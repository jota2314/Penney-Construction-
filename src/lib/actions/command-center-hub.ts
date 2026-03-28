"use server";

import { createClient } from "@/lib/supabase/server";

export interface HubMetrics {
  projects: { active: number; byStatus: Record<string, number> };
  estimates: { total: number; byStatus: Record<string, number> };
  followUps: { open: number; overdue: number; byPriority: Record<string, number> };
  quotes: { total: number; byStatus: Record<string, number> };
  schedule: { activeThisWeek: number; inProgress: number; upcoming: number };
  customers: { total: number; newThisMonth: number };
  subcontractors: { active: number; onProjects: number };
  email: {
    weekTotal: number;
    sent: number;
    received: number;
    dailyVolume: { day: string; sent: number; received: number }[];
  };
  costBook: { rateCount: number; lastUpdated: string | null };
}

// Wrap a promise so it never rejects — returns null on error
async function safe<T>(promise: PromiseLike<{ data: T | null; error: unknown; count?: number | null }>): Promise<{ data: T | null; count: number | null }> {
  try {
    const result = await promise;
    if (result.error) return { data: null, count: null };
    return { data: result.data, count: result.count ?? null };
  } catch {
    return { data: null, count: null };
  }
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

  const [
    projectsRes,
    estimatesRes,
    followUpsRes,
    quotesRes,
    scheduleRes,
    customersRes,
    customersNewRes,
    subsRes,
    subsOnProjectsRes,
    emailsRes,
    tradeRatesRes,
  ] = await Promise.all([
    safe(supabase
      .from("projects")
      .select("status")
      .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])),

    safe(supabase.from("estimates").select("status")),

    safe(supabase
      .from("follow_ups")
      .select("status, priority, due_date")
      .eq("status", "open")),

    safe(supabase.from("quote_requests").select("status")),

    safe(supabase
      .from("schedule_phases")
      .select("status")
      .or(`start_date.lte.${weekEnd.toISOString()},end_date.gte.${weekStart.toISOString()}`)
      .in("status", ["in_progress", "not_started"])),

    safe(supabase.from("customers").select("id", { count: "exact", head: true })),

    safe(supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString())),

    safe(supabase
      .from("subcontractors")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)),

    safe(supabase
      .from("project_subcontractors")
      .select("subcontractor_id")
      .limit(100)),

    safe(supabase
      .from("email_logs")
      .select("direction, sent_at")
      .gte("sent_at", weekStart.toISOString())),

    safe(supabase.from("trade_rates").select("id, updated_at").order("updated_at", { ascending: false }).limit(1)),
  ]);

  // Projects
  const projects = (projectsRes.data as { status: string }[] | null) || [];
  const projectsByStatus: Record<string, number> = {};
  projects.forEach((p) => {
    projectsByStatus[p.status] = (projectsByStatus[p.status] || 0) + 1;
  });

  // Estimates
  const estimates = (estimatesRes.data as { status: string }[] | null) || [];
  const estimatesByStatus: Record<string, number> = {};
  estimates.forEach((e) => {
    estimatesByStatus[e.status] = (estimatesByStatus[e.status] || 0) + 1;
  });

  // Follow-ups
  const followUps = (followUpsRes.data as { status: string; priority: string; due_date: string | null }[] | null) || [];
  const byPriority: Record<string, number> = {};
  let overdue = 0;
  followUps.forEach((f) => {
    byPriority[f.priority] = (byPriority[f.priority] || 0) + 1;
    if (f.due_date && f.due_date < today) overdue++;
  });

  // Quotes
  const quotes = (quotesRes.data as { status: string }[] | null) || [];
  const quotesByStatus: Record<string, number> = {};
  quotes.forEach((q) => {
    quotesByStatus[q.status] = (quotesByStatus[q.status] || 0) + 1;
  });

  // Schedule
  const phases = (scheduleRes.data as { status: string }[] | null) || [];
  const inProgress = phases.filter((p) => p.status === "in_progress").length;
  const upcoming = phases.filter((p) => p.status === "not_started").length;

  // Subs on projects
  const subProjectData = (subsOnProjectsRes.data as { subcontractor_id: string }[] | null) || [];
  const uniqueSubIds = new Set(subProjectData.map((ps) => ps.subcontractor_id));

  // Email daily volume
  const emails = (emailsRes.data as { direction: string; sent_at: string }[] | null) || [];
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

  const sent = emails.filter((e) => e.direction === "outbound").length;
  const received = emails.filter((e) => e.direction === "inbound").length;

  // Trade rates
  const tradeRateData = (tradeRatesRes.data as { id: string; updated_at: string }[] | null) || [];
  let rateCount = 0;
  let lastUpdated: string | null = tradeRateData[0]?.updated_at || null;

  const tradeCountRes = await safe(
    supabase.from("trade_rates").select("id", { count: "exact", head: true })
  );
  rateCount = tradeCountRes.count || 0;

  return {
    projects: { active: projects.length, byStatus: projectsByStatus },
    estimates: { total: estimates.length, byStatus: estimatesByStatus },
    followUps: { open: followUps.length, overdue, byPriority },
    quotes: { total: quotes.length, byStatus: quotesByStatus },
    schedule: { activeThisWeek: phases.length, inProgress, upcoming },
    customers: { total: customersRes.count || 0, newThisMonth: customersNewRes.count || 0 },
    subcontractors: { active: subsRes.count || 0, onProjects: uniqueSubIds.size },
    email: { weekTotal: emails.length, sent, received, dailyVolume },
    costBook: { rateCount, lastUpdated },
  };
}
