/**
 * Shared context loaders for all 4 chats.
 * Each function pulls the right data from Supabase for its chat type.
 */

import { canSeeRate, getRateVisibility } from "@/lib/auth/rate-visibility";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// ── Brain Chat Context ──────────────────────────────────────

export async function loadBrainContext(supabase: SupabaseClient, isField = false) {
  const [projectsRes, todosRes, emailsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_number, name, address, city, status, project_type, estimated_value, contract_value")
      .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("todos")
      .select("id, description, contact_name, priority, due_date, project_name, category, assignee")
      .eq("status", "open")
      .order("due_date", { ascending: true })
      .limit(20),
    supabase
      .from("inbox_emails")
      .select("subject, from_name, from_email, direction, date, snippet")
      .order("date", { ascending: false })
      .limit(10),
  ]);

  const projects = projectsRes.data || [];
  const todos = todosRes.data || [];
  const emails = emailsRes.data || [];

  return {
    projectSummary: projects.length
      ? projects.map((p) =>
          `- ${p.name} [${p.status}]${p.address ? ` — ${p.address}` : ""}${
            !isField && p.contract_value
              ? ` ($${p.contract_value.toLocaleString()})`
              : !isField && p.estimated_value
              ? ` (~$${p.estimated_value.toLocaleString()})`
              : ""
          }`
        ).join("\n")
      : undefined,
    openTodosSummary: todos.length
      ? todos.map((t) =>
          `- ${t.description}${t.project_name ? ` (${t.project_name})` : ""} [${t.priority}]${t.due_date ? ` due ${t.due_date}` : ""}${t.assignee ? ` → ${t.assignee}` : ""}`
        ).join("\n")
      : undefined,
    recentEmailsSummary: emails.length
      ? emails.map((e) =>
          `- [${e.direction}] ${e.from_name || e.from_email}: "${e.subject}" (${e.date})`
        ).join("\n")
      : undefined,
  };
}

// ── Project Chat Context ────────────────────────────────────

export async function loadProjectContext(
  supabase: SupabaseClient,
  projectId: string,
  isField = false,
) {
  const { data: project } = await supabase
    .from("projects")
    .select("*, customer:customers(first_name, last_name, email, phone, address)")
    .eq("id", projectId)
    .single();

  if (!project) return null;

  const [quotesRes, todosRes, emailsRes, scheduleRes] = await Promise.all([
    supabase.from("quote_requests")
      .select("subcontractor_name, trade, amount, status")
      .or(`project_id.eq.${projectId},project_name.eq.${project.name}`)
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("todos")
      .select("description, priority, contact_name, due_date, status")
      .or(`project_id.eq.${projectId},project_name.eq.${project.name}`)
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("inbox_emails")
      .select("subject, from_name, from_email, direction, date, snippet")
      .eq("project_id", projectId)
      .order("date", { ascending: false }).limit(15),
    supabase.from("schedule_phases")
      .select("name, start_date, end_date, status")
      .eq("project_id", projectId)
      .order("start_date", { ascending: true }),
  ]);

  const customer = Array.isArray(project.customer) ? project.customer[0] : project.customer;

  return {
    project: {
      id: project.id,
      project_number: project.project_number,
      name: project.name,
      address: project.address,
      city: project.city,
      state: project.state,
      status: project.status,
      project_type: project.project_type,
      description: project.description,
      scope_of_work: project.scope_of_work,
      estimated_value: isField ? null : project.estimated_value,
      contract_value: isField ? null : project.contract_value,
      phase: project.phase,
      next_action: project.next_action,
      required_trades: project.required_trades,
    },
    customer: customer ? {
      name: `${customer.first_name} ${customer.last_name}`,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
    } : null,
    quotes: isField ? [] : (quotesRes.data || []),
    todos: todosRes.data || [],
    emails: (emailsRes.data || []).map((e) => ({
      subject: e.subject,
      from: e.from_name || e.from_email,
      direction: e.direction,
      date: e.date,
      snippet: e.snippet,
    })),
    schedule: scheduleRes.data || [],
  };
}

// ── Email Triage Context ────────────────────────────────────

export async function loadEmailTriageContext(supabase: SupabaseClient) {
  const [projectsRes, customersRes, subsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, address, customer:customers(first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("customers")
      .select("id, first_name, last_name, email")
      .order("last_name"),
    supabase
      .from("subcontractors")
      .select("id, company_name, contact_name, email, trades")
      .eq("is_active", true)
      .order("company_name"),
  ]);

  return {
    projects: (projectsRes.data || []).map((p) => {
      const customer = Array.isArray(p.customer) ? p.customer[0] : p.customer;
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        customer_name: customer ? `${customer.first_name} ${customer.last_name}` : undefined,
      };
    }),
    customers: (customersRes.data || []).map((c) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      email: c.email,
    })),
    subcontractors: (subsRes.data || []).map((s) => ({
      id: s.id,
      company_name: s.company_name,
      contact_name: s.contact_name,
      email: s.email,
      trades: s.trades,
    })),
  };
}

// ── Schedule Chat Context ───────────────────────────────────

export async function loadScheduleContext(supabase: SupabaseClient, projectId?: string) {
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [phasesRes, projectsRes, crewRes, todosRes] = await Promise.all([
    supabase
      .from("schedule_phases")
      .select("id, name, project_id, start_date, end_date, status, assigned_employee_ids, assigned_sub_ids, notes, project:projects(name)")
      .or("status.eq.in_progress,status.eq.not_started")
      .lte("start_date", thirtyDays.toISOString().split("T")[0])
      .order("start_date", { ascending: true })
      .limit(50),
    supabase
      .from("projects")
      .select("id, name, address, status")
      .in("status", ["contracted", "in_progress", "estimating", "proposal_sent"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("employees")
      .select("id, first_name, last_name, title, hourly_rate")
      .eq("status", "active"),
    supabase
      .from("todos")
      .select("description, project_name, priority, due_date")
      .eq("status", "open")
      .eq("category", "scheduling")
      .order("due_date", { ascending: true })
      .limit(20),
  ]);

  // Build active phases with project names
  const activePhases = (phasesRes.data || []).map((p) => {
    const proj = Array.isArray(p.project) ? p.project[0] : p.project;
    return {
      id: p.id,
      name: p.name,
      project_name: proj?.name,
      project_id: p.project_id,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
      assigned_employee_ids: p.assigned_employee_ids,
      assigned_sub_ids: p.assigned_sub_ids,
      notes: p.notes,
    };
  });

  // If project-specific, load that project's phases too
  let projectContext;
  if (projectId) {
    const { data: proj } = await supabase
      .from("projects")
      .select("id, name, project_type, address, description")
      .eq("id", projectId)
      .single();

    const { data: phases } = await supabase
      .from("schedule_phases")
      .select("name, start_date, end_date, status")
      .eq("project_id", projectId)
      .order("start_date", { ascending: true });

    if (proj) {
      projectContext = {
        id: proj.id,
        name: proj.name,
        type: proj.project_type,
        address: proj.address,
        description: proj.description,
        phases: phases || [],
      };
    }
  }

  // Crew list feeds the schedule prompt — mask office-team rates for
  // chatters outside the office-rate set.
  const rateVis = await getRateVisibility();
  const crew = (crewRes.data || []).map((c) =>
    canSeeRate(rateVis, { employeeId: c.id })
      ? c
      : { ...c, hourly_rate: null },
  );

  return {
    activePhases,
    activeProjects: projectsRes.data || [],
    crew,
    openScheduleTodos: todosRes.data || [],
    projectContext,
  };
}
