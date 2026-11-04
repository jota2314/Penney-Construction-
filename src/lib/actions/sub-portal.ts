"use server";

import { randomInt } from "crypto";
import { requireAuth } from "@/lib/auth/require-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhone, hashPin, normalizePhone } from "@/lib/sub-portal/auth";
import { addDays, todayET } from "@/lib/sub-portal/et-day";
import { isMaterialSupplier } from "@/lib/finance/spend-category";
import { sendEmail } from "@/lib/google/gmail";
import {
  TEST_MODE_RECIPIENT_EMAILS,
  isNotificationTestMode,
  testModeSubject,
} from "@/lib/notifications/test-mode";
import type { SubInviteChannel } from "@/lib/sub-portal/payload";
import type { AuthUser } from "@/types/auth";

/**
 * Office side of the sub portal: PINs, invites, the rollout list and the
 * per-sub activity in the portal dialog.
 *
 * Every action checks for an office role first and writes with the admin
 * client. The access row's `token` is the PIN salt and the portal cookie, so
 * it never leaves this file: nothing returned here carries it or the hash.
 */

type Admin = ReturnType<typeof createAdminClient>;

const OFFICE_ROLES = new Set(["owner", "precon_manager", "project_manager", "office_admin"]);
const NOT_OFFICE = "Only the office can manage sub portal logins.";

/** The address subs are given: the cookie is host-only and the apex redirects. */
const PORTAL_LOGIN_URL = "https://www.penneyconstruction.build/sub";
const OFFICE_PHONE = "978-621-4387";
const LOOM_SETTING = "sub_portal_loom_url";

async function officeUser(): Promise<AuthUser | null> {
  const user = await requireAuth();
  return user.profile && OFFICE_ROLES.has(user.profile.role) ? user : null;
}

// ───────────────────────────────────────── status

export interface SubPortalStatus {
  id: string;
  phone_login: string | null;
  has_pin: boolean;
  enabled: boolean;
  /** Bumped by the sub's own page loads (office previews too, before Oct 17). */
  last_viewed_at: string | null;
  view_count: number;
  /** sub_portal_access.link_sent_at: the last invite. */
  invited_at: string | null;
  invite_channel: SubInviteChannel | null;
}

type StatusRow = {
  id: string;
  phone_login: string | null;
  pin_hash: string | null;
  enabled: boolean;
  last_viewed_at: string | null;
  view_count: number;
  link_sent_at: string | null;
  invite_channel: string | null;
};

/** Never includes `token`. pin_hash is read only to say whether a PIN is set. */
const STATUS_COLS = "id, phone_login, pin_hash, enabled, last_viewed_at, view_count, link_sent_at, invite_channel";

const CHANNELS: readonly SubInviteChannel[] = ["text", "email", "copy", "qr"];

function toStatus(row: StatusRow): SubPortalStatus {
  return {
    id: row.id,
    phone_login: row.phone_login,
    has_pin: !!row.pin_hash,
    enabled: row.enabled,
    last_viewed_at: row.last_viewed_at,
    view_count: row.view_count ?? 0,
    invited_at: row.link_sent_at,
    invite_channel: CHANNELS.includes(row.invite_channel as SubInviteChannel)
      ? (row.invite_channel as SubInviteChannel)
      : null,
  };
}

async function readStatus(admin: Admin, subId: string): Promise<SubPortalStatus | null> {
  const { data } = await admin
    .from("sub_portal_access")
    .select(STATUS_COLS)
    .eq("subcontractor_id", subId)
    .maybeSingle();
  return data ? toStatus(data as StatusRow) : null;
}

export async function getSubPortalStatus(subcontractorId: string): Promise<SubPortalStatus | null> {
  if (!(await officeUser())) return null;
  return readStatus(createAdminClient(), subcontractorId);
}

// ───────────────────────────────────────── PIN

/** "Another sub signs in with this cell" check, shared by every login write. */
async function phoneTakenBy(admin: Admin, phone: string, subId: string): Promise<boolean> {
  const { data } = await admin
    .from("sub_portal_access")
    .select("id")
    .eq("phone_login", phone)
    .neq("subcontractor_id", subId)
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Create (or refresh) the access row and set its PIN. The login phone comes
 * from the sub's record. The PIN is hashed against the row's own token and
 * never stored; the token is never rotated (that would break every PIN).
 */
async function savePin(
  admin: Admin,
  subId: string,
  pin: string,
  createdBy: string,
): Promise<{ status?: SubPortalStatus; error?: string }> {
  const { data: sub } = await admin
    .from("subcontractors")
    .select("phone")
    .eq("id", subId)
    .maybeSingle();
  if (!sub) return { error: "That sub isn't in the directory any more." };
  const phone = normalizePhone(sub.phone || "");
  if (phone.length < 10) {
    return { error: "This sub needs a cell number on file first. That's their login." };
  }
  if (await phoneTakenBy(admin, phone, subId)) {
    return { error: "Another sub already uses this cell number to sign in." };
  }

  const { data: existing } = await admin
    .from("sub_portal_access")
    .select("id, token")
    .eq("subcontractor_id", subId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await admin
      .from("sub_portal_access")
      .update({
        phone_login: phone,
        pin_hash: hashPin(existing.token, pin),
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(STATUS_COLS)
      .single();
    if (error) return { error: error.message };
    return { status: toStatus(data as StatusRow) };
  }

  // Insert first so Postgres mints the token, then hash the PIN against it.
  const { data: created, error: insertErr } = await admin
    .from("sub_portal_access")
    .insert({ subcontractor_id: subId, phone_login: phone, created_by: createdBy })
    .select("id, token")
    .single();
  if (insertErr || !created) return { error: insertErr?.message || "Couldn't create portal access." };

  const { data, error } = await admin
    .from("sub_portal_access")
    .update({ pin_hash: hashPin(created.token, pin) })
    .eq("id", created.id)
    .select(STATUS_COLS)
    .single();
  if (error) return { error: error.message };
  return { status: toStatus(data as StatusRow) };
}

/**
 * Set the PIN the office typed. The raw PIN is never stored.
 */
export async function setSubPortalPin(
  subcontractorId: string,
  pin: string,
): Promise<{ status?: SubPortalStatus; error?: string }> {
  const user = await officeUser();
  if (!user) return { error: NOT_OFFICE };
  if (!/^\d{4,6}$/.test(pin)) return { error: "PIN must be 4-6 digits." };
  return savePin(createAdminClient(), subcontractorId, pin, user.id);
}

export async function toggleSubPortalEnabled(
  subcontractorId: string,
  enabled: boolean,
): Promise<{ status?: SubPortalStatus; error?: string }> {
  if (!(await officeUser())) return { error: NOT_OFFICE };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sub_portal_access")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("subcontractor_id", subcontractorId)
    .select(STATUS_COLS)
    .single();
  if (error) return { error: error.message };
  return { status: toStatus(data as StatusRow) };
}

/**
 * A random 4-digit PIN that isn't one a stranger would guess first: no
 * 1111, no 1234 or 4321 runs, no 1212 repeats.
 */
function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10000)).padStart(4, "0");
    const d = pin.split("").map(Number);
    const steps = [d[1] - d[0], d[2] - d[1], d[3] - d[2]];
    if (steps.every((s) => s === steps[0]) && Math.abs(steps[0]) <= 1) continue; // 1111, 1234, 4321
    if (pin.slice(0, 2) === pin.slice(2)) continue; // 1212
    return pin;
  }
}

// ───────────────────────────────────────── cell (the login)

/**
 * Put a cell number on a sub, from the rollout list's "Add cell" box. The cell
 * is the portal login, so it must be at least 10 digits and no other sub may
 * sign in with it. If he already has a login, it moves to the new cell.
 */
export async function setSubLoginPhone(
  subcontractorId: string,
  input: string,
): Promise<{ phone?: string; warning?: string; error?: string }> {
  if (!(await officeUser())) return { error: NOT_OFFICE };
  const digits = normalizePhone(input);
  if (digits.length < 10) return { error: "Enter the full cell number, at least 10 digits." };
  if (digits.length > 15) return { error: "That's too many digits for a phone number." };

  const admin = createAdminClient();
  if (await phoneTakenBy(admin, digits, subcontractorId)) {
    return { error: "Another sub already uses this cell number to sign in." };
  }

  // Not a block: the same cell on a second directory record usually means a
  // duplicate company (the Two Wesleys trap), which the office should see.
  const { data: others } = await admin
    .from("subcontractors")
    .select("id, company_name, phone")
    .neq("id", subcontractorId)
    .not("phone", "is", null);
  const twin = (others ?? []).find((s) => normalizePhone(s.phone || "") === digits);

  const phone = formatPhone(digits);
  const { error } = await admin
    .from("subcontractors")
    .update({ phone, updated_at: new Date().toISOString() })
    .eq("id", subcontractorId);
  if (error) return { error: error.message };

  await admin
    .from("sub_portal_access")
    .update({ phone_login: digits, updated_at: new Date().toISOString() })
    .eq("subcontractor_id", subcontractorId);

  return {
    phone,
    warning: twin
      ? `${twin.company_name} has the same cell on file. If it's the same company, merge the two records.`
      : undefined,
  };
}

// ───────────────────────────────────────── hide from the rollout list

export async function setSubPortalExcluded(
  subcontractorId: string,
  excluded: boolean,
): Promise<{ ok?: true; error?: string }> {
  if (!(await officeUser())) return { error: NOT_OFFICE };
  const { error } = await createAdminClient()
    .from("subcontractors")
    .update({ portal_excluded_at: excluded ? new Date().toISOString() : null })
    .eq("id", subcontractorId);
  if (error) return { error: error.message };
  return { ok: true };
}

// ───────────────────────────────────────── invites

export type SubInviteSendChannel = "text" | "email" | "copy";

export interface SubInvitePreview {
  company_name: string;
  first_name: string | null;
  /** "978-430-0049", or null when there's no usable cell. */
  cell: string | null;
  email: string | null;
  has_access: boolean;
  has_pin: boolean;
  enabled: boolean;
  /** Why an invite can't go out yet, in plain words. Empty when it can. */
  problems: string[];
  /** Email invites go to the tester while notifications test mode is on. */
  test_mode: boolean;
  /** Test mode only touches a TEST sub's login; a real sub's PIN is left alone. */
  is_test_sub: boolean;
  /** The text and email as they'll read, with the PIN shown as "(new PIN)". */
  text: string;
  email_subject: string;
  email_body: string;
}

export interface SubInviteResult {
  channel: SubInviteSendChannel;
  /** The PIN this click set. Shown once to the clicking user; never stored. */
  pin: string | null;
  cell: string;
  /** The text body (the same words go in the email). */
  text: string;
  /** sms:{cell}?&body=…, for the Open Messages button and the desktop QR. */
  sms_href: string;
  email_to: string | null;
  test_mode: boolean;
  /** link_sent_at / invite_channel were stamped. */
  stamped: boolean;
  note: string | null;
  status: SubPortalStatus | null;
}

type InviteSub = {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
};

function firstName(sub: InviteSub): string | null {
  const name = (sub.contact_name || "").trim();
  return name ? name.split(/\s+/)[0] : null;
}

function isTestSub(sub: InviteSub): boolean {
  return /^test\b/i.test(sub.company_name.trim());
}

function validEmail(email: string | null | undefined): string | null {
  const e = (email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

async function loomUrl(admin: Admin): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", LOOM_SETTING).maybeSingle();
  const url = (data?.value || "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * The invite words. Short, plain, no dashes (Jorge's email rules), with one
 * Portuguese line; a native speaker should check it before Wave 1.
 * `pin` null means he keeps the PIN he has.
 */
function inviteText(opts: {
  sub: InviteSub;
  sender: string;
  cell: string;
  pin: string | null;
  loom: string | null;
}): { text: string; subject: string; body: string } {
  const hi = firstName(opts.sub) ? `Hi ${firstName(opts.sub)}` : "Hi";
  const pinLine = opts.pin
    ? `PIN: ${opts.pin}`
    : `PIN: the one Penney gave you (forgot it? call ${OFFICE_PHONE})`;
  const watch = opts.loom ? [`Watch how (1 min): ${opts.loom}`] : [];
  const pt = `Português: entre em ${PORTAL_LOGIN_URL} com o seu celular e o PIN acima.`;

  const text = [
    `${hi}, it's ${opts.sender} at Penney Construction. Your sub portal is ready: your dates, drawings and one place to post your job photos.`,
    `Sign in: ${PORTAL_LOGIN_URL}`,
    `Cell: ${opts.cell}`,
    pinLine,
    ...watch,
    pt,
  ].join("\n");

  const body = [
    `${hi},`,
    "Your Penney Construction sub portal is ready: your dates, drawings and one place to post your job photos.",
    [`Sign in: ${PORTAL_LOGIN_URL}`, `Cell: ${opts.cell}`, pinLine].join("\n"),
    "Save it to your home screen. When you get to a job, scan the sign at the door and add your photos before you leave.",
    ...watch,
    pt,
    `Questions? Call the office at ${OFFICE_PHONE}.`,
    opts.sender,
  ].join("\n\n");

  return { text, subject: "Your Penney Construction sub portal", body };
}

function senderName(user: AuthUser): string {
  const profile = user.realProfile ?? user.profile;
  const first = (profile?.full_name || "").trim().split(/\s+/)[0];
  return first || "the office";
}

function smsHref(cellDigits: string, text: string): string {
  return `sms:${cellDigits}?&body=${encodeURIComponent(text)}`;
}

async function loadInviteContext(admin: Admin, subId: string) {
  const [{ data: sub }, { data: access }, loom, testMode] = await Promise.all([
    admin
      .from("subcontractors")
      .select("id, company_name, contact_name, phone, email")
      .eq("id", subId)
      .maybeSingle(),
    admin
      .from("sub_portal_access")
      .select(STATUS_COLS)
      .eq("subcontractor_id", subId)
      .maybeSingle(),
    loomUrl(admin),
    isNotificationTestMode(admin),
  ]);
  return {
    sub: sub as InviteSub | null,
    access: access as StatusRow | null,
    loom,
    testMode,
  };
}

/** What an invite would say and whether it can go out. Read-only. */
export async function previewSubInvite(
  subcontractorId: string,
): Promise<{ preview?: SubInvitePreview; error?: string }> {
  const user = await officeUser();
  if (!user) return { error: NOT_OFFICE };
  const admin = createAdminClient();
  const { sub, access, loom, testMode } = await loadInviteContext(admin, subcontractorId);
  if (!sub) return { error: "That sub isn't in the directory any more." };

  const digits = normalizePhone(sub.phone || "");
  const problems: string[] = [];
  if (digits.length < 10) problems.push("Add a cell first. The cell is his login.");
  else if (await phoneTakenBy(admin, digits, subcontractorId)) {
    problems.push("Another sub already uses this cell number to sign in.");
  }
  if (access && !access.enabled) problems.push("His portal is turned off. Turn it on first.");

  const cell = digits.length >= 10 ? formatPhone(digits) : null;
  const words = inviteText({
    sub,
    sender: senderName(user),
    cell: cell ?? "(no cell yet)",
    pin: access?.pin_hash ? null : "(new PIN)",
    loom,
  });
  return {
    preview: {
      company_name: sub.company_name,
      first_name: firstName(sub),
      cell,
      email: validEmail(sub.email),
      has_access: !!access,
      has_pin: !!access?.pin_hash,
      enabled: access ? access.enabled : true,
      problems,
      test_mode: testMode,
      is_test_sub: isTestSub(sub),
      text: words.text,
      email_subject: words.subject,
      email_body: words.body,
    },
  };
}

/**
 * Invite a sub to the portal, on an explicit office click.
 *
 * - Sets a fresh 4-digit PIN when he has none (or `newPin`), and returns it
 *   once to the clicking user. The PIN is never stored or logged.
 * - "text" / "copy": returns the words and the sms: link; the office phone
 *   does the sending. Stamped at the click.
 * - "email": sends from the clicking user's Gmail with an email_logs row. In
 *   notifications test mode it goes to the tester instead, and a real sub's
 *   login and invite stamp are left alone (a TEST sub runs end to end).
 *
 * Nothing here ever runs on its own.
 */
export async function inviteSubToPortal(
  subcontractorId: string,
  opts: { channel: SubInviteSendChannel; newPin?: boolean },
): Promise<{ result?: SubInviteResult; error?: string }> {
  const user = await officeUser();
  if (!user) return { error: NOT_OFFICE };
  const channel = opts.channel;
  if (channel !== "text" && channel !== "email" && channel !== "copy") {
    return { error: "Pick text, email or copy." };
  }

  const admin = createAdminClient();
  const { sub, access, loom, testMode } = await loadInviteContext(admin, subcontractorId);
  if (!sub) return { error: "That sub isn't in the directory any more." };

  const digits = normalizePhone(sub.phone || "");
  if (digits.length < 10) return { error: "Add a cell first. The cell is his login." };
  if (access && !access.enabled) return { error: "His portal is turned off. Turn it on first." };
  if (await phoneTakenBy(admin, digits, subcontractorId)) {
    return { error: "Another sub already uses this cell number to sign in." };
  }
  const cell = formatPhone(digits);
  const emailTo = validEmail(sub.email);
  if (channel === "email" && !emailTo) return { error: "There's no email on file for this sub." };

  // Test mode keeps a real sub's login exactly as it is: the email goes to the
  // tester, so a new PIN would lock him out with nobody told.
  const dryRun = channel === "email" && testMode && !isTestSub(sub);
  const needPin = !dryRun && (!access?.pin_hash || !!opts.newPin);
  const pin = needPin ? generatePin() : null;
  const words = inviteText({
    sub,
    sender: senderName(user),
    cell,
    pin: dryRun ? "(test mode: no PIN was set)" : pin,
    loom,
  });

  // Text and copy: save the PIN first; the office phone sends the words.
  // Email: send first, then save, so a failed send never leaves a PIN nobody got.
  let status: SubPortalStatus | null = access ? toStatus(access) : null;
  if (needPin && pin && channel !== "email") {
    const saved = await savePin(admin, subcontractorId, pin, user.id);
    if (saved.error) return { error: saved.error };
    status = saved.status ?? null;
  }

  let note: string | null = null;
  if (channel === "email" && emailTo) {
    const to = testMode ? TEST_MODE_RECIPIENT_EMAILS[0] : emailTo;
    const subject = testMode ? testModeSubject(words.subject) : words.subject;
    const body = testMode
      ? `Test mode: this invite would have gone to ${emailTo}.\n\n${words.body}`
      : words.body;
    let sentId: string;
    try {
      sentId = (await sendEmail({ to, subject, body })).id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      return {
        error: msg.includes("No Google OAuth tokens")
          ? "Google isn't connected. Sign in with Google from Settings, then try again."
          : `The email didn't send: ${msg}`,
      };
    }

    // email_logs has NOT NULL subject/from_email/to_email and no created_by.
    const { error: logErr } = await admin.from("email_logs").insert({
      gmail_message_id: sentId,
      subject,
      from_email: user.email || "",
      to_email: to,
      direction: "outbound",
      category: "sub_outreach",
      project_id: null,
    });
    if (logErr) console.error("[sub-invite] email_logs insert failed:", logErr.message);

    if (needPin && pin) {
      const saved = await savePin(admin, subcontractorId, pin, user.id);
      if (saved.error) {
        return { error: `The email went out, but the PIN didn't save (${saved.error}). Use New PIN and send it again.` };
      }
      status = saved.status ?? null;
    }
    note = dryRun
      ? `Test mode: sent to ${to} only. ${sub.company_name}'s login and invite date didn't change.`
      : testMode
        ? `Test mode: sent to ${to} only.`
        : `Sent to ${emailTo} from your Gmail.`;
  }

  let stamped = false;
  if (!dryRun) {
    const { error: stampErr } = await admin
      .from("sub_portal_access")
      .update({
        link_sent_at: new Date().toISOString(),
        invite_channel: channel,
        updated_at: new Date().toISOString(),
      })
      .eq("subcontractor_id", subcontractorId);
    if (stampErr) console.error("[sub-invite] invite stamp failed:", stampErr.message);
    stamped = !stampErr;
    status = (await readStatus(admin, subcontractorId)) ?? status;
  }

  return {
    result: {
      channel,
      pin,
      cell,
      text: words.text,
      sms_href: smsHref(digits, words.text),
      email_to: emailTo,
      test_mode: testMode,
      stamped,
      note,
      status,
    },
  };
}

// ───────────────────────────────────────── activity (the dialog)

export interface SubJobVisits {
  project_id: string;
  project_name: string;
  /** Days with a visit row in the window. */
  days: number;
  posts: number;
  photos: number;
  last_seen_at: string;
}

export interface SubPortalActivity {
  status: SubPortalStatus | null;
  cell: string | null;
  email: string | null;
  posts_30d: number;
  /** QR check-ins, posts and clock-ins by job, last 30 days (sub_site_visits). */
  visits_30d: SubJobVisits[];
  last_on_site: { at: string; project_name: string } | null;
  test_mode: boolean;
}

export async function getSubPortalActivity(
  subcontractorId: string,
): Promise<{ activity?: SubPortalActivity; error?: string }> {
  if (!(await officeUser())) return { error: NOT_OFFICE };
  const admin = createAdminClient();
  const since30 = addDays(todayET(), -30);
  const since30At = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [status, { data: sub }, { count: posts }, { data: visits }, { data: lastVisit }, testMode] =
    await Promise.all([
      readStatus(admin, subcontractorId),
      admin.from("subcontractors").select("phone, email").eq("id", subcontractorId).maybeSingle(),
      admin
        .from("daily_logs")
        .select("id", { count: "exact", head: true })
        .eq("subcontractor_id", subcontractorId)
        .gte("created_at", since30At),
      admin
        .from("sub_site_visits")
        .select("project_id, visit_date, posts, photos, last_seen_at")
        .eq("subcontractor_id", subcontractorId)
        .gte("visit_date", since30)
        .order("last_seen_at", { ascending: false })
        .limit(500),
      admin
        .from("sub_site_visits")
        .select("project_id, last_seen_at")
        .eq("subcontractor_id", subcontractorId)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      isNotificationTestMode(admin),
    ]);

  const byJob = new Map<string, Omit<SubJobVisits, "project_name">>();
  for (const v of visits ?? []) {
    const row = byJob.get(v.project_id);
    if (row) {
      row.days += 1;
      row.posts += v.posts ?? 0;
      row.photos += v.photos ?? 0;
    } else {
      byJob.set(v.project_id, {
        project_id: v.project_id,
        days: 1,
        posts: v.posts ?? 0,
        photos: v.photos ?? 0,
        last_seen_at: v.last_seen_at,
      });
    }
  }
  const projectIds = [...new Set([...byJob.keys(), ...(lastVisit ? [lastVisit.project_id] : [])])];
  const names = await projectNames(admin, projectIds);

  const digits = normalizePhone(sub?.phone || "");
  return {
    activity: {
      status,
      cell: digits.length >= 10 ? formatPhone(digits) : null,
      email: validEmail(sub?.email),
      posts_30d: posts ?? 0,
      visits_30d: [...byJob.values()].map((v) => ({ ...v, project_name: names.get(v.project_id) ?? "Job" })),
      last_on_site: lastVisit
        ? { at: lastVisit.last_seen_at, project_name: names.get(lastVisit.project_id) ?? "Job" }
        : null,
      test_mode: testMode,
    },
  };
}

async function projectNames(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const { data } = await admin.from("projects").select("id, name").in("id", ids);
  for (const p of data ?? []) names.set(p.id, p.name);
  return names;
}

// ───────────────────────────────────────── rollout list

/** never → set up (PIN, no invite) → invited → on (he has opened it). Off = turned off. */
export type SubPortalState = "never" | "set_up" | "invited" | "on" | "off";

export interface SubRolloutRow {
  sub_id: string;
  company_name: string;
  contact_name: string | null;
  trades: string[];
  /** "978-430-0049", or null when there's no 10-digit cell (Add cell). */
  cell: string | null;
  /** What's on file when it isn't a usable cell ("781-555"), for the Add cell box. */
  phone_on_file: string | null;
  email: string | null;
  portal: SubPortalState;
  has_access: boolean;
  has_pin: boolean;
  invited_at: string | null;
  invite_channel: SubInviteChannel | null;
  last_real_visit_at: string | null;
  view_count: number;
  posts_30d: number;
  last_on_site: { at: string; project_name: string } | null;
  /** Bills in the last 90 days and the latest bill's day. */
  bills_90d: number;
  last_bill_day: string | null;
  /** Assigned phases overlapping the next 30 days, and the first of them. */
  phases_30d: number;
  next_phase: { name: string; project_name: string; start_date: string } | null;
  /** A material dealer (isMaterialSupplier): never invited. */
  supplier: boolean;
  /** Hidden from the list by the office (subcontractors.portal_excluded_at). */
  excluded_at: string | null;
}

export interface SubRolloutData {
  today: string;
  generated_at: string;
  rows: SubRolloutRow[];
  test_mode: boolean;
}

const PAGE = 1000;

/** Read every page (PostgREST caps a select at 1000 rows). */
async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * Who should be on the portal: every sub billed in the last 90 days or on a
 * phase in the next 30, with live counts. Material suppliers and anyone the
 * office hid are flagged (the table hides them by default), not dropped.
 */
export async function getSubRollout(): Promise<{ data?: SubRolloutData; error?: string }> {
  if (!(await officeUser())) return { error: NOT_OFFICE };
  const admin = createAdminClient();
  const today = todayET();
  const since90 = addDays(today, -90);
  const until30 = addDays(today, 30);
  const since30At = new Date(Date.now() - 30 * 86_400_000).toISOString();

  try {
    const [bills, phases] = await Promise.all([
      selectAll<{ id: string; subcontractor_id: string; invoice_date: string | null; created_at: string }>(
        (from, to) =>
          admin
            .from("invoices")
            .select("id, subcontractor_id, invoice_date, created_at")
            .not("subcontractor_id", "is", null)
            .or(`invoice_date.gte.${since90},and(invoice_date.is.null,created_at.gte.${since90})`)
            .order("id")
            .range(from, to),
      ),
      selectAll<{
        id: string;
        project_id: string;
        name: string;
        start_date: string | null;
        end_date: string | null;
        assigned_sub_ids: string[] | null;
      }>((from, to) =>
        admin
          .from("schedule_phases")
          .select("id, project_id, name, start_date, end_date, assigned_sub_ids")
          .lte("start_date", until30)
          .or(`end_date.gte.${today},and(end_date.is.null,start_date.gte.${today})`)
          .order("id")
          .range(from, to),
      ),
    ]);

    const billed = new Map<string, { n: number; last: string | null }>();
    for (const b of bills) {
      const day = b.invoice_date ?? b.created_at.slice(0, 10);
      const row = billed.get(b.subcontractor_id) ?? { n: 0, last: null };
      row.n += 1;
      if (!row.last || day > row.last) row.last = day;
      billed.set(b.subcontractor_id, row);
    }

    const scheduled = new Map<string, { n: number; next: (typeof phases)[number] | null }>();
    for (const p of phases) {
      for (const subId of p.assigned_sub_ids ?? []) {
        if (!subId) continue;
        const row = scheduled.get(subId) ?? { n: 0, next: null };
        row.n += 1;
        if (!row.next || (p.start_date ?? "") < (row.next.start_date ?? "")) row.next = p;
        scheduled.set(subId, row);
      }
    }

    const ids = [...new Set([...billed.keys(), ...scheduled.keys()])];
    if (!ids.length) {
      return { data: { today, generated_at: new Date().toISOString(), rows: [], test_mode: false } };
    }

    const [{ data: subs }, { data: access }, logs, { data: visits }, testMode] = await Promise.all([
      admin
        .from("subcontractors")
        .select("id, company_name, contact_name, trades, phone, email, portal_excluded_at")
        .in("id", ids),
      admin.from("sub_portal_access").select(`subcontractor_id, ${STATUS_COLS}`).in("subcontractor_id", ids),
      selectAll<{ id: string; subcontractor_id: string }>((from, to) =>
        admin
          .from("daily_logs")
          .select("id, subcontractor_id")
          .in("subcontractor_id", ids)
          .gte("created_at", since30At)
          .order("id")
          .range(from, to),
      ),
      admin
        .from("sub_site_visits")
        .select("subcontractor_id, project_id, last_seen_at")
        .in("subcontractor_id", ids)
        .order("last_seen_at", { ascending: false })
        .limit(PAGE),
      isNotificationTestMode(admin),
    ]);

    const accessBySub = new Map<string, StatusRow>();
    for (const a of access ?? []) accessBySub.set(a.subcontractor_id, a as StatusRow);
    const postsBySub = new Map<string, number>();
    for (const l of logs) postsBySub.set(l.subcontractor_id, (postsBySub.get(l.subcontractor_id) ?? 0) + 1);
    const lastVisitBySub = new Map<string, { project_id: string; last_seen_at: string }>();
    for (const v of visits ?? []) if (!lastVisitBySub.has(v.subcontractor_id)) lastVisitBySub.set(v.subcontractor_id, v);

    const names = await projectNames(admin, [
      ...new Set([
        ...[...scheduled.values()].map((s) => s.next?.project_id).filter((id): id is string => !!id),
        ...[...lastVisitBySub.values()].map((v) => v.project_id),
      ]),
    ]);

    const rows: SubRolloutRow[] = (subs ?? []).map((s) => {
      const a = accessBySub.get(s.id);
      const status = a ? toStatus(a) : null;
      const digits = normalizePhone(s.phone || "");
      const bill = billed.get(s.id);
      const sched = scheduled.get(s.id);
      const visit = lastVisitBySub.get(s.id);
      const portal: SubPortalState = !status
        ? "never"
        : !status.enabled
          ? "off"
          : status.last_viewed_at
            ? "on"
            : status.invited_at
              ? "invited"
              : status.has_pin
                ? "set_up"
                : "never";
      return {
        sub_id: s.id,
        company_name: s.company_name,
        contact_name: s.contact_name,
        trades: Array.isArray(s.trades) ? s.trades : [],
        cell: digits.length >= 10 ? formatPhone(digits) : null,
        phone_on_file: digits.length >= 10 ? null : s.phone || null,
        email: validEmail(s.email),
        portal,
        has_access: !!status,
        has_pin: !!status?.has_pin,
        invited_at: status?.invited_at ?? null,
        invite_channel: status?.invite_channel ?? null,
        last_real_visit_at: status?.last_viewed_at ?? null,
        view_count: status?.view_count ?? 0,
        posts_30d: postsBySub.get(s.id) ?? 0,
        last_on_site: visit
          ? { at: visit.last_seen_at, project_name: names.get(visit.project_id) ?? "Job" }
          : null,
        bills_90d: bill?.n ?? 0,
        last_bill_day: bill?.last ?? null,
        phases_30d: sched?.n ?? 0,
        next_phase:
          sched?.next && sched.next.start_date
            ? {
                name: sched.next.name,
                project_name: names.get(sched.next.project_id) ?? "Job",
                start_date: sched.next.start_date,
              }
            : null,
        supplier: isMaterialSupplier(s.company_name),
        excluded_at: s.portal_excluded_at ?? null,
      };
    });

    // Scheduled soonest first (Wave 1 is whoever is on the schedule), then
    // the most recently billed.
    rows.sort((x, y) => {
      const xs = x.next_phase?.start_date ?? "9999-12-31";
      const ys = y.next_phase?.start_date ?? "9999-12-31";
      if (xs !== ys) return xs < ys ? -1 : 1;
      const xb = x.last_bill_day ?? "";
      const yb = y.last_bill_day ?? "";
      if (xb !== yb) return xb > yb ? -1 : 1;
      return x.company_name.localeCompare(y.company_name);
    });

    return { data: { today, generated_at: new Date().toISOString(), rows, test_mode: testMode } };
  } catch (err) {
    console.error("[sub-rollout] load failed:", err);
    return { error: "Couldn't load the rollout list. Refresh to try again." };
  }
}
