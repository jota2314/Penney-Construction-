import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import { crewToday } from "@/lib/crew/schedule-dates";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { deriveScheduleHealth, recentWorkDates, type ScheduleHealthPhase, type ScheduleWorkLog } from "@/lib/schedule/health";
import { withEffectiveScheduleDates, type CascadeInput } from "@/lib/schedule/cascade";
import { isMasterPhase } from "@/lib/schedule/progress";

export const maxDuration = 60;

/**
 * AI health read for the job board: one Claude call over compact per-project
 * signals (schedule slippage, overdue todos, stuck material orders, unsigned
 * COs, field-log activity + tone) → { health, note, issues[] } per project.
 * If the model call fails, deterministic signals still produce a rating so
 * the board never renders blank dots.
 */

type HealthPhase = ScheduleHealthPhase & CascadeInput & { project_id: string };
type HealthLog = ScheduleWorkLog & { id: string; project_id: string | null; text: string | null };

interface Signals {
  id: string;
  name: string;
  number: string;
  status: string;
  overduePhases: string[];
  scheduleIssues: string[];
  scheduleUrgent: boolean;
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

/** Signals-only fallback rating, also used when the model reply won't parse. */
function ruleBasedHealth(s: Signals): HealthRow {
  const issues = [
    ...s.scheduleIssues,
    ...s.stuckOrders.map((o) => `Material order past needed-by: ${o}`),
    ...s.overdueTodos.map((t) => `Overdue: ${t}`),
    ...s.unsignedCOs.map((c) => `CO not signed: ${c}`),
  ];
  if (s.status === "in_progress" && s.daysSinceLastLog !== null && s.daysSinceLastLog > 5) {
    issues.push(`No field activity in ${s.daysSinceLastLog} days`);
  }
  const health = s.scheduleUrgent || issues.length >= 3 ? "red" : issues.length > 0 ? "yellow" : "green";
  return { id: s.id, health, note: issues.length ? "" : "On track", issues };
}

export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canViewJobBoard({ role: user.profile?.role, email: user.profile?.email ?? user.email })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, project_number, status")
    .neq("status", "cancelled")
    .eq("is_overhead", false);
  if (!projects || projects.length === 0) {
    return NextResponse.json({ projects: [] });
  }

  const ids = projects.map((p) => p.id);
  const today = crewToday();
  const recentCutoff = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();

  const [{ data: phases }, { data: todos }, { data: orders }, { data: cos }, { data: logs }] =
    await Promise.all([
      fetchAllRows<HealthPhase>((from, to) => supabase
        .from("schedule_phases")
        .select("id, project_id, name, phase_scope, event_type, start_date, end_date, planned_start_date, planned_end_date, sort_order, is_manually_scheduled, is_confirmed, actual_completed_at, estimate_line_item_id, status")
        .in("project_id", ids)
        .order("id")
        .range(from, to)
        .throwOnError()).then((data) => ({ data })),
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
      fetchAllRows<HealthLog>((from, to) => supabase
        .from("daily_logs")
        .select("id, project_id, started_at, ended_at, status, text")
        .in("project_id", ids)
        .gte("started_at", recentCutoff)
        .order("started_at", { ascending: false })
        .order("id")
        .range(from, to)
        .throwOnError()).then((data) => ({ data })),
    ]);

  const signals: Signals[] = projects.map((p) => {
    const projLogs = (logs ?? []).filter((l) => l.project_id === p.id);
    const lastLog = projLogs[0];
    const projTodos = (todos ?? []).filter((t) => t.project_id === p.id);
    const savedPhases = (phases ?? []).filter((ph) => ph.project_id === p.id);
    const effective = withEffectiveScheduleDates(savedPhases.filter(isMasterPhase));
    const schedule = deriveScheduleHealth({ status: p.status, phases: effective, today, recentWorkDates: recentWorkDates(projLogs, today) });
    return {
      id: p.id,
      name: p.name,
      number: p.project_number,
      status: p.status,
      scheduleIssues: schedule.issues.map((issue) => issue.text),
      scheduleUrgent: schedule.issues.some((issue) => issue.tone === "urgent"),
      overduePhases: schedule.overduePhases
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
  }).filter((s) => ["in_progress", "contracted", "proposal_sent", "estimating"].includes(s.status) || s.scheduleIssues.length > 0);

  const fallback = signals.map(ruleBasedHealth);

  try {
    const system = `You are the project-health reader for Penney Construction's job board. Today: ${nowStamp()}

You get one JSON array of projects with hard signals (scheduleIssues, overdue master phases, stuck material orders, overdue todos, unsigned change orders, field-log recency) and the raw text of recent field logs. scheduleIssues are deterministic review findings and must be preserved; they are not permission to change dates or status. Read the field-log tone too — complaints, rework, blockers, waiting-on-someone all count against a job.

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
      const signal = signals.find((s) => s.id === fb.id)!;
      const aiIssues = Array.isArray(ai.issues) ? ai.issues.filter((i) => typeof i === "string") : [];
      // An AI summary may add context, never erase or downgrade known schedule gaps.
      const health = signal.scheduleUrgent ? "red" : signal.scheduleIssues.length && ai.health === "green" ? "yellow" : ai.health;
      return {
        id: fb.id,
        health,
        note: signal.scheduleIssues.length ? signal.scheduleIssues[0] : typeof ai.note === "string" ? ai.note.slice(0, 140) : "",
        issues: [...new Set([...signal.scheduleIssues, ...aiIssues])].slice(0, Math.max(4, signal.scheduleIssues.length)),
      };
    });
    return NextResponse.json({ projects: merged });
  } catch (error) {
    console.error("[board/health] AI read failed, serving rule-based ratings:", error);
    return NextResponse.json({ projects: fallback });
  }
}
