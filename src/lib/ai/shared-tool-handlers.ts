/**
 * Unified tool execution for ALL 4 AI chats.
 * Single dispatcher — Brain, Project, Email Triage, and Schedule chats all call this.
 */

import { createClient } from "@/lib/supabase/server";
import { canSeeRate, getRateVisibility } from "@/lib/auth/rate-visibility";
import { sendEmail } from "@/lib/google/gmail";
import { createEvent, deleteEvent } from "@/lib/google/calendar";
import { listFolderFiles } from "@/lib/google/drive";
import { googleFetch } from "@/lib/google/auth";
import {
  GmailRateLimitError,
  RateLimitExceeded,
  assertGmailNotThrottled,
  recordGmailThrottle,
  assertSendRateOk,
  recordSendAttempt,
} from "@/lib/google/throttle";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import {
  notifySchedulePhaseAssignees,
  formatShortRange,
} from "@/lib/notifications/schedule-notify";
import { lineItemFinancials, lineCost, linePrice, lineMarkupPct } from "@/lib/estimates/line-item-financials";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// ── Dispatcher ──────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId?: string,
  request?: Request
): Promise<string> {
  try {
    switch (name) {
      // READ
      case "search_projects": return await searchProjects(input, supabase);
      case "get_project_details": return await getProjectDetails(input, supabase);
      case "get_project_financials": return await getProjectFinancials(input, supabase);
      case "get_budget_vs_actual": return await getBudgetVsActual(input, supabase);
      case "search_customers": return await searchCustomers(input, supabase);
      case "search_subcontractors": return await searchSubcontractors(input, supabase);
      case "search_emails": return await searchEmails(input, supabase);
      case "get_email_details": return await getEmailDetails(input, supabase);
      case "list_quotes": return await listQuotes(input, supabase);
      case "list_todos": return await listTodos(input, supabase);
      case "get_schedule": return await getSchedule(input, supabase);
      case "find_crew_member": return await findCrewMember(input, supabase);
      case "list_invoices": return await listInvoices(input, supabase);
      case "list_payments": return await listPayments(input, supabase);
      case "list_change_orders": return await listChangeOrders(input, supabase);
      case "get_budget_lines": return await getBudgetLines(input, supabase);
      case "search_costbook": return await searchCostbook(input, supabase);
      case "list_project_documents": return await listProjectDocuments(input, supabase);

      // WRITE
      case "save_memory": return await saveMemory(input, supabase);
      case "create_todo": return await createTodo(input, supabase, userId);
      case "update_todo": return await updateTodo(input, supabase);
      case "create_project": return await createProject(input, supabase);
      case "update_project": return await updateProject(input, supabase);
      case "create_customer": return await createCustomer(input, supabase);
      case "create_subcontractor": return await createSubcontractor(input, supabase);
      case "create_quote_request": return await createQuoteRequest(input, supabase);
      case "list_line_items_for_bidding": return await listLineItemsForBidding(input, supabase);
      case "send_bid_to_subs": return await sendBidToSubs(input, supabase);
      case "record_quote_received": return await recordQuoteReceived(input, supabase);
      case "award_bid": return await awardBidFromChat(input, supabase);
      case "create_invoice": return await createInvoice(input, supabase, userId);
      case "split_invoice": return await splitInvoice(input, supabase, userId);
      case "update_invoice": return await updateInvoice(input, supabase);
      case "record_payment": return await recordPayment(input, supabase, userId);
      case "create_change_order": return await createChangeOrder(input, supabase, userId);
      case "update_change_order": return await updateChangeOrder(input, supabase);
      case "draft_email": return await draftEmail(input);
      case "send_email": return await doSendEmail(input, supabase, request);
      case "link_email_to_project": return await linkEmailToProject(input, supabase);
      case "create_schedule_event": return await createScheduleEvent(input, supabase, userId);
      case "create_schedule_phase": return await createSchedulePhase(input, supabase, userId);
      case "update_schedule_phase": return await updateSchedulePhase(input, supabase);
      case "delete_schedule_phase": return await deleteSchedulePhase(input, supabase);
      case "assign_crew_to_project": return await assignCrewToProject(input, supabase, userId);
      case "save_file_to_project": return await saveFileToProject(input, supabase, userId);

      // ESTIMATING
      case "update_estimate_line_item": return await updateEstimateLineItem(input, supabase);
      case "add_estimate_line_item": return await addEstimateLineItem(input, supabase, userId);

      // ESTIMATE + DOCUMENT GENERATION
      case "generate_bid_package": return await generateBidPackage(input, supabase);
      case "generate_estimate": return await generateEstimate(input, supabase, userId);
      case "generate_proposal": return await generateProposal(input, supabase);
      case "generate_change_order_pdf": return await generateChangeOrderPdf(input, supabase);
      case "generate_financial_report": return await generateFinancialReport(input, supabase);

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ── READ handlers ───────────────────────────────────────────

async function searchProjects(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const limit = Math.min(Number(input.limit) || 10, 50);
  let query = supabase
    .from("projects")
    .select("id, project_number, name, address, city, status, project_type, estimated_value, contract_value, customer:customers(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) query = query.eq("status", input.status);
  if (input.query) {
    const q = String(input.query);
    query = query.or(`name.ilike.%${q}%,address.ilike.%${q}%,city.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ message: "No projects found", results: [] });

  return JSON.stringify({
    count: data.length,
    results: data.map((p) => {
      const customer = Array.isArray(p.customer) ? p.customer[0] : p.customer;
      return {
        id: p.id, project_number: p.project_number, name: p.name,
        address: p.address, city: p.city, status: p.status,
        type: p.project_type, estimated_value: p.estimated_value,
        contract_value: p.contract_value,
        customer: customer ? `${customer.first_name} ${customer.last_name}` : null,
      };
    }),
  });
}

async function getProjectDetails(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id);

  const { data: project, error } = await supabase
    .from("projects")
    .select("*, customer:customers(first_name, last_name, email, phone, address)")
    .eq("id", projectId)
    .single();

  if (error || !project) return JSON.stringify({ error: "Project not found" });

  const [quotesRes, todosRes, emailsRes, scheduleRes, invoicesRes] = await Promise.all([
    supabase.from("quote_requests")
      .select("id, subcontractor_name, trade, amount, status, scope_description, document_type, created_at")
      .or(`project_id.eq.${projectId},project_name.eq.${project.name}`)
      .order("created_at", { ascending: false }).limit(30),
    supabase.from("todos")
      .select("id, contact_name, description, priority, status, due_date, category, assignee, created_at")
      .or(`project_id.eq.${projectId},project_name.eq.${project.name}`)
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("inbox_emails")
      .select("id, subject, from_name, from_email, to_email, snippet, direction, is_processed, date")
      .eq("project_id", projectId)
      .order("date", { ascending: false }).limit(15),
    supabase.from("schedule_phases")
      .select("*").eq("project_id", projectId)
      .order("start_date", { ascending: true }),
    supabase.from("invoices")
      .select("id, vendor_name, trade, amount, paid_amount, payment_status, invoice_date, description")
      .eq("project_id", projectId)
      .order("invoice_date", { ascending: false }).limit(20),
  ]);

  const customer = Array.isArray(project.customer) ? project.customer[0] : project.customer;

  return JSON.stringify({
    project: {
      id: project.id, project_number: project.project_number, name: project.name,
      address: project.address, city: project.city, state: project.state,
      status: project.status, project_type: project.project_type,
      description: project.description, scope_of_work: project.scope_of_work,
      estimated_value: project.estimated_value, contract_value: project.contract_value,
      phase: project.phase, next_action: project.next_action, progress: project.progress,
      required_trades: project.required_trades,
    },
    customer: customer ? {
      name: `${customer.first_name} ${customer.last_name}`,
      email: customer.email, phone: customer.phone, address: customer.address,
    } : null,
    quotes: quotesRes.data || [],
    todos: todosRes.data || [],
    emails: (emailsRes.data || []).map((e) => ({
      id: e.id, subject: e.subject, from: e.from_name || e.from_email,
      to: e.to_email, snippet: e.snippet, direction: e.direction, date: e.date,
    })),
    schedule: scheduleRes.data || [],
    invoices: invoicesRes.data || [],
  });
}

async function getProjectFinancials(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id);
  const { data, error } = await supabase.rpc("get_project_financials", { p_project_id: projectId });

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ project_id: projectId, financials: data });
}

async function getBudgetVsActual(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id);
  const { data, error } = await supabase
    .from("budget_vs_actual")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ message: "No budget data — project needs an estimate first", lines: [] });
  return JSON.stringify({ count: data.length, lines: data });
}

async function searchCustomers(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const q = String(input.query);
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email, phone, address")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,address.ilike.%${q}%`)
    .limit(20);

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function searchSubcontractors(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  let query = supabase
    .from("subcontractors")
    .select("id, company_name, contact_name, email, phone, trades, vetting_status, is_active")
    .eq("is_active", true).limit(30);

  if (input.query) {
    const q = String(input.query);
    query = query.or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%,email.ilike.%${q}%`);
  }
  if (input.trade) query = query.contains("trades", [String(input.trade)]);

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function searchEmails(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const limit = Math.min(Number(input.limit) || 10, 30);
  let query = supabase
    .from("inbox_emails")
    .select("id, subject, from_name, from_email, to_email, snippet, direction, is_processed, project_id, date")
    .order("date", { ascending: false }).limit(limit);

  if (input.project_id) query = query.eq("project_id", String(input.project_id));
  if (input.direction) query = query.eq("direction", String(input.direction));
  if (input.query) {
    const q = String(input.query);
    query = query.or(`subject.ilike.%${q}%,from_email.ilike.%${q}%,from_name.ilike.%${q}%,snippet.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function getEmailDetails(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("inbox_emails")
    .select("id, gmail_message_id, subject, from_name, from_email, to_email, body, snippet, direction, is_processed, project_id, attachments, date")
    .eq("id", String(input.email_id)).single();

  if (error || !data) return JSON.stringify({ error: "Email not found" });

  const body = data.body ? data.body.substring(0, 6000) : null;
  const attachments = (data.attachments || []).map((a: Record<string, unknown>) => ({
    filename: a.filename, mime_type: a.mime_type, size: a.size,
    has_text: !!a.text_content,
    text_preview: a.text_content ? String(a.text_content).substring(0, 2000) : null,
  }));

  return JSON.stringify({ ...data, body, attachments });
}

async function listQuotes(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = supabase
    .from("quote_requests")
    .select("id, project_name, project_id, subcontractor_name, trade, amount, status, scope_description, document_type, created_at")
    .order("created_at", { ascending: false }).limit(limit);

  if (input.project_id) query = query.eq("project_id", String(input.project_id));
  if (input.project_name) query = query.ilike("project_name", `%${input.project_name}%`);
  if (input.subcontractor_name) query = query.ilike("subcontractor_name", `%${input.subcontractor_name}%`);
  if (input.trade) query = query.ilike("trade", `%${input.trade}%`);
  if (input.status) query = query.eq("status", String(input.status));

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function listTodos(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = supabase
    .from("todos")
    .select("id, contact_name, description, priority, status, due_date, category, project_name, assignee, created_at")
    .order("created_at", { ascending: false }).limit(limit);

  if (input.status) query = query.eq("status", String(input.status));
  else query = query.eq("status", "open");
  if (input.priority) query = query.eq("priority", String(input.priority));
  if (input.project_name) query = query.ilike("project_name", `%${input.project_name}%`);
  if (input.category) query = query.eq("category", String(input.category));

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function getSchedule(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  let query = supabase.from("schedule_phases").select("*, project:projects(name)").order("start_date", { ascending: true });

  if (input.project_id) {
    query = query.eq("project_id", String(input.project_id));
  } else {
    // Return all active phases (next 30 days)
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    query = query.or(`status.eq.in_progress,status.eq.not_started`)
      .lte("start_date", thirtyDays.toISOString().split("T")[0])
      .limit(50);
  }

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });

  // Resolve assigned_employee_ids → names so the AI can describe assignments
  const allIds = new Set<string>();
  for (const p of data ?? []) {
    for (const id of (p.assigned_employee_ids ?? []) as string[]) allIds.add(id);
  }
  let nameById = new Map<string, string>();
  if (allIds.size > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", Array.from(allIds));
    nameById = new Map(
      (emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()])
    );
  }
  const phases = (data ?? []).map((p) => ({
    ...p,
    assigned_employees: ((p.assigned_employee_ids ?? []) as string[]).map((id) => ({
      employee_id: id,
      full_name: nameById.get(id) ?? "(unknown)",
    })),
  }));

  return JSON.stringify({ count: phases.length, phases });
}

async function findCrewMember(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const raw = String(input.query ?? "").trim();
  if (!raw) return JSON.stringify({ error: "query is required (a name fragment)" });

  const includeInactive = input.include_inactive === true;
  const q = raw.toLowerCase();

  let builder = supabase
    .from("employees")
    .select("id, first_name, last_name, email, title, status, hourly_rate, profile_id")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(20);
  if (!includeInactive) builder = builder.eq("status", "active");

  const { data, error } = await builder;
  if (error) return JSON.stringify({ error: error.message });

  // Office-team rates are masked for callers outside the office-rate set.
  const rateVis = await getRateVisibility();
  const matches = (data ?? []).map((e) => ({
    employee_id: e.id,
    full_name: `${e.first_name} ${e.last_name}`.trim(),
    email: e.email,
    title: e.title,
    status: e.status,
    hourly_rate: canSeeRate(rateVis, { employeeId: e.id, profileId: e.profile_id })
      ? e.hourly_rate
      : null,
    has_logged_in: !!e.profile_id,
  }));

  return JSON.stringify({ count: matches.length, query: raw, matches });
}

async function assignCrewToProject(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId?: string
): Promise<string> {
  const employeeId = String(input.employee_id ?? "");
  const projectId = String(input.project_id ?? "");
  if (!employeeId || !projectId) {
    return JSON.stringify({ error: "employee_id and project_id are both required" });
  }

  let assignedBy = userId;
  if (!assignedBy) {
    const { data: { user } } = await supabase.auth.getUser();
    assignedBy = user?.id;
  }
  if (!assignedBy) return JSON.stringify({ error: "Not signed in — cannot assign crew." });

  const { error } = await supabase.from("crew_project_assignments").upsert(
    { employee_id: employeeId, project_id: projectId, assigned_by: assignedBy },
    { onConflict: "employee_id,project_id" }
  );
  if (error) return JSON.stringify({ error: error.message });

  const [{ data: emp }, { data: proj }] = await Promise.all([
    supabase.from("employees").select("first_name, last_name").eq("id", employeeId).maybeSingle(),
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
  ]);

  const who = emp ? `${emp.first_name} ${emp.last_name}`.trim() : "Crew member";
  const where = proj?.name ?? "project";
  return JSON.stringify({ success: true, message: `${who} added to ${where} crew.` });
}

async function listInvoices(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = supabase
    .from("invoices")
    .select("id, project_id, vendor_name, vendor_type, trade, invoice_number, invoice_date, due_date, amount, paid_amount, payment_status, description")
    .order("invoice_date", { ascending: false }).limit(limit);

  if (input.project_id) query = query.eq("project_id", String(input.project_id));
  if (input.payment_status) query = query.eq("payment_status", String(input.payment_status));

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function listPayments(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = supabase
    .from("payments_received")
    .select("id, project_id, payment_type, amount, received_date, method, reference_number, description, notes")
    .order("received_date", { ascending: false }).limit(limit);

  if (input.project_id) query = query.eq("project_id", String(input.project_id));

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });

  const total = (data || []).reduce((sum, p) => sum + Number(p.amount), 0);
  return JSON.stringify({ count: data?.length || 0, total_received: total, results: data || [] });
}

async function listChangeOrders(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  let query = supabase
    .from("change_orders")
    .select("id, project_id, change_order_number, title, description, status, cost_impact, price_impact, submitted_at, approved_at")
    .order("change_order_number", { ascending: true });

  if (input.project_id) query = query.eq("project_id", String(input.project_id));
  if (input.status) query = query.eq("status", String(input.status));

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

// ── WRITE handlers ──────────────────────────────────────────

async function saveMemory(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const source = String(input.source || "user_taught");
  // Only humans make permanent rules — never pin an agent's own inference.
  if (input.pinned && source === "auto_learned") {
    return JSON.stringify({ error: "Only user_taught or correction memories can be pinned." });
  }
  const content = String(input.content);
  if (content.length > 2000) {
    return JSON.stringify({ error: "Memory content is over 2000 chars — summarize it first." });
  }

  const row = {
    type: String(input.type),
    scope: input.project_id ? "project" : "global",
    project_id: input.project_id ? String(input.project_id) : null,
    title: String(input.title),
    content,
    source,
    pinned: Boolean(input.pinned ?? false),
  };

  const { data, error } = await supabase.from("agent_memory").insert(row).select("id").single();
  if (error) {
    // DB dedup guard (idx_agent_memory_title_dedup): same active title in this
    // scope already exists — update that memory instead of failing.
    if (error.code === "23505") {
      let upd = supabase
        .from("agent_memory")
        .update({ type: row.type, content: row.content, source: row.source, pinned: row.pinned })
        .eq("is_active", true)
        .ilike("title", row.title);
      if (row.project_id) upd = upd.eq("project_id", row.project_id);
      else upd = upd.eq("scope", "global");
      const { data: existing, error: updErr } = await upd.select("id").single();
      if (updErr) return JSON.stringify({ error: updErr.message });
      return JSON.stringify({
        success: true,
        message: "A memory with this title already existed — updated it.",
        memory_id: existing.id,
      });
    }
    return JSON.stringify({ error: error.message });
  }
  return JSON.stringify({
    success: true,
    message: "Saved to the shared agent brain. Future chats and routines will recall it.",
    memory_id: data.id,
  });
}

async function createTodo(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id;
  }

  const { data, error } = await supabase
    .from("todos")
    .insert({
      description: String(input.description),
      contact_name: input.contact_name ? String(input.contact_name) : "General",
      priority: String(input.priority || "medium"),
      status: "open",
      due_date: input.due_date ? String(input.due_date) : null,
      project_name: input.project_name ? String(input.project_name) : null,
      category: String(input.category || "general"),
      assignee: input.assignee ? String(input.assignee) : null,
      source: "ai_execute",
      created_by: userId,
    })
    .select("id, description, contact_name, priority, due_date, project_name, assignee")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Todo created", todo: data });
}

async function updateTodo(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const updates: Record<string, unknown> = {};
  if (input.status) {
    updates.status = String(input.status);
    if (input.status === "done") updates.completed_at = new Date().toISOString();
  }
  if (input.priority) updates.priority = String(input.priority);
  if (input.snooze_until) updates.snooze_until = String(input.snooze_until);

  const { data, error } = await supabase
    .from("todos").update(updates).eq("id", String(input.todo_id))
    .select("id, description, status, priority").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Todo updated", todo: data });
}

async function createProject(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  // RLS on projects requires created_by = auth.uid() on insert.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: "Not authenticated" });

  const insertData: Record<string, unknown> = {
    name: String(input.name),
    status: String(input.status || "lead"),
    state: String(input.state || "MA"),
    created_by: user.id,
  };

  for (const f of ["address", "city", "project_type", "description", "scope_of_work"]) {
    if (input[f]) insertData[f] = String(input[f]);
  }
  if (input.estimated_value) insertData.estimated_value = Number(input.estimated_value);
  if (input.customer_id) insertData.customer_id = String(input.customer_id);

  const { data, error } = await supabase
    .from("projects").insert(insertData).select("id, project_number, name, status").single();

  if (error) {
    console.error("[createProject] insert failed:", error);
    return JSON.stringify({ error: error.message });
  }
  return JSON.stringify({ success: true, message: `Project ${data.project_number} created`, project: data });
}

async function updateProject(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const updates: Record<string, unknown> = {};
  for (const f of ["status", "description", "scope_of_work", "phase", "next_action"]) {
    if (input[f] !== undefined) updates[f] = input[f];
  }
  for (const f of ["estimated_value", "contract_value"]) {
    if (input[f] !== undefined) updates[f] = Number(input[f]);
  }

  const { data, error } = await supabase
    .from("projects").update(updates).eq("id", String(input.project_id))
    .select("id, project_number, name, status").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Project updated", project: data });
}

async function createCustomer(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  // RLS on customers requires created_by = auth.uid() on insert.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: "Not authenticated" });

  const insertData: Record<string, unknown> = {
    first_name: String(input.first_name),
    last_name: String(input.last_name),
    created_by: user.id,
  };
  for (const f of ["email", "phone", "address", "city", "state", "zip"]) {
    if (input[f]) insertData[f] = String(input[f]);
  }

  const { data, error } = await supabase
    .from("customers").insert(insertData).select("id, first_name, last_name, email").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Customer created", customer: data });
}

async function createSubcontractor(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  // RLS on subcontractors requires created_by = auth.uid() on insert.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: "Not authenticated" });

  const insertData: Record<string, unknown> = {
    company_name: String(input.company_name),
    is_active: true,
    vetting_status: "prospect",
    created_by: user.id,
  };
  for (const f of ["contact_name", "email", "phone", "address", "city", "state"]) {
    if (input[f]) insertData[f] = String(input[f]);
  }
  if (input.trades) insertData.trades = input.trades;

  const { data, error } = await supabase
    .from("subcontractors").insert(insertData)
    .select("id, company_name, contact_name, email, trades").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Subcontractor created", subcontractor: data });
}

async function createQuoteRequest(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const insertData: Record<string, unknown> = {
    project_name: String(input.project_name),
    subcontractor_name: String(input.subcontractor_name),
    trade: String(input.trade),
    status: String(input.status || "received"),
  };
  for (const f of ["amount", "scope_description", "extracted_text", "gmail_message_id", "attachment_storage_path", "estimate_line_item_id"]) {
    if (input[f] !== undefined) insertData[f] = f === "amount" ? Number(input[f]) : String(input[f]);
  }
  insertData.document_type = String(input.document_type || "quote");
  insertData.subcontractor_id = await resolveSubcontractorId(supabase, String(input.subcontractor_name));

  const { data, error } = await supabase
    .from("quote_requests").insert(insertData)
    .select("id, project_name, subcontractor_name, trade, amount, status, estimate_line_item_id").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Quote recorded", quote: data });
}

// ── Line-item-spined bid tools (used by all chats) ────────────────────

async function listLineItemsForBidding(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id);
  const tradeFilter = input.trade ? String(input.trade).toLowerCase() : null;

  const { data: ests } = await supabase
    .from("estimates").select("id, version")
    .eq("project_id", projectId).order("version", { ascending: false }).limit(1);
  if (!ests?.[0]) return JSON.stringify({ error: "No estimate yet for this project" });

  let q = supabase.from("estimate_line_items")
    .select(`id, description, trade, total_cost, quantity, unit, unit_cost, total_price,
             markup_percentage, proposal_description, scope_text, notes, is_visible_on_proposal,
             needs_sub_quote, quote_status, sort_order,
             awarded_bid_id, awarded_cost,
             awarded_sub:subcontractors!awarded_subcontractor_id ( company_name )`)
    .eq("estimate_id", ests[0].id)
    .order("sort_order");
  if (tradeFilter) q = q.ilike("trade", `%${tradeFilter}%`);

  const { data: lines, error } = await q;
  if (error) return JSON.stringify({ error: error.message });

  const lineIds = (lines || []).map((l) => l.id);
  const { data: bids } = await supabase
    .from("subcontractor_bids")
    .select(`id, estimate_line_item_id, amount, status, is_selected, subcontractors ( company_name )`)
    .in("estimate_line_item_id", lineIds.length ? lineIds : ["00000000-0000-0000-0000-000000000000"]);

  const bidsByLine = new Map<string, typeof bids>();
  for (const b of bids || []) {
    if (!b.estimate_line_item_id) continue;
    const arr = bidsByLine.get(b.estimate_line_item_id) || [];
    arr.push(b);
    bidsByLine.set(b.estimate_line_item_id, arr);
  }

  const results = (lines || []).map((li) => {
    const lineBids = bidsByLine.get(li.id) || [];
    const awardedSub = Array.isArray(li.awarded_sub) ? li.awarded_sub[0] : li.awarded_sub;
    // Compute profit live from the columns the UI uses, since the stored
    // profit column drifts when total_price changes without total_cost.
    const cost = Number(li.total_cost ?? 0);
    const price = Number(li.total_price ?? 0);
    const profit = price - cost;
    const margin = price > 0 ? +(profit / price * 100).toFixed(1) : 0;
    return {
      line_item_id: li.id,
      description: li.description,
      proposal_description: li.proposal_description,
      scope_text: li.scope_text,
      notes: li.notes,
      trade: li.trade,
      quantity: li.quantity,
      unit: li.unit,
      unit_cost: li.unit_cost,
      estimated_cost: cost,
      markup_pct: li.markup_percentage,
      client_price: price,
      profit,
      margin_pct: margin,
      visible_on_proposal: li.is_visible_on_proposal,
      needs_sub_quote: li.needs_sub_quote,
      quote_status: li.quote_status,
      awarded: li.awarded_bid_id ? { sub: awardedSub?.company_name, amount: li.awarded_cost } : null,
      bids: lineBids.map((b) => {
        const sub = Array.isArray(b.subcontractors) ? b.subcontractors[0] : b.subcontractors;
        return { bid_id: b.id, sub: sub?.company_name, amount: b.amount, status: b.status, is_selected: b.is_selected };
      }),
    };
  });
  return JSON.stringify({ count: results.length, lines: results });
}

async function sendBidToSubs(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const lineItemId = String(input.estimate_line_item_id);
  const subIds = (input.subcontractor_ids as string[]) || [];
  if (subIds.length === 0) return JSON.stringify({ error: "subcontractor_ids required" });

  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("id, description, scope_text, trade, estimate:estimates(project_id, projects(name, address))")
    .eq("id", lineItemId).single();
  if (!line) return JSON.stringify({ error: "Line item not found" });

  const estimate = Array.isArray(line.estimate) ? line.estimate[0] : line.estimate;
  const project = estimate?.projects ? (Array.isArray(estimate.projects) ? estimate.projects[0] : estimate.projects) : null;
  const projectId = estimate?.project_id;
  if (!projectId) return JSON.stringify({ error: "Could not resolve project from line item" });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: "Not authenticated" });

  const { data: pkg, error: pkgErr } = await supabase
    .from("bid_packages")
    .insert({
      project_id: projectId,
      name: `${line.trade || "Bid"} — ${line.description}`,
      trade: line.trade || "general",
      scope_of_work: input.scope_of_work ? String(input.scope_of_work) : (line.scope_text || line.description),
      due_date: input.due_date ? String(input.due_date) : null,
      project_address: project?.address || null,
      estimate_line_item_id: lineItemId,
      status: "draft",
      created_by: user.id,
    })
    .select("id").single();
  if (pkgErr || !pkg) return JSON.stringify({ error: pkgErr?.message || "Failed to create bid package" });

  const bidRows = subIds.map((subId) => ({
    bid_package_id: pkg.id,
    subcontractor_id: subId,
    estimate_line_item_id: lineItemId,
    status: "invited" as const,
  }));
  const { error: bidErr } = await supabase.from("subcontractor_bids").insert(bidRows);
  if (bidErr) return JSON.stringify({ error: bidErr.message });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    await fetch(`${baseUrl}/api/send-bid-package`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidPackageId: pkg.id }),
    });
  } catch { /* best-effort send; bids are persisted either way */ }

  return JSON.stringify({
    success: true,
    message: `Bid package created for "${line.description}" — sent to ${subIds.length} sub(s).`,
    bid_package_id: pkg.id,
    project_url: `/projects/${projectId}/bids`,
  });
}

async function recordQuoteReceived(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const bidId = String(input.bid_id);
  const amount = Number(input.amount);
  const update: Record<string, unknown> = {
    status: "submitted", amount, submitted_at: new Date().toISOString(),
  };
  if (input.gmail_message_id) update.response_gmail_id = String(input.gmail_message_id);

  const { data, error } = await supabase
    .from("subcontractor_bids").update(update).eq("id", bidId)
    .select("id, amount, status, bid_package_id, subcontractors(company_name)").single();
  if (error) return JSON.stringify({ error: error.message });

  if (data?.bid_package_id) {
    await supabase.from("bid_packages").update({ status: "receiving" })
      .eq("id", data.bid_package_id).eq("status", "sent");
  }
  const sub = Array.isArray(data.subcontractors) ? data.subcontractors[0] : data.subcontractors;
  return JSON.stringify({
    success: true,
    message: `Recorded ${sub?.company_name} quote at $${amount.toLocaleString()}`,
    bid: data,
  });
}

async function awardBidFromChat(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const bidId = String(input.bid_id);
  const { data: bid } = await supabase
    .from("subcontractor_bids").select("id, bid_package_id").eq("id", bidId).single();
  if (!bid) return JSON.stringify({ error: "Bid not found" });

  const { awardBid } = await import("@/lib/actions/bids");
  const result = await awardBid(bidId, bid.bid_package_id);
  if (result.error) return JSON.stringify({ error: result.error });
  return JSON.stringify({
    success: true,
    message: "Bid awarded. Estimate line item updated with awarded sub and price.",
  });
}

async function createInvoice(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  const projectId = String(input.project_id);

  // Validate project exists — prevents FK constraint errors from hallucinated UUIDs
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", projectId).single();
  if (!project) {
    return JSON.stringify({ error: `Project ID "${projectId}" not found. Use search_projects to find the correct project first.` });
  }

  const insertData: Record<string, unknown> = {
    project_id: projectId,
    vendor_name: String(input.vendor_name),
    amount: Number(input.amount),
    payment_status: String(input.payment_status || "unpaid"),
    vendor_type: String(input.vendor_type || "subcontractor"),
  };
  for (const f of ["trade", "invoice_number", "invoice_date", "due_date", "description", "subcontractor_id", "gmail_message_id", "attachment_storage_path", "extracted_text"]) {
    if (input[f]) insertData[f] = String(input[f]);
  }
  // Validate estimate_line_item_id exists before setting — AI may hallucinate UUIDs
  if (input.estimate_line_item_id) {
    const { data: lineItem } = await supabase.from("estimate_line_items").select("id").eq("id", String(input.estimate_line_item_id)).single();
    if (lineItem) insertData.estimate_line_item_id = lineItem.id;
  }
  if (input.payment_status === "paid") {
    insertData.paid_amount = Number(input.amount);
    insertData.paid_date = String(input.invoice_date || new Date().toISOString().split("T")[0]);
  }
  if (userId) insertData.created_by = userId;
  if (!insertData.subcontractor_id) {
    insertData.subcontractor_id = await resolveSubcontractorId(supabase, String(input.vendor_name));
  }

  const { data, error } = await supabase
    .from("invoices").insert(insertData)
    .select("id, vendor_name, amount, trade, payment_status").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Invoice from ${data.vendor_name} for $${data.amount} recorded on ${project.name}`, invoice: data });
}

async function recordPayment(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  const insertData: Record<string, unknown> = {
    project_id: String(input.project_id),
    payment_type: String(input.payment_type),
    amount: Number(input.amount),
    received_date: input.received_date ? String(input.received_date) : new Date().toISOString().split("T")[0],
  };
  for (const f of ["method", "reference_number", "description", "notes"]) {
    if (input[f]) insertData[f] = String(input[f]);
  }
  if (userId) insertData.created_by = userId;

  const { data, error } = await supabase
    .from("payments_received").insert(insertData)
    .select("id, payment_type, amount, received_date, method").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `${data.payment_type} payment of $${data.amount} recorded`, payment: data });
}

async function createChangeOrder(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  const projectId = String(input.project_id);

  // Validate project exists
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", projectId).single();
  if (!project) return JSON.stringify({ error: `Project "${projectId}" not found. Use search_projects first.` });

  // Get next CO number for this project
  const { data: existing } = await supabase
    .from("change_orders")
    .select("change_order_number")
    .eq("project_id", projectId)
    .order("change_order_number", { ascending: false })
    .limit(1);

  const nextNum = existing?.length ? existing[0].change_order_number + 1 : 1;

  const insertData: Record<string, unknown> = {
    project_id: projectId,
    change_order_number: nextNum,
    title: String(input.title),
    status: String(input.status || "draft"),
    cost_impact: Number(input.cost_impact || 0),
    price_impact: Number(input.price_impact || 0),
  };
  if (input.description) insertData.description = String(input.description);
  if (userId) insertData.created_by = userId;
  if (input.status === "approved") insertData.approved_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("change_orders").insert(insertData)
    .select("id, change_order_number, title, status, cost_impact, price_impact").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Change Order #${data.change_order_number} created on ${project.name}`, change_order: data });
}

async function updateChangeOrder(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const coId = String(input.change_order_id);

  const { data: existing } = await supabase.from("change_orders").select("id, status").eq("id", coId).single();
  if (!existing) return JSON.stringify({ error: `Change order "${coId}" not found. Use list_change_orders first.` });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ["title", "description", "approved_by"]) {
    if (input[f] !== undefined) updates[f] = String(input[f]);
  }
  if (input.cost_impact !== undefined) updates.cost_impact = Number(input.cost_impact);
  if (input.price_impact !== undefined) updates.price_impact = Number(input.price_impact);
  if (input.status !== undefined) {
    updates.status = String(input.status);
    if (input.status === "approved") updates.approved_at = new Date().toISOString();
    if (input.status === "submitted") updates.submitted_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("change_orders").update(updates).eq("id", coId)
    .select("id, change_order_number, title, status, cost_impact, price_impact, approved_at").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `CO #${data.change_order_number} updated — status: ${data.status}`, change_order: data });
}

async function draftEmail(input: Record<string, unknown>): Promise<string> {
  return JSON.stringify({
    draft: true,
    to: String(input.to),
    subject: String(input.subject),
    body: String(input.body),
    reply_to_message_id: input.reply_to_message_id ? String(input.reply_to_message_id) : null,
    attachments: input.attachments || [],
    message: "Email drafted for review. User must approve before sending.",
  });
}

async function doSendEmail(input: Record<string, unknown>, supabase: SupabaseClient, request?: Request): Promise<string> {
  try {
    // Pre-flight gates BEFORE we touch Gmail.
    // 1. Local Google throttle (set when a 429 came back recently).
    // 2. App-level send rate limit (proactive cap to stay below Google's
    //    adaptive anti-abuse threshold even on accidental bursts).
    const { data: { user: throttleUser } } = await supabase.auth.getUser();
    if (throttleUser?.id) {
      try {
        await assertGmailNotThrottled(supabase, throttleUser.id);
        await assertSendRateOk(supabase, throttleUser.id);
      } catch (err) {
        if (err instanceof GmailRateLimitError) {
          return JSON.stringify({
            error: err.message,
            retry_at: err.retryAt.toISOString(),
            hint: "Gmail throttle is active. Do not retry until retry_at — every attempt extends the window.",
          });
        }
        if (err instanceof RateLimitExceeded) {
          return JSON.stringify({
            error: err.message,
            hint: `App-level cap (${err.limit} per ${err.window}). Wait briefly and resend.`,
          });
        }
        throw err;
      }
    }

    // Resolve attachments — fetch URLs or download from storage
    let emailAttachments: Array<{ filename: string; mimeType: string; content: string }> | undefined;

    const rawAttachments = input.attachments as Array<{
      url?: string; storage_path?: string; drive_file_id?: string; filename: string; mimeType?: string;
    }> | undefined;

    // ══════════════════════════════════════════════════════════════════
    // HARD GUARD: never send client-facing documents to subcontractors.
    // Client proposals and financial reports contain Penney's markup —
    // exposing them to a sub destroys margin and negotiation leverage.
    // ══════════════════════════════════════════════════════════════════
    const recipient = String(input.to || "").trim().toLowerCase();
    if (recipient && rawAttachments?.length) {
      const isClientDoc = (att: { url?: string; filename?: string }) => {
        const url = (att.url || "").toLowerCase();
        const fn = (att.filename || "").toLowerCase();
        return (
          url.includes("generate-proposal") ||
          url.includes("generate-financial-report") ||
          fn.includes("proposal") ||
          fn.includes("financial report") ||
          fn.includes("financials")
        );
      };
      const clientDocs = rawAttachments.filter(isClientDoc);
      if (clientDocs.length > 0) {
        const { data: sub } = await supabase
          .from("subcontractors")
          .select("id, company_name, contact_name, email")
          .ilike("email", recipient)
          .maybeSingle();
        if (sub) {
          return JSON.stringify({
            error: "BLOCKED: cannot send client-facing documents to a subcontractor.",
            reason: `${recipient} is a known subcontractor (${sub.company_name}). Proposals and financial reports contain Penney's markup — sending them to a sub would expose margin.`,
            blocked_attachments: clientDocs.map(a => a.filename),
            fix: "For subs, use generate_bid_package (scope + measurements + screenshots, no pricing) instead of generate_proposal.",
          });
        }
      }

      // NOTE (7/30): the Ryan-approval gate on proposal attachments was
      // removed. Jorge sends proposals to clients directly now, so there is
      // no approval_status check here. The subcontractor guard above still
      // stands — margin never goes to a sub.
    }

    if (rawAttachments?.length) {
      emailAttachments = [];
      const attachmentErrors: string[] = [];

      for (const att of rawAttachments) {
        try {
          if (att.url && request) {
            const fwdHost = request.headers.get("x-forwarded-host");
            const host = request.headers.get("host");
            const origin = request.headers.get("origin")
              || (fwdHost ? `https://${fwdHost}` : null)
              || (host ? `https://${host}` : "https://penney-construction-mf6m.vercel.app");
            const fetchUrl = `${origin}${att.url}`;
            const res = await fetch(fetchUrl, {
              headers: { cookie: request.headers.get("cookie") || "" },
            });
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer());
              emailAttachments.push({
                filename: att.filename,
                mimeType: att.mimeType || res.headers.get("content-type") || "application/octet-stream",
                content: buffer.toString("base64"),
              });
            } else {
              console.error(`Attachment URL fetch failed: ${fetchUrl} → ${res.status} ${res.statusText}`);
              attachmentErrors.push(`${att.filename}: HTTP ${res.status}`);
            }
          } else if (att.url && !request) {
            console.error(`Attachment URL requires request object but none available: ${att.url}`);
            attachmentErrors.push(`${att.filename}: no request context for URL fetch`);
          } else if (att.storage_path) {
            let blob: Blob | null = null;
            const { data: d1 } = await supabase.storage.from("email-attachments").download(att.storage_path);
            blob = d1;
            if (!blob) {
              const { data: d2 } = await supabase.storage.from("project-files").download(att.storage_path);
              blob = d2;
            }
            if (blob) {
              const buffer = Buffer.from(await blob.arrayBuffer());
              emailAttachments.push({
                filename: att.filename,
                mimeType: att.mimeType || "application/octet-stream",
                content: buffer.toString("base64"),
              });
            } else {
              console.error(`Attachment storage download failed for: ${att.storage_path}`);
              attachmentErrors.push(`${att.filename}: not found in storage`);
            }
          } else if (att.drive_file_id) {
            // Google Drive file — download via Drive API
            try {
              const driveRes = await googleFetch(
                `https://www.googleapis.com/drive/v3/files/${att.drive_file_id}?alt=media&supportsAllDrives=true`,
                { method: "GET" }
              );
              if (driveRes.ok) {
                const buffer = Buffer.from(await driveRes.arrayBuffer());
                emailAttachments.push({
                  filename: att.filename,
                  mimeType: att.mimeType || driveRes.headers.get("content-type") || "application/octet-stream",
                  content: buffer.toString("base64"),
                });
              } else {
                console.error(`Drive file download failed: ${att.drive_file_id} → ${driveRes.status}`);
                attachmentErrors.push(`${att.filename}: Drive download HTTP ${driveRes.status}`);
              }
            } catch (driveErr) {
              console.error(`Drive file download error for ${att.drive_file_id}:`, driveErr);
              attachmentErrors.push(`${att.filename}: Drive error`);
            }
          } else {
            console.error(`Attachment has no url, storage_path, or drive_file_id:`, JSON.stringify(att));
            attachmentErrors.push(`${att.filename}: no url, storage_path, or drive_file_id`);
          }
        } catch (err) {
          console.error(`Attachment processing failed for ${att.filename}:`, err);
          attachmentErrors.push(`${att.filename}: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }

      if (attachmentErrors.length > 0) {
        console.error("Attachment errors:", attachmentErrors);
      }

      // If user requested attachments but NONE succeeded, don't send a naked email.
      // Also surface the paths that were tried so the AI can self-correct on retry
      // (most failures are wrong/hallucinated storage_path strings).
      if (emailAttachments.length === 0 && rawAttachments.length > 0) {
        const triedPaths = rawAttachments.map((a) => ({
          filename: a.filename,
          storage_path: a.storage_path,
          url: a.url,
          drive_file_id: a.drive_file_id,
        }));
        return JSON.stringify({
          error: `All ${rawAttachments.length} attachment(s) failed to download. Email NOT sent.`,
          attachment_errors: attachmentErrors,
          tried: triedPaths,
          hint: "The storage_path values above were not found. Re-read the conversation for the exact storage_path callouts (look for 'storage_path: \"...\"' in earlier messages), copy them character-for-character, and try again. Do NOT guess paths from the filename.",
        });
      }

      if (emailAttachments.length === 0) emailAttachments = undefined;
    }

    let replyThreadId: string | undefined;
    let replyMessageId: string | undefined;
    const replyToId = input.reply_to_message_id
      ? String(input.reply_to_message_id)
      : undefined;
    if (replyToId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(replyToId);
      const replyQuery = supabase
        .from("inbox_emails")
        .select("thread_id, rfc822_message_id, gmail_message_id");
      const { data: replyEmail } = await (
        isUuid
          ? replyQuery.eq("id", replyToId)
          : replyQuery.eq("gmail_message_id", replyToId)
      ).maybeSingle();
      if (replyEmail) {
        replyThreadId = replyEmail.thread_id || undefined;
        replyMessageId =
          replyEmail.rfc822_message_id ||
          replyEmail.gmail_message_id ||
          undefined;
      }
    }

    const result = await sendEmail({
      to: String(input.to),
      subject: String(input.subject),
      body: String(input.body),
      cc: input.cc ? String(input.cc) : undefined,
      bcc: input.bcc ? String(input.bcc) : undefined,
      threadId: replyThreadId,
      inReplyTo: replyMessageId,
      attachments: emailAttachments,
    });

    // Record successful send for rate-limit tracking + audit log.
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const fromEmail = authUser?.email || "unknown";
      if (authUser?.id) await recordSendAttempt(supabase, authUser.id, String(input.to), true);
      await supabase.from("email_logs").insert({
        direction: "outbound",
        subject: String(input.subject),
        to_email: String(input.to),
        from_email: fromEmail,
        category: "general",
      });
    } catch { /* non-critical */ }

    const attCount = emailAttachments?.length || 0;
    const requestedCount = rawAttachments?.length || 0;
    const failedCount = requestedCount - attCount;
    let msg = `Email sent to ${input.to}`;
    if (attCount > 0) msg += ` with ${attCount} attachment${attCount > 1 ? "s" : ""}`;
    if (failedCount > 0) msg += ` (${failedCount} attachment${failedCount > 1 ? "s" : ""} failed to download)`;
    return JSON.stringify({
      success: true,
      message: msg,
      gmail_message_id: result.id,
      attachments_sent: attCount,
      attachments_failed: failedCount,
    });
  } catch (err) {
    if (err instanceof GmailRateLimitError) {
      // Persist the throttle so future taps short-circuit locally instead
      // of hitting Gmail and re-arming the rolling retry-after window.
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        if (u?.id) await recordGmailThrottle(supabase, u.id, err.retryAfterMs);
      } catch { /* best-effort */ }
      return JSON.stringify({
        error: err.message,
        retry_at: err.retryAt.toISOString(),
        hint: "Do not retry — every attempt extends Google's throttle window.",
      });
    }
    return JSON.stringify({
      error: `Failed to send: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Google OAuth tokens may have expired. Reconnect Google.",
    });
  }
}

async function linkEmailToProject(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const { error } = await supabase
    .from("inbox_emails")
    .update({ project_id: String(input.project_id) })
    .eq("id", String(input.email_id));

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Email linked to project" });
}

async function createScheduleEvent(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  const date = String(input.date);
  const startTime = String(input.start_time);
  const endTime = input.end_time ? String(input.end_time) : undefined;
  const title = String(input.title);

  const startISO = `${date}T${startTime}:00`;
  const endISO = endTime
    ? `${date}T${endTime}:00`
    : `${date}T${String(Number(startTime.split(":")[0]) + 1).padStart(2, "0")}:${startTime.split(":")[1]}:00`;

  let googleEventId: string | null = null;
  try {
    const event = await createEvent({
      summary: title, startTime: startISO, endTime: endISO,
      location: input.location ? String(input.location) : undefined,
      description: input.description ? String(input.description) : undefined,
      attendees: input.attendees as string[] | undefined,
    });
    googleEventId = event.id;
  } catch { /* Google may fail */ }

  let createdBy = userId;
  if (!createdBy) {
    const { data: { user } } = await supabase.auth.getUser();
    createdBy = user?.id;
  }
  if (!createdBy) {
    return JSON.stringify({ error: "Not signed in — cannot create schedule event." });
  }

  const insertData: Record<string, unknown> = {
    name: title, start_date: date, end_date: date,
    status: "not_started", event_type: "meeting", color: "#f59e0b", phase_scope: "daily",
    notes: input.description ? String(input.description) : null,
    created_by: createdBy,
  };
  if (googleEventId) insertData.google_calendar_event_id = googleEventId;
  if (input.project_id) insertData.project_id = String(input.project_id);

  const { data: phase } = await supabase.from("schedule_phases").insert(insertData).select("id").single();

  return JSON.stringify({
    success: true,
    message: `Event "${title}" created for ${date} at ${startTime}${googleEventId ? " (synced to Google Calendar)" : ""}`,
    phase_id: phase?.id, event_id: googleEventId,
  });
}

async function createSchedulePhase(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  if (!input.start_date) {
    return JSON.stringify({
      error: "start_date is required (YYYY-MM-DD). Ask the user when this phase should begin.",
    });
  }

  const startDate = String(input.start_date);
  const endDate = input.end_date ? String(input.end_date) : startDate;

  if (endDate < startDate) {
    return JSON.stringify({ error: "end_date must be on or after start_date." });
  }

  let createdBy = userId;
  if (!createdBy) {
    const { data: { user } } = await supabase.auth.getUser();
    createdBy = user?.id;
  }
  if (!createdBy) {
    return JSON.stringify({ error: "Not signed in — cannot create schedule phase." });
  }

  const eventType = String(input.event_type || "phase");
  const colors: Record<string, string> = {
    phase: "#8b5cf6", inspection: "#ef4444", walkthrough: "#f59e0b", meeting: "#3b82f6",
  };

  const rawIds = Array.isArray(input.assigned_employee_ids) ? input.assigned_employee_ids : [];
  const assignedIds = Array.from(
    new Set(rawIds.map((v) => String(v)).filter((s) => s.length > 0))
  );

  const insertData: Record<string, unknown> = {
    project_id: input.project_id ? String(input.project_id) : null,
    name: String(input.name),
    start_date: startDate,
    end_date: endDate,
    status: String(input.status || "not_started"),
    event_type: eventType,
    phase_scope: "daily",
    color: colors[eventType] || "#8b5cf6",
    created_by: createdBy,
  };
  if (input.notes) insertData.notes = String(input.notes);
  if (assignedIds.length) insertData.assigned_employee_ids = assignedIds;

  const { data, error } = await supabase
    .from("schedule_phases").insert(insertData)
    .select("id, name, start_date, end_date, status, project_id, assigned_employee_ids").single();

  if (error) return JSON.stringify({ error: error.message });

  const rosterMsg = await syncCrewToProjectRoster(
    supabase, assignedIds, data.project_id as string | null, createdBy
  );

  return JSON.stringify({
    success: true,
    message: `Phase "${data.name}" added${rosterMsg ? `. ${rosterMsg}` : ""}`,
    phase: data,
  });
}

// Ensures every assigned employee is also on the project's crew roster.
// Returns a short human-readable summary, or "" if nothing to do.
async function syncCrewToProjectRoster(
  supabase: SupabaseClient,
  employeeIds: string[],
  projectId: string | null,
  assignedBy: string | undefined
): Promise<string> {
  if (!projectId || employeeIds.length === 0 || !assignedBy) return "";
  const rows = employeeIds.map((employee_id) => ({
    employee_id,
    project_id: projectId,
    assigned_by: assignedBy,
  }));
  const { error } = await supabase
    .from("crew_project_assignments")
    .upsert(rows, { onConflict: "employee_id,project_id" });
  if (error) return `(roster sync warning: ${error.message})`;
  return `${employeeIds.length} crew member${employeeIds.length === 1 ? "" : "s"} added to project roster`;
}

async function updateSchedulePhase(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const updates: Record<string, unknown> = {};
  for (const f of ["start_date", "end_date", "status", "notes"]) {
    if (input[f] !== undefined) updates[f] = String(input[f]);
  }

  let assignedIds: string[] | null = null;
  if (Array.isArray(input.assigned_employee_ids)) {
    assignedIds = Array.from(
      new Set(input.assigned_employee_ids.map((v) => String(v)).filter((s) => s.length > 0))
    );
    updates.assigned_employee_ids = assignedIds;
  }

  // Snapshot before the write — a LIVE (confirmed) phase re-notifies its
  // people when dates move or someone new is put on it.
  const { data: before } = await supabase
    .from("schedule_phases")
    .select("is_confirmed, start_date, end_date, assigned_employee_ids")
    .eq("id", String(input.phase_id))
    .single();

  const { data, error } = await supabase
    .from("schedule_phases").update(updates).eq("id", String(input.phase_id))
    .select("id, name, start_date, end_date, status, project_id, assigned_employee_ids").single();

  if (error) return JSON.stringify({ error: error.message });

  let rosterMsg = "";
  const { data: { user } } = await supabase.auth.getUser();
  if (assignedIds && assignedIds.length > 0) {
    rosterMsg = await syncCrewToProjectRoster(
      supabase, assignedIds, data.project_id as string | null, user?.id
    );
  }

  let notifyMsg = "";
  if (before?.is_confirmed && user?.id) {
    const oldEmps: string[] = before.assigned_employee_ids ?? [];
    const addedEmps = assignedIds?.filter((eid) => !oldEmps.includes(eid)) ?? [];
    const datesChanged =
      data.start_date !== before.start_date || data.end_date !== before.end_date;
    const emailed: string[] = [];
    if (addedEmps.length > 0) {
      const res = await notifySchedulePhaseAssignees({
        phaseId: String(input.phase_id),
        kind: "confirmed",
        actorId: user.id,
        onlyEmployeeIds: addedEmps,
      });
      emailed.push(...res.emailed);
    }
    if (datesChanged) {
      const existingEmps = (assignedIds ?? oldEmps).filter((eid) => oldEmps.includes(eid));
      if (existingEmps.length > 0 || !assignedIds) {
        const res = await notifySchedulePhaseAssignees({
          phaseId: String(input.phase_id),
          kind: "updated",
          actorId: user.id,
          changes: [
            `Dates: ${formatShortRange(before.start_date, before.end_date)} → ${formatShortRange(data.start_date, data.end_date)}`,
          ],
          onlyEmployeeIds: assignedIds ? existingEmps : undefined,
        });
        emailed.push(...res.emailed);
      }
    }
    if (emailed.length > 0) notifyMsg = `Schedule email sent to: ${emailed.join(", ")}`;
  }

  return JSON.stringify({
    success: true,
    message: `Phase "${data.name}" updated${rosterMsg ? `. ${rosterMsg}` : ""}${notifyMsg ? `. ${notifyMsg}` : ""}`,
    phase: data,
  });
}

async function deleteSchedulePhase(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const phaseId = String(input.phase_id);

  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("id, name, google_calendar_event_id")
    .eq("id", phaseId)
    .single();
  if (!phase) return JSON.stringify({ error: `Phase ${phaseId} not found` });

  const { error } = await supabase.from("schedule_phases").delete().eq("id", phaseId);
  if (error) return JSON.stringify({ error: error.message });

  let calendarCleanup = "";
  if (phase.google_calendar_event_id) {
    try {
      const ok = await deleteEvent(phase.google_calendar_event_id);
      calendarCleanup = ok ? " (Google Calendar event also cancelled)" : " (warning: couldn't reach Google Calendar — delete the event manually)";
    } catch {
      calendarCleanup = " (warning: Google Calendar event still exists — delete it manually)";
    }
  }

  return JSON.stringify({ success: true, message: `Phase "${phase.name}" deleted${calendarCleanup}` });
}

// ── Budget Lines (read) ──────────────────────────────────────

async function getBudgetLines(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id);

  const { data: estimates } = await supabase
    .from("estimates")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["approved", "draft"])
    .order("version", { ascending: false })
    .limit(1);

  if (!estimates?.[0]) return JSON.stringify({ error: "No estimate found for this project" });

  const { data: lines, error } = await supabase
    .from("estimate_line_items")
    .select("id, description, trade, total_cost, client_price, total_price")
    .eq("estimate_id", estimates[0].id)
    .order("sort_order");

  if (error) return JSON.stringify({ error: error.message });

  // Also get current spend per line
  const { data: invoices } = await supabase
    .from("invoices")
    .select("estimate_line_item_id, amount")
    .eq("project_id", projectId)
    .not("estimate_line_item_id", "is", null);

  const spendByLine = new Map<string, number>();
  for (const inv of invoices || []) {
    const cur = spendByLine.get(inv.estimate_line_item_id!) || 0;
    spendByLine.set(inv.estimate_line_item_id!, cur + Number(inv.amount));
  }

  const result = (lines || []).map((li) => ({
    id: li.id,
    description: li.description,
    trade: li.trade,
    budgeted: Number(li.total_cost || li.client_price || li.total_price || 0),
    spent: spendByLine.get(li.id) || 0,
    remaining: Number(li.total_cost || li.client_price || li.total_price || 0) - (spendByLine.get(li.id) || 0),
  }));

  return JSON.stringify({ budget_lines: result, count: result.length });
}

// ── Search Cost Book ──────────────────────────────────────

async function searchCostbook(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const query = String(input.query || "").trim();
  const category = String(input.category || "").trim();

  let q = supabase
    .from("trade_rates")
    .select("trade_name, unit_type, avg_price, avg_cost")
    .eq("is_active", true)
    .order("trade_name");

  if (query) {
    q = q.ilike("trade_name", `%${query}%`);
  }

  const { data, error } = await q.limit(30);
  if (error) return JSON.stringify({ error: error.message });

  let results = data || [];

  // If category filter provided, filter client-side (trade_name contains category keywords)
  if (category) {
    const catLower = category.toLowerCase();
    results = results.filter(r => r.trade_name.toLowerCase().includes(catLower));
  }

  const formatted = results.map(r => ({
    item: r.trade_name,
    unit: r.unit_type,
    price: `$${Number(r.avg_price).toFixed(2)}`,
    cost: `$${Number(r.avg_cost).toFixed(2)}`,
    markup: `${(((Number(r.avg_price) / Number(r.avg_cost)) - 1) * 100).toFixed(0)}%`,
  }));

  return JSON.stringify({
    results: formatted,
    count: formatted.length,
    note: formatted.length === 0 ? `No cost book entries found matching "${query}". Try broader keywords.` : undefined,
  });
}

// ── List Project Documents ─────────────────────────────────

async function listProjectDocuments(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id || "");
  if (!projectId) return JSON.stringify({ error: "project_id is required" });

  const query = input.query ? String(input.query).toLowerCase() : "";

  // Parallel queries for all document sources
  const [estimateRes, coRes, quotesRes, emailsRes, filesRes, projectRes] = await Promise.all([
    supabase.from("estimates").select("id").eq("project_id", projectId).in("status", ["approved", "draft"]).limit(1),
    supabase.from("change_orders").select("id, title, co_number, status, price_impact").eq("project_id", projectId),
    supabase.from("quote_requests").select("subcontractor_name, trade, document_type, attachment_storage_path, amount").eq("project_id", projectId).not("attachment_storage_path", "is", null),
    supabase.from("inbox_emails").select("subject, attachments").eq("project_id", projectId).not("attachments", "is", null).limit(50),
    supabase.from("project_files").select("filename, category, storage_path, mime_type").eq("project_id", projectId),
    supabase.from("projects").select("name").eq("id", projectId).single(),
  ]);

  const projectName = projectRes.data?.name || "Project";
  interface DocEntry { name: string; type: string; source: string; attachment: { url?: string; storage_path?: string; drive_file_id?: string; filename: string; open_url?: string } }
  const docs: DocEntry[] = [];

  // Generatable documents
  if (estimateRes.data?.length) {
    docs.push({
      name: `${projectName} - Proposal (PDF)`,
      type: "proposal_pdf",
      source: "generated",
      attachment: { url: `/api/generate-proposal-pdf?projectId=${projectId}`, filename: `${projectName} - Proposal.pdf` },
    });
  }

  docs.push({
    name: `${projectName} - Financial Report (PDF)`,
    type: "financial_report",
    source: "generated",
    attachment: { url: `/api/generate-financial-report?projectId=${projectId}`, filename: `${projectName} - Financial Report.pdf` },
  });

  for (const co of coRes.data || []) {
    const label = co.co_number ? `CO #${co.co_number}` : co.title;
    docs.push({
      name: `${label} — ${co.title} (${co.status}, $${Number(co.price_impact || 0).toLocaleString()})`,
      type: "change_order_pdf",
      source: "generated",
      attachment: { url: `/api/generate-change-order?changeOrderId=${co.id}`, filename: `${projectName} - ${label}.pdf` },
    });
  }

  // Helper: get a signed URL from whichever bucket holds the file.
  const signedUrlFor = async (path: string): Promise<string | null> => {
    try {
      const { data: s1 } = await supabase.storage.from("email-attachments").createSignedUrl(path, 3600);
      if (s1?.signedUrl) return s1.signedUrl;
      const { data: s2 } = await supabase.storage.from("project-files").createSignedUrl(path, 3600);
      if (s2?.signedUrl) return s2.signedUrl;
    } catch { /* fall through */ }
    return null;
  };

  // Stored quote/invoice PDFs
  for (const q of quotesRes.data || []) {
    const filename = q.attachment_storage_path.split("/").pop() || "document.pdf";
    const openUrl = await signedUrlFor(q.attachment_storage_path);
    docs.push({
      name: `${q.subcontractor_name} — ${q.trade} ${q.document_type || "quote"} ($${Number(q.amount || 0).toLocaleString()})`,
      type: q.document_type || "quote",
      source: "quote_request",
      attachment: { storage_path: q.attachment_storage_path, filename, ...(openUrl ? { open_url: openUrl } : {}) },
    });
  }

  // Email attachments
  for (const email of emailsRes.data || []) {
    const atts = email.attachments as Array<{ filename?: string; storage_path?: string; mimeType?: string }> | null;
    if (!atts) continue;
    for (const att of atts) {
      if (!att.storage_path) continue;
      const openUrl = await signedUrlFor(att.storage_path);
      docs.push({
        name: `${att.filename || "attachment"} (from: ${email.subject || "email"})`,
        type: att.mimeType?.includes("pdf") ? "pdf" : "file",
        source: "email_attachment",
        attachment: { storage_path: att.storage_path, filename: att.filename || "attachment", ...(openUrl ? { open_url: openUrl } : {}) },
      });
    }
  }

  // Uploaded project files — include a signed URL so the AI can hand
  // Jorge a clickable link to open the PDF directly.
  for (const f of filesRes.data || []) {
    const openUrl = await signedUrlFor(f.storage_path);
    docs.push({
      name: `${f.filename} [${f.category}]`,
      type: f.category || "file",
      source: "project_file",
      attachment: { storage_path: f.storage_path, filename: f.filename, ...(openUrl ? { open_url: openUrl } : {}) },
    });
  }

  // Google Drive files (project folder + subfolders)
  try {
    const { data: proj } = await supabase
      .from("projects")
      .select("google_drive_folder_id")
      .eq("id", projectId)
      .single();

    if (proj?.google_drive_folder_id) {
      const driveFiles = await listFolderFiles(proj.google_drive_folder_id, 30);
      for (const df of driveFiles) {
        const isFolder = df.mimeType === "application/vnd.google-apps.folder";
        if (isFolder) {
          // Recurse one level into subfolders
          try {
            const subFiles = await listFolderFiles(df.id, 20);
            for (const sf of subFiles) {
              if (sf.mimeType === "application/vnd.google-apps.folder") continue;
              docs.push({
                name: `${sf.name} [Drive/${df.name}]`,
                type: "drive_file",
                source: "google_drive",
                attachment: { drive_file_id: sf.id, filename: sf.name },
              });
            }
          } catch { /* subfolder access may fail */ }
        } else {
          docs.push({
            name: `${df.name} [Drive]`,
            type: "drive_file",
            source: "google_drive",
            attachment: { drive_file_id: df.id, filename: df.name },
          });
        }
      }
    }
  } catch { /* Drive access may fail if tokens expired */ }

  // Filter by query if provided
  const filtered = query
    ? docs.filter(d => d.name.toLowerCase().includes(query) || d.type.toLowerCase().includes(query))
    : docs;

  return JSON.stringify({
    project: projectName,
    count: filtered.length,
    documents: filtered,
  });
}

// ── Split Invoice ──────────────────────────────────────────

async function splitInvoice(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  const invoiceId = String(input.invoice_id);
  const splits = input.splits as { line_item_id: string; amount: number; note?: string }[];

  if (!splits?.length) return JSON.stringify({ error: "splits array required" });

  const { data: original, error: fetchErr } = await supabase
    .from("invoices").select("*").eq("id", invoiceId).single();

  if (fetchErr || !original) return JSON.stringify({ error: `Invoice "${invoiceId}" not found. Use list_invoices first to get real invoice IDs.` });

  // If 1 split, just reassign
  if (splits.length === 1) {
    const { error } = await supabase.from("invoices")
      .update({
        estimate_line_item_id: splits[0].line_item_id,
        description: splits[0].note || original.description,
      })
      .eq("id", invoiceId);

    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, message: `Invoice reassigned to budget line`, action: "linked" });
  }

  // Multiple splits: create children, delete original
  const splitSubId =
    original.subcontractor_id ?? (await resolveSubcontractorId(supabase, original.vendor_name));
  const newInvoices = splits.map((s) => ({
    project_id: original.project_id,
    vendor_name: original.vendor_name,
    vendor_type: original.vendor_type,
    trade: original.trade,
    invoice_number: original.invoice_number,
    invoice_date: original.invoice_date,
    due_date: original.due_date,
    terms: original.terms,
    amount: s.amount,
    paid_amount: original.payment_status === "paid" ? s.amount : 0,
    payment_status: original.payment_status,
    paid_date: original.paid_date,
    description: s.note || original.description,
    estimate_line_item_id: s.line_item_id,
    subcontractor_id: splitSubId,
    quote_request_id: original.quote_request_id,
    gmail_message_id: original.gmail_message_id,
    attachment_storage_path: original.attachment_storage_path,
    created_by: userId,
  }));

  const { data: created, error: insertErr } = await supabase
    .from("invoices").insert(newInvoices).select("id, description, amount, estimate_line_item_id");

  if (insertErr) return JSON.stringify({ error: insertErr.message });

  await supabase.from("invoices").delete().eq("id", invoiceId);

  return JSON.stringify({
    success: true,
    message: `Invoice split into ${created?.length} parts across budget lines`,
    action: "split",
    new_invoices: created,
  });
}

// ── Update Invoice ──────────────────────────────────────────

async function updateInvoice(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const invoiceId = String(input.invoice_id);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const f of ["trade", "description"]) {
    if (input[f] !== undefined) updates[f] = String(input[f]);
  }
  // Validate estimate_line_item_id exists before updating
  if (input.estimate_line_item_id !== undefined) {
    if (input.estimate_line_item_id) {
      const { data: lineItem } = await supabase.from("estimate_line_items").select("id").eq("id", String(input.estimate_line_item_id)).single();
      if (lineItem) updates.estimate_line_item_id = lineItem.id;
    } else {
      updates.estimate_line_item_id = null; // allow unlinking
    }
  }
  if (input.amount !== undefined) updates.amount = Number(input.amount);
  if (input.payment_status !== undefined) {
    updates.payment_status = String(input.payment_status);
    if (input.payment_status === "paid") {
      // Auto-set paid_amount to full amount
      const { data: inv } = await supabase.from("invoices").select("amount").eq("id", invoiceId).single();
      if (inv) {
        updates.paid_amount = Number(input.amount ?? inv.amount);
        updates.paid_date = new Date().toISOString().split("T")[0];
      }
    } else if (input.payment_status === "unpaid") {
      updates.paid_amount = 0;
      updates.paid_date = null;
    }
  }

  const { data, error } = await supabase
    .from("invoices").update(updates).eq("id", invoiceId)
    .select("id, vendor_name, amount, trade, payment_status, estimate_line_item_id").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Invoice updated`, invoice: data });
}

// ── ESTIMATING handlers ───────────────────────────────────

async function updateEstimateLineItem(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const lineItemId = String(input.line_item_id || "");
  if (!lineItemId) return JSON.stringify({ error: "line_item_id is required" });

  const updates: Record<string, unknown> = {};
  if (input.scope_text !== undefined) {
    updates.scope_text = String(input.scope_text);
    updates.proposal_description = String(input.scope_text);
  }
  if (input.description !== undefined) updates.description = String(input.description);
  if (input.quantity !== undefined) updates.quantity = Number(input.quantity);
  if (input.unit !== undefined) updates.unit = String(input.unit);
  if (input.unit_cost !== undefined) updates.unit_cost = Number(input.unit_cost);

  // Money fields write BOTH column sets (active cost/client_price is
  // authoritative, legacy total_* is the mirror). Merge with the current row
  // so a cost-only or price-only update still lands a consistent markup/profit.
  if (input.total_cost !== undefined || input.total_price !== undefined) {
    const { data: row } = await supabase
      .from("estimate_line_items")
      .select("cost, total_cost, client_price, total_price, markup_pct, markup_percentage")
      .eq("id", lineItemId)
      .maybeSingle();
    if (!row) return JSON.stringify({ error: "Line item not found" });
    const cost = input.total_cost !== undefined ? Number(input.total_cost) : lineCost(row);
    const price = input.total_price !== undefined ? Number(input.total_price) : linePrice(row);
    const markup = cost > 0 ? Math.round(((price / cost) - 1) * 10000) / 100 : lineMarkupPct(row);
    Object.assign(updates, lineItemFinancials(cost, markup, price));
  }
  if (input.notes !== undefined) updates.notes = String(input.notes);

  if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No fields to update" });

  const { data, error } = await supabase
    .from("estimate_line_items")
    .update(updates)
    .eq("id", lineItemId)
    .select("id, description, scope_text, quantity, unit, total_cost, total_price, trade")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Updated: ${data.description}`, line_item: data });
}

async function addEstimateLineItem(input: Record<string, unknown>, supabase: SupabaseClient, userId?: string): Promise<string> {
  const projectId = String(input.project_id || "");
  if (!projectId) return JSON.stringify({ error: "project_id is required" });

  // Find or create draft estimate
  const { data: existingEst } = await supabase
    .from("estimates")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["draft", "approved"])
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let estimateId: string;
  if (existingEst) {
    estimateId = existingEst.id;
  } else {
    const { data: newEst, error: createErr } = await supabase
      .from("estimates")
      .insert({
        project_id: projectId,
        version: 1,
        name: "Estimate",
        status: "draft",
        markup_percentage: 0,
        total_cost: 0,
        total_price: 0,
        created_by: userId || null,
        notes: "Created from takeoff chat",
      })
      .select("id")
      .single();
    if (createErr || !newEst) return JSON.stringify({ error: createErr?.message || "Failed to create estimate" });
    estimateId = newEst.id;
  }

  // Get next sort order
  const { data: lastLine } = await supabase
    .from("estimate_line_items")
    .select("sort_order")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (lastLine?.sort_order || 0) + 1;

  const qty = Number(input.quantity || 1);
  const unitCost = Number(input.unit_cost || 0);
  const totalCost = Number(input.total_cost || unitCost * qty);
  const totalPrice = Number(input.total_price || totalCost * 1.30);
  const markupPct = totalCost > 0 ? Math.round(((totalPrice / totalCost) - 1) * 10000) / 100 : 30;

  const { data, error } = await supabase
    .from("estimate_line_items")
    .insert({
      estimate_id: estimateId,
      sort_order: nextOrder,
      description: String(input.description),
      scope_text: String(input.scope_text || ""),
      proposal_description: String(input.scope_text || ""),
      quantity: qty,
      unit: String(input.unit || "LS"),
      unit_cost: unitCost,
      ...lineItemFinancials(totalCost, markupPct, totalPrice),
      is_visible_on_proposal: true,
      trade: String(input.trade || input.description || "general").toLowerCase().replace(/\s+/g, "_"),
      source: "takeoff_chat",
      notes: String(input.notes || ""),
    })
    .select("id, description, scope_text, quantity, unit, total_cost, total_price, trade")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Added: ${data.description}`, line_item: data, estimate_id: estimateId });
}

// ── BID PACKAGE handler ───────────────────────────────────

async function generateBidPackage(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id || "");
  const trade = String(input.trade || "");
  if (!projectId) return JSON.stringify({ error: "project_id is required" });
  if (!trade) return JSON.stringify({ error: "trade is required" });

  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();
  if (!project) return JSON.stringify({ error: "Project not found" });

  // Build query params for the POST endpoint — we'll return a document URL
  // The actual PDF is generated by /api/generate-bid-package (POST)
  const filename = `${project.name} - ${trade} - Bid Package.pdf`;

  // Store the bid package data so the PDF route can access it
  // We use a temporary approach: encode the data in the URL via a POST fetch
  // For the download button, we need a GET URL. Store the params in a temp record.
  const bidData = {
    projectId,
    trade,
    scopeText: String(input.scope_text || ""),
    measurements: String(input.measurements || ""),
    screenshotPaths: (input.screenshot_paths as string[]) || [],
    subName: String(input.sub_name || ""),
    notes: String(input.notes || ""),
  };

  // Store bid package data in app_settings for retrieval by the PDF route
  const bidId = `bid_${Date.now()}`;
  await supabase.from("app_settings").upsert({
    key: bidId,
    value: JSON.stringify(bidData),
  });

  return JSON.stringify({
    success: true,
    message: `Bid package ready: ${trade} for ${project.name}`,
    document_url: `/api/generate-bid-package?bidId=${bidId}`,
    filename,
    document_type: "pdf",
    bid_data: bidData,
  });
}

// ── ESTIMATE GENERATION handler ───────────────────────────

async function generateEstimate(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId?: string
): Promise<string> {
  const projectId = String(input.project_id || "");
  if (!projectId) return JSON.stringify({ error: "project_id is required" });

  // 1. Load project
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, project_type, address, scope_of_work, estimated_value, contract_value")
    .eq("id", projectId)
    .single();
  if (!project) return JSON.stringify({ error: "Project not found" });

  // 2. Load pricing context in parallel
  const [tradeRatesRes, quotesRes, takeoffRes] = await Promise.all([
    supabase.from("trade_rates").select("trade_name, description, unit_type, avg_cost, avg_price").eq("is_active", true),
    supabase.from("quote_requests").select("subcontractor_name, trade, amount, scope_description").eq("project_id", projectId).not("amount", "is", null),
    supabase.from("takeoff_measurements").select("label, measurement_type, value, unit, trade, notes").eq("project_id", projectId).neq("measurement_type", "checklist").order("created_at"),
  ]);

  const tradeRates = (tradeRatesRes.data ?? [])
    .map(r => `${r.trade_name}: $${r.avg_cost} cost / $${r.avg_price} price per ${r.unit_type}${r.description ? ` — ${r.description}` : ""}`)
    .join("\n");

  const existingQuotes = (quotesRes.data ?? [])
    .map(q => `${q.subcontractor_name} — ${q.trade}: $${q.amount}${q.scope_description ? ` (${q.scope_description.substring(0, 100)})` : ""}`)
    .join("\n");

  const takeoffs = takeoffRes.data ?? [];
  const takeoffContext = takeoffs.length > 0
    ? takeoffs.map(t => `  ${t.label}: ${t.value} ${t.unit}${t.trade ? ` [${t.trade}]` : ""}${t.notes ? ` — ${t.notes}` : ""}`).join("\n")
    : "";

  // 3. Build Estimator AI prompt
  const systemPrompt = `You are the estimating AI for Penney Construction, a residential GC on the North Shore of Massachusetts.
${nowStamp()}

## PROJECT
Name: ${project.name || "Unknown"}
Type: ${project.project_type || "remodel"}
Address: ${project.address || "N/A"}
Jorge's draft budget notes (TREAT AS HINT, NOT FINAL):
${project.scope_of_work || "(none)"}

## YOUR PRICING DATA (from real quotes and trade rates)
Trade Rates:
${tradeRates || "None loaded"}

Existing Sub Quotes for this project:
${existingQuotes || "None yet"}${takeoffContext ? `

## TAKEOFF MEASUREMENTS (actual quantities from drawings — use these for accurate pricing)
${takeoffContext}
IMPORTANT: When takeoff measurements are provided, use the EXACT quantities for pricing.` : ""}${input.instructions ? `

## USER INSTRUCTIONS
${String(input.instructions)}` : ""}

## ESTIMATE FORMAT
Generate estimate line items. Each line:
{
  "category": "Trade/phase name (e.g., Permits, Demolition, Framing, Plumbing)",
  "scope_text": "Detailed scope description — what's included, what's excluded. Use bullet points with dashes.",
  "cost": 5000,
  "markup_pct": 30,
  "client_price": 6500,
  "quote_status": "known" | "allowance" | "waiting",
  "notes": "Internal notes — which sub, where the price came from"
}

## RULES
- Use REAL prices from the trade rates — don't make up numbers
- If you have a sub quote for this project, use that exact amount as cost
- Default markup is 30% — cost × 1.30 = client_price
- For items you're less sure about, use "allowance" as quote_status
- Scope text should match Jorge's style: detailed but concise, use dashes for line items
- NEVER put unit pricing in scope_text or category (no "$X/sqft", no "at $Y per LF"). Clients see these. Pricing goes in the numeric fields only.
- Think like a GC: don't miss permits, protection, dumpster, jiffy john, final clean
- Include ALL trades needed for this type of project

Return a JSON object:
{
  "message": "Brief explanation of the estimate",
  "line_items": [...]
}`;

  // 4. Call Claude
  const response = await callClaude(
    systemPrompt,
    `Generate a complete estimate for ${project.name}. Include all trades and phases needed.`,
    8192
  );

  // 5. Parse response
  let parsed: { message?: string; line_items?: Array<Record<string, unknown>> } = {};
  try {
    const cleaned = response.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      parsed = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
    }
  } catch {
    return JSON.stringify({ error: "AI returned invalid JSON. Try again." });
  }

  const lineItems = parsed.line_items || [];
  if (lineItems.length === 0) {
    return JSON.stringify({ error: "AI generated no line items. Check that the project has scope_of_work or takeoff data." });
  }

  // 6. Create or reuse estimate record
  const { data: latestEstimate } = await supabase
    .from("estimates")
    .select("id, version, status")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let estimateId: string;
  if (latestEstimate && latestEstimate.status === "draft") {
    estimateId = latestEstimate.id;
    // Clear existing lines for clean replace
    await supabase.from("estimate_line_items").delete().eq("estimate_id", estimateId);
  } else {
    const nextVersion = (latestEstimate?.version || 0) + 1;
    const { data: newEst, error: createErr } = await supabase
      .from("estimates")
      .insert({
        project_id: projectId,
        version: nextVersion,
        name: `${project.name} Estimate`,
        status: "draft",
        markup_percentage: 0,
        total_cost: 0,
        total_price: 0,
        created_by: userId || null,
        notes: "Generated from AI chat",
      })
      .select("id")
      .single();
    if (createErr || !newEst) {
      return JSON.stringify({ error: createErr?.message || "Failed to create estimate record" });
    }
    estimateId = newEst.id;
  }

  // 7. Insert line items
  const rows = lineItems.map((li, i) => {
    const cost = Number(li.cost || 0);
    const markupPct = Number(li.markup_pct || 30);
    const clientPrice = Number(li.client_price || cost * (1 + markupPct / 100));
    return {
      estimate_id: estimateId,
      sort_order: i,
      description: String(li.category || "General"),
      scope_text: String(li.scope_text || ""),
      proposal_description: String(li.scope_text || ""),
      quantity: 1,
      unit: "LS",
      unit_cost: cost,
      ...lineItemFinancials(cost, markupPct, clientPrice),
      is_visible_on_proposal: true,
      trade: String(li.category || "general").toLowerCase().replace(/\s+/g, "_"),
      needs_sub_quote: li.quote_status === "waiting",
      source: "ai_chat",
      notes: String(li.notes || ""),
    };
  });

  const { error: insertErr } = await supabase.from("estimate_line_items").insert(rows);
  if (insertErr) return JSON.stringify({ error: insertErr.message });

  // 8. Update estimate totals
  const totalCost = rows.reduce((s, r) => s + r.total_cost, 0);
  const totalPrice = rows.reduce((s, r) => s + r.total_price, 0);
  await supabase.from("estimates").update({ total_cost: totalCost, total_price: totalPrice }).eq("id", estimateId);

  return JSON.stringify({
    success: true,
    message: parsed.message || `Estimate generated for ${project.name}`,
    estimate_id: estimateId,
    line_count: rows.length,
    total_cost: Math.round(totalCost),
    total_price: Math.round(totalPrice),
    documents: [
      { url: `/api/generate-proposal-pdf?projectId=${projectId}`, filename: `${project.name} - Proposal.pdf`, type: "pdf" },
    ],
  });
}

// ── DOCUMENT GENERATION handlers ──────────────────────────

async function generateProposal(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id || "");
  if (!projectId) return JSON.stringify({ error: "project_id is required" });

  // Validate project exists and has an estimate
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .eq("id", projectId)
    .single();
  if (!project) return JSON.stringify({ error: "Project not found" });

  const { data: estimates } = await supabase
    .from("estimates")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["approved", "draft"])
    .limit(1);
  if (!estimates?.length) return JSON.stringify({ error: "No estimate found for this project. Create an estimate first." });

  return JSON.stringify({
    success: true,
    message: `Proposal ready for ${project.name}`,
    documents: [
      { url: `/api/generate-proposal-pdf?projectId=${projectId}`, filename: `${project.name} - Proposal.pdf`, type: "pdf" },
    ],
  });
}

async function generateChangeOrderPdf(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const changeOrderId = String(input.change_order_id || "");
  if (!changeOrderId) return JSON.stringify({ error: "change_order_id is required" });

  // Validate change order exists
  const { data: co } = await supabase
    .from("change_orders")
    .select("id, title, co_number, projects(name)")
    .eq("id", changeOrderId)
    .single();
  if (!co) return JSON.stringify({ error: "Change order not found" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = Array.isArray(co.projects) ? (co.projects as any)[0] : co.projects;
  const projectName = proj?.name || "";
  const label = co.co_number ? `CO #${co.co_number}` : co.title;
  const filename = `${projectName} - ${label}.pdf`;

  return JSON.stringify({
    success: true,
    document_url: `/api/generate-change-order?changeOrderId=${changeOrderId}`,
    filename,
    document_type: "pdf",
    message: `Change order PDF ready: ${label}`,
  });
}

async function generateFinancialReport(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const projectId = String(input.project_id || "");
  if (!projectId) return JSON.stringify({ error: "project_id is required" });

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .eq("id", projectId)
    .single();
  if (!project) return JSON.stringify({ error: "Project not found" });

  const filename = `${project.name} - Financial Report.pdf`;
  return JSON.stringify({
    success: true,
    document_url: `/api/generate-financial-report?projectId=${projectId}`,
    filename,
    document_type: "pdf",
    message: `Financial report ready for ${project.name}`,
  });
}

// ── Save File to Project ─────────────────────────────────

async function saveFileToProject(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId?: string,
): Promise<string> {
  const projectId = String(input.project_id || "");
  const sourcePath = String(input.storage_path || "");
  const filename = String(input.filename || "file");
  const category = String(input.category || "other");
  const description = input.description ? String(input.description) : null;

  if (!projectId || !sourcePath) {
    return JSON.stringify({ error: "project_id and storage_path are required" });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();
  if (!project) return JSON.stringify({ error: "Project not found" });

  const { data: blob, error: dlError } = await supabase.storage
    .from("email-attachments")
    .download(sourcePath);

  if (dlError || !blob) {
    return JSON.stringify({ error: `Could not download file: ${dlError?.message || "not found"}` });
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = `${projectId}/${category}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(destPath, blob, { contentType: blob.type || "application/octet-stream", upsert: false });

  if (uploadError) {
    return JSON.stringify({ error: `Upload failed: ${uploadError.message}` });
  }

  const { error: dbError } = await supabase.from("project_files").insert({
    project_id: projectId,
    filename,
    storage_path: destPath,
    storage_bucket: "project-files",
    mime_type: blob.type || "application/octet-stream",
    size: blob.size,
    category,
    description,
    uploaded_by: userId || null,
  });

  if (dbError) {
    return JSON.stringify({ error: `DB insert failed: ${dbError.message}` });
  }

  return JSON.stringify({
    success: true,
    message: `Saved "${filename}" to ${project.name} under ${category}`,
    storage_path: destPath,
  });
}
