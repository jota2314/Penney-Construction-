"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";

export interface HubMetrics {
  projects: { active: number; byStatus: Record<string, number> };
  estimates: { total: number; byStatus: Record<string, number> };
  todos: { open: number; overdue: number; byPriority: Record<string, number> };
  quotes: { total: number; byStatus: Record<string, number> };
  schedule: { activeThisWeek: number; inProgress: number; upcoming: number };
  customers: { total: number; newThisMonth: number };
  subcontractors: { active: number; onProjects: number };
  email: {
    all: { sent: number; received: number; total: number };
    day: { sent: number; received: number; total: number };
    week: { sent: number; received: number; total: number };
    month: { sent: number; received: number; total: number };
    dailyVolume: { day: string; sent: number; received: number }[];
  };
  costBook: { rateCount: number; lastUpdated: string | null };
}

export async function getHubMetrics(): Promise<HubMetrics> {
  const supabase = await createClient();
  // Honor impersonation — profile.id is the effective user
  const authUser = await getUser();
  const currentUserId = authUser?.profile?.id ?? authUser?.id ?? null;

  // All date math in Eastern Time (Penney Construction is in MA)
  const TZ = "America/New_York";
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const today = nowET.toISOString().split("T")[0];

  // Week bounds (Monday–Friday in ET)
  const weekStart = new Date(nowET);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 5);

  // Month start in ET
  const monthStart = new Date(nowET);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // All queries run in parallel for fast loading
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safe = (builder: PromiseLike<any>) =>
    Promise.resolve(builder).catch(() => ({ data: null, error: true, count: null }));

  const [
    projectsRes,
    estimatesRes,
    todosRes,
    quotesRes,
    phasesRes,
    customerCountRes,
    newCustomerCountRes,
    subCountRes,
    subOnProjectsRes,
    emailsRes,
    rateCountRes,
    latestRateRes,
  ] = await Promise.all([
    safe(supabase.from("projects").select("status")
      .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])),
    safe(supabase.from("estimates").select("status")),
    safe(supabase.from("todos").select("status, priority, due_date").eq("status", "open")),
    safe(supabase.from("quote_requests").select("status")),
    safe(supabase.from("schedule_phases").select("status")
      .or(`start_date.lte.${weekEnd.toISOString()},end_date.gte.${weekStart.toISOString()}`)
      .in("status", ["in_progress", "not_started"])),
    safe(supabase.from("customers").select("id", { count: "exact", head: true })),
    safe(supabase.from("customers").select("id", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString())),
    safe(supabase.from("subcontractors").select("id", { count: "exact", head: true }).eq("is_active", true)),
    safe(supabase.from("project_subcontractors").select("subcontractor_id").limit(100)),
    safe(
      currentUserId
        ? supabase.from("inbox_emails").select("direction, date").eq("created_by", currentUserId).order("date", { ascending: false }).limit(500)
        : supabase.from("inbox_emails").select("direction, date").order("date", { ascending: false }).limit(0)
    ),
    safe(supabase.from("trade_rates").select("id", { count: "exact", head: true })),
    safe(supabase.from("trade_rates").select("updated_at").order("updated_at", { ascending: false }).limit(1)),
  ]);

  const projects: { status: string }[] = (!projectsRes.error && projectsRes.data) || [];
  const estimates: { status: string }[] = (!estimatesRes.error && estimatesRes.data) || [];
  const todos: { status: string; priority: string; due_date: string | null }[] = (!todosRes.error && todosRes.data) || [];
  const quotes: { status: string }[] = (!quotesRes.error && quotesRes.data) || [];
  const phases: { status: string }[] = (!phasesRes.error && phasesRes.data) || [];
  const customerCount: number = (!customerCountRes.error && customerCountRes.count) || 0;
  const newCustomerCount: number = (!newCustomerCountRes.error && newCustomerCountRes.count) || 0;
  const subCount: number = (!subCountRes.error && subCountRes.count) || 0;
  const subOnProjectsData = (!subOnProjectsRes.error && subOnProjectsRes.data) || [];
  const subOnProjects = new Set(subOnProjectsData.map((ps: { subcontractor_id: string }) => ps.subcontractor_id)).size;
  const emails: { direction: string; sent_at: string }[] = ((!emailsRes.error && emailsRes.data) || [])
    .map((e: { direction: string; date: string }) => ({ direction: e.direction, sent_at: e.date }));
  const rateCount: number = (!rateCountRes.error && rateCountRes.count) || 0;
  const lastRateUpdate: string | null = (!latestRateRes.error && latestRateRes.data?.[0]?.updated_at) || null;

  // Process results
  const projectsByStatus: Record<string, number> = {};
  projects.forEach((p) => { projectsByStatus[p.status] = (projectsByStatus[p.status] || 0) + 1; });

  const estimatesByStatus: Record<string, number> = {};
  estimates.forEach((e) => { estimatesByStatus[e.status] = (estimatesByStatus[e.status] || 0) + 1; });

  const byPriority: Record<string, number> = {};
  let overdue = 0;
  todos.forEach((f) => {
    byPriority[f.priority] = (byPriority[f.priority] || 0) + 1;
    if (f.due_date && f.due_date < today) overdue++;
  });

  const quotesByStatus: Record<string, number> = {};
  quotes.forEach((q) => { quotesByStatus[q.status] = (quotesByStatus[q.status] || 0) + 1; });

  const inProgress = phases.filter((p) => p.status === "in_progress").length;
  const upcoming = phases.filter((p) => p.status === "not_started").length;

  // Email daily volume
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const dailyVolume = days.map((day, i) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const nextDay = new Date(dayDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const dayEmails = emails.filter((e) => {
      const sent = new Date(e.sent_at);
      return sent >= dayDate && sent < nextDay;
    });
    return {
      day,
      sent: dayEmails.filter((e) => e.direction === "outbound").length,
      received: dayEmails.filter((e) => e.direction === "inbound").length,
    };
  });

  // Day metrics (today in ET)
  const todayStart = new Date(nowET);
  todayStart.setHours(0, 0, 0, 0);
  const todayEmails = emails.filter((e) => new Date(e.sent_at) >= todayStart);
  const daySent = todayEmails.filter((e) => e.direction === "outbound").length;
  const dayReceived = todayEmails.filter((e) => e.direction === "inbound").length;

  // Week metrics
  const weekEmails = emails.filter((e) => new Date(e.sent_at) >= weekStart);
  const weekSent = weekEmails.filter((e) => e.direction === "outbound").length;
  const weekReceived = weekEmails.filter((e) => e.direction === "inbound").length;

  // Month metrics
  const monthEmails = emails.filter((e) => new Date(e.sent_at) >= monthStart);
  const monthSent = monthEmails.filter((e) => e.direction === "outbound").length;
  const monthReceived = monthEmails.filter((e) => e.direction === "inbound").length;

  // All-time totals
  const allSent = emails.filter((e) => e.direction === "outbound").length;
  const allReceived = emails.filter((e) => e.direction === "inbound").length;

  return {
    projects: { active: projects.length, byStatus: projectsByStatus },
    estimates: { total: estimates.length, byStatus: estimatesByStatus },
    todos: { open: todos.length, overdue, byPriority },
    quotes: { total: quotes.length, byStatus: quotesByStatus },
    schedule: { activeThisWeek: phases.length, inProgress, upcoming },
    customers: { total: customerCount, newThisMonth: newCustomerCount },
    subcontractors: { active: subCount, onProjects: subOnProjects },
    email: {
      all: { sent: allSent, received: allReceived, total: allSent + allReceived },
      day: { sent: daySent, received: dayReceived, total: daySent + dayReceived },
      week: { sent: weekSent, received: weekReceived, total: weekSent + weekReceived },
      month: { sent: monthSent, received: monthReceived, total: monthSent + monthReceived },
      dailyVolume,
    },
    costBook: { rateCount, lastUpdated: lastRateUpdate },
  };
}
