/**
 * Unified tool execution for ALL 4 AI chats.
 * Single dispatcher — Brain, Project, Email Triage, and Schedule chats all call this.
 */

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { createEvent } from "@/lib/google/calendar";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// ── Dispatcher ──────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId?: string
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
      case "list_invoices": return await listInvoices(input, supabase);
      case "list_payments": return await listPayments(input, supabase);
      case "list_change_orders": return await listChangeOrders(input, supabase);
      case "get_budget_lines": return await getBudgetLines(input, supabase);

      // WRITE
      case "create_todo": return await createTodo(input, supabase, userId);
      case "update_todo": return await updateTodo(input, supabase);
      case "create_project": return await createProject(input, supabase);
      case "update_project": return await updateProject(input, supabase);
      case "create_customer": return await createCustomer(input, supabase);
      case "create_subcontractor": return await createSubcontractor(input, supabase);
      case "create_quote_request": return await createQuoteRequest(input, supabase);
      case "create_invoice": return await createInvoice(input, supabase, userId);
      case "split_invoice": return await splitInvoice(input, supabase, userId);
      case "update_invoice": return await updateInvoice(input, supabase);
      case "record_payment": return await recordPayment(input, supabase, userId);
      case "create_change_order": return await createChangeOrder(input, supabase, userId);
      case "draft_email": return await draftEmail(input);
      case "send_email": return await doSendEmail(input, supabase);
      case "link_email_to_project": return await linkEmailToProject(input, supabase);
      case "create_schedule_event": return await createScheduleEvent(input, supabase, userId);
      case "create_schedule_phase": return await createSchedulePhase(input, supabase);
      case "update_schedule_phase": return await updateSchedulePhase(input, supabase);

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
  return JSON.stringify({ count: data?.length || 0, phases: data || [] });
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
  const insertData: Record<string, unknown> = {
    name: String(input.name),
    status: String(input.status || "lead"),
    state: String(input.state || "MA"),
  };

  for (const f of ["address", "city", "project_type", "description", "scope_of_work"]) {
    if (input[f]) insertData[f] = String(input[f]);
  }
  if (input.estimated_value) insertData.estimated_value = Number(input.estimated_value);
  if (input.customer_id) insertData.customer_id = String(input.customer_id);

  const { data, error } = await supabase
    .from("projects").insert(insertData).select("id, project_number, name, status").single();

  if (error) return JSON.stringify({ error: error.message });
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
  const insertData: Record<string, unknown> = {
    first_name: String(input.first_name),
    last_name: String(input.last_name),
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
  const insertData: Record<string, unknown> = {
    company_name: String(input.company_name),
    is_active: true,
    vetting_status: "prospect",
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
  for (const f of ["amount", "scope_description", "extracted_text", "gmail_message_id", "attachment_storage_path"]) {
    if (input[f] !== undefined) insertData[f] = f === "amount" ? Number(input[f]) : String(input[f]);
  }
  insertData.document_type = String(input.document_type || "quote");

  const { data, error } = await supabase
    .from("quote_requests").insert(insertData)
    .select("id, project_name, subcontractor_name, trade, amount, status").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Quote recorded", quote: data });
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
  for (const f of ["trade", "invoice_number", "invoice_date", "due_date", "description", "estimate_line_item_id", "subcontractor_id", "gmail_message_id", "attachment_storage_path", "extracted_text"]) {
    if (input[f]) insertData[f] = String(input[f]);
  }
  if (input.payment_status === "paid") {
    insertData.paid_amount = Number(input.amount);
    insertData.paid_date = String(input.invoice_date || new Date().toISOString().split("T")[0]);
  }
  if (userId) insertData.created_by = userId;

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
  // Get next CO number for this project
  const { data: existing } = await supabase
    .from("change_orders")
    .select("change_order_number")
    .eq("project_id", String(input.project_id))
    .order("change_order_number", { ascending: false })
    .limit(1);

  const nextNum = existing?.length ? existing[0].change_order_number + 1 : 1;

  const insertData: Record<string, unknown> = {
    project_id: String(input.project_id),
    change_order_number: nextNum,
    title: String(input.title),
    status: String(input.status || "draft"),
    cost_impact: Number(input.cost_impact || 0),
    price_impact: Number(input.price_impact || 0),
  };
  if (input.description) insertData.description = String(input.description);
  if (userId) insertData.created_by = userId;

  const { data, error } = await supabase
    .from("change_orders").insert(insertData)
    .select("id, change_order_number, title, status, cost_impact, price_impact").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Change Order #${data.change_order_number} created`, change_order: data });
}

async function draftEmail(input: Record<string, unknown>): Promise<string> {
  return JSON.stringify({
    draft: true,
    to: String(input.to),
    subject: String(input.subject),
    body: String(input.body),
    reply_to_message_id: input.reply_to_message_id ? String(input.reply_to_message_id) : null,
    message: "Email drafted for review. User must approve before sending.",
  });
}

async function doSendEmail(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  try {
    const result = await sendEmail({
      to: String(input.to),
      subject: String(input.subject),
      body: String(input.body),
    });

    // Log the email
    try {
      await supabase.from("email_logs").insert({
        direction: "outbound",
        subject: String(input.subject),
        to_email: String(input.to),
        from_email: "rpenney@penneyconstructioninc.com",
        category: "general",
      });
    } catch { /* non-critical */ }

    return JSON.stringify({ success: true, message: `Email sent to ${input.to}`, gmail_message_id: result.id });
  } catch (err) {
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

  const insertData: Record<string, unknown> = {
    name: title, start_date: date, end_date: date,
    status: "not_started", event_type: "meeting", color: "#f59e0b",
    notes: input.description ? String(input.description) : null,
  };
  if (googleEventId) insertData.google_calendar_event_id = googleEventId;
  if (userId) insertData.created_by = userId;
  if (input.project_id) insertData.project_id = String(input.project_id);

  const { data: phase } = await supabase.from("schedule_phases").insert(insertData).select("id").single();

  return JSON.stringify({
    success: true,
    message: `Event "${title}" created for ${date} at ${startTime}${googleEventId ? " (synced to Google Calendar)" : ""}`,
    phase_id: phase?.id, event_id: googleEventId,
  });
}

async function createSchedulePhase(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const insertData: Record<string, unknown> = {
    project_id: String(input.project_id),
    name: String(input.name),
    status: String(input.status || "not_started"),
    event_type: String(input.event_type || "phase"),
  };
  if (input.start_date) insertData.start_date = String(input.start_date);
  if (input.end_date) insertData.end_date = String(input.end_date);
  if (input.notes) insertData.notes = String(input.notes);

  // Color by type
  const colors: Record<string, string> = {
    phase: "#8b5cf6", inspection: "#ef4444", walkthrough: "#f59e0b", meeting: "#3b82f6",
  };
  insertData.color = colors[String(input.event_type || "phase")] || "#8b5cf6";

  const { data, error } = await supabase
    .from("schedule_phases").insert(insertData)
    .select("id, name, start_date, end_date, status").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Phase "${data.name}" added`, phase: data });
}

async function updateSchedulePhase(input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const updates: Record<string, unknown> = {};
  for (const f of ["start_date", "end_date", "status", "notes"]) {
    if (input[f] !== undefined) updates[f] = String(input[f]);
  }

  const { data, error } = await supabase
    .from("schedule_phases").update(updates).eq("id", String(input.phase_id))
    .select("id, name, start_date, end_date, status").single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Phase "${data.name}" updated`, phase: data });
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
    subcontractor_id: original.subcontractor_id,
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

  for (const f of ["trade", "estimate_line_item_id", "description"]) {
    if (input[f] !== undefined) updates[f] = String(input[f]);
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
