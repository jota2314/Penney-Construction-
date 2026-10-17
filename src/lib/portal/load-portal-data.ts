import type { SupabaseClient } from "@supabase/supabase-js";
import { cascadeSchedule, type CascadeInput } from "@/lib/schedule/cascade";
import { isMasterPhase } from "@/lib/schedule/progress";
import { signThumbUrls } from "@/lib/image/transform-signed-url";
import { cachedSignedUrls } from "@/lib/storage/signed-url-cache";
import type {
  PortalData,
  PortalDocument,
  PortalNeed,
  PortalSelectionSheet,
} from "./types";

// Everything the client portal shows, loaded with the service-role client.
//
// mode "client"  — the homeowner's /portal/[token] view. Only published sheets
//                  and documents, only client-visible decisions.
// mode "preview" — staff preview. Same projection, plus anything staged
//                  (published_at null) or hidden, flagged so the page can mark
//                  it DRAFT. Never bumps the client's view counters, and links
//                  go to staff routes so opening a document doesn't either.
//
// No internal cost, margin, vendor-bill or crew-note data ever leaves here.

const SIGN_TTL = 60 * 60 * 4;

interface PaymentRow { payment_type: string; amount: number }
interface CORow { status: string; price_impact: number }

// Client-safe financial summary from raw rows (contract + payments + approved
// change orders). Computed directly rather than via get_project_financials,
// which is coupled to the estimate and returns zeros for projects without one.
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

// Sign storage paths grouped by bucket; returns a "bucket/path" → URL map.
async function signAll(
  supabase: SupabaseClient,
  refs: { bucket: string | null | undefined; path: string | null | undefined }[],
): Promise<Map<string, string>> {
  const byBucket = new Map<string, string[]>();
  for (const r of refs) {
    if (!r.bucket || !r.path) continue;
    const list = byBucket.get(r.bucket) ?? [];
    list.push(r.path);
    byBucket.set(r.bucket, list);
  }
  const out = new Map<string, string>();
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, paths]) => {
      const { data } = await cachedSignedUrls(supabase, bucket, paths, SIGN_TTL);
      for (const s of data) out.set(`${bucket}/${s.path}`, s.signedUrl);
    }),
  );
  return out;
}

export interface LoadPortalOptions {
  projectId: string;
  mode: "client" | "preview";
  /** The portal token — client mode only, used to build invoice links. */
  token?: string | null;
  clientName?: string | null;
}

export async function loadPortalData(
  supabase: SupabaseClient,
  { projectId, mode, token, clientName }: LoadPortalOptions,
): Promise<PortalData | null> {
  const preview = mode === "preview";
  // Job-site day boundary — the crew works in Eastern time.
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const tomorrowET = new Date(Date.parse(`${todayET}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

  let selectionsQuery = supabase
    .from("client_selections")
    .select("id, category, description, status, allowance_amount, options, selected_option_id, selected_value, selected_at, sort_order, client_visible, client_done_at, client_dismissed_at")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (!preview) selectionsQuery = selectionsQuery.eq("client_visible", true);

  let sheetsQuery = supabase
    .from("client_selection_sheets")
    .select("id, title, revision, sheet_date, intro, pdf_bucket, pdf_path, pdf_filename, show_prices, show_allowances, allowances, allowance_note, notes, published_at, created_at")
    .eq("project_id", projectId)
    .order("published_at", { ascending: false, nullsFirst: preview })
    .order("created_at", { ascending: false });
  if (!preview) sheetsQuery = sheetsQuery.not("published_at", "is", null);

  let docsQuery = supabase
    .from("client_portal_documents")
    .select("id, kind, title, subtitle, storage_bucket, storage_path, filename, cover_bucket, cover_path, sort_order, published_at, created_at")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (!preview) docsQuery = docsQuery.not("published_at", "is", null);

  const [
    projectRes, scheduleRes, paymentsRes, changeOrdersRes, selectionsRes, photoLogsRes,
    todayPhasesRes, tomorrowPhasesRes, liveLogsRes, sheetsRes, docsRes, invoicesRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("name, project_number, address, city, state, status, contract_value, contract_status, contract_token, contract_client_signed_at, contract_sent_to_client_at")
      .eq("id", projectId)
      .single(),
    supabase
      .from("schedule_phases")
      .select("id, name, description, start_date, end_date, planned_start_date, planned_end_date, status, is_confirmed, is_manually_scheduled, sort_order, color, event_type, phase_scope, client_completed_at, actual_completed_at")
      .eq("project_id", projectId)
      // Master schedule only — daily crew plans are internal (phase_scope 'daily').
      .or("phase_scope.eq.master,phase_scope.is.null")
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
      .select("id, change_order_number, title, description, status, price_impact, client_signed_at, approval_token, sent_to_client_at")
      .eq("project_id", projectId)
      .or("sent_to_client_at.not.is.null,status.eq.approved")
      .neq("status", "void")
      .order("change_order_number", { ascending: true }),
    selectionsQuery,
    // Progress photos the crew posted from the site. Photos ONLY — the log
    // text and author are internal and never leave here.
    supabase
      .from("daily_logs")
      .select("id, photo_storage_paths, started_at, created_at")
      .eq("project_id", projectId)
      .not("photo_storage_paths", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    // Today's confirmed crew rows — their NAME is client-facing (see the
    // gotcha on locked crew rows); notes are not read here.
    supabase
      .from("schedule_phases")
      .select("name, description, assigned_employee_ids")
      .eq("project_id", projectId)
      .eq("phase_scope", "daily")
      .eq("is_confirmed", true)
      .lte("start_date", todayET)
      .gte("end_date", todayET),
    supabase
      .from("schedule_phases")
      .select("name, description, assigned_employee_ids")
      .eq("project_id", projectId)
      .eq("phase_scope", "daily")
      .eq("is_confirmed", true)
      .lte("start_date", tomorrowET)
      .gte("end_date", tomorrowET),
    // Who is clocked in at the site right now (20h window guards stragglers).
    supabase
      .from("daily_logs")
      .select("author_id")
      .eq("project_id", projectId)
      .eq("status", "in_progress")
      .gte("started_at", new Date(Date.now() - 20 * 3600_000).toISOString()),
    sheetsQuery,
    docsQuery,
    // Invoices the client has actually been sent. Paid status is NOT shown:
    // client_invoices.paid_at is rarely set, payments_received is the record.
    supabase
      .from("client_invoices")
      .select("id, invoice_number, title, amount, invoice_date, sent_to_client_at, status")
      .eq("project_id", projectId)
      .not("sent_to_client_at", "is", null)
      .neq("status", "draft")
      .order("invoice_number", { ascending: true }),
  ]);

  const proj = projectRes.data;
  if (!proj) return null;

  // ---- schedule (live cascade: confirmed phases firm, the rest estimated)
  const rawPhases = ((scheduleRes.data || []) as CascadeInput[]).filter(isMasterPhase);
  const cascade = cascadeSchedule(rawPhases);
  const schedule = rawPhases.map((p) => {
    const c = cascade.get(p.id);
    const row = p as unknown as { name: string; description: string | null; color: string | null; event_type: string | null; client_completed_at: string | null };
    return {
      id: p.id,
      name: row.name,
      description: row.description,
      status: p.status,
      color: row.color,
      event_type: row.event_type,
      sort_order: p.sort_order,
      start_date: c?.start_date ?? p.start_date,
      end_date: c?.end_date ?? p.end_date,
      firm: c?.firm ?? false,
      actual_completion_date: c?.actual_completion_date ?? null,
      // The client marked it complete on their portal (board status unchanged).
      client_completed: !!row.client_completed_at,
    };
  });

  const payments = (paymentsRes.data || []).map((p) => ({ ...p, amount: Number(p.amount) }));
  const coLink = (c: { id: string; approval_token: string | null }) =>
    preview
      ? `/api/generate-change-order?changeOrderId=${c.id}`
      : c.approval_token ? `/approve/${c.approval_token}` : null;
  const changeOrders = (changeOrdersRes.data || []).map((c) => ({
    id: c.id,
    change_order_number: c.change_order_number,
    title: c.title,
    description: c.description,
    status: c.status,
    price_impact: Number(c.price_impact),
    signed: !!c.client_signed_at,
    sent_at: c.sent_to_client_at,
    approval_token: preview ? null : c.approval_token,
    url: coLink(c),
  }));

  // ---- progress photos
  const PHOTO_BUCKET = "daily-log-photos";
  const photoEntries = (photoLogsRes.data || [])
    .filter((l) => (l.photo_storage_paths?.length ?? 0) > 0)
    .flatMap((l) =>
      (l.photo_storage_paths as string[]).map((path) => ({
        path,
        date: (l.started_at || l.created_at || "").slice(0, 10),
      })),
    )
    .slice(0, 150);
  let photos: { thumb: string; full: string; date: string }[] = [];
  if (photoEntries.length > 0) {
    const paths = photoEntries.map((p) => p.path);
    const [fullRes, thumbsByPath] = await Promise.all([
      cachedSignedUrls(supabase, PHOTO_BUCKET, paths, SIGN_TTL),
      signThumbUrls(supabase, PHOTO_BUCKET, paths, SIGN_TTL, 640),
    ]);
    const fullByPath = new Map(
      (fullRes.data || []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]),
    );
    photos = photoEntries.flatMap((entry) => {
      const full = fullByPath.get(entry.path);
      if (!full) return [];
      return [{ thumb: thumbsByPath.get(entry.path) || full, full, date: entry.date }];
    });
  }

  // ---- "Today at your home": live headcount + today's/tomorrow's crew plan
  const taskRows = (rows: { name: string; description: string | null; assigned_employee_ids: string[] | null }[] | null) => {
    // Two crew rows with the same task (one per person) read as one line.
    const seen = new Set<string>();
    const tasks = (rows || [])
      .filter((t) => { const k = t.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((t) => ({ name: t.name, description: t.description ?? null }));
    const ids = new Set<string>();
    (rows || []).forEach((t) => (t.assigned_employee_ids ?? []).forEach((id) => ids.add(id)));
    return { tasks, planned_count: ids.size };
  };
  const todayPlan = taskRows(todayPhasesRes.data);
  const tomorrowPlan = taskRows(tomorrowPhasesRes.data);
  const liveCount = new Set((liveLogsRes.data || []).map((l) => l.author_id)).size;

  // ---- selection sheets: the newest one is shown in full; every sheet's
  // PDF is listed under Documents.
  type SheetRow = {
    id: string; title: string; revision: string | null; sheet_date: string | null; intro: string | null;
    pdf_bucket: string | null; pdf_path: string | null; pdf_filename: string | null;
    show_prices: boolean; show_allowances: boolean; allowances: unknown; allowance_note: string | null;
    notes: unknown; published_at: string | null; created_at: string;
  };
  const sheets = (sheetsRes.data || []) as SheetRow[];
  const current = sheets[0] ?? null;
  type ItemRow = {
    id: string; section: string | null; sort_order: number; status: string; status_label: string | null;
    name: string; brand_model: string | null; details: string | null; image_bucket: string | null;
    image_path: string | null; product_url: string | null; link_label: string | null; quantity: string | null;
    unit_price: string | null; ext_price: number | null; price_note: string | null;
    client_action: "approved" | "removed" | null;
  };
  let items: ItemRow[] = [];
  if (current) {
    const { data } = await supabase
      .from("client_selection_items")
      .select("id, section, sort_order, status, status_label, name, brand_model, details, image_bucket, image_path, product_url, link_label, quantity, unit_price, ext_price, price_note, client_action")
      .eq("sheet_id", current.id)
      .order("sort_order", { ascending: true });
    items = (data || []) as ItemRow[];
  }

  type DocRow = {
    id: string; kind: string; title: string; subtitle: string | null; storage_bucket: string;
    storage_path: string; filename: string | null; cover_bucket: string | null; cover_path: string | null;
    published_at: string | null; created_at: string;
  };
  const docRows = (docsRes.data || []) as DocRow[];

  const signed = await signAll(supabase, [
    ...sheets.map((s) => ({ bucket: s.pdf_bucket, path: s.pdf_path })),
    ...items.map((i) => ({ bucket: i.image_bucket, path: i.image_path })),
    ...docRows.map((d) => ({ bucket: d.storage_bucket, path: d.storage_path })),
    ...docRows.map((d) => ({ bucket: d.cover_bucket, path: d.cover_path })),
  ]);
  const urlOf = (bucket: string | null, path: string | null) =>
    bucket && path ? signed.get(`${bucket}/${path}`) ?? null : null;

  let selectionSheet: PortalSelectionSheet | null = null;
  if (current) {
    const showPrices = current.show_prices;
    selectionSheet = {
      id: current.id,
      title: current.title,
      revision: current.revision,
      sheet_date: current.sheet_date,
      intro: current.intro,
      pdf_url: urlOf(current.pdf_bucket, current.pdf_path),
      show_prices: showPrices,
      staged: !current.published_at,
      published_at: current.published_at,
      allowances: current.show_allowances && Array.isArray(current.allowances)
        ? (current.allowances as PortalSelectionSheet["allowances"])
        : [],
      allowance_note: current.show_allowances ? current.allowance_note : null,
      notes: Array.isArray(current.notes) ? (current.notes as PortalSelectionSheet["notes"]) : [],
      items: items.map((i) => ({
        id: i.id,
        section: i.section,
        status: i.status as PortalSelectionSheet["items"][number]["status"],
        status_label: i.status_label,
        name: i.name,
        brand_model: i.brand_model,
        details: i.details,
        image_url: urlOf(i.image_bucket, i.image_path),
        product_url: i.product_url,
        link_label: i.link_label,
        quantity: i.quantity,
        // Prices only when the team chose to show them on this sheet.
        unit_price: showPrices ? i.unit_price : null,
        ext_price: showPrices && i.ext_price != null ? Number(i.ext_price) : null,
        price_note: showPrices ? i.price_note : null,
        client_action: i.client_action,
      })),
    };
  }

  // ---- documents
  const documents: PortalDocument[] = [];
  for (const d of docRows) {
    const url = urlOf(d.storage_bucket, d.storage_path);
    if (!url) continue;
    documents.push({
      id: d.id,
      group: d.kind === "drawing" ? "design" : (d.kind as PortalDocument["group"]),
      title: d.title,
      subtitle: d.subtitle,
      date: (d.published_at || d.created_at).slice(0, 10),
      url,
      staged: !d.published_at,
    });
  }
  // Home hero: the rendering on a visible design document. Published covers
  // win over staged ones so the staff preview reads like the client's page.
  let designCover: PortalData["design_cover"] = null;
  for (const d of [...docRows].sort((a, b) => Number(!!b.published_at) - Number(!!a.published_at))) {
    if (d.kind !== "design" && d.kind !== "drawing") continue;
    const image = urlOf(d.cover_bucket, d.cover_path);
    const url = urlOf(d.storage_bucket, d.storage_path);
    if (!image || !url) continue;
    designCover = { document_id: d.id, title: d.title, subtitle: d.subtitle, image_url: image, url, staged: !d.published_at };
    break;
  }
  for (const s of sheets) {
    const url = urlOf(s.pdf_bucket, s.pdf_path);
    if (!url) continue;
    documents.push({
      id: `sheet-${s.id}`,
      group: "selections",
      title: [s.title, s.revision].filter(Boolean).join(" "),
      subtitle: s === current ? "Current" : "Earlier version",
      date: (s.sheet_date || s.published_at || s.created_at).slice(0, 10),
      url,
      staged: !s.published_at,
    });
  }
  const contractStatus = proj.contract_status as string | null;
  if (proj.contract_token && contractStatus) {
    documents.push({
      id: "contract",
      group: "contract",
      title: "Construction contract",
      subtitle: proj.contract_client_signed_at ? "Signed" : "Ready for your signature",
      date: (proj.contract_client_signed_at || proj.contract_sent_to_client_at || "").slice(0, 10) || null,
      url: preview
        ? `/api/generate-contract?projectId=${projectId}`
        : `/contract/${proj.contract_token}`,
      staged: false,
    });
  }
  for (const co of changeOrders) {
    if (!co.url) continue;
    documents.push({
      id: `co-${co.id}`,
      group: "change_order",
      title: `Change order ${co.change_order_number} · ${co.title}`,
      subtitle: co.signed || co.status === "approved" ? "Approved" : "Awaiting your signature",
      date: (co.sent_at || "").slice(0, 10) || null,
      url: co.url,
      staged: false,
    });
  }
  const invoices = (invoicesRes.data || []).map((inv) => ({
    id: inv.id as string,
    invoice_number: inv.invoice_number as number,
    title: inv.title as string | null,
    amount: Number(inv.amount),
    date: ((inv.invoice_date as string | null) || (inv.sent_to_client_at as string)).slice(0, 10),
    url: preview
      ? `/api/generate-client-invoice?invoiceId=${inv.id}`
      : `/api/generate-client-invoice?invoiceId=${inv.id}&portalToken=${token}`,
  }));
  for (const inv of invoices) {
    documents.push({
      id: `inv-${inv.id}`,
      group: "invoice",
      title: `Invoice ${inv.invoice_number}${inv.title ? ` · ${inv.title}` : ""}`,
      subtitle: null,
      date: inv.date,
      url: inv.url,
      staged: false,
    });
  }

  // ---- what we need from the client
  const decisions = (selectionsRes.data || []) as PortalData["selections"];
  const needed: PortalNeed[] = [];
  if (proj.contract_token && contractStatus && !proj.contract_client_signed_at) {
    needed.push({ kind: "contract", title: "Review and sign your contract", url: preview ? null : `/contract/${proj.contract_token}` });
  }
  for (const co of changeOrders) {
    if (!co.signed && co.status === "submitted") {
      needed.push({ kind: "change_order", title: `Review and sign change order ${co.change_order_number}`, detail: co.title, url: co.url });
    }
  }
  for (const s of decisions) {
    if (s.status === "pending" && s.client_visible !== false && !s.client_dismissed_at) {
      needed.push({ kind: "decision", title: `Choose: ${s.category}`, detail: s.description, tab: "selections" });
    }
  }

  return {
    mode,
    client_name: clientName ?? null,
    today_on_site: {
      date: todayET,
      live_count: liveCount,
      planned_count: todayPlan.planned_count,
      tasks: todayPlan.tasks,
      tomorrow: tomorrowPlan,
    },
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
    invoices,
    selections: decisions,
    selection_sheet: selectionSheet,
    documents,
    design_cover: designCover,
    needed,
    photos,
  };
}
