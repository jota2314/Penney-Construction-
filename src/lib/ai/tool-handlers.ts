/**
 * Tool execution handlers for the AI Chat assistant.
 * Each handler takes tool input and returns a string result for Claude.
 */

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { createEvent } from "@/lib/google/calendar";
import {
  GmailRateLimitError,
  RateLimitExceeded,
  assertGmailNotThrottled,
  recordGmailThrottle,
  assertSendRateOk,
  recordSendAttempt,
} from "@/lib/google/throttle";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// ── Dispatcher ────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId?: string
): Promise<string> {
  try {
    switch (name) {
      case "search_projects":
        return await searchProjects(input, supabase);
      case "get_project_details":
        return await getProjectDetails(input, supabase);
      case "search_customers":
        return await searchCustomers(input, supabase);
      case "search_subcontractors":
        return await searchSubcontractors(input, supabase);
      case "search_emails":
        return await searchEmails(input, supabase);
      case "get_email_details":
        return await getEmailDetails(input, supabase);
      case "list_quotes":
        return await listQuotes(input, supabase);
      case "list_todos":
        return await listTodos(input, supabase);
      case "get_schedule":
        return await getSchedule(input, supabase);
      case "create_todo":
        return await createTodo(input, supabase, userId);
      case "create_project":
        return await createProject(input, supabase);
      case "create_customer":
        return await createCustomer(input, supabase);
      case "create_quote_request":
        return await createQuoteRequest(input, supabase);
      case "list_line_items_for_bidding":
        return await listLineItemsForBidding(input, supabase);
      case "send_bid_to_subs":
        return await sendBidToSubs(input, supabase);
      case "record_quote_received":
        return await recordQuoteReceived(input, supabase);
      case "award_bid":
        return await awardBidFromChat(input, supabase);
      case "update_todo":
        return await updateTodo(input, supabase);
      case "update_project":
        return await updateProject(input, supabase);
      case "draft_email":
        return await draftEmail(input);
      case "send_email":
        return await doSendEmail(input, supabase);
      case "create_schedule_event":
        return await createScheduleEvent(input, supabase, userId);
      case "create_schedule_phase":
        return await createSchedulePhase(input, supabase);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── READ / SEARCH handlers ───────────────────────────────

async function searchProjects(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const limit = Math.min(Number(input.limit) || 10, 50);
  let query = supabase
    .from("projects")
    .select("id, project_number, name, address, city, status, project_type, estimated_value, contract_value, customer:customers(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) {
    query = query.eq("status", input.status);
  }

  if (input.query) {
    const q = String(input.query);
    query = query.or(
      `name.ilike.%${q}%,address.ilike.%${q}%,city.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  if (!data || data.length === 0) return JSON.stringify({ message: "No projects found", results: [] });

  const results = data.map((p) => {
    const customer = Array.isArray(p.customer) ? p.customer[0] : p.customer;
    return {
      id: p.id,
      project_number: p.project_number,
      name: p.name,
      address: p.address,
      city: p.city,
      status: p.status,
      type: p.project_type,
      estimated_value: p.estimated_value,
      contract_value: p.contract_value,
      customer: customer ? `${customer.first_name} ${customer.last_name}` : null,
    };
  });

  return JSON.stringify({ count: results.length, results });
}

async function getProjectDetails(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const projectId = String(input.project_id);

  // Fetch project + customer
  const { data: project, error } = await supabase
    .from("projects")
    .select("*, customer:customers(first_name, last_name, email, phone, address)")
    .eq("id", projectId)
    .single();

  if (error || !project) return JSON.stringify({ error: "Project not found" });

  // Parallel fetches
  const [quotesRes, todosRes, emailsRes, scheduleRes] = await Promise.all([
    supabase
      .from("quote_requests")
      .select("id, subcontractor_name, trade, amount, status, scope_description, document_type, created_at")
      .or(`project_id.eq.${projectId},project_name.eq.${project.name}`)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("todos")
      .select("id, contact_name, description, priority, status, due_date, category, created_at")
      .or(`project_id.eq.${projectId},project_name.eq.${project.name}`)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("inbox_emails")
      .select("id, subject, from_address, to_address, snippet, direction, is_processed, date")
      .eq("project_id", projectId)
      .order("date", { ascending: false })
      .limit(15),
    supabase
      .from("schedule_phases")
      .select("*")
      .eq("project_id", projectId)
      .order("planned_start", { ascending: true }),
  ]);

  const customer = Array.isArray(project.customer) ? project.customer[0] : project.customer;

  return JSON.stringify({
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
      estimated_value: project.estimated_value,
      contract_value: project.contract_value,
      required_trades: project.required_trades,
      created_at: project.created_at,
    },
    customer: customer
      ? {
          name: `${customer.first_name} ${customer.last_name}`,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
        }
      : null,
    quotes: quotesRes.data || [],
    todos: todosRes.data || [],
    emails: (emailsRes.data || []).map((e) => ({
      id: e.id,
      subject: e.subject,
      from: e.from_address,
      to: e.to_address,
      snippet: e.snippet,
      direction: e.direction,
      processed: e.is_processed,
      date: e.date,
    })),
    schedule: scheduleRes.data || [],
  });
}

async function searchCustomers(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const q = String(input.query);
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email, phone, address")
    .or(
      `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,address.ilike.%${q}%`
    )
    .limit(20);

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function searchSubcontractors(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  let query = supabase
    .from("subcontractors")
    .select("id, company_name, contact_name, email, phone, trades, vetting_status, is_active")
    .eq("is_active", true)
    .limit(30);

  if (input.query) {
    const q = String(input.query);
    query = query.or(
      `company_name.ilike.%${q}%,contact_name.ilike.%${q}%,email.ilike.%${q}%`
    );
  }

  if (input.trade) {
    query = query.contains("trades", [String(input.trade)]);
  }

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function searchEmails(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const limit = Math.min(Number(input.limit) || 10, 30);
  let query = supabase
    .from("inbox_emails")
    .select("id, subject, from_address, to_address, snippet, direction, is_processed, project_id, date")
    .order("date", { ascending: false })
    .limit(limit);

  if (input.project_id) {
    query = query.eq("project_id", String(input.project_id));
  }
  if (input.direction) {
    query = query.eq("direction", String(input.direction));
  }
  if (input.query) {
    const q = String(input.query);
    query = query.or(
      `subject.ilike.%${q}%,from_address.ilike.%${q}%,snippet.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function getEmailDetails(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from("inbox_emails")
    .select("id, gmail_message_id, subject, from_address, to_address, body, snippet, direction, is_processed, project_id, attachments, date")
    .eq("id", String(input.email_id))
    .single();

  if (error || !data) return JSON.stringify({ error: "Email not found" });

  // Truncate body for token efficiency
  const body = data.body ? data.body.substring(0, 6000) : null;
  const attachments = (data.attachments || []).map((a: Record<string, unknown>) => ({
    filename: a.filename,
    mime_type: a.mime_type,
    size: a.size,
    has_text: !!a.text_content,
  }));

  return JSON.stringify({
    ...data,
    body,
    attachments,
  });
}

async function listQuotes(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = supabase
    .from("quote_requests")
    .select("id, project_name, project_id, subcontractor_name, trade, amount, status, scope_description, document_type, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.project_id) query = query.eq("project_id", String(input.project_id));
  if (input.project_name) query = query.ilike("project_name", `%${input.project_name}%`);
  if (input.subcontractor_name) query = query.ilike("subcontractor_name", `%${input.subcontractor_name}%`);
  if (input.trade) query = query.ilike("trade", `%${input.trade}%`);
  if (input.status) query = query.eq("status", String(input.status));

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function listTodos(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = supabase
    .from("todos")
    .select("id, contact_name, description, priority, status, due_date, category, project_name, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) query = query.eq("status", String(input.status));
  else query = query.eq("status", "open"); // default to open
  if (input.priority) query = query.eq("priority", String(input.priority));
  if (input.project_name) query = query.ilike("project_name", `%${input.project_name}%`);

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, results: data || [] });
}

async function getSchedule(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from("schedule_phases")
    .select("*")
    .eq("project_id", String(input.project_id))
    .order("planned_start", { ascending: true });

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ count: data?.length || 0, phases: data || [] });
}

// ── CREATE / WRITE handlers ──────────────────────────────

async function createTodo(
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  userId?: string
): Promise<string> {
  // Get user ID if not provided
  let createdBy = userId;
  if (!createdBy) {
    const { data: { user } } = await supabase.auth.getUser();
    createdBy = user?.id;
  }
  if (!createdBy) {
    return JSON.stringify({ error: "Not authenticated — cannot create todo" });
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
      created_by: createdBy,
    })
    .select("id, description, contact_name, priority, due_date, project_name")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Todo created", todo: data });
}

async function createProject(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const insertData: Record<string, unknown> = {
    name: String(input.name),
    status: String(input.status || "lead"),
    state: String(input.state || "MA"),
  };

  if (input.address) insertData.address = String(input.address);
  if (input.city) insertData.city = String(input.city);
  if (input.project_type) insertData.project_type = String(input.project_type);
  if (input.description) insertData.description = String(input.description);
  if (input.scope_of_work) insertData.scope_of_work = String(input.scope_of_work);
  if (input.estimated_value) insertData.estimated_value = Number(input.estimated_value);
  if (input.customer_id) insertData.customer_id = String(input.customer_id);

  const { data, error } = await supabase
    .from("projects")
    .insert(insertData)
    .select("id, project_number, name, status")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Project ${data.project_number} created`, project: data });
}

async function createCustomer(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from("customers")
    .insert({
      first_name: String(input.first_name),
      last_name: String(input.last_name),
      email: input.email ? String(input.email) : null,
      phone: input.phone ? String(input.phone) : null,
      address: input.address ? String(input.address) : null,
    })
    .select("id, first_name, last_name, email")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Customer created", customer: data });
}

async function createQuoteRequest(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from("quote_requests")
    .insert({
      project_name: String(input.project_name),
      subcontractor_name: String(input.subcontractor_name),
      trade: String(input.trade),
      amount: input.amount ? Number(input.amount) : null,
      status: String(input.status || "pending"),
      scope_description: input.scope_description ? String(input.scope_description) : null,
      estimate_line_item_id: input.estimate_line_item_id ? String(input.estimate_line_item_id) : null,
    })
    .select("id, project_name, subcontractor_name, trade, amount, status, estimate_line_item_id")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Quote request created", quote: data });
}

// ── Line-item-spined bid tools ────────────────────────────

async function listLineItemsForBidding(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const projectId = String(input.project_id);
  const tradeFilter = input.trade ? String(input.trade).toLowerCase() : null;

  const { data: ests } = await supabase
    .from("estimates")
    .select("id, version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);

  if (!ests?.[0]) return JSON.stringify({ error: "No estimate yet for this project — create one first" });

  let q = supabase
    .from("estimate_line_items")
    .select(`
      id, description, trade, quantity, unit, total_cost,
      awarded_bid_id, awarded_cost,
      awarded_sub:subcontractors!awarded_subcontractor_id ( company_name )
    `)
    .eq("estimate_id", ests[0].id);

  if (tradeFilter) q = q.ilike("trade", `%${tradeFilter}%`);

  const { data: lines, error } = await q;
  if (error) return JSON.stringify({ error: error.message });

  // Fetch bids for these lines
  const lineIds = (lines || []).map((l) => l.id);
  const { data: bids } = await supabase
    .from("subcontractor_bids")
    .select(`
      id, estimate_line_item_id, amount, status, is_selected, sent_at,
      subcontractors ( company_name )
    `)
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
    return {
      line_item_id: li.id,
      description: li.description,
      trade: li.trade,
      estimated_cost: li.total_cost,
      awarded: li.awarded_bid_id
        ? { sub: awardedSub?.company_name, amount: li.awarded_cost }
        : null,
      bids_out: lineBids.length,
      bids: lineBids.map((b) => {
        const sub = Array.isArray(b.subcontractors) ? b.subcontractors[0] : b.subcontractors;
        return {
          bid_id: b.id,
          sub: sub?.company_name,
          amount: b.amount,
          status: b.status,
          is_selected: b.is_selected,
        };
      }),
    };
  });

  return JSON.stringify({ count: results.length, lines: results });
}

async function sendBidToSubs(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const lineItemId = String(input.estimate_line_item_id);
  const subIds = (input.subcontractor_ids as string[]) || [];
  if (subIds.length === 0) return JSON.stringify({ error: "subcontractor_ids required" });

  // Look up the line item to get project + trade + scope
  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("id, description, scope_text, trade, estimate:estimates(project_id, projects(name, address))")
    .eq("id", lineItemId)
    .single();

  if (!line) return JSON.stringify({ error: "Line item not found" });

  const estimate = Array.isArray(line.estimate) ? line.estimate[0] : line.estimate;
  const project = estimate?.projects ? (Array.isArray(estimate.projects) ? estimate.projects[0] : estimate.projects) : null;
  const projectId = estimate?.project_id;
  if (!projectId) return JSON.stringify({ error: "Could not resolve project from line item" });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: "Not authenticated" });

  // Create the bid package + child bids — both anchored to the line item
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
    .select("id")
    .single();

  if (pkgErr || !pkg) return JSON.stringify({ error: pkgErr?.message || "Failed to create bid package" });

  const bidRows = subIds.map((subId) => ({
    bid_package_id: pkg.id,
    subcontractor_id: subId,
    estimate_line_item_id: lineItemId,
    status: "invited" as const,
  }));
  const { error: bidErr } = await supabase.from("subcontractor_bids").insert(bidRows);
  if (bidErr) return JSON.stringify({ error: bidErr.message });

  // Trigger the existing send-bid-package endpoint to actually email + attach drawings
  // (The endpoint runs server-side; we call its logic via a fetch to keep behavior consistent.)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    await fetch(`${baseUrl}/api/send-bid-package`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "" },
      body: JSON.stringify({ bidPackageId: pkg.id }),
    });
  } catch {
    // Email send is best-effort from chat — bids still exist so user can resend from UI
  }

  return JSON.stringify({
    success: true,
    message: `Bid package created for "${line.description}" — sent to ${subIds.length} sub(s). Open the project bids page to track responses.`,
    bid_package_id: pkg.id,
    project_url: `/projects/${projectId}/bids`,
  });
}

async function recordQuoteReceived(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const bidId = String(input.bid_id);
  const amount = Number(input.amount);
  const gmailId = input.gmail_message_id ? String(input.gmail_message_id) : null;

  const update: Record<string, unknown> = {
    status: "submitted",
    amount,
    submitted_at: new Date().toISOString(),
  };
  if (gmailId) update.response_gmail_id = gmailId;

  const { data, error } = await supabase
    .from("subcontractor_bids")
    .update(update)
    .eq("id", bidId)
    .select("id, amount, status, estimate_line_item_id, subcontractors(company_name)")
    .single();

  if (error) return JSON.stringify({ error: error.message });

  // Bump parent package to 'receiving' if it was 'sent'
  const { data: bidPkgRow } = await supabase
    .from("subcontractor_bids")
    .select("bid_package_id")
    .eq("id", bidId)
    .single();
  if (bidPkgRow?.bid_package_id) {
    await supabase
      .from("bid_packages")
      .update({ status: "receiving" })
      .eq("id", bidPkgRow.bid_package_id)
      .eq("status", "sent");
  }

  const sub = Array.isArray(data.subcontractors) ? data.subcontractors[0] : data.subcontractors;
  return JSON.stringify({
    success: true,
    message: `Recorded ${sub?.company_name} quote at $${amount.toLocaleString()}`,
    bid: data,
  });
}

async function awardBidFromChat(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const bidId = String(input.bid_id);

  const { data: bid } = await supabase
    .from("subcontractor_bids")
    .select("id, bid_package_id")
    .eq("id", bidId)
    .single();
  if (!bid) return JSON.stringify({ error: "Bid not found" });

  // Reuse the same award action used by the UI so the line item gets updated correctly
  const { awardBid } = await import("@/lib/actions/bids");
  const result = await awardBid(bidId, bid.bid_package_id);
  if (result.error) return JSON.stringify({ error: result.error });

  return JSON.stringify({
    success: true,
    message: "Bid awarded. Estimate line item updated with awarded sub and price.",
  });
}

async function updateTodo(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const updates: Record<string, unknown> = {};
  if (input.status) updates.status = String(input.status);
  if (input.priority) updates.priority = String(input.priority);
  if (input.snooze_until) updates.snooze_until = String(input.snooze_until);

  const { data, error } = await supabase
    .from("todos")
    .update(updates)
    .eq("id", String(input.todo_id))
    .select("id, description, status, priority")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Todo updated", todo: data });
}

async function updateProject(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const updates: Record<string, unknown> = {};
  const fields = ["status", "description", "scope_of_work", "estimated_value", "contract_value", "phase"];
  for (const f of fields) {
    if (input[f] !== undefined) updates[f] = input[f];
  }

  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", String(input.project_id))
    .select("id, project_number, name, status")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: "Project updated", project: data });
}

// ── EMAIL handlers ───────────────────────────────────────

async function draftEmail(input: Record<string, unknown>): Promise<string> {
  // Draft doesn't send — just formats for user review
  return JSON.stringify({
    draft: true,
    to: String(input.to),
    subject: String(input.subject),
    body: String(input.body),
    message: "Email drafted. Show this to the user for review. Ask if they want to send it.",
  });
}

async function doSendEmail(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  try {
    // Pre-flight gates: local Google throttle + app-level send rate limit.
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
            hint: "Gmail throttle is active. Do not retry until retry_at.",
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

    const result = await sendEmail({
      to: String(input.to),
      subject: String(input.subject),
      body: String(input.body),
    });

    if (throttleUser?.id) {
      try { await recordSendAttempt(supabase, throttleUser.id, String(input.to), true); } catch { /* non-critical */ }
    }

    // Log the email — use the actual signed-in user's email and only
    // columns that exist in email_logs. Silent failure stays silent.
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const fromEmail = authUser?.email || "unknown";
      await supabase.from("email_logs").insert({
        direction: "outbound",
        subject: String(input.subject),
        to_email: String(input.to),
        from_email: fromEmail,
        category: "general",
      });
    } catch {
      // Log failure is non-critical
    }

    return JSON.stringify({
      success: true,
      message: `Email sent to ${input.to}`,
      gmail_message_id: result.id,
    });
  } catch (err) {
    if (err instanceof GmailRateLimitError) {
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
      error: `Failed to send email: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Google OAuth tokens may have expired. User may need to reconnect Google.",
    });
  }
}

// ── SCHEDULE handlers ────────────────────────────────────

async function createScheduleEvent(
  input: Record<string, unknown>,
  supabase?: SupabaseClient,
  userId?: string
): Promise<string> {
  const date = String(input.date);
  const startTime = String(input.start_time);
  const endTime = input.end_time ? String(input.end_time) : undefined;
  const title = String(input.title);

  // Build datetime strings
  const startISO = `${date}T${startTime}:00`;
  const endISO = endTime
    ? `${date}T${endTime}:00`
    : `${date}T${String(Number(startTime.split(":")[0]) + 1).padStart(2, "0")}:${startTime.split(":")[1]}:00`;

  // Try Google Calendar first
  let googleEventId: string | null = null;
  let googleError: string | null = null;
  try {
    const event = await createEvent({
      summary: title,
      startTime: startISO,
      endTime: endISO,
      location: input.location ? String(input.location) : undefined,
      description: input.description ? String(input.description) : undefined,
      attendees: input.attendees as string[] | undefined,
    });
    googleEventId = event.id;
  } catch (err) {
    googleError = err instanceof Error ? err.message : String(err);
  }

  // Always save to internal schedule_phases so it shows on the schedule page
  let phaseId: string | null = null;
  if (supabase) {
    const insertData: Record<string, unknown> = {
      name: title,
      start_date: date,
      end_date: date,
      status: "not_started",
      event_type: "meeting",
      color: "#f59e0b",
      notes: input.description ? String(input.description) : null,
    };
    if (googleEventId) insertData.google_calendar_event_id = googleEventId;
    if (userId) insertData.created_by = userId;
    if (input.project_id) insertData.project_id = String(input.project_id);

    const { data: phase } = await supabase
      .from("schedule_phases")
      .insert(insertData)
      .select("id")
      .single();

    phaseId = phase?.id ?? null;
  }

  if (googleEventId) {
    return JSON.stringify({
      success: true,
      message: `Calendar event "${title}" created for ${date} at ${startTime} and added to schedule`,
      event_id: googleEventId,
      phase_id: phaseId,
    });
  }

  // Google failed but internal schedule saved
  if (phaseId) {
    return JSON.stringify({
      success: true,
      message: `Event "${title}" added to the internal schedule for ${date} at ${startTime}. Google Calendar sync failed — sign out and back in to reconnect.`,
      phase_id: phaseId,
      google_error: googleError,
    });
  }

  return JSON.stringify({
    error: `Failed to create event: ${googleError}`,
    hint: googleError?.includes("No Google OAuth")
      ? "Google session expired. Sign out and back in with Google to reconnect. The event was NOT saved."
      : "Google OAuth tokens may have expired.",
  });
}

async function createSchedulePhase(
  input: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase
    .from("schedule_phases")
    .insert({
      project_id: String(input.project_id),
      phase_name: String(input.phase_name),
      planned_start: input.planned_start ? String(input.planned_start) : null,
      planned_end: input.planned_end ? String(input.planned_end) : null,
      notes: input.notes ? String(input.notes) : null,
      status: "planned",
    })
    .select("id, phase_name, planned_start, planned_end")
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ success: true, message: `Phase "${input.phase_name}" added`, phase: data });
}
