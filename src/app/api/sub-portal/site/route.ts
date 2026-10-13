import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatPhone,
  getSubPortalClient,
  hashPin,
  normalizePhone,
  setSubPortalCookie,
} from "@/lib/sub-portal/auth";
import { getSubProjectIds, resolveSubAccess } from "@/lib/sub-portal/access";
import { SITE_OPEN_STATUSES, findProjectBySiteCode, type SiteProject } from "@/lib/sub-portal/site-code";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { notifySubSiteEvent } from "@/lib/notifications/tagged-mentions";

export const runtime = "nodejs";

// Sign-ups from job QRs across the whole company in any hour. A real crew
// day never comes close; a leaked QR being hammered stops here.
const MAX_SIGNUPS_PER_HOUR = 10;
// Carries a brand-new directory record when the job has no PM assigned.
const FALLBACK_CREATOR_EMAIL = "jbetancur@penneyconstructioninc.com";

const notifyLater = (args: Parameters<typeof notifySubSiteEvent>[0]) =>
  after(() => notifySubSiteEvent(args).catch((err) => console.error("[sub-site] notify failed", err)));

const isOpen = (p: SiteProject) => SITE_OPEN_STATUSES.includes(p.status);

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
 * login, and whether it's a Penney team phone (those clock in from /crew).
 * Name and town only — the street address stays inside the portal.
 */
export async function GET(request: NextRequest) {
  const code = new URL(request.url).searchParams.get("code") || "";
  const supabase = getSubPortalClient();
  const project = await findProjectBySiteCode(supabase, code);
  if (!project) return badCode();

  const access = await resolveSubAccess(request);

  let team = false;
  try {
    const session = await createSessionClient();
    const { data } = await session.auth.getClaims();
    team = typeof data?.claims?.sub === "string";
  } catch {
    /* no team session — a sub's phone */
  }

  return NextResponse.json({
    project: {
      name: project.name,
      number: project.project_number,
      town: project.city,
      open: isOpen(project),
    },
    signedIn: !!access,
    company: access?.companyName ?? null,
    team,
  });
}

/**
 * POST /api/sub-portal/site
 *   { action: "join", code }  — signed-in sub scanned the QR: add them to the job.
 *   { action: "signup", code, name, company, trade, phone, email, pin }
 *       — first time: phone + PIN login on the spot, on this job, in right away.
 * Either way the office hears about it when something new happened.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = getSubPortalClient();
  const project = await findProjectBySiteCode(supabase, String(body.code || ""));
  if (!project) return badCode();
  if (!isOpen(project)) return closedJob(project);

  if (body.action === "join") return join(request, supabase, project);
  if (body.action === "signup") return signup(supabase, project, body);
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function join(request: NextRequest, supabase: SupabaseClient, project: SiteProject) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const added = await putSubOnJob(supabase, access.subId, project.id);
  if (added) {
    const who = subLabel(access.contactName, access.companyName);
    notifyLater({
      subName: who,
      projectId: project.id,
      title: `${who} scanned in at ${project.name}`,
      body: `${who} wasn't on ${project.project_number} ${project.name} yet and added themselves from the job QR. They can clock in, post photos and see the drawings there now. If they shouldn't be on this job, turn off their portal from Subcontractors.`,
      url: `/projects/${project.id}`,
    });
  }
  return NextResponse.json({ ok: true, projectId: project.id });
}

async function signup(supabase: SupabaseClient, project: SiteProject, body: Record<string, unknown>) {
  const text = (k: string, max: number) => String(body[k] ?? "").trim().replace(/\s+/g, " ").slice(0, max);

  // Hidden field a person never sees; a form-filling bot fills it.
  if (text("website", 200)) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const name = text("name", 80);
  const company = text("company", 120) || name;
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

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await supabase
    .from("sub_portal_access")
    .select("id", { count: "exact", head: true })
    .is("created_by", null)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_SIGNUPS_PER_HOUR) {
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
    .select("id, token, subcontractor_id, pin_hash, enabled")
    .eq("phone_login", phone)
    .limit(1);
  const phoneAccess = byPhone?.[0] ?? null;
  if (phoneAccess && !phoneAccess.enabled) {
    return NextResponse.json({ error: "Your portal access is turned off. Call the Penney office." }, { status: 403 });
  }
  if (phoneAccess?.pin_hash) return hasLogin();

  let subId: string;
  let token: string;
  let kind: "new" | "matched";
  let possibleDupe: string | null = null;

  if (phoneAccess) {
    // Office made their access but never set a PIN — let them set it here.
    subId = phoneAccess.subcontractor_id;
    token = phoneAccess.token;
    kind = "matched";
    await supabase
      .from("sub_portal_access")
      .update({ pin_hash: hashPin(token, pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
      .eq("id", phoneAccess.id);
  } else {
    // 2) Already in the sub directory under this cell number.
    const matched = await findSubByPhone(supabase, phone);
    if (matched) {
      subId = matched.id;
      kind = "matched";
      const { data: existing } = await supabase
        .from("sub_portal_access")
        .select("id, pin_hash, enabled")
        .eq("subcontractor_id", subId)
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
      await fillBlanks(supabase, matched, { name, email, trade });
    } else {
      // 3) Brand new to us: a prospect record the office can vet later.
      kind = "new";
      const { data: sameName } = await supabase
        .from("subcontractors")
        .select("company_name")
        .ilike("company_name", company)
        .limit(1);
      possibleDupe = sameName?.[0]?.company_name ?? null;

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
      subId = created.id;
    }

    // Insert first so Postgres mints the token, then hash the PIN against it
    // (same order as the office's setSubPortalPin). Reuse a PIN-less row.
    const { data: existingRow } = await supabase
      .from("sub_portal_access")
      .select("id, token")
      .eq("subcontractor_id", subId)
      .maybeSingle();
    let row = existingRow;
    if (!row) {
      const { data: inserted, error: insertErr } = await supabase
        .from("sub_portal_access")
        .insert({ subcontractor_id: subId, phone_login: phone })
        .select("id, token")
        .single();
      if (insertErr || !inserted) {
        console.error("[sub-site] create access failed", insertErr);
        return NextResponse.json({ error: "Couldn't sign you up. Call the Penney office." }, { status: 500 });
      }
      row = inserted;
    }
    token = row.token;
    await supabase
      .from("sub_portal_access")
      .update({ phone_login: phone, pin_hash: hashPin(token, pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  await putSubOnJob(supabase, subId, project.id);

  // Name the sub the way the directory has them — a matched sub may have
  // typed their company differently than it's filed.
  const { data: record } = await supabase
    .from("subcontractors")
    .select("company_name, contact_name")
    .eq("id", subId)
    .maybeSingle();
  const who = subLabel(record?.contact_name ?? name, record?.company_name ?? company);
  const tradeText = trade ? `, ${trade.replace(/_/g, " ")}` : "";
  notifyLater({
    subName: who,
    projectId: project.id,
    title:
      kind === "new"
        ? `New sub signed up at ${project.name}: ${who}`
        : `${who} signed up for the sub portal at ${project.name}`,
    body:
      kind === "new"
        ? `${who}${tradeText}, ${formatPhone(phone)}${email ? `, ${email}` : ""} signed up from the job QR at ${project.project_number} ${project.name}. They're in now and can clock in and post photos there. New directory record (prospect)${possibleDupe ? ` — possible duplicate of "${possibleDupe}"` : ""}.`
        : `${who} (${formatPhone(phone)}) set their own portal PIN from the job QR at ${project.project_number} ${project.name}. Matched to their existing directory record by phone, so they now see all their jobs.`,
    url: "/subcontractors",
  });

  const res = NextResponse.json({ ok: true, projectId: project.id });
  setSubPortalCookie(res, token);
  return res;
}

/** True when this scan put the sub on a job they weren't on before. */
async function putSubOnJob(supabase: SupabaseClient, subId: string, projectId: string): Promise<boolean> {
  const already = await getSubProjectIds(supabase, subId);
  if (already.includes(projectId)) return false;
  const { error } = await supabase
    .from("project_subcontractors")
    .upsert(
      { project_id: projectId, subcontractor_id: subId, notes: "Added from the job QR" },
      { onConflict: "project_id,subcontractor_id", ignoreDuplicates: true },
    );
  if (error) console.error("[sub-site] link to job failed", error);
  return !error;
}

type DirectorySub = {
  id: string;
  phone: string | null;
  contact_name: string | null;
  email: string | null;
  trades: string[] | null;
  is_active: boolean;
};

async function findSubByPhone(supabase: SupabaseClient, phone: string): Promise<DirectorySub | null> {
  // Phones are stored however they were typed; narrow by the last four
  // digits, then compare digits-only.
  const { data } = await supabase
    .from("subcontractors")
    .select("id, phone, contact_name, email, trades, is_active")
    .ilike("phone", `%${phone.slice(-4)}%`)
    .limit(50);
  const hits = ((data as DirectorySub[] | null) ?? []).filter((s) => normalizePhone(s.phone || "") === phone);
  return hits.find((s) => s.is_active) ?? hits[0] ?? null;
}

/** Add what they typed only where the directory record is empty. */
async function fillBlanks(
  supabase: SupabaseClient,
  sub: DirectorySub,
  input: { name: string; email: string; trade: string },
) {
  const patch: Record<string, unknown> = {};
  if (!sub.contact_name && input.name) patch.contact_name = input.name;
  if (!sub.email && input.email) patch.email = input.email;
  if ((!sub.trades || sub.trades.length === 0) && input.trade) patch.trades = [input.trade];
  if (Object.keys(patch).length === 0) return;
  await supabase.from("subcontractors").update(patch).eq("id", sub.id);
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
