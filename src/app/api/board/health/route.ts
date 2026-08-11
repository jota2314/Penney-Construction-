import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

export const maxDuration = 60;

/**
 * AI health read for the job board: one Claude call over compact per-project
 * signals (schedule slippage, overdue todos, stuck material orders, unsigned
 * COs, field-log activity + tone) → { health, note, issues[] } per project.
 * If the model call fails, deterministic signals still produce a rating so
 * the board never renders blank dots.
 */

const BOARD_STATUSES = ["in_progress", "contracted", "proposal_sent", "estimating"];

interface Signals {
  id: string;
  name: string;
  number: string;
  status: string;
  overduePhases: string[];
  overdueTodos: string[];
  openTodoCount: number;
  stuckOrders: string[];
  unsignedCOs: string[];
  daysSinceLastLog: number | null;
  recentLogNotes: string[];
}

interface HealthRow {
  id: string;
  health: "green" | "yellow" | "red";
  note: string;
  issues: string[];
}

function localDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Signals-only fallback rating, also used when the model reply won't parse. */
function ruleBasedHealth(s: Signals): HealthRow {
  const issues = [
    ...s.overduePhases.map((p) => `Phase past its end date: ${p}`),
    ...s.stuckOrders.map((o) => `Material order past needed-by: ${o}`),
    ...s.overdueTodos.map((t) => `Overdue: ${t}`),
    ...s.unsignedCOs.map((c) => `CO not signed: ${c}`),
  ];
  if (s.status === "in_progress" && s.daysSinceLastLog !== null && s.daysSinceLastLog > 5) {
    issues.push(`No field activity in ${s.daysSinceLastLog} days`);
  }
  const health = issues.length >= 3 ? "red" : issues.length > 0 ? "yellow" : "green";
  return { id: s.id, health, note: issues.length ? "" : "On track", issues };
}

export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canViewJobBoard(user.profile?.email ?? user.email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, project_number, status")
    .in("status", BOARD_STATUSES)
    .eq("is_overhead", false);
  if (!projects || projects.length === 0) {
    return NextResponse.json({ projects: [] });
  }

  const ids = projects.map((p) => p.id);
  const today = localDateStr(new Date());
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

  const [{ data: phases }, { data: todos }, { data: orders }, { data: cos }, { data: logs }] =
    await Promise.all([
      supabase
        .from("schedule_phases")
        .select("project_id, name, end_date, status")
        .in("project_id", ids)
        .lt("end_date", today)
        .not("status", "in", '("completed","cancelled")'),
      supabase
        .from("todos")
        .select("project_id, description, due_date")
        .in("project_id", ids)
        .eq("status", "open"),
      supabase
        .from("material_orders")
        .select("project_id, order_number, needed_by, status, material_order_items(item_name)")
        .in("project_id", ids)
        .in("status", ["pending", "approved"])
        .lt("needed_by", today),
      supabase
        .from("change_orders")
        .select("project_id, title, status")
        .in("project_id", ids)
        .not("status", "in", '("approved","rejected","cancelled")'),
      supabase
        .from("daily_logs")
        .select("project_id, started_at, text")
        .in("project_id", ids)
        .gte("started_at", twoWeeksAgo)
        .order("started_at", { ascending: false })
        .limit(400),
    ]);

  const signals: Signals[] = projects.map((p) => {
    const projLogs = (logs ?? []).filter((l) => l.project_id === p.id);
    const lastLog = projLogs[0];
    const projTodos = (todos ?? []).filter((t) => t.project_id === p.id);
    return {
      id: p.id,
      name: p.name,
      number: p.project_number,
      status: p.status,
      overduePhases: (phases ?? [])
        .filter((ph) => ph.project_id === p.id)
        .slice(0, 5)
        .map((ph) => `${ph.name} (ended ${ph.end_date})`),
      overdueTodos: projTodos
        .filter((t) => t.due_date && t.due_date < today)
        .slice(0, 5)
        .map((t) => t.description.slice(0, 80)),
      openTodoCount: projTodos.length,
      stuckOrders: (orders ?? [])
        .filter((o) => o.project_id === p.id)
        .slice(0, 5)
        .map(
          (o) =>
            `${o.order_number} ${o.material_order_items?.[0]?.item_name ?? ""} (needed ${o.needed_by}, ${o.status})`,
        ),
      unsignedCOs: (cos ?? [])
        .filter((c) => c.project_id === p.id)
        .slice(0, 5)
        .map((c) => c.title.slice(0, 60)),
      daysSinceLastLog: lastLog
        ? Math.floor((Date.now() - new Date(lastLog.started_at).getTime()) / 86400000)
        : null,
      recentLogNotes: projLogs
        .filter((l) => l.text && l.text.trim().length > 10)
        .slice(0, 5)
        .map((l) => l.text!.slice(0, 200)),
    };
  });

  const fallback = signals.map(ruleBasedHealth);

  try {
    const system = `You are the project-health reader for Penney Construction's job board. Today: ${nowStamp()}

You get one JSON array of active projects with hard signals (overdue phases, stuck material orders, overdue todos, unsigned change orders, field-log recency) and the raw text of recent field logs. Read the field-log tone too — complaints, rework, blockers, waiting-on-someone all count against a job.

Return ONLY a JSON array, one object per project, same order:
[{"id":"<project id>","health":"green"|"yellow"|"red","note":"<one short sentence, plain words, how the job feels>","issues":["<short issue to raise>", ...]}]

Rules:
- "issues" = things Jorge should act on, most urgent first, max 4, each under 12 words.
- red = schedule or money is actively slipping; yellow = needs an eye; green = on track.
- estimating/proposal jobs with no signals are green with an empty issues list.
- No markdown, no prose outside the JSON.`;

    const reply = await callClaude(system, JSON.stringify(signals), 3000);
    const jsonText = reply.slice(reply.indexOf("["), reply.lastIndexOf("]") + 1);
    const parsed = JSON.parse(jsonText) as HealthRow[];
    const byId = new Map(parsed.map((r) => [r.id, r]));
    const merged: HealthRow[] = fallback.map((fb) => {
      const ai = byId.get(fb.id);
      if (!ai || !["green", "yellow", "red"].includes(ai.health)) return fb;
      return {
        id: fb.id,
        health: ai.health,
        note: typeof ai.note === "string" ? ai.note.slice(0, 140) : "",
        issues: Array.isArray(ai.issues)
          ? ai.issues.filter((i) => typeof i === "string").slice(0, 4)
          : fb.issues,
      };
    });
    return NextResponse.json({ projects: merged });
  } catch (error) {
    console.error("[board/health] AI read failed, serving rule-based ratings:", error);
    return NextResponse.json({ projects: fallback });
  }
}
