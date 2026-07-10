import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import type {
  ActionCardData,
  FeedEmailSummary,
  FeedItem,
  FeedTodoSummary,
  FeedWalkthroughSummary,
  Jobsite,
  RoleId,
} from "@/components/field-feed/command-center-feed";
import { listRecentFieldActivity, getWeekSchedule } from "@/lib/actions/daily-logs";
import { getPendingDecisions } from "@/lib/actions/decisions";
import { listRecentCompanyFeedPosts } from "@/lib/actions/company-feed";

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

type WalkthroughRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  purpose: string | null;
  status: string;
  visited_at: string;
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

// Open clock-in (daily_logs status='in_progress'). project_id is direct on
// new project-first logs; older clock-ins only know their schedule phase.
type LiveLogRow = {
  project_id: string | null;
  author_id: string | null;
  phase: { project_id: string | null } | { project_id: string | null }[] | null;
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

  const safe = <T>(b: PromiseLike<{ data: T | null; error: unknown }>) =>
    Promise.resolve(b).catch(() => ({ data: null as T | null, error: true }));

  const [
    todosRes,
    walkthroughsRes,
    projectsRes,
    phasesRes,
    allProjectsRes,
    emailsRes,
    liveLogsRes,
  ] = await Promise.all([
    safe<TodoRow[]>(
      supabase
        .from("todos")
        .select("id, project_id, project_name, contact_name, contact_type, description, status, priority, due_date, category, ai_summary")
        .eq("status", "open")
        .order("priority", { ascending: false })
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(50),
    ),
    safe<WalkthroughRow[]>(
      supabase
        .from("walkthroughs")
        .select("id, name, address, city, purpose, status, visited_at")
        .order("visited_at", { ascending: false })
        .limit(12),
    ),
    // Every active jobsite — the rail is the source of truth for "what's on
    // the board", so no tight cap (was 8, which silently dropped jobs).
    safe<ProjectRow[]>(
      supabase
        .from("projects")
        .select("id, project_number, name, status, address, city, state, contract_value, estimated_value")
        .in("status", ["in_progress", "contracted"])
        .order("updated_at", { ascending: false })
        .limit(50),
    ),
    safe<PhaseRow[]>(
      supabase
        .from("schedule_phases")
        .select("id, project_id, name, start_date, end_date, status")
        .gte("end_date", today.toISOString().slice(0, 10))
        .lte("start_date", in14d.toISOString().slice(0, 10))
        .order("start_date", { ascending: true })
        .limit(200),
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
            .order("date", { ascending: false })
            .limit(12)
        : Promise.resolve({ data: [] as EmailRow[], error: null }),
    ),
    // Who's on the clock right now — drives the "Live" badge + crew initials
    // on jobsite cards. 24h window so a forgotten open shift doesn't show a
    // site as live for days.
    safe<LiveLogRow[]>(
      supabase
        .from("daily_logs")
        .select("project_id, author_id, phase:schedule_phases!schedule_phase_id(project_id)")
        .eq("status", "in_progress")
        .gte("started_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    ),
  ]);

  const todos = todosRes.data ?? [];
  const walkthroughs = walkthroughsRes.data ?? [];
  const activeProjects = projectsRes.data ?? [];
  const phases = phasesRes.data ?? [];
  const pipeline = allProjectsRes.data ?? [];
  // Senders that are pure-robot notification services. Even if a stale
  // classification stored urgency='urgent' (the prompt has since been
  // tightened), suppress them from the swipe stack — they're never humans
  // waiting on Penney. Real invoices/quotes delivered through QuickBooks
  // etc. come from different addresses and aren't affected.
  const ROBOT_SENDER_PATTERNS = [
    "buildertrend.com",
    "notify.buildertrend.com",
    "noreply@",
    "no-reply@",
    "donotreply@",
  ];

  const isRobotSender = (e: EmailRow): boolean => {
    const addr = (e.from_email ?? "").toLowerCase();
    return ROBOT_SENDER_PATTERNS.some((p) => addr.includes(p));
  };

  const emails = (emailsRes.data ?? []).filter((e) => !isRobotSender(e));

  // Recent daily-log posts (read-only social feed for managers) + the manager's
  // top-of-feed week schedule. The clock-in/out flow itself lives on /crew —
  // managers don't clock in.
  const [recentLogs, companyPosts, weekSchedule, pendingDecisions] = await Promise.all([
    listRecentFieldActivity(20).catch(() => []),
    listRecentCompanyFeedPosts(20).catch(() => []),
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

  // ── Todo popup summaries ───────────────────────────────────────
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

  const todoSummaries: FeedTodoSummary[] = ranked.slice(0, 12).map((t) => {
    const overdue = t.due_date ? new Date(t.due_date) < today : false;
    const priority = overdue || t.priority === "urgent" ? "urgent" : t.priority === "high" ? "high" : "normal";
    return {
      id: t.id,
      description: t.description,
      project: t.project_name,
      priority,
      dueDate: t.due_date,
    };
  });

  // ── Decision cards (AI-proposed actions awaiting approval) ─────
  const decisionCards: ActionCardData[] = pendingDecisions.map((d) => {
    const eyebrowMap: Record<string, string> = {
      add_schedule_phase: "Schedule · Confirm phase",
      delete_schedule_phase: "Schedule · Confirm delete",
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

  // ── Email popup summaries ──────────────────────────────────────
  const sortedEmails = [...emails].sort((a, b) => {
    const ua = a.urgency === "urgent" ? 0 : 1;
    const ub = b.urgency === "urgent" ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });

  const emailSummaries: FeedEmailSummary[] = sortedEmails.map((email) => ({
    id: email.id,
    subject: email.subject || "(no subject)",
    sender: email.from_name || email.from_email || "Unknown sender",
    snippet: email.snippet || "No preview available",
    date: email.date || new Date(0).toISOString(),
    urgent: email.urgency === "urgent" || email.ai_action_required === true,
  }));

  // ── Walkthrough popup summaries ────────────────────────────────
  const walkthroughSummaries: FeedWalkthroughSummary[] = walkthroughs.map(
    (walkthrough) => ({
      id: walkthrough.id,
      name: walkthrough.name,
      address:
        [walkthrough.address, walkthrough.city].filter(Boolean).join(", ") || null,
      purpose: walkthrough.purpose,
      status: walkthrough.status,
      visitedAt: walkthrough.visited_at,
    }),
  );

  // ── Jobsites ───────────────────────────────────────────────────
  const phasesByProject = new Map<string, PhaseRow[]>();
  for (const p of phases) {
    const arr = phasesByProject.get(p.project_id) ?? [];
    arr.push(p);
    phasesByProject.set(p.project_id, arr);
  }

  // Resolve open clock-ins → crew initials per project.
  const liveLogs = liveLogsRes.data ?? [];
  const liveAuthorIds = Array.from(
    new Set(liveLogs.map((l) => l.author_id).filter((a): a is string => Boolean(a))),
  );
  const initialsByProfile = new Map<string, string>();
  if (liveAuthorIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("profile_id, first_name, last_name")
      .in("profile_id", liveAuthorIds);
    for (const e of emps ?? []) {
      if (e.profile_id) {
        const initials = `${e.first_name?.[0] ?? ""}${e.last_name?.[0] ?? ""}`.toUpperCase();
        if (initials) initialsByProfile.set(e.profile_id, initials);
      }
    }
    const missing = liveAuthorIds.filter((id) => !initialsByProfile.has(id));
    if (missing.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", missing);
      for (const pr of profs ?? []) {
        const parts = (pr.full_name ?? "").trim().split(/\s+/);
        const initials = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
        if (initials) initialsByProfile.set(pr.id, initials);
      }
    }
  }
  const liveCrewByProject = new Map<string, string[]>();
  for (const l of liveLogs) {
    const phase = Array.isArray(l.phase) ? l.phase[0] : l.phase;
    const pid = l.project_id ?? phase?.project_id;
    if (!pid || !l.author_id) continue;
    const initials = initialsByProfile.get(l.author_id);
    if (!initials) continue;
    const arr = liveCrewByProject.get(pid) ?? [];
    if (!arr.includes(initials)) arr.push(initials);
    liveCrewByProject.set(pid, arr);
  }

  // Sites with crew on the clock first, then in-progress jobs, then pre-con.
  // Stable sort keeps most-recently-updated first within each group.
  const jobsiteRank = (p: ProjectRow) =>
    liveCrewByProject.has(p.id) ? 0 : p.status === "in_progress" ? 1 : 2;
  const orderedProjects = [...activeProjects].sort((a, b) => jobsiteRank(a) - jobsiteRank(b));

  const todayDateStr = today.toISOString().slice(0, 10);
  const jobsites: Jobsite[] = orderedProjects.map((p, i) => {
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
      crew: liveCrewByProject.get(p.id) ?? [],
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
  feed.push({ type: "emailInbox", emails: emailSummaries });
  feed.push({ type: "todoInbox", todos: todoSummaries });
  feed.push({ type: "walkthroughsInbox", walkthroughs: walkthroughSummaries });

  if (todayItem) feed.push(todayItem);

  // Keep approvals as an ordinary labeled section. Email, todos, and walkthroughs
  // now have dedicated popup cards, so the old tab strip is gone.
  if (decisionCards.length > 0) {
    feed.push({ type: "section", label: "AI approvals" });
    feed.push(...decisionCards);
  }

  if (companyPosts.length > 0) {
    feed.push({ type: "section", label: "Company updates" });
    for (const post of companyPosts) {
      feed.push({ type: "companyPost", post });
    }
  }

  if (recentLogs.length > 0) {
    feed.push({ type: "section", label: "From the field" });
    for (const item of recentLogs) {
      if (item.kind === "punch-group") {
        feed.push({ type: "punchGroupPost", group: item });
      } else {
        feed.push({ type: "logPost", log: item });
      }
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
