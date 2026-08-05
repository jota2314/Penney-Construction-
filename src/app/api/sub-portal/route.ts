import { NextRequest, NextResponse } from "next/server";
import { SUB_PORTAL_COOKIE, getSubPortalClient } from "@/lib/sub-portal/auth";

export const runtime = "nodejs";

const FILE_TTL = 60 * 60 * 4;
// What a sub is allowed to see from the project file cabinet. Pricing,
// contracts, client invoices, photos, etc. never leave here.
const SUB_FILE_CATEGORIES = ["construction_drawings", "specs", "permits"];

interface SignedFile {
  id: string;
  project_id: string;
  filename: string;
  category: string;
  url: string;
}

/**
 * GET /api/sub-portal
 * Loads the sub-facing view for one subcontractor, resolved from the login
 * cookie (or ?token= for a direct link). Everything is scoped to that sub:
 * their phases, their quotes/awards (their dollars only), and the drawings,
 * specs and selections for the jobs they're on. No client pricing, no
 * payments, no other subs' numbers — ever.
 */
export async function GET(request: NextRequest) {
  const token =
    request.cookies.get(SUB_PORTAL_COOKIE)?.value ||
    new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const supabase = getSubPortalClient();

  const { data: access } = await supabase
    .from("sub_portal_access")
    .select("id, subcontractor_id, enabled, view_count")
    .eq("token", token)
    .maybeSingle();
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!access.enabled) {
    return NextResponse.json(
      { error: "Portal access has been turned off. Contact Penney Construction." },
      { status: 403 }
    );
  }

  const subId = access.subcontractor_id;

  await supabase
    .from("sub_portal_access")
    .update({
      last_viewed_at: new Date().toISOString(),
      view_count: (access.view_count || 0) + 1,
    })
    .eq("id", access.id);

  const [subRes, phasesRes, quotesRes, bidsRes, awardedRes] = await Promise.all([
    supabase
      .from("subcontractors")
      .select("company_name, contact_name")
      .eq("id", subId)
      .single(),
    supabase
      .from("schedule_phases")
      .select("id, project_id, name, description, start_date, end_date, status, event_type")
      .contains("assigned_sub_ids", [subId])
      .order("start_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("quote_requests")
      .select("id, project_id, project_name, trade, scope_description, amount, status, attachment_storage_path, sent_at")
      .eq("subcontractor_id", subId),
    supabase
      .from("subcontractor_bids")
      .select("id, amount, status, attachment_storage_path, bid_packages(project_id, name, trade, scope_of_work)")
      .eq("subcontractor_id", subId)
      .in("status", ["invited", "submitted", "accepted"]),
    supabase
      .from("estimate_line_items")
      .select("id, description, proposal_description, awarded_cost, estimates!inner(project_id)")
      .eq("awarded_subcontractor_id", subId),
  ]);

  const sub = subRes.data;
  if (!sub) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  type BidPkg = { project_id: string; name: string; trade: string | null; scope_of_work: string | null };
  const bids = (bidsRes.data || []).map((b) => ({
    id: b.id as string,
    amount: b.amount as number | null,
    status: b.status as string,
    attachment_storage_path: b.attachment_storage_path as string | null,
    pkg: (Array.isArray(b.bid_packages) ? b.bid_packages[0] : b.bid_packages) as BidPkg | null,
  }));
  const awarded = (awardedRes.data || []).map((li) => ({
    id: li.id as string,
    description: li.description as string,
    scope: (li.proposal_description as string | null) ?? null,
    amount: (li.awarded_cost as number | null) ?? null,
    project_id: (Array.isArray(li.estimates) ? li.estimates[0] : li.estimates)?.project_id as string,
  }));

  // Every project this sub touches, from any direction.
  const projectIds = new Set<string>();
  (phasesRes.data || []).forEach((p) => projectIds.add(p.project_id));
  (quotesRes.data || []).forEach((q) => q.project_id && projectIds.add(q.project_id));
  bids.forEach((b) => b.pkg?.project_id && projectIds.add(b.pkg.project_id));
  awarded.forEach((a) => a.project_id && projectIds.add(a.project_id));
  const ids = Array.from(projectIds);

  const [projectsRes, filesRes, selectionsRes] = await Promise.all([
    ids.length
      ? supabase
          .from("projects")
          .select("id, name, project_number, address, city, state, status")
          .in("id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("project_files")
          .select("id, project_id, filename, category, storage_path, storage_bucket")
          .in("project_id", ids)
          .in("category", SUB_FILE_CATEGORIES)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("client_selections")
          .select("id, project_id, category, description, status, selected_value")
          .in("project_id", ids)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // Sign drawings/specs, honoring each row's bucket (rows without
  // storage_bucket live in project-files — the 7/30 backfill default).
  type FileRow = { id: string; project_id: string; filename: string; category: string; storage_path: string; storage_bucket: string | null };
  const fileRows = (filesRes.data || []) as FileRow[];
  const signedFiles: SignedFile[] = [];
  await Promise.all(
    ["project-files", "email-attachments"].map(async (bucket) => {
      const rows = fileRows.filter(
        (f) => (f.storage_bucket ?? "project-files") === bucket && f.storage_path
      );
      if (!rows.length) return;
      const { data } = await supabase.storage
        .from(bucket)
        .createSignedUrls(rows.map((r) => r.storage_path), FILE_TTL);
      (data || []).forEach((s, i) => {
        if (s.signedUrl) {
          const r = rows[i];
          signedFiles.push({ id: r.id, project_id: r.project_id, filename: r.filename, category: r.category, url: s.signedUrl });
        }
      });
    })
  );

  // Their own quote/bid PDFs (uploaded quotes land in email-attachments).
  const signPdf = async (path: string | null) => {
    if (!path) return null;
    const { data } = await supabase.storage.from("email-attachments").createSignedUrl(path, FILE_TTL);
    return data?.signedUrl ?? null;
  };
  const quotes = await Promise.all(
    (quotesRes.data || []).map(async (q) => ({
      id: q.id,
      project_id: q.project_id,
      project_name: q.project_name,
      trade: q.trade,
      scope: q.scope_description,
      amount: q.amount === null ? null : Number(q.amount),
      status: q.status,
      pdf_url: await signPdf(q.attachment_storage_path),
    }))
  );
  const bidCards = await Promise.all(
    bids.map(async (b) => ({
      id: b.id,
      project_id: b.pkg?.project_id ?? null,
      package_name: b.pkg?.name ?? null,
      trade: b.pkg?.trade ?? null,
      scope: b.pkg?.scope_of_work ?? null,
      amount: b.amount === null ? null : Number(b.amount),
      status: b.status,
      pdf_url: await signPdf(b.attachment_storage_path),
    }))
  );

  return NextResponse.json({
    sub: { company_name: sub.company_name, contact_name: sub.contact_name },
    projects: (projectsRes.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      address: [p.address, p.city, p.state].filter(Boolean).join(", "),
      status: p.status,
    })),
    phases: (phasesRes.data || []).map((p) => ({
      id: p.id,
      project_id: p.project_id,
      name: p.name,
      description: p.description,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
    })),
    quotes,
    bids: bidCards,
    awarded: awarded.map((a) => ({
      ...a,
      amount: a.amount === null ? null : Number(a.amount),
    })),
    files: signedFiles,
    selections: selectionsRes.data || [],
  });
}
