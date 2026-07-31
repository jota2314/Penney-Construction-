import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cascadeSchedule, type CascadeInput } from "@/lib/schedule/cascade";

export const runtime = "nodejs";

// Service role for public, token-gated access — mirrors /api/approve-change-order.
// The public /portal pages NEVER use the anon key; everything routes through here
// and is validated by the token server-side, so RLS stays intact for the app.
function getPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Build the client-safe financial summary from raw rows. We compute this
// directly (contract + payments + approved change orders) rather than via
// get_project_financials, because that RPC is coupled to the estimate and
// returns all zeros for any project without one — which would show the client
// a wrong $0 paid. The client view never needs budget/cost data anyway, so we
// deliberately expose only: contract, payments received, balance, and approved
// change orders. No internal cost, margin, or vendor numbers ever leave here.
interface PaymentRow { payment_type: string; amount: number }
interface CORow { status: string; price_impact: number }
function buildFinancials(contractValue: number, payments: PaymentRow[], changeOrders: CORow[]) {
  const sumBy = (pred: (t: string) => boolean) =>
    payments.filter((p) => pred(p.payment_type)).reduce((s, p) => s + p.amount, 0);
  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);
  const approvedCOs = changeOrders.filter((c) => c.status === "approved");
  const changeOrderRevenue = approvedCOs.reduce((s, c) => s + c.price_impact, 0);
  const adjustedContract = contractValue + changeOrderRevenue;
  return {
    contract_value: contractValue,
    adjusted_contract: adjustedContract,
    total_payments_received: totalReceived,
    deposit_received: sumBy((t) => t === "deposit"),
    draws_received: sumBy((t) => t === "draw" || t === "progress"),
    final_received: sumBy((t) => t === "final"),
    outstanding_receivable: adjustedContract - totalReceived,
    change_order_count: approvedCOs.length,
    change_order_revenue: changeOrderRevenue,
  };
}

/**
 * GET /api/portal?token=...
 * Loads the full client-facing project view for one tokenized portal.
 */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const supabase = getPublicClient();

  // 1. Validate the portal token.
  const { data: portal, error: portalErr } = await supabase
    .from("client_portal_access")
    .select("id, project_id, client_name, client_email, enabled, view_count")
    .eq("token", token)
    .single();

  if (portalErr || !portal) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }
  if (!portal.enabled) {
    return NextResponse.json({ error: "Access to this portal has been turned off. Please contact Penney Construction." }, { status: 403 });
  }

  const projectId = portal.project_id;
  // Job-site day boundary — the crew works in Eastern time.
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const tomorrowET = new Date(Date.parse(`${todayET}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

  // 2. Track the view (first-viewed timestamp + count).
  await supabase
    .from("client_portal_access")
    .update({
      last_viewed_at: new Date().toISOString(),
      view_count: (portal.view_count || 0) + 1,
    })
    .eq("id", portal.id);

  // 3. Load everything the client is allowed to see, in parallel.
  const [projectRes, scheduleRes, paymentsRes, changeOrdersRes, selectionsRes, photoLogsRes, todayPhasesRes, tomorrowPhasesRes, liveLogsRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("name, project_number, address, city, state, status, contract_value")
        .eq("id", projectId)
        .single(),
      supabase
        .from("schedule_phases")
        .select("id, name, description, start_date, end_date, planned_start_date, planned_end_date, status, is_confirmed, sort_order, color, event_type")
        .eq("project_id", projectId)
        // Master schedule only — daily crew plans are internal (phase_scope 'daily').
        .eq("phase_scope", "master")
        .order("sort_order", { ascending: true })
        .order("start_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("payments_received")
        .select("id, payment_type, description, amount, received_date, invoice_sent_number")
        .eq("project_id", projectId)
        .order("received_date", { ascending: false }),
      // Client-facing change orders only — exclude internal cost_impact.
      supabase
        .from("change_orders")
        .select("id, change_order_number, title, description, status, price_impact, client_signed_at, approval_token")
        .eq("project_id", projectId)
        .order("change_order_number", { ascending: true }),
      supabase
        .from("client_selections")
        .select("id, category, description, status, allowance_amount, options, selected_option_id, selected_value, selected_at, sort_order")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      // Progress photos the crew posted from the site. Photos ONLY — the log
      // text and author are internal and never leave here.
      supabase
        .from("daily_logs")
        .select("id, photo_storage_paths, started_at, created_at")
        .eq("project_id", projectId)
        .not("photo_storage_paths", "is", null)
        .order("created_at", { ascending: false })
        .limit(200),
      // Today's crew plan — the daily rows stay off the long-term plan, but
      // today's get their own "at your home today" spotlight.
      supabase
        .from("schedule_phases")
        .select("name, description, assigned_employee_ids")
        .eq("project_id", projectId)
        .eq("phase_scope", "daily")
        .lte("start_date", todayET)
        .gte("end_date", todayET),
      // …and then tomorrow: the next day's crew plan for the same card.
      supabase
        .from("schedule_phases")
        .select("name, description, assigned_employee_ids")
        .eq("project_id", projectId)
        .eq("phase_scope", "daily")
        .lte("start_date", tomorrowET)
        .gte("end_date", tomorrowET),
      // Who is clocked in at the site right now (20h window guards stragglers).
      supabase
        .from("daily_logs")
        .select("author_id")
        .eq("project_id", projectId)
        .eq("status", "in_progress")
        .gte("started_at", new Date(Date.now() - 20 * 3600_000).toISOString()),
    ]);

  const proj = projectRes.data;
  if (!proj) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  // Apply the live cascade: confirmed phases stay firm; unconfirmed phases ride
  // the master schedule shifted by the latest confirmed slip. The client only
  // ever needs name/dates/firm — never internal notes or crew/sub assignments.
  const rawPhases = (scheduleRes.data || []) as CascadeInput[];
  const cascade = cascadeSchedule(rawPhases);
  const schedule = rawPhases.map((p) => {
    const c = cascade.get(p.id);
    return {
      id: p.id,
      name: (p as unknown as { name: string }).name,
      description: (p as unknown as { description: string | null }).description,
      status: p.status,
      color: (p as unknown as { color: string | null }).color,
      event_type: (p as unknown as { event_type: string | null }).event_type,
      sort_order: p.sort_order,
      start_date: c?.start_date ?? p.start_date,
      end_date: c?.end_date ?? p.end_date,
      // firm = real dates the client can count on; otherwise shown as estimated.
      firm: c?.firm ?? false,
    };
  });

  const payments = (paymentsRes.data || []).map((p) => ({ ...p, amount: Number(p.amount) }));
  const changeOrders = (changeOrdersRes.data || []).map((c) => ({
    ...c,
    price_impact: Number(c.price_impact),
    signed: !!c.client_signed_at,
  }));

  // Sign the progress photos: one batched call for full-size, per-photo signs
  // for grid thumbnails (transforms must be baked in at signing time).
  const PHOTO_BUCKET = "daily-log-photos";
  const PHOTO_TTL = 60 * 60 * 4;
  const photoLogs = (photoLogsRes.data || []).filter(
    (l) => (l.photo_storage_paths?.length ?? 0) > 0
  );
  const photoEntries = photoLogs
    .flatMap((l) =>
      (l.photo_storage_paths as string[]).map((path) => ({
        path,
        date: (l.started_at || l.created_at || "").slice(0, 10),
      }))
    )
    .slice(0, 150);
  let photos: { thumb: string; full: string; date: string }[] = [];
  if (photoEntries.length > 0) {
    const paths = photoEntries.map((p) => p.path);
    const [fullRes, thumbResults] = await Promise.all([
      supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_TTL),
      Promise.all(
        paths.map((p) =>
          supabase.storage
            .from(PHOTO_BUCKET)
            .createSignedUrl(p, PHOTO_TTL, { transform: { width: 640, quality: 75 } })
        )
      ),
    ]);
    const fullByPath = new Map(
      (fullRes.data || []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl])
    );
    photos = photoEntries.flatMap((entry, i) => {
      const full = fullByPath.get(entry.path);
      if (!full) return [];
      return [{ thumb: thumbResults[i]?.data?.signedUrl || full, full, date: entry.date }];
    });
  }

  // "Today at your home": live headcount from clock-ins + today's crew plan.
  // Counts and task text only — never individual names beyond what's written
  // in the task itself.
  const taskRows = (rows: { name: string; description: string | null; assigned_employee_ids: string[] | null }[] | null) => {
    const tasks = (rows || []).map((t) => ({ name: t.name, description: t.description ?? null }));
    const ids = new Set<string>();
    (rows || []).forEach((t) => (t.assigned_employee_ids ?? []).forEach((id) => ids.add(id)));
    return { tasks, planned_count: ids.size };
  };
  const todayPlan = taskRows(todayPhasesRes.data);
  const tomorrowPlan = taskRows(tomorrowPhasesRes.data);
  const liveCount = new Set((liveLogsRes.data || []).map((l) => l.author_id)).size;

  return NextResponse.json({
    today_on_site: {
      date: todayET,
      live_count: liveCount,
      planned_count: todayPlan.planned_count,
      tasks: todayPlan.tasks,
      tomorrow: tomorrowPlan,
    },
    client_name: portal.client_name,
    project: {
      name: proj.name,
      project_number: proj.project_number,
      address: [proj.address, proj.city, proj.state].filter(Boolean).join(", "),
      status: proj.status,
    },
    financials: buildFinancials(Number(proj.contract_value || 0), payments, changeOrders),
    schedule,
    payments,
    change_orders: changeOrders,
    selections: selectionsRes.data || [],
    photos,
  });
}
