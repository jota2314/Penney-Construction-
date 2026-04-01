"use server";

import { createClient } from "@/lib/supabase/server";

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
  const today = new Date().toISOString().split("T")[0];

  // Week bounds
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 5);

  // Month start
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Each query wrapped individually so one failure doesn't break anything
  let projects: { status: string }[] = [];
  let estimates: { status: string }[] = [];
  let todos: { status: string; priority: string; due_date: string | null }[] = [];
  let quotes: { status: string }[] = [];
  let phases: { status: string }[] = [];
  let customerCount = 0;
  let newCustomerCount = 0;
  let subCount = 0;
  let subOnProjects = 0;
  let emails: { direction: string; sent_at: string }[] = [];
  let rateCount = 0;
  let lastRateUpdate: string | null = null;

  try {
    const res = await supabase.from("projects").select("status")
      .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]);
    if (!res.error) projects = res.data || [];
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("estimates").select("status");
    if (!res.error) estimates = res.data || [];
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("todos").select("status, priority, due_date").eq("status", "open");
    if (!res.error) todos = res.data || [];
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("quote_requests").select("status");
    if (!res.error) quotes = res.data || [];
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("schedule_phases").select("status")
      .or(`start_date.lte.${weekEnd.toISOString()},end_date.gte.${weekStart.toISOString()}`)
      .in("status", ["in_progress", "not_started"]);
    if (!res.error) phases = res.data || [];
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("customers").select("id", { count: "exact", head: true });
    if (!res.error) customerCount = res.count || 0;
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("customers").select("id", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString());
    if (!res.error) newCustomerCount = res.count || 0;
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("subcontractors").select("id", { count: "exact", head: true }).eq("is_active", true);
    if (!res.error) subCount = res.count || 0;
  } catch { /* table may not exist */ }

  try {
    const res = await supabase.from("project_subcontractors").select("subcontractor_id").limit(100);
    if (!res.error) {
      const uniqueIds = new Set((res.data || []).map((ps: { subcontractor_id: string }) => ps.subcontractor_id));
      subOnProjects = uniqueIds.size;
    }
  } catch { /* table may not exist */ }

  try {
    // Fetch all stored emails — the table is small and filters are applied in-memory
    const res = await supabase
      .from("inbox_emails")
      .select("direction, date")
      .order("date", { ascending: false })
      .limit(500);
    if (!res.error) emails = (res.data || []).map((e: { direction: string; date: string }) => ({ direction: e.direction, sent_at: e.date }));
  } catch { /* table may not exist */ }

  try {
    const countRes = await supabase.from("trade_rates").select("id", { count: "exact", head: true });
    if (!countRes.error) rateCount = countRes.count || 0;
    const latestRes = await supabase.from("trade_rates").select("updated_at").order("updated_at", { ascending: false }).limit(1);
    if (!latestRes.error && latestRes.data?.[0]) lastRateUpdate = latestRes.data[0].updated_at;
  } catch { /* table may not exist */ }

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

  // Day metrics (today)
  const todayStart = new Date();
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
