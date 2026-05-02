import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import type { ActionCardData, FeedItem, Jobsite, RoleId } from "@/components/field-feed/command-center-feed";
import { listRecentDailyLogs, getWeekSchedule } from "@/lib/actions/daily-logs";
import { getPendingDecisions } from "@/lib/actions/decisions";

const TZ = "America/New_York";

function nowET(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).replace(/^0/, "");
}

function fmtRelativeDay(iso: string): string {
  const d = new Date(iso);
  const today = startOfDay(nowET());
  const target = startOfDay(new Date(d.toLocaleString("en-US", { timeZone: TZ })));
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
  }
  if (diffDays < 0) return `${-diffDays}d overdue`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
}

function fmtScheduleWhen(startIso: string): string {
  const day = fmtRelativeDay(startIso);
  // Phases are date-only — skip the time component
  return day;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

const PROJECT_COLORS = ["amber", "blue", "violet", "rose", "emerald", "cyan", "fuchsia"] as const;

type TodoRow = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  contact_name: string;
  contact_type: string;
  description: string;
  status: "open" | "done" | "snoozed";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  category: string;
  ai_summary: string | null;
};

type QuoteRow = {
  id: string;
  project_name: string;
  subcontractor_name: string;
  trade: string | null;
  amount: number | null;
  status: string;
  sent_at: string;
};

type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  contract_value: number | null;
  estimated_value: number | null;
};

type PhaseRow = {
  id: string;
  project_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "not_started" | "in_progress" | "completed" | "on_hold";
};

type EmailRow = {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  snippet: string | null;
  urgency: string | null;
  ai_action_required: boolean | null;
  date: string | null;
};

export async function getCommandCenterFeedData(
  role: RoleId,
): Promise<{ feed: FeedItem[]; jobsites: Jobsite[] }> {
  const supabase = await createClient();
  const authUser = await getUser();
  const userId = authUser?.profile?.id ?? authUser?.id ?? null;

  const now = nowET();
  const today = startOfDay(now);
  const in14d = new Date(today);
  in14d.setDate(in14d.getDate() + 14);
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const safe = <T>(b: PromiseLike<{ data: T | null; error: unknown }>) =>
    Promise.resolve(b).catch(() => ({ data: null as T | null, error: true }));

  const [todosRes, quotesRes, projectsRes, phasesRes, allProjectsRes, emailsRes] = await Promise.all([
    safe<TodoRow[]>(
      supabase
        .from("todos")
        .select("id, project_id, project_name, contact_name, contact_type, description, status, priority, due_date, category, ai_summary")
        .eq("status", "open")
        .order("priority", { ascending: false })
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(50),
    ),
    safe<QuoteRow[]>(
      supabase
        .from("quote_requests")
        .select("id, project_name, subcontractor_name, trade, amount, status, sent_at")
        .in("status", ["just_sent", "awaiting_reply"])
        .lt("sent_at", threeDaysAgo.toISOString())
        .order("sent_at", { ascending: true })
        .limit(10),
    ),
    safe<ProjectRow[]>(
      supabase
        .from("projects")
        .select("id, project_number, name, status, address, city, state, contract_value, estimated_value")
        .in("status", ["in_progress", "contracted"])
        .order("updated_at", { ascending: false })
        .limit(8),
    ),
    safe<PhaseRow[]>(
      supabase
        .from("schedule_phases")
        .select("id, project_id, name, start_date, end_date, status")
        .gte("end_date", today.toISOString().slice(0, 10))
        .lte("start_date", in14d.toISOString().slice(0, 10))
        .order("start_date", { ascending: true })
        .limit(20),
    ),
    safe<{ status: string; contract_value: number | null; estimated_value: number | null }[]>(
      supabase
        .from("projects")
        .select("status, contract_value, estimated_value")
        .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]),
    ),
    safe<EmailRow[]>(
      userId
        ? supabase
            .from("inbox_emails")
            .select("id, subject, from_name, from_email, snippet, urgency, ai_action_required, date")
            .eq("created_by", userId)
            .eq("is_processed", false)
            .eq("is_dismissed", false)
            .or("urgency.eq.urgent,ai_action_required.eq.true")
            .order("date", { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] as EmailRow[], error: null }),
    ),
  ]);

  const todos = todosRes.data ?? [];
  const quotes = quotesRes.data ?? [];
  const activeProjects = projectsRes.data ?? [];
  const phases = phasesRes.data ?? [];
  const pipeline = allProjectsRes.data ?? [];
  const emails = emailsRes.data ?? [];

  // Recent daily-log posts (read-only social feed for managers) + the manager's
  // top-of-feed week schedule. The clock-in/out flow itself lives on /crew —
  // managers don't clock in.
  const [recentLogs, weekSchedule, pendingDecisions] = await Promise.all([
    listRecentDailyLogs(12).catch(() => []),
    getWeekSchedule().catch(() => ({ weekStart: "", weekEnd: "", phases: [], myEmployeeIds: [] })),
    getPendingDecisions().catch(() => []),
  ]);
  const hideFinances = role === "crew" || role === "lead";

  // ── Today strip ────────────────────────────────────────────────
  const todayEnd = new Date(today);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const todayTodos = todos.filter((t) => {
    if (!t.due_date) return false;
    const d = new Date(t.due_date);
    return d >= today && d < todayEnd;
  });

  const todayItem: FeedItem | null = todayTodos.length
    ? {
        type: "today",
        events: todayTodos.slice(0, 6).map((t) => ({
          time: fmtTime(t.due_date!),
          what: t.description,
          tag: t.priority === "urgent" ? "urgent" : t.priority === "high" ? "high" : "normal",
          done: false,
        })),
      }
    : null;

  // ── Action cards from todos ────────────────────────────────────
  const ranked = [...todos].sort((a, b) => {
    const pri = (p: string) =>
      p === "urgent" ? 0 : p === "high" ? 1 : p === "medium" ? 2 : 3;
    const ap = pri(a.priority);
    const bp = pri(b.priority);
    if (ap !== bp) return ap - bp;
    const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return ad - bd;
  });

  const todoCards: FeedItem[] = ranked.slice(0, 6).map((t) => {
    const overdue = t.due_date ? new Date(t.due_date) < today : false;
    const priority = overdue || t.priority === "urgent" ? "urgent" : t.priority === "high" ? "high" : "normal";
    const lines: string[] = [];
    if (t.due_date) lines.push(`${overdue ? "Overdue · " : ""}${fmtRelativeDay(t.due_date)}`);
    if (t.ai_summary) lines.push(t.ai_summary);
    if (t.contact_name && t.contact_type !== "internal") lines.push(t.contact_name);

    return {
      type: "action",
      id: `todo-${t.id}`,
      priority,
      kind: t.category,
      eyebrow: t.project_name ? `${t.category.replace(/_/g, " ")} · ${t.project_name}` : t.category.replace(/_/g, " "),
      title: t.description,
      lines: lines.length ? lines : undefined,
      primary: { label: "Mark done", icon: "check" },
      secondary: { label: "Snooze 1d", icon: "clock" },
    };
  });

  // ── Decision cards (AI-proposed actions awaiting approval) ─────
  const decisionCards: ActionCardData[] = pendingDecisions.map((d) => {
    const eyebrowMap: Record<string, string> = {
      add_schedule_phase: "Schedule · Confirm phase",
      link_quote_to_line: "Quote · Confirm budget line",
      link_invoice_to_line: "Invoice · Confirm budget line",
    };
    const lines: string[] = [];
    if (d.context) lines.push(d.context);
    return {
      type: "action",
      id: `decision-${d.id}`,
      priority: "high",
      kind: "decision",
      eyebrow: eyebrowMap[d.decision_type] ?? "AI · Needs review",
      title: d.title,
      lines: lines.length ? lines : undefined,
      primary: { label: "Confirm", icon: "check" },
      secondary: { label: "Reject", icon: "x" },
      decisionId: d.id,
    };
  });

  // ── Email cards (urgent first, then AI-flagged "hot") ──────────
  const sortedEmails = [...emails].sort((a, b) => {
    const ua = a.urgency === "urgent" ? 0 : 1;
    const ub = b.urgency === "urgent" ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });

  const emailCards: ActionCardData[] = sortedEmails.slice(0, 6).map((e) => {
    const isUrgent = e.urgency === "urgent";
    const sender = e.from_name || e.from_email || "Unknown sender";
    const lines: string[] = [sender];
    if (e.snippet) lines.push(e.snippet.length > 100 ? `${e.snippet.slice(0, 100)}…` : e.snippet);
    return {
      type: "action",
      id: `email-${e.id}`,
      priority: isUrgent ? "urgent" : "high",
      kind: "email",
      eyebrow: isUrgent ? "Email · Urgent" : "Email · Hot",
      title: e.subject || "(no subject)",
      lines,
      primary: { label: "Done", icon: "check" },
      secondary: { label: "Dismiss", icon: "x" },
      emailId: e.id,
    };
  });

  // ── Action cards from overdue quote follow-ups ─────────────────
  const quoteCards: FeedItem[] = quotes.slice(0, 4).map((q) => {
    const days = Math.floor((Date.now() - new Date(q.sent_at).getTime()) / 86400000);
    const priority = days >= 7 ? "urgent" : days >= 5 ? "high" : "normal";
    return {
      type: "action",
      id: `quote-${q.id}`,
      priority,
      kind: "quote",
      eyebrow: `Sub follow-up · ${q.project_name}`,
      title: `Chase ${q.subcontractor_name}${q.trade ? ` · ${q.trade}` : ""}.`,
      lines: [`Sent ${days}d ago, no reply.`],
      primary: { label: "Send reminder", icon: "mail" },
      secondary: { label: "Open", icon: "doc" },
    };
  });

  // ── Jobsites ───────────────────────────────────────────────────
  const phasesByProject = new Map<string, PhaseRow[]>();
  for (const p of phases) {
    const arr = phasesByProject.get(p.project_id) ?? [];
    arr.push(p);
    phasesByProject.set(p.project_id, arr);
  }

  const todayDateStr = today.toISOString().slice(0, 10);
  const jobsites: Jobsite[] = activeProjects.map((p, i) => {
    const ps = phasesByProject.get(p.id) ?? [];
    const current = ps.find((x) => x.start_date <= todayDateStr && x.end_date >= todayDateStr);
    const next = ps.find((x) => x.start_date > todayDateStr);
    const phaseLabel = current?.name ?? (next ? `Next: ${next.name}` : p.status === "in_progress" ? "In progress" : "Pre-con");
    const status = current?.status === "in_progress" ? "in progress" : current?.name?.toLowerCase() ?? p.status.replace(/_/g, " ");
    const addressParts = [p.address, p.city].filter(Boolean).join(", ");

    return {
      id: p.id,
      project: p.name,
      address: addressParts || "—",
      crew: [],
      lead: null,
      status,
      phase: phaseLabel,
      weather: "—",
      color: PROJECT_COLORS[i % PROJECT_COLORS.length],
    };
  });

  // ── Schedule (next 14d) ────────────────────────────────────────
  const projectNameById = new Map(activeProjects.map((p) => [p.id, p.name]));
  const scheduleItems = phases
    .filter((p) => p.start_date >= todayDateStr || p.status === "in_progress")
    .slice(0, 6)
    .map((p) => ({
      when: fmtScheduleWhen(`${p.start_date}T08:00:00`),
      what: `${projectNameById.get(p.project_id) ?? "Project"} · ${p.name}`,
    }));

  const scheduleItem: FeedItem | null = scheduleItems.length
    ? { type: "schedule", items: scheduleItems }
    : null;

  // ── Pipeline metric ────────────────────────────────────────────
  const pipelineByStatus = new Map<string, { count: number; value: number }>();
  for (const p of pipeline) {
    const value = Number(p.contract_value ?? p.estimated_value ?? 0);
    const cur = pipelineByStatus.get(p.status) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += value;
    pipelineByStatus.set(p.status, cur);
  }
  const totalValue = [...pipelineByStatus.values()].reduce((s, x) => s + x.value, 0);
  const totalCount = pipeline.length;

  const pipelineItem: FeedItem | null = totalCount > 0
    ? {
        type: "metric",
        id: "pipeline",
        title: "Pipeline",
        big: fmtMoney(totalValue),
        sub: "across all projects",
        bars: [
          { label: "Active", value: (pipelineByStatus.get("in_progress")?.value ?? 0) / Math.max(totalValue, 1) },
          { label: "Contract", value: (pipelineByStatus.get("contracted")?.value ?? 0) / Math.max(totalValue, 1) },
          { label: "Proposal", value: (pipelineByStatus.get("proposal_sent")?.value ?? 0) / Math.max(totalValue, 1) },
          { label: "Estimate", value: (pipelineByStatus.get("estimating")?.value ?? 0) / Math.max(totalValue, 1) },
          { label: "Lead", value: (pipelineByStatus.get("lead")?.value ?? 0) / Math.max(totalValue, 1) },
        ].filter((b) => b.value > 0),
        detail: `${pipelineByStatus.get("in_progress")?.count ?? 0} active · ${pipelineByStatus.get("contracted")?.count ?? 0} contracted · ${pipelineByStatus.get("estimating")?.count ?? 0} estimating`,
      }
    : null;

  // ── Assemble feed ──────────────────────────────────────────────
  const feed: FeedItem[] = [];

  // Week/day schedule first — this is the manager's primary planning surface.
  if (weekSchedule.weekStart) {
    feed.push({
      type: "weekSchedule",
      weekStart: weekSchedule.weekStart,
      weekEnd: weekSchedule.weekEnd,
      phases: weekSchedule.phases,
      myEmployeeIds: weekSchedule.myEmployeeIds,
    });
  }

  if (todayItem) feed.push(todayItem);

  // Each section becomes its own swipe stack — section headers between
  // action runs break the grouping so urgent emails don't bleed into todos.
  const sortedTodosAndQuotes = [...todoCards, ...quoteCards].sort((a, b) => {
    if (a.type !== "action" || b.type !== "action") return 0;
    const order = { urgent: 0, high: 1, normal: 2 } as const;
    return order[a.priority] - order[b.priority];
  });

  // Single tabbed swipe section — the user toggles between Decisions /
  // Emails / Needs you instead of seeing three stacked sections.
  const swipeSections = [
    { id: "decisions" as const, label: "AI",    cards: decisionCards },
    { id: "emails" as const,    label: "Email", cards: emailCards },
    { id: "needs_you" as const, label: "Todo",  cards: sortedTodosAndQuotes as ActionCardData[] },
  ].filter((s) => s.cards.length > 0);

  if (swipeSections.length > 0) {
    feed.push({ type: "swipeSections", sections: swipeSections });
  }

  if (jobsites.length > 0) {
    feed.push({ type: "section", label: "Active jobs" });
    feed.push({ type: "jobsites", sites: jobsites });
  }

  if (recentLogs.length > 0) {
    feed.push({ type: "section", label: "From the field" });
    for (const log of recentLogs) {
      feed.push({ type: "logPost", log });
    }
  }

  // Old "Coming up" stub list replaced by the week/day ScheduleStrip above.
  void scheduleItem;

  if (pipelineItem && !hideFinances) {
    feed.push({ type: "section", label: "This week" });
    feed.push(pipelineItem);
  }

  return { feed, jobsites };
}
