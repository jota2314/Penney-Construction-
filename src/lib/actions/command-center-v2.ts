"use server";

import { createClient } from "@/lib/supabase/server";

export type TimeRange = "week" | "month" | "quarter" | "year";

export interface PeriodInfo {
  range: TimeRange;
  offset: number;
  start: string;       // ISO
  end: string;         // ISO
  label: string;       // "This week · Apr 20 – 26" / "Last month · March 2026"
  isCurrent: boolean;
}

export interface CommandCenterV2Data {
  period: PeriodInfo;
  money: {
    contract: number;       // sum of contract_value across active projects
    spent: number;          // paid invoices (money out) during the period
    received: number;       // client payments (money in) during the period
    committed: number;      // unpaid invoices (already booked work) — kept for legacy, hidden in UI
    remaining: number;      // contract - spent - committed
    pipeline: number;       // estimated_value of leads / proposal_sent / estimating
    marginQ2: number;       // derived from spent vs revenue; 0..1
    marginTrend: number;    // placeholder — 0.03 until we compute historical
    revenueQ2ToDate: number;
    revenueQ2Target: number;
  };
  projects: Array<{
    id: string;
    project_number: string | null;
    name: string;
    phase: string | null;
    status: string;
    contract_value: number;
    progress: number;       // 0..1 — derived from spent / contract_value
    next_action: string | null;
    flag: "urgent" | "high" | null;
  }>;
  week: Array<{
    day: string;
    date: number;
    isoDate: string;
    items: Array<{ title: string; project: string; tag?: string | null }>;
  }>;
  todayIdx: number;
  attention: Array<{
    priority: "urgent" | "high" | "medium" | "low";
    icon: string;
    text: string;
    meta: string;
    href?: string;
  }>;
  pipeline: {
    estimates: { draft: number; review: number; approved: number; sent: number; totalValue: number };
    quotes: { awaiting: number; received: number; accepted: number; declined: number };
    leadsThisWeek: number;
    actualOverheadYtd: number;  // qb_opex from latest overhead_config row — real dollars spent YTD
    overheadPeriodLabel: string;
  };
  stakeholders: Array<{
    role: string;
    name: string;
    tag: string;
    avatar: string;
    color: string;
  }>;
  recent: Array<{ when: string; text: string; by: string }>;
  headline: {
    active: number;
    inFlight: number;      // sum of contract_value
    paceDeltaPct: number;  // placeholder 0.08
    healthStatus: string;
  };
}

// Supabase row shapes (narrow — only fields we read)
interface ProjectRow {
  id: string;
  project_number: string | null;
  name: string;
  phase: string | null;
  status: string;
  contract_value: number | string | null;
  estimated_value: number | string | null;
  next_action: string | null;
  updated_at: string;
  created_at?: string;
}
interface InvoiceRow { project_id: string; amount: number | string | null; payment_status: string | null; invoice_date: string | null }
interface EstimateRow { status: string; total_price: number | string | null; project_id: string; created_at?: string }
interface QuoteRow { status: string; created_at: string }
interface PhaseRow {
  id: string;
  project_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  event_type: string | null;
}
interface TodoRow {
  id: string;
  description: string;
  priority: string | null;
  due_date: string | null;
  contact_name: string | null;
  category: string | null;
  created_at: string;
}
interface SubOnProjectRow { subcontractor_id: string; project_id: string }
interface SubRow { id: string; company_name: string; contact_name: string | null }
interface CustomerRow { id: string; first_name: string; last_name: string; created_at: string }
interface EmailRow { subject: string; from_email: string | null; direction: string | null; date: string }

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v) || 0;
}

// Compute period bounds for a given range + offset. offset=0 means current,
// -1 = previous period, etc. Returns ISO strings for query filters and a
// human-readable label.
function computePeriod(range: TimeRange, offset: number, nowET: Date): PeriodInfo {
  let start: Date;
  let end: Date;
  let label: string;

  if (range === "week") {
    const d = new Date(nowET);
    const dow = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - dow + offset * 7);
    d.setHours(0, 0, 0, 0);
    start = new Date(d);
    end = new Date(d);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const fmt = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const prefix = offset === 0 ? "This week" : offset === -1 ? "Last week" : offset === 1 ? "Next week" : offset < 0 ? `${Math.abs(offset)} weeks ago` : `${offset} weeks from now`;
    label = `${prefix} · ${fmt(start)} – ${fmt(end)}`;
  } else if (range === "month") {
    start = new Date(nowET.getFullYear(), nowET.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthLabel = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const prefix = offset === 0 ? "This month" : offset === -1 ? "Last month" : offset === 1 ? "Next month" : offset < 0 ? `${Math.abs(offset)} months ago` : `${offset} months from now`;
    label = `${prefix} · ${monthLabel}`;
  } else if (range === "quarter") {
    const currentQStart = Math.floor(nowET.getMonth() / 3) * 3;
    start = new Date(nowET.getFullYear(), currentQStart + offset * 3, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59, 999);
    const qNum = Math.floor(start.getMonth() / 3) + 1;
    const qLabel = `Q${qNum} ${start.getFullYear()}`;
    const prefix = offset === 0 ? "This quarter" : offset === -1 ? "Last quarter" : offset === 1 ? "Next quarter" : offset < 0 ? `${Math.abs(offset)} quarters ago` : `${offset} quarters from now`;
    label = `${prefix} · ${qLabel}`;
  } else {
    // year
    start = new Date(nowET.getFullYear() + offset, 0, 1);
    end = new Date(nowET.getFullYear() + offset, 11, 31, 23, 59, 59, 999);
    const prefix = offset === 0 ? "This year" : offset === -1 ? "Last year" : offset === 1 ? "Next year" : offset < 0 ? `${Math.abs(offset)} years ago` : `${offset} years from now`;
    label = `${prefix} · ${start.getFullYear()}`;
  }

  return {
    range,
    offset,
    start: start.toISOString(),
    end: end.toISOString(),
    label,
    isCurrent: offset === 0,
  };
}

export async function getCommandCenterV2Data(opts?: { range?: TimeRange; offset?: number }): Promise<CommandCenterV2Data> {
  const supabase = await createClient();

  const TZ = "America/New_York";
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const today = nowET.toISOString().split("T")[0];

  const range: TimeRange = opts?.range || "week";
  const offset = opts?.offset ?? 0;
  const period = computePeriod(range, offset, nowET);
  const periodStart = new Date(period.start);
  const periodEnd = new Date(period.end);

  // Current week (Mon–Sun) — used only for the week-strip grid when we're
  // not in week-range mode. When range === "week", period bounds drive it.
  const weekStart = range === "week" ? periodStart : (() => {
    const d = new Date(nowET);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const weekEnd = range === "week" ? periodEnd : (() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  })();

  const ACTIVE_STATUSES = ["contracted", "in_progress"];
  const PIPELINE_STATUSES = ["lead", "estimating", "proposal_sent"];

  const [
    activeProjectsRes,
    pipelineProjectsRes,
    invoicesRes,
    estimatesRes,
    quotesRes,
    phasesRes,
    todosRes,
    subsOnProjectsRes,
    subsRes,
    customersRes,
    emailsRes,
  ] = await Promise.all([
    supabase.from("projects")
      .select("id, project_number, name, phase, status, contract_value, estimated_value, next_action, updated_at")
      .in("status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false }),
    supabase.from("projects")
      .select("id, project_number, name, phase, status, contract_value, estimated_value, next_action, updated_at, created_at")
      .in("status", PIPELINE_STATUSES),
    // Invoices always fetched in full; we filter by invoice_date client-side
    // so we can compute totals for multiple views in one pass.
    supabase.from("invoices")
      .select("project_id, amount, payment_status, invoice_date"),
    supabase.from("estimates")
      .select("status, total_price, project_id, created_at"),
    supabase.from("quote_requests")
      .select("status, created_at"),
    supabase.from("schedule_phases")
      .select("id, project_id, name, start_date, end_date, status, event_type")
      .lte("start_date", weekEnd.toISOString())
      .gte("end_date", weekStart.toISOString()),
    supabase.from("todos")
      .select("id, description, priority, due_date, contact_name, category, created_at")
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(10),
    supabase.from("project_subcontractors")
      .select("subcontractor_id, project_id"),
    supabase.from("subcontractors")
      .select("id, company_name, contact_name")
      .eq("is_active", true),
    // New customers within the selected period (not always "this month")
    supabase.from("customers")
      .select("id, first_name, last_name, created_at")
      .gte("created_at", periodStart.toISOString())
      .lte("created_at", periodEnd.toISOString())
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("inbox_emails")
      .select("subject, from_email, direction, date")
      .gte("date", periodStart.toISOString())
      .lte("date", periodEnd.toISOString())
      .order("date", { ascending: false })
      .limit(8),
  ]);

  const activeProjects = (activeProjectsRes.data as ProjectRow[] | null) || [];
  const pipelineProjects = (pipelineProjectsRes.data as ProjectRow[] | null) || [];
  const invoices = (invoicesRes.data as InvoiceRow[] | null) || [];
  const estimates = (estimatesRes.data as EstimateRow[] | null) || [];
  const quotes = (quotesRes.data as QuoteRow[] | null) || [];
  const phases = (phasesRes.data as PhaseRow[] | null) || [];
  const todos = (todosRes.data as TodoRow[] | null) || [];
  const subsOnProjects = (subsOnProjectsRes.data as SubOnProjectRow[] | null) || [];
  const subs = (subsRes.data as SubRow[] | null) || [];
  const newCustomers = (customersRes.data as CustomerRow[] | null) || [];
  const emails = (emailsRes.data as EmailRow[] | null) || [];

  // ── Money aggregation ──────────────────────────────────────
  // `contract` and `committed` are current-state snapshots (sum today's
  // contract values / sum today's unpaid invoices). `spent` is period-
  // scoped — only invoices with invoice_date inside the period count.
  // Project progress bars still use all-time spent so they reflect real
  // cumulative progress, not just the selected period's slice.
  const activeIds = new Set(activeProjects.map(p => p.id));
  const contract = activeProjects.reduce((s, p) => s + num(p.contract_value), 0);
  let spent = 0;
  let committed = 0;
  const spentByProject = new Map<string, number>(); // all-time, for project rail
  const periodStartISO = periodStart.toISOString().split("T")[0];
  const periodEndISO = periodEnd.toISOString().split("T")[0];
  for (const inv of invoices) {
    if (!activeIds.has(inv.project_id)) continue;
    const amt = num(inv.amount);
    const invDate = inv.invoice_date;
    const inPeriod = invDate != null && invDate >= periodStartISO && invDate <= periodEndISO;
    if (inv.payment_status === "paid") {
      spentByProject.set(inv.project_id, (spentByProject.get(inv.project_id) || 0) + amt);
      if (inPeriod) spent += amt;
    } else {
      // Committed stays current-state — all unpaid work on the books.
      committed += amt;
    }
  }
  const remaining = Math.max(0, contract - spent - committed);

  // Money IN during the period (client payments recorded in payments_received).
  const { data: paymentsIn } = await supabase
    .from("payments_received")
    .select("amount, received_date")
    .gte("received_date", periodStartISO.slice(0, 10))
    .lte("received_date", periodEndISO.slice(0, 10));
  const received = (paymentsIn ?? []).reduce((s, p) => s + num(p.amount), 0);

  const pipelineValue = pipelineProjects.reduce((s, p) => s + (num(p.contract_value) || num(p.estimated_value)), 0);
  const revenueQ2ToDate = received; // real money in, not paid-invoice proxy
  const revenueQ2Target = Math.max(contract * 0.45, 1_000_000); // rough target until we model it
  // Leaving margin at 0 until we have real cost-vs-revenue tracking.
  // The UI hides the pill when this is 0.
  const marginQ2 = 0;
  const marginTrend = 0;

  // ── Projects rail ──────────────────────────────────────────
  const projectsRail = activeProjects.slice(0, 12).map(p => {
    const cv = num(p.contract_value);
    const pSpent = spentByProject.get(p.id) || 0;
    const progress = cv > 0 ? Math.min(1, pSpent / cv) : 0;
    // Flag: if phase contains "closeout" and progress < 1 → high;
    // if project hasn't been updated in 14+ days → urgent.
    const staleDays = (Date.now() - new Date(p.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    let flag: "urgent" | "high" | null = null;
    if (staleDays > 14) flag = "urgent";
    else if (p.phase?.toLowerCase().includes("closeout") && progress < 0.98) flag = "high";
    return {
      id: p.id,
      project_number: p.project_number,
      name: p.name,
      phase: p.phase,
      status: p.status,
      contract_value: cv,
      progress,
      next_action: p.next_action,
      flag,
    };
  });

  // ── Week strip ─────────────────────────────────────────────
  const projectNameById = new Map<string, string>();
  for (const p of activeProjects) projectNameById.set(p.id, p.name);
  for (const p of pipelineProjects) projectNameById.set(p.id, p.name);

  const week: CommandCenterV2Data["week"] = [];
  let todayIdx = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split("T")[0];
    if (iso === today) todayIdx = i;
    const dayItems = phases
      .filter(ph => {
        const start = ph.start_date ? ph.start_date.split("T")[0] : null;
        const end = ph.end_date ? ph.end_date.split("T")[0] : start;
        if (!start) return false;
        return iso >= start && (!end || iso <= end);
      })
      .slice(0, 4)
      .map(ph => ({
        title: ph.name,
        project: projectNameById.get(ph.project_id) || "Project",
        tag: ph.event_type && ph.event_type !== "phase" ? ph.event_type : null,
      }));
    week.push({
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      date: d.getDate(),
      isoDate: iso,
      items: dayItems,
    });
  }

  // ── Attention inbox ────────────────────────────────────────
  const priorityRank = (p: string | null) => {
    if (p === "urgent") return 3;
    if (p === "high") return 2;
    if (p === "medium") return 1;
    return 0;
  };
  const attention: CommandCenterV2Data["attention"] = todos
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
    .slice(0, 8)
    .map(t => {
      const overdueDays = t.due_date ? Math.floor((Date.now() - new Date(t.due_date).getTime()) / (1000 * 60 * 60 * 24)) : -1;
      const prio = (t.priority === "urgent" || t.priority === "high" || t.priority === "medium" || t.priority === "low")
        ? t.priority
        : (overdueDays > 0 ? "urgent" : "medium");
      const iconByCat: Record<string, string> = {
        quotes: "FileCheck",
        follow_up_quotes: "FileCheck",
        follow_up_clients: "Mail",
        payments: "DollarSign",
        estimates: "Calculator",
        change_orders: "Bell",
        permits_inspections: "CalendarDays",
        materials: "HardHat",
        scheduling: "CalendarDays",
        contracts_docs: "FileCheck",
        general: "Bell",
      };
      const icon = iconByCat[t.category || "general"] || "Bell";
      const metaBits: string[] = [];
      if (t.contact_name) metaBits.push(t.contact_name);
      if (overdueDays > 0) metaBits.push(`${overdueDays}d overdue`);
      else if (t.due_date) metaBits.push(`due ${t.due_date}`);
      return {
        priority: prio,
        icon,
        text: t.description,
        meta: metaBits.join(" · ") || t.category || "Todo",
      };
    });

  // ── Pipeline counts (period-scoped) ────────────────────────
  // Estimates / quotes / leads created within the selected period.
  const inPeriod = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= periodStart.getTime() && t <= periodEnd.getTime();
  };
  const estByStatus = { draft: 0, review: 0, approved: 0, sent: 0 };
  let estimatesTotalValue = 0;
  for (const e of estimates) {
    if (!inPeriod(e.created_at)) continue;
    if (e.status in estByStatus) estByStatus[e.status as keyof typeof estByStatus]++;
    if (e.status === "draft" || e.status === "sent" || e.status === "approved") {
      estimatesTotalValue += num(e.total_price);
    }
  }
  const qByStatus = { awaiting: 0, received: 0, accepted: 0, declined: 0 };
  for (const q of quotes) {
    if (!inPeriod(q.created_at)) continue;
    if (q.status === "awaiting_reply" || q.status === "just_sent") qByStatus.awaiting++;
    else if (q.status === "received" || q.status === "in_progress") qByStatus.received++;
    else if (q.status === "accepted" || q.status === "approved") qByStatus.accepted++;
    else if (q.status === "declined") qByStatus.declined++;
  }
  // Leads created during the selected period (was mis-labeled "this week"
  // regardless of range).
  const leadsInPeriod = pipelineProjects.filter(p =>
    p.status === "lead" && inPeriod(p.created_at)
  ).length;

  // Actual overhead YTD — pulled from overhead_config (QuickBooks-synced).
  // Falls back to zero if nothing's been seeded yet.
  const { data: overheadRow } = await supabase
    .from("overhead_config")
    .select("qb_opex, period_start, period_end")
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  const actualOverhead = {
    amount: num(overheadRow?.qb_opex ?? 0),
    label: overheadRow?.period_start && overheadRow?.period_end
      ? `${new Date(overheadRow.period_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(overheadRow.period_end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "no data yet",
  };

  // ── Stakeholders ───────────────────────────────────────────
  const subById = new Map<string, SubRow>();
  for (const s of subs) subById.set(s.id, s);
  const subProjectCount = new Map<string, number>();
  for (const row of subsOnProjects) {
    if (!activeIds.has(row.project_id)) continue;
    subProjectCount.set(row.subcontractor_id, (subProjectCount.get(row.subcontractor_id) || 0) + 1);
  }
  const topSubs = [...subProjectCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([subId, count]) => {
      const s = subById.get(subId);
      if (!s) return null;
      const initials = s.company_name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
      return {
        role: "Most active subs",
        name: s.company_name,
        tag: `${count} project${count === 1 ? "" : "s"}`,
        avatar: initials || "??",
        color: "oklch(0.72 0.15 40)",
      };
    })
    .filter((v): v is NonNullable<typeof v> => v != null);

  const newCustomerRoleLabel = range === "week" ? "New this week"
    : range === "month" ? "New this month"
    : range === "quarter" ? "New this quarter"
    : "New this year";
  const newCustomerStakes = newCustomers.slice(0, 2).map(c => {
    const fullName = `${c.first_name} ${c.last_name}`;
    const initials = `${c.first_name[0] || ""}${c.last_name[0] || ""}`.toUpperCase();
    return {
      role: newCustomerRoleLabel,
      name: fullName,
      tag: "Client",
      avatar: initials || "??",
      color: "oklch(0.72 0.15 250)",
    };
  });

  const stakeholders: CommandCenterV2Data["stakeholders"] = [...topSubs, ...newCustomerStakes];

  // ── Recent activity (from inbox_emails) ────────────────────
  const relTime = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    return `${days} days ago`;
  };
  const recent = emails.slice(0, 6).map(e => {
    const who = e.from_email ? e.from_email.split("@")[0] : "Inbox";
    return {
      when: relTime(e.date),
      text: e.direction === "outbound"
        ? `Sent: ${e.subject}`
        : `${who} — ${e.subject}`,
      by: who,
    };
  });

  // ── Headline ───────────────────────────────────────────────
  // No pace delta until we have period-over-period revenue data. The UI
  // hides the trend chip when this is 0.
  const paceDeltaPct = 0;
  // Health status labels that don't clash with construction jargon like
  // "booked" (which readers confuse with money).
  let healthStatus = "On pace";
  if (contract === 0) healthStatus = "Quiet";
  else if (spent > contract * 0.8 && remaining < contract * 0.1) healthStatus = "Tight";
  else if (activeProjects.length >= 10) healthStatus = "Full plate";

  return {
    period,
    money: {
      contract,
      spent,
      received,
      committed,
      remaining,
      pipeline: pipelineValue,
      marginQ2,
      marginTrend,
      revenueQ2ToDate,
      revenueQ2Target,
    },
    projects: projectsRail,
    week,
    todayIdx,
    attention,
    pipeline: {
      estimates: { ...estByStatus, totalValue: estimatesTotalValue },
      quotes: qByStatus,
      leadsThisWeek: leadsInPeriod,
      actualOverheadYtd: actualOverhead.amount,
      overheadPeriodLabel: actualOverhead.label,
    },
    stakeholders,
    recent,
    headline: {
      active: activeProjects.length,
      inFlight: contract,
      paceDeltaPct,
      healthStatus,
    },
  };
}

export async function getQuarterLabel(): Promise<string> {
  const TZ = "America/New_York";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  return `Q${Math.floor(now.getMonth() / 3) + 1}`;
}
