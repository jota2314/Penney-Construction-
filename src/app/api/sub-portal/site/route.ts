import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatPhone,
  getSubPortalClient,
  hashPin,
  normalizePhone,
  setSubPortalCookie,
} from "@/lib/sub-portal/auth";
import { resolveSubAccess } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import {
  findProjectBySiteCode,
  firstNameOf,
  getSubPortalLoomUrl,
  isSiteOpen,
  normalizeCompanyName,
  subPortalJobPath,
  type SiteProject,
} from "@/lib/sub-portal/site-code";
import { isMaterialSupplier } from "@/lib/finance/spend-category";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { notifySubSiteEvent } from "@/lib/notifications/tagged-mentions";
import { notifySubField } from "@/lib/notifications/sub-field-notify";

export const runtime = "nodejs";

// Sign-ups from job QRs across the whole company in any hour. A real crew
// day never comes close; a leaked QR being hammered stops here. Counts new
// logins AND "my company is already set up" notices, so neither path can be
// used to flood the office.
const MAX_SIGNUPS_PER_HOUR = 10;
// Carries a brand-new directory record when the job has no PM assigned.
const FALLBACK_CREATOR_EMAIL = "jbetancur@penneyconstructioninc.com";
// Company suggestions on the sign-up form.
const MAX_SUGGESTIONS = 6;
// Directory names (subs not on this job) need 4 letters, match the start of
// the name only, and add at most this many: a worker typing his own company
// still finds it, but a script walking 3-letter prefixes can't dump the list.
const MIN_DIRECTORY_QUERY = 4;
const MAX_DIRECTORY_SUGGESTIONS = 2;
// Typeahead lookups per caller (IP) per job. Best effort: the map is per
// server instance, so it slows a scripted dump rather than stopping it.
const LOOKUP_WINDOW_MS = 10 * 60_000;
const MAX_LOOKUPS_PER_WINDOW = 60;
const lookups = new Map<string, { count: number; start: number }>();

function lookupAllowed(request: NextRequest, projectId: string): boolean {
  const now = Date.now();
  for (const [key, hit] of lookups) if (now - hit.start > LOOKUP_WINDOW_MS) lookups.delete(key);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const key = `${ip}|${projectId}`;
  const hit = lookups.get(key);
  if (!hit) {
    lookups.set(key, { count: 1, start: now });
    return true;
  }
  hit.count += 1;
  return hit.count <= MAX_LOOKUPS_PER_WINDOW;
}

const notifyLater = (args: Parameters<typeof notifySubSiteEvent>[0]) =>
  after(() => notifySubSiteEvent(args).catch((err) => console.error("[sub-site] notify failed", err)));

const closedJob = (p: SiteProject) =>
  NextResponse.json(
    { error: `${p.name} isn't open for check-in right now. Call the Penney office.` },
    { status: 409 },
  );

const badCode = () =>
  NextResponse.json({ error: "This QR code isn't active. Call the Penney office." }, { status: 404 });

/**
 * GET /api/sub-portal/site?code=XXXX — what the job QR page needs to decide
 * what to show: which job this is, whether the phone already has a portal
 * login, and whether it's a Penney team phone (those post from /crew) or an
 * office browser (those use Preview). Name and town only — the street
 * address stays inside the portal.
 *
 * GET /api/sub-portal/site?code=XXXX&q=mgl — company suggestions for the
 * sign-up form: subs on this job first, then the directory. Names only.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const supabase = getSubPortalClient();
  const project = await findProjectBySiteCode(supabase, params.get("code") || "");
  if (!project) return badCode();

  const q = params.get("q");
  if (q !== null) {
    if (!isSiteOpen(project) || !lookupAllowed(request, project.id)) return NextResponse.json({ companies: [] });
    return NextResponse.json({ companies: await companySuggestions(supabase, project.id, q) });
  }

  const [access, session, loomUrl] = await Promise.all([
    resolveSubAccess(request),
    teamSession(supabase),
    getSubPortalLoomUrl(supabase),
  ]);

  return NextResponse.json({
    project: {
      name: project.name,
      number: project.project_number,
      town: project.city,
      open: isSiteOpen(project),
    },
    signedIn: !!access,
    company: access?.companyName ?? null,
    team: session.team,
    staff: session.staff,
    loomUrl,
  });
}

/**
 * POST /api/sub-portal/site
 *   { action: "arrive", code }  — a signed-in sub scanned the sign: record
 *       the visit, put him on the job if he's new to it, tell the office,
 *       and send him to the job's composer.
 *   { action: "signup", code, name, company, trade, phone, email, pin }
 *       — first time, brand new to Penney: phone + PIN login on the spot,
 *       on this job, in right away. When his cell or his company is already
 *       on file, no record, PIN or session is made: he's told to call the
 *       office and the office is told who he is.
 * Refused in a browser signed in as Penney office staff (use Preview).
 */
export async function POST(request: NextRequest) {
  const refused = await refuseStaffBrowser(request);
  if (refused) return refused;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = getSubPortalClient();
  const project = await findProjectBySiteCode(supabase, String(body.code || ""));
  if (!project) return badCode();
  if (!isSiteOpen(project)) return closedJob(project);

  // "join" is the pre-v3 name; an app shell cached on a phone may still send it.
  if (body.action === "arrive" || body.action === "join") return arrive(request, supabase, project);
  if (body.action === "signup") return signup(supabase, project, body);
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function arrive(request: NextRequest, supabase: SupabaseClient, project: SiteProject) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const firstToday = await recordScan(supabase, access.subId, project.id);
  await putSubOnJob(supabase, access.subId, project.id);

  // One notice per sub per job per day: the first touch today pushes, a
  // rescan only refreshes "last seen" on the same row. When he's on no phase
  // there today the title asks the office to assign him.
  if (firstToday !== null) {
    after(() => notifySubField({ subId: access.subId, projectId: project.id, event: "arrived" }));
  }

  return NextResponse.json({
    ok: true,
    projectId: project.id,
    redirect: subPortalJobPath(project.id, true),
    firstToday: firstToday === true,
  });
}

async function signup(supabase: SupabaseClient, project: SiteProject, body: Record<string, unknown>) {
  const text = (k: string, max: number) => String(body[k] ?? "").trim().replace(/\s+/g, " ").slice(0, max);

  // Hidden field a person never sees; a form-filling bot fills it.
  if (text("website", 200)) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const name = text("name", 80);
  const typedCompany = text("company", 120);
  const company = typedCompany || name;
  const trade = text("trade", 40).toLowerCase();
  const email = text("email", 120).toLowerCase();
  const phone = normalizePhone(String(body.phone || ""));
  const pin = String(body.pin || "").trim();

  if (name.length < 2) return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  if (phone.length !== 10) return NextResponse.json({ error: "Enter your 10-digit cell number." }, { status: 400 });
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: "Pick a 4-digit PIN." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That email doesn't look right. Leave it blank if you want." }, { status: 400 });
  }

  if ((await recentSignupCount(supabase)) >= MAX_SIGNUPS_PER_HOUR) {
    return NextResponse.json({ error: "Too many sign-ups right now. Call the Penney office." }, { status: 429 });
  }

  const hasLogin = () =>
    NextResponse.json(
      { error: "This number already has a login. Sign in with your PIN.", hasLogin: true },
      { status: 409 },
    );

  // 1) This phone already signs in to the portal.
  const { data: byPhone } = await supabase
    .from("sub_portal_access")
    .select("id, subcontractor_id, pin_hash, enabled")
    .eq("phone_login", phone)
    .limit(1);
  const phoneAccess = byPhone?.[0] ?? null;
  if (phoneAccess && !phoneAccess.enabled) {
    return NextResponse.json({ error: "Your portal access is turned off. Call the Penney office." }, { status: 403 });
  }
  if (phoneAccess?.pin_hash) return hasLogin();

  // 1) + 2) This cell is already in Penney's records: an office-made access
  //    row with no PIN yet, or a directory record with this phone. Typing a
  //    number doesn't prove he holds that phone, and that record's bills,
  //    payments and agreements sit behind the login, so the QR never sets a
  //    PIN or a session here. Same answer as a known company: call the
  //    office, who set his PIN and text the invite to the cell on file.
  if (phoneAccess) {
    const { data: onFile } = await supabase
      .from("subcontractors")
      .select(DIRECTORY_COLS)
      .eq("id", phoneAccess.subcontractor_id)
      .maybeSingle();
    if (!onFile) {
      return NextResponse.json({ error: "Call the Penney office to set up your login." }, { status: 409 });
    }
    return phoneOnFile(project, onFile as DirectorySub, { name, phone, typedCompany: company });
  }
  const matched = await findSubByPhone(supabase, phone);
  if (matched) {
    const { data: existing } = await supabase
      .from("sub_portal_access")
      .select("id, pin_hash, enabled")
      .eq("subcontractor_id", matched.id)
      .maybeSingle();
    // The company already has a login under a different number. Don't
    // hand out a second key to the same billing — the office sorts it.
    if (existing?.pin_hash || existing?.enabled === false) {
      return NextResponse.json(
        {
          error:
            "Your company already has a portal login under another phone number. Sign in with that number, or call the Penney office.",
        },
        { status: 409 },
      );
    }
    return phoneOnFile(project, matched, { name, phone, typedCompany: company });
  }

  // 3) His company is already in the directory (a second MGL worker on
  //    a new phone). No duplicate prospect and no second key to the
  //    company's billing: tell him who to ask, tell the office who he is.
  const directory = await loadDirectory(supabase);
  const linked = await jobSubIds(supabase, project.id);
  const known = await findKnownCompany(supabase, directory, linked, company);
  if (known) {
    const sameFirstName =
      !!known.firstName && known.firstName.toLowerCase() === (firstNameOf(name) ?? "").toLowerCase();
    notifyKnownCompanySignup(project, { name, phone, typedCompany: company, known, sameFirstName });
    return NextResponse.json({
      known: { company: known.company_name, firstName: known.firstName, hasLogin: known.hasLogin, sameFirstName },
    });
  }

  // 4) Brand new to us: a prospect record the office can vet later. The only
  //    path that signs in from the QR: a new, empty record (no bills, money
  //    or agreements) on the job he scanned.
  const possibleDupe = nearMissCompany(directory, company);

  const createdBy = project.assigned_pm ?? (await fallbackCreator(supabase));
  if (!createdBy) return NextResponse.json({ error: "Sign-up isn't available right now. Call the Penney office." }, { status: 500 });

  const { data: created, error } = await supabase
    .from("subcontractors")
    .insert({
      company_name: company,
      contact_name: name,
      phone: formatPhone(phone),
      email: email || null,
      trades: trade ? [trade] : [],
      vetting_status: "prospect",
      is_active: true,
      created_by: createdBy,
      notes: `Signed up from the job QR at ${project.project_number} ${project.name} on ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}.`,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[sub-site] create sub failed", error);
    return NextResponse.json({ error: "Couldn't sign you up. Call the Penney office." }, { status: 500 });
  }
  const subId: string = created.id;

  // Insert first so Postgres mints the token, then hash the PIN against it
  // (same order as the office's setSubPortalPin).
  const { data: row, error: insertErr } = await supabase
    .from("sub_portal_access")
    .insert({ subcontractor_id: subId, phone_login: phone, invite_channel: "qr" })
    .select("id, token")
    .single();
  if (insertErr || !row) {
    console.error("[sub-site] create access failed", insertErr);
    return NextResponse.json({ error: "Couldn't sign you up. Call the Penney office." }, { status: 500 });
  }
  const token: string = row.token;
  await supabase
    .from("sub_portal_access")
    .update({ phone_login: phone, pin_hash: hashPin(token, pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  // He's standing at the job: count the scan and link him like an arrival.
  // The sign-up notice below is the office's heads-up, so no second
  // "arrived" ping; his first post today pushes the field notice.
  await recordScan(supabase, subId, project.id);
  await putSubOnJob(supabase, subId, project.id);

  const who = subLabel(name, company);
  const tradeText = trade ? `, ${trade.replace(/_/g, " ")}` : "";
  notifyLater({
    subName: who,
    projectId: project.id,
    title: `New sub signed up at ${project.name}: ${who}`,
    body: `${who}${tradeText}, ${formatPhone(phone)}${email ? `, ${email}` : ""} signed up from the job QR at ${project.project_number} ${project.name}. They're in now and can post photos there. New directory record (prospect)${possibleDupe ? ` — possible duplicate of "${possibleDupe}"` : ""}.`,
    url: "/subcontractors",
  });

  const res = NextResponse.json({ ok: true, projectId: project.id, redirect: subPortalJobPath(project.id, true) });
  setSubPortalCookie(res, token);
  return res;
}

// ─────────────────────────────── Visits and job links

/**
 * One QR scan on today's visit row. Returns true when this was his first
 * touch at this job today, false for a rescan, null when the write failed
 * (the scan still goes through; presence is a nice-to-have, not a gate).
 */
async function recordScan(supabase: SupabaseClient, subId: string, projectId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("sub_record_visit", {
    p_project: projectId,
    p_sub: subId,
    p_worker: null,
    p_source: "qr",
    p_scans: 1,
  });
  if (error) {
    console.error("[sub-site] record visit failed", error.message);
    return null;
  }
  return data === true;
}

/**
 * Every sub tied to this job from any direction: phases, quotes, bids,
 * awarded lines, bills, and the project_subcontractors list. Membership only.
 */
async function jobSubIds(supabase: SupabaseClient, projectId: string): Promise<Set<string>> {
  const [phases, quotes, bids, awarded, invoices, projSubs] = await Promise.all([
    supabase.from("schedule_phases").select("assigned_sub_ids").eq("project_id", projectId),
    supabase.from("quote_requests").select("subcontractor_id").eq("project_id", projectId).not("subcontractor_id", "is", null),
    supabase
      .from("subcontractor_bids")
      .select("subcontractor_id, bid_packages!inner(project_id)")
      .eq("bid_packages.project_id", projectId),
    supabase
      .from("estimate_line_items")
      .select("awarded_subcontractor_id, estimates!inner(project_id)")
      .eq("estimates.project_id", projectId)
      .not("awarded_subcontractor_id", "is", null),
    supabase.from("invoices").select("subcontractor_id").eq("project_id", projectId).not("subcontractor_id", "is", null),
    supabase.from("project_subcontractors").select("subcontractor_id").eq("project_id", projectId),
  ]);

  const ids = new Set<string>();
  const add = (id: unknown) => {
    if (typeof id === "string" && id) ids.add(id);
  };
  for (const r of (phases.data as { assigned_sub_ids: string[] | null }[] | null) ?? []) (r.assigned_sub_ids ?? []).forEach(add);
  for (const r of (quotes.data as { subcontractor_id: string | null }[] | null) ?? []) add(r.subcontractor_id);
  for (const r of (bids.data as { subcontractor_id: string | null }[] | null) ?? []) add(r.subcontractor_id);
  for (const r of (awarded.data as { awarded_subcontractor_id: string | null }[] | null) ?? []) add(r.awarded_subcontractor_id);
  for (const r of (invoices.data as { subcontractor_id: string | null }[] | null) ?? []) add(r.subcontractor_id);
  for (const r of (projSubs.data as { subcontractor_id: string | null }[] | null) ?? []) add(r.subcontractor_id);
  return ids;
}

/**
 * A sub new to this job gets a `visit_only` link: he was there, nothing was
 * awarded, no amount. ignoreDuplicates is load-bearing: an existing row
 * (active, removed, or locked by a signed work order) is left exactly as is,
 * since an upsert that touched a locked row's status would be refused.
 * Returns true when this scan made the link.
 */
async function putSubOnJob(supabase: SupabaseClient, subId: string, projectId: string): Promise<boolean> {
  const already = await jobSubIds(supabase, projectId);
  if (already.has(subId)) return false;
  const { data, error } = await supabase
    .from("project_subcontractors")
    .upsert(
      { project_id: projectId, subcontractor_id: subId, status: "visit_only", notes: "Added from the job QR" },
      { onConflict: "project_id,subcontractor_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error("[sub-site] link to job failed", error.message);
    return false;
  }
  return ((data as unknown[] | null) ?? []).length > 0;
}

// ─────────────────────────────── Sessions and limits

/**
 * Is this browser signed in to the Penney team app, and as office staff?
 * A field login (a team phone) is sent to /crew; an office login is told to
 * use Preview, since the sub-portal POSTs refuse it.
 */
async function teamSession(supabase: SupabaseClient): Promise<{ team: boolean; staff: boolean }> {
  try {
    const session = await createSessionClient();
    const { data } = await session.auth.getClaims();
    const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    if (!userId) return { team: false, staff: false };
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    const role = (profile as { role?: string | null } | null)?.role ?? null;
    return { team: true, staff: !!role && role !== "field" };
  } catch {
    /* no team session — a sub's phone */
    return { team: false, staff: false };
  }
}

/** QR sign-ups in the last hour: new logins, or "already set up" notices if more. */
async function recentSignupCount(supabase: SupabaseClient): Promise<number> {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const [{ count }, { data: notices }] = await Promise.all([
    supabase
      .from("sub_portal_access")
      .select("id", { count: "exact", head: true })
      .is("created_by", null)
      .gte("created_at", hourAgo),
    supabase
      .from("app_notifications")
      .select("source_id")
      .eq("source_type", "sub_signup")
      .gte("created_at", hourAgo)
      .limit(500),
  ]);
  // One notice goes to several people; count each sign-up once.
  const noticeCount = new Set(((notices as { source_id: string }[] | null) ?? []).map((n) => n.source_id)).size;
  return Math.max(count ?? 0, noticeCount);
}

// ─────────────────────────────── The directory

type DirectorySub = {
  id: string;
  company_name: string;
  legal_name: string | null;
  contact_name: string | null;
  aliases: string[] | null;
  phone: string | null;
  email: string | null;
  trades: string[] | null;
  is_active: boolean;
  vetting_status: string | null;
  portal_excluded_at: string | null;
};

const DIRECTORY_COLS =
  "id, company_name, legal_name, contact_name, aliases, phone, email, trades, is_active, vetting_status, portal_excluded_at";

/** The whole sub directory (about 170 rows), for name matching. */
async function loadDirectory(supabase: SupabaseClient): Promise<DirectorySub[]> {
  const { data, error } = await supabase.from("subcontractors").select(DIRECTORY_COLS).limit(2000);
  if (error) console.error("[sub-site] directory read failed", error.message);
  return (data as DirectorySub[] | null) ?? [];
}

/**
 * Suggestions for the sign-up form's company box. Subs on this job come
 * first and match from 2 letters (their aliases too); the rest of the
 * directory needs 4, matches the start of the name only, and adds at most
 * MAX_DIRECTORY_SUGGESTIONS. Suppliers and anyone the office excluded from
 * the portal never show. Names only, deduped.
 */
async function companySuggestions(
  supabase: SupabaseClient,
  projectId: string,
  rawQuery: string,
): Promise<{ name: string; onJob: boolean }[]> {
  const q = normalizeCompanyName(rawQuery.slice(0, 80));
  if (q.length < 2) return [];
  const [directory, linked] = await Promise.all([loadDirectory(supabase), jobSubIds(supabase, projectId)]);

  const scored: { name: string; norm: string; onJob: boolean; score: number }[] = [];
  for (const sub of directory) {
    if (!sub.company_name || isMaterialSupplier(sub.company_name)) continue;
    const onJob = linked.has(sub.id);
    if (!onJob && (sub.portal_excluded_at || q.length < MIN_DIRECTORY_QUERY)) continue;
    const norm = normalizeCompanyName(sub.company_name);
    let score = matchScore(norm, q);
    // Off this job: whole-name prefix only, never "a later word starts with".
    if (!onJob && score === 2) continue;
    if (score === null && onJob) {
      const aliasHit = (sub.aliases ?? []).some((a) => matchScore(normalizeCompanyName(a), q) !== null);
      if (aliasHit) score = 3;
    }
    if (score === null) continue;
    scored.push({ name: sub.company_name.trim(), norm, onJob, score });
  }

  scored.sort((a, b) => Number(b.onJob) - Number(a.onJob) || a.score - b.score || a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const out: { name: string; onJob: boolean }[] = [];
  let offJob = 0;
  for (const s of scored) {
    if (seen.has(s.norm)) continue;
    if (!s.onJob && offJob >= MAX_DIRECTORY_SUGGESTIONS) continue;
    seen.add(s.norm);
    if (!s.onJob) offJob += 1;
    out.push({ name: s.name, onJob: s.onJob });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** 0 exact, 1 starts with, 2 a later word starts with; null = no match. */
function matchScore(norm: string, q: string): number | null {
  if (!norm) return null;
  if (norm === q) return 0;
  if (norm.startsWith(q)) return 1;
  if (` ${norm}`.includes(` ${q}`)) return 2;
  return null;
}

type KnownCompany = DirectorySub & { firstName: string | null; hasLogin: boolean };

/**
 * The directory record for the company he typed, when there is one:
 * "MGL Tile" = "MGL Tile Inc" (normalized company or legal name; for subs
 * on this job, an "Also called" alias too). A sub on this job wins, then one
 * with a portal login, then an active record.
 */
async function findKnownCompany(
  supabase: SupabaseClient,
  directory: DirectorySub[],
  linked: Set<string>,
  typed: string,
): Promise<KnownCompany | null> {
  const target = normalizeCompanyName(typed);
  if (target.length < 2) return null;
  const hits = directory.filter(
    (s) =>
      normalizeCompanyName(s.company_name) === target ||
      (!!s.legal_name && normalizeCompanyName(s.legal_name) === target) ||
      (linked.has(s.id) && (s.aliases ?? []).some((a) => normalizeCompanyName(a) === target)),
  );
  if (hits.length === 0) return null;

  // Which of them already sign in (enabled, PIN set). Only the id comes back.
  const { data: logins } = await supabase
    .from("sub_portal_access")
    .select("subcontractor_id")
    .in(
      "subcontractor_id",
      hits.map((h) => h.id),
    )
    .eq("enabled", true)
    .not("pin_hash", "is", null);
  const withLogin = new Set(((logins as { subcontractor_id: string }[] | null) ?? []).map((l) => l.subcontractor_id));

  const rank = (s: DirectorySub) => [linked.has(s.id) ? 0 : 1, withLogin.has(s.id) ? 0 : 1, s.is_active ? 0 : 1];
  const best = [...hits].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  })[0];
  return { ...best, firstName: firstNameOf(best.contact_name), hasLogin: withLogin.has(best.id) };
}

/**
 * A close-but-not-equal directory name ("Cosentino" vs "Cosentino Plumbing
 * and Heating"), flagged in the new-prospect notice so the office can merge.
 */
function nearMissCompany(directory: DirectorySub[], typed: string): string | null {
  const target = normalizeCompanyName(typed);
  if (target.length < 5) return null;
  const hit = directory.find((s) => {
    const n = normalizeCompanyName(s.company_name);
    return n.length >= 5 && n !== target && (n.startsWith(`${target} `) || target.startsWith(`${n} `));
  });
  return hit?.company_name ?? null;
}

/** The office's heads-up when a worker named a company that's already set up. */
function notifyKnownCompanySignup(
  project: SiteProject,
  input: {
    name: string;
    phone: string;
    typedCompany: string;
    known: KnownCompany;
    sameFirstName: boolean;
    /** Matched by the cell he typed, not the company name. */
    phoneMatch?: boolean;
  },
) {
  const { name, phone, typedCompany, known, sameFirstName, phoneMatch } = input;
  const company = known.company_name;
  const contact = known.firstName;
  // What he typed, when it isn't word for word how the directory files it.
  const typedNote =
    typedCompany.trim().toLowerCase() !== company.trim().toLowerCase() ? ` (typed "${typedCompany}")` : "";
  const inactive = !known.is_active || known.vetting_status === "rejected";
  const next = phoneMatch
    ? inactive
      ? `That cell is on file for ${company}, which is marked inactive in the directory, so no login was made and they were told to call the office.`
      : `That cell is on file for ${company}, which has no portal login yet, so they were told to call the office. To let them in, set up the login from Subcontractors and text the invite to the cell on file.`
    : !known.hasLogin
      ? `${company} has no portal login yet, so they were told to call the office. Set one up from Subcontractors.`
      : sameFirstName
        ? `${company} already has a portal login (${contact}), possibly theirs under another phone number. They were told to sign in with that number or call the office.`
        : `${company} already has a portal login${contact ? ` (${contact})` : ""}, so they were told to ask ${contact ?? "them"} to post today or call the office.`;
  notifyLater({
    subName: name,
    projectId: project.id,
    title: `${name} at ${project.name} says they're with ${company}`,
    body: `${name}, ${formatPhone(phone)}, said they work for ${company}${typedNote} when they scanned the job QR at ${project.project_number} ${project.name}. No new directory record or login was made. ${next}`,
    url: "/subcontractors",
  });
}

/**
 * The cell he typed is already on file (a directory record, or an office-made
 * login with no PIN yet). No PIN and no session from the QR: typing a number
 * proves nothing, and that record's money and agreements sit behind the
 * login. He's told to call the office; the office is told who he is and sets
 * up the login, texting the invite to the cell on file.
 */
function phoneOnFile(
  project: SiteProject,
  sub: DirectorySub,
  input: { name: string; phone: string; typedCompany: string },
) {
  const known: KnownCompany = { ...sub, firstName: firstNameOf(sub.contact_name), hasLogin: false };
  notifyKnownCompanySignup(project, { ...input, known, sameFirstName: false, phoneMatch: true });
  // The "call the office" copy never names the contact, so his first name
  // doesn't go back to whoever typed the number.
  return NextResponse.json({
    known: { company: known.company_name, firstName: null, hasLogin: false, sameFirstName: false },
  });
}

async function findSubByPhone(supabase: SupabaseClient, phone: string): Promise<DirectorySub | null> {
  // Phones are stored however they were typed; narrow by the last four
  // digits, then compare digits-only.
  const { data } = await supabase
    .from("subcontractors")
    .select(DIRECTORY_COLS)
    .ilike("phone", `%${phone.slice(-4)}%`)
    .limit(50);
  const hits = ((data as DirectorySub[] | null) ?? []).filter((s) => normalizePhone(s.phone || "") === phone);
  // An inactive record still counts as "on file": a match never signs in
  // (signup tells him to call the office), and skipping it would mint a
  // fresh prospect login for a deactivated sub's number.
  return hits.find((s) => s.is_active) ?? hits[0] ?? null;
}

async function fallbackCreator(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", FALLBACK_CREATOR_EMAIL)
    .order("created_at", { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

function subLabel(contact: string | null, company: string): string {
  return contact && contact.toLowerCase() !== company.toLowerCase() ? `${contact} — ${company}` : company;
}
