"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { notifyAssignee } from "@/lib/actions/notify-assignee";
import type {
  QuoteRequest,
  Todo,
  ClientUpdate,
  QuoteRequestStatus,
  TodoStatus,
  TodoCategory,
} from "@/types/database";

// ── Dashboard Stats ──────────────────────────────────────

export async function getCommandCenterStats() {
  const supabase = await createClient();

  const [projectsRes, todosRes, quotesRes, clientUpdatesRes, emailsRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .in("status", [
          "lead",
          "estimating",
          "proposal_sent",
          "contracted",
          "in_progress",
        ]),
      supabase
        .from("todos")
        .select("*", { count: "exact", head: true })
        .eq("status", "open"),
      supabase
        .from("quote_requests")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("client_updates")
        .select("*", { count: "exact", head: true })
        .gte(
          "week_start",
          new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000
          ).toISOString()
        ),
      supabase
        .from("client_updates")
        .select("*", { count: "exact", head: true })
        .eq("status", "sent")
        .gte(
          "week_start",
          new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000
          ).toISOString()
        ),
    ]);

  const totalClients = clientUpdatesRes.count ?? 0;
  const sentClients = emailsRes.count ?? 0;

  return {
    activeJobs: projectsRes.count ?? 0,
    todos: todosRes.count ?? 0,
    quotesOut: quotesRes.count ?? 0,
    updatesSent: sentClients,
    totalClients: totalClients,
  };
}

// ── Active Projects ──────────────────────────────────────

export async function getActiveProjects() {
  const supabase = await createClient();

  const { data: projects, error } = await supabase
    .from("projects")
    .select(
      "*, customer:customers(*)"
    )
    .in("status", [
      "lead",
      "estimating",
      "proposal_sent",
      "contracted",
      "in_progress",
    ])
    .order("updated_at", { ascending: false });

  if (error) throw error;

  // Get quote counts per project
  const projectIds = (projects ?? []).map((p) => p.id);
  const { data: quotes } = await supabase
    .from("quote_requests")
    .select("project_id")
    .in("project_id", projectIds.length > 0 ? projectIds : ["__none__"]);

  const quoteCounts: Record<string, number> = {};
  (quotes ?? []).forEach((q) => {
    if (q.project_id) {
      quoteCounts[q.project_id] = (quoteCounts[q.project_id] || 0) + 1;
    }
  });

  // Get todos (next actions) per project
  const { data: todos } = await supabase
    .from("todos")
    .select("project_id, description")
    .eq("status", "open")
    .in("project_id", projectIds.length > 0 ? projectIds : ["__none__"])
    .order("created_at", { ascending: true });

  const nextActions: Record<string, string> = {};
  (todos ?? []).forEach((f) => {
    if (f.project_id && !nextActions[f.project_id]) {
      nextActions[f.project_id] = f.description;
    }
  });

  // Get sub names per project
  const { data: projectSubs } = await supabase
    .from("project_subcontractors")
    .select("project_id, subcontractor:subcontractors(company_name)")
    .in("project_id", projectIds.length > 0 ? projectIds : ["__none__"]);

  const subNames: Record<string, string[]> = {};
  (projectSubs ?? []).forEach((ps: Record<string, unknown>) => {
    const pid = ps.project_id as string;
    const sub = ps.subcontractor as { company_name: string } | null;
    if (pid && sub) {
      if (!subNames[pid]) subNames[pid] = [];
      subNames[pid].push(sub.company_name);
    }
  });

  return (projects ?? []).map((p) => ({
    ...p,
    quote_count: quoteCounts[p.id] || 0,
    next_action: p.next_action || nextActions[p.id] || null,
    progress: p.progress ?? 0,
    subcontractor_names: subNames[p.id] || [],
  }));
}

// ── Quote Pipeline ──────────────────────────────────────

export async function getQuoteRequests(statusFilter?: QuoteRequestStatus) {
  const supabase = await createClient();

  let query = supabase
    .from("quote_requests")
    .select("*")
    .order("sent_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as QuoteRequest[];
}

export async function getQuoteStatusCounts() {
  const supabase = await createClient();

  const statuses: QuoteRequestStatus[] = [
    "received",
    "in_progress",
    "awaiting_reply",
    "just_sent",
  ];

  const counts: Record<string, number> = {};

  await Promise.all(
    statuses.map(async (status) => {
      const { count } = await supabase
        .from("quote_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", status);
      counts[status] = count ?? 0;
    })
  );

  return counts;
}

// ── Todos ──────────────────────────────────────

export async function getTodos(status?: TodoStatus, category?: TodoCategory) {
  const supabase = await createClient();

  let query = supabase
    .from("todos")
    .select("*")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  if (category) {
    query = query.eq("category", category);
  }

  // Don't show snoozed todos that haven't hit their wake-up time
  const now = new Date().toISOString();
  query = query.or(`snooze_until.is.null,snooze_until.lte.${now}`);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Todo[];
}

export async function updateTodoStatus(id: string, status: TodoStatus) {
  const supabase = await createClient();

  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "done") {
    updates.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("todos")
    .update(updates)
    .eq("id", id);

  if (error) throw error;
}

export async function updateTodo(
  id: string,
  updates: {
    description?: string;
    priority?: string;
    category?: TodoCategory;
    due_date?: string | null;
    assignee?: string | null;
    contact_name?: string;
  }
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("todos")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export async function snoozeTodo(id: string, until: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("todos")
    .update({
      status: "snoozed" as TodoStatus,
      snooze_until: until,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
}

export async function getTodoCategoryCounts() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("todos")
    .select("category")
    .eq("status", "open");

  if (error) throw error;

  const counts: Record<string, number> = { all: (data ?? []).length };
  (data ?? []).forEach((t) => {
    counts[t.category] = (counts[t.category] || 0) + 1;
  });
  return counts;
}

// ── Client Updates ──────────────────────────────────────

export async function getClientUpdates() {
  const supabase = await createClient();

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("client_updates")
    .select("*")
    .gte("week_start", weekStart.toISOString().split("T")[0])
    .order("sent_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ClientUpdate[];
}

// ── Email Analytics ──────────────────────────────────────

export async function getEmailVolume() {
  const supabase = await createClient();

  // Get emails from the current week
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("email_logs")
    .select("direction, category, sent_at")
    .gte("sent_at", weekStart.toISOString());

  if (error) throw error;

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const volume = days.map((day, i) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const nextDay = new Date(dayDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const dayEmails = (data ?? []).filter((e) => {
      const sent = new Date(e.sent_at);
      return sent >= dayDate && sent < nextDay;
    });

    return {
      day,
      sent: dayEmails.filter((e) => e.direction === "outbound").length,
      received: dayEmails.filter((e) => e.direction === "inbound").length,
    };
  });

  return volume;
}

export async function getPerformanceHighlights() {
  const supabase = await createClient();

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  const [emailsRes, categoryRes, clientsRes, quotesRes] = await Promise.all([
    supabase
      .from("email_logs")
      .select("*", { count: "exact", head: true })
      .gte("sent_at", weekStart.toISOString())
      .eq("direction", "outbound"),
    supabase
      .from("email_logs")
      .select("category")
      .gte("sent_at", weekStart.toISOString())
      .eq("direction", "outbound"),
    supabase
      .from("client_updates")
      .select("status")
      .gte("week_start", weekStart.toISOString().split("T")[0]),
    supabase
      .from("quote_requests")
      .select("status"),
  ]);

  const totalEmails = emailsRes.count ?? 0;
  const categories = (categoryRes.data ?? []);
  const clientUpdates = clientsRes.data ?? [];
  const allQuotes = quotesRes.data ?? [];

  const catCounts: Record<string, number> = {};
  categories.forEach((e) => {
    catCounts[e.category] = (catCounts[e.category] || 0) + 1;
  });

  const totalClientUpdates = clientUpdates.length;
  const sentClientUpdates = clientUpdates.filter(
    (c) => c.status === "sent"
  ).length;

  const activeQuotes = allQuotes.filter(
    (q) => !["accepted", "declined"].includes(q.status)
  ).length;

  return {
    emailsSent: totalEmails,
    emailBreakdown: catCounts,
    clientCoverage: { sent: sentClientUpdates, total: totalClientUpdates },
    activeQuotes,
  };
}

// ── Project Detail ──────────────────────────────────────

export async function getProjectTodos(projectId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Todo[];
}

export async function getProjectQuotes(projectId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quote_requests")
    .select("*")
    .eq("project_id", projectId)
    .order("sent_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as QuoteRequest[];
}

// ── Create Actions ──────────────────────────────────────

export async function createQuoteRequest(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("quote_requests").insert({
    project_id: formData.get("project_id") as string || null,
    subcontractor_name: formData.get("subcontractor_name") as string,
    project_name: formData.get("project_name") as string,
    trade: formData.get("trade") as string || null,
    scope_description: formData.get("scope_description") as string || null,
    status: "just_sent",
    created_by: user.id,
  });

  if (error) throw error;
}

/**
 * Bulk-create todos from a voice-parsed list. Used by the schedule
 * popup composer so dictating "call Mike about the permit, order tile,
 * follow up with Picardi" creates three todos at once.
 */
export async function createTodos(
  projectId: string,
  projectName: string | null,
  items: Array<{
    description: string;
    priority: string;
    due_date: string | null;
    contact_name: string | null;
  }>
): Promise<{ inserted: number; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { inserted: 0, error: "Not authenticated" };
  if (items.length === 0) return { inserted: 0 };

  const rows = items.map((item) => ({
    project_id: projectId,
    project_name: projectName,
    contact_name: item.contact_name || projectName || "Field crew",
    contact_type: "internal" as const,
    description: item.description,
    priority: ["low", "medium", "high"].includes(item.priority) ? item.priority : "medium",
    category: "general" as const,
    due_date: item.due_date,
    source: "manual" as const,
    created_by: user.id,
  }));

  const { error, data } = await supabase.from("todos").insert(rows).select("id");
  if (error) return { inserted: 0, error: error.message };
  revalidatePath("/command-center/todos");
  revalidatePath(`/projects/${projectId}`);
  return { inserted: data?.length ?? 0 };
}

export async function createTodo(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const assignee = formData.get("assignee") as string || null;
  const description = formData.get("description") as string;
  const projectName = formData.get("project_name") as string || null;
  const priority = formData.get("priority") as string || "medium";
  const dueDate = formData.get("due_date") as string || null;

  const { error } = await supabase.from("todos").insert({
    project_id: formData.get("project_id") as string || null,
    project_name: projectName,
    contact_name: formData.get("contact_name") as string,
    contact_type: formData.get("contact_type") as string || "subcontractor",
    description,
    priority,
    category: formData.get("category") as string || "general",
    due_date: dueDate,
    assignee,
    source: "manual",
    created_by: user.id,
  });

  if (error) throw error;

  // Send email notification to assignee
  if (assignee) {
    notifyAssignee({
      assignee,
      description,
      projectName,
      priority,
      dueDate,
    }).catch(() => {}); // Don't block on notification failure
  }

  revalidatePath("/command-center");
  revalidatePath("/command-center/todos");
}

// ── Action Inbox (Morning View) ──────────────────────────────────────

export async function getActionInbox() {
  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  const [todosRes, quotesRes, emailsRes] = await Promise.all([
    // Overdue and open todos
    supabase
      .from("todos")
      .select("id, contact_name, contact_type, description, priority, project_name, project_id, due_date, created_at")
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(15),

    // Quotes received but not yet reviewed
    supabase
      .from("quote_requests")
      .select("id, subcontractor_name, project_name, project_id, trade, amount, status, received_at")
      .eq("status", "received")
      .order("received_at", { ascending: false })
      .limit(10),

    // Recent inbound emails not yet processed (last 3 days)
    supabase
      .from("email_logs")
      .select("id, subject, from_name, from_email, project_name, project_id, category, sent_at")
      .eq("direction", "inbound")
      .gte("sent_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
      .order("sent_at", { ascending: false })
      .limit(10),
  ]);

  const todos = (todosRes.data ?? []).map((f) => ({
    ...f,
    type: "todo" as const,
    isOverdue: f.due_date ? f.due_date < today : false,
  }));

  const quotes = (quotesRes.data ?? []).map((q) => ({
    ...q,
    type: "quote_review" as const,
  }));

  const emails = (emailsRes.data ?? []).map((e) => ({
    ...e,
    type: "email" as const,
  }));

  return { todos, quotes, emails };
}

// ── Crew Deployment (Morning View) ──────────────────────────────────────

export async function getCrewDeployment() {
  const supabase = await createClient();

  // Get current week bounds
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 5);

  const { data: phases } = await supabase
    .from("schedule_phases")
    .select("*, project:projects(id, name, address)")
    .or(`start_date.lte.${weekEnd.toISOString()},end_date.gte.${weekStart.toISOString()}`)
    .in("status", ["in_progress", "not_started"])
    .order("start_date", { ascending: true });

  return (phases ?? []).map((p: Record<string, unknown>) => {
    const project = p.project as { id: string; name: string; address: string } | null;
    return {
      id: p.id as string,
      phase_name: p.name as string,
      project_name: project?.name || "Unknown",
      project_id: project?.id || "",
      project_address: project?.address || "",
      start_date: p.start_date as string,
      end_date: p.end_date as string,
      status: p.status as string,
      assigned_to: p.assigned_to as string | null,
    };
  });
}

// ── Enhanced Project Cards (Morning View) ──────────────────────────────

export async function getProjectStatusCards() {
  const supabase = await createClient();

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, address, city, status, project_type, estimated_value, progress, phase")
    .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) return [];

  // Get quote counts and missing trade counts per project
  const { data: allQuotes } = await supabase
    .from("quote_requests")
    .select("project_id, status")
    .in("project_id", projectIds);

  const { data: openTodos } = await supabase
    .from("todos")
    .select("project_id, description")
    .eq("status", "open")
    .in("project_id", projectIds);

  const quoteCounts: Record<string, number> = {};
  const pendingQuotes: Record<string, number> = {};
  (allQuotes ?? []).forEach((q) => {
    if (q.project_id) {
      quoteCounts[q.project_id] = (quoteCounts[q.project_id] || 0) + 1;
      if (["just_sent", "awaiting_reply", "in_progress"].includes(q.status)) {
        pendingQuotes[q.project_id] = (pendingQuotes[q.project_id] || 0) + 1;
      }
    }
  });

  const nextActions: Record<string, string> = {};
  (openTodos ?? []).forEach((f) => {
    if (f.project_id && !nextActions[f.project_id]) {
      nextActions[f.project_id] = f.description;
    }
  });

  return (projects ?? []).map((p) => ({
    ...p,
    quote_count: quoteCounts[p.id] || 0,
    pending_quotes: pendingQuotes[p.id] || 0,
    next_action: nextActions[p.id] || null,
  }));
}

export async function updateQuoteStatus(id: string, status: QuoteRequestStatus, amount?: number) {
  const supabase = await createClient();

  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "received") {
    updates.received_at = new Date().toISOString();
  }
  if (amount !== undefined) {
    updates.amount = amount;
  }

  const { error } = await supabase
    .from("quote_requests")
    .update(updates)
    .eq("id", id);

  if (error) throw error;
}
