import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cascadeSchedule, type CascadeInput } from "@/lib/schedule/cascade";

export const runtime = "nodejs";

// Service role for public, token-gated access — mirrors /api/portal.
// The public /job pages NEVER use the anon key; everything routes through here
// and is validated by the token server-side, so RLS stays intact for the app.
function getPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Crew-visible file categories. Everything else in project_files (pricing,
// quotes, contracts, "other") can carry dollar figures and stays internal.
const CREW_FILE_CATEGORIES = ["construction_drawings", "specs", "permits"] as const;

const SIGNED_URL_TTL = 60 * 60 * 4; // 4h — covers a work morning; re-signed on every load

interface FileRow {
  id: string;
  filename: string;
  storage_path: string;
  storage_bucket: string | null;
  mime_type: string | null;
  size: number;
  category: string;
  created_at: string;
}

interface LineRow {
  description: string;
  proposal_description: string | null;
  scope_text: string | null;
  section: string | null;
  is_section_header: boolean;
  sort_order: number;
}

interface ScopeSection { title: string | null; items: { title: string; details: string | null }[] }

// Exhibit-A style scope with no dollars: group visible line items under their
// section headers (or the `section` column when a version has no header rows).
function buildScope(lines: LineRow[]): ScopeSection[] {
  const items = lines.filter((l) => !l.is_section_header);
  const hasHeaders = lines.some((l) => l.is_section_header);
  const sections: ScopeSection[] = [];
  const push = (title: string | null) => {
    const s: ScopeSection = { title, items: [] };
    sections.push(s);
    return s;
  };
  if (hasHeaders) {
    let current: ScopeSection | null = null;
    for (const l of lines) {
      if (l.is_section_header) current = push(l.description);
      else (current ?? (current = push(null))).items.push(toItem(l));
    }
  } else if (items.some((l) => l.section)) {
    const byName = new Map<string, ScopeSection>();
    for (const l of items) {
      const key = l.section || "General";
      let s = byName.get(key);
      if (!s) { s = push(key); byName.set(key, s); }
      s.items.push(toItem(l));
    }
  } else if (items.length) {
    const s = push(null);
    for (const l of items) s.items.push(toItem(l));
  }
  return sections.filter((s) => s.items.length > 0);
}

function toItem(l: LineRow) {
  return { title: l.description, details: l.proposal_description || l.scope_text || null };
}

/**
 * GET /api/job?token=...
 * Loads the crew-facing job view for one tokenized job-site link.
 * Hard rule: no contract values, costs, prices, or margins in this payload.
 */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const supabase = getPublicClient();

  // 1. Validate the job link token.
  const { data: portal, error: portalErr } = await supabase
    .from("crew_portal_access")
    .select("id, project_id, enabled, view_count")
    .eq("token", token)
    .single();

  if (portalErr || !portal) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }
  if (!portal.enabled) {
    return NextResponse.json({ error: "This job link has been turned off. Check with the office." }, { status: 403 });
  }

  const projectId = portal.project_id;

  // 2. Track the view.
  await supabase
    .from("crew_portal_access")
    .update({
      last_viewed_at: new Date().toISOString(),
      view_count: (portal.view_count || 0) + 1,
    })
    .eq("id", portal.id);

  // 3. Load everything the crew needs, in parallel. No financial columns.
  const [projectRes, scheduleRes, filesRes, selectionsRes, changeOrdersRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("name, project_number, address, city, state, zip, status, assigned_pm")
        .eq("id", projectId)
        .single(),
      supabase
        .from("schedule_phases")
        .select("id, name, description, start_date, end_date, planned_start_date, planned_end_date, status, is_confirmed, sort_order, color")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true })
        .order("start_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("project_files")
        .select("id, filename, storage_path, storage_bucket, mime_type, size, category, created_at")
        .eq("project_id", projectId)
        .in("category", [...CREW_FILE_CATEGORIES])
        .order("created_at", { ascending: false }),
      supabase
        .from("client_selections")
        .select("id, category, description, status, selected_value, sort_order")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      // Approved scope changes only — title/description, never price_impact.
      supabase
        .from("change_orders")
        .select("id, change_order_number, title, description")
        .eq("project_id", projectId)
        .eq("status", "approved")
        .order("change_order_number", { ascending: true }),
    ]);

  const proj = projectRes.data;
  if (!proj) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  // 4. Site lead contact (assigned PM) + contracted scope, now that we have ids.
  const [pmRes, estimateRes] = await Promise.all([
    proj.assigned_pm
      ? supabase.from("profiles").select("full_name, phone, email").eq("id", proj.assigned_pm).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .eq("approval_status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let scope: ScopeSection[] = [];
  if (estimateRes.data) {
    const { data: lines } = await supabase
      .from("estimate_line_items")
      .select("description, proposal_description, scope_text, section, is_section_header, sort_order")
      .eq("estimate_id", estimateRes.data.id)
      .eq("is_visible_on_proposal", true)
      .order("sort_order", { ascending: true });
    scope = buildScope((lines || []) as LineRow[]);
  }

  // 5. Sign file URLs, batched per bucket. storage_bucket is authoritative;
  //    fall back to the path-prefix rule for legacy rows where it's null.
  const files = (filesRes.data || []) as FileRow[];
  const bucketOf = (f: FileRow) =>
    f.storage_bucket || (f.storage_path.startsWith(projectId) ? "project-files" : "email-attachments");
  const byBucket = new Map<string, FileRow[]>();
  for (const f of files) {
    const b = bucketOf(f);
    byBucket.set(b, [...(byBucket.get(b) || []), f]);
  }
  const urlByFileId = new Map<string, string>();
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, rows]) => {
      const { data } = await supabase.storage
        .from(bucket)
        .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_TTL);
      (data || []).forEach((signed, i) => {
        if (signed?.signedUrl) urlByFileId.set(rows[i].id, signed.signedUrl);
      });
    })
  );

  // Apply the live cascade: confirmed phases stay firm; unconfirmed phases ride
  // the master schedule shifted by the latest confirmed slip. Same as /api/portal.
  const rawPhases = (scheduleRes.data || []) as CascadeInput[];
  const cascade = cascadeSchedule(rawPhases);
  const schedule = rawPhases.map((p) => {
    const c = cascade.get(p.id);
    return {
      id: p.id,
      name: (p as unknown as { name: string }).name,
      description: (p as unknown as { description: string | null }).description,
      status: p.status,
      sort_order: p.sort_order,
      start_date: c?.start_date ?? p.start_date,
      end_date: c?.end_date ?? p.end_date,
      firm: c?.firm ?? false,
    };
  });

  const pm = pmRes.data as { full_name: string | null; phone: string | null; email: string | null } | null;

  return NextResponse.json({
    project: {
      name: proj.name,
      project_number: proj.project_number,
      address: [proj.address, proj.city, proj.state].filter(Boolean).join(", "),
      status: proj.status,
    },
    pm: pm ? { name: pm.full_name, phone: pm.phone, email: pm.email } : null,
    schedule,
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      category: f.category,
      mime_type: f.mime_type,
      size: f.size,
      created_at: f.created_at,
      url: urlByFileId.get(f.id) || null,
    })),
    selections: selectionsRes.data || [],
    change_orders: changeOrdersRes.data || [],
    scope,
  });
}
