import "server-only";
import { keyUuid } from "@/lib/ids/key-uuid";
import { formatMoney } from "@/lib/money";
import {
  SUB_SCHEDULE_OFFICE_EMAILS,
  applyTestModeRecipients,
  isNotificationTestMode,
  testModeSubject,
  type RecipientProfile,
  type SubNoticeSource,
} from "@/lib/notifications/tagged-mentions";
import { TEST_MODE_RECIPIENT_EMAILS } from "@/lib/notifications/test-mode";
import { sendPushToUser } from "@/lib/push/send";
import { coversDay, etTimeLabel, todayET } from "@/lib/sub-portal/et-day";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What subs do in the field, told to the office without spam (plan §4.3).
 *
 * This does NOT go through deliverNotifications and doesn't widen
 * notifyOfficeOfSub: those always push and email, even when the upsert hit a
 * duplicate. Here:
 *  - The row's source_id is deterministic (keyUuid), so "one notice per sub
 *    per job per day" is enforced by the table's unique key, races included.
 *  - The upsert ignores duplicates and returns only the rows it INSERTED.
 *    Push goes to those recipients only.
 *  - A later event with the same key rewrites the existing row's title and
 *    body in place ("· 3 posts · 14 photos") with no push.
 *  - Never email. Notifications test mode narrows recipients to the tester
 *    and marks the title, same as the bill notices. When that leaves nobody
 *    (the bill notice goes to Nicole alone), the tester gets the one copy
 *    instead, like notifyBillApprovedForPay, so a TEST walk still sees it.
 *  - Subs have no profile, so Jorge's profile is the actor on every row, as
 *    with the existing sub schedule notices.
 *
 * Every function catches its own errors and resolves: a notice must never
 * break a sub's post. Call them inside `after()` from the routes.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The four sub notice types (all allowed by migration 20261017120000). Defined
 * next to MentionSource in tagged-mentions.ts, whose emailing notifiers refuse
 * them at the type level; re-exported here for callers.
 */
export type { SubNoticeSource };

/** Who a sub notice can go to. */
export type SubNoticeAudience = "pm" | "jorge" | "ryan" | "nicole" | "bill_reviewer";

const JORGE_EMAIL = SUB_SCHEDULE_OFFICE_EMAILS[0];
const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";
const NICOLE_EMAIL = "nsmith@penneyconstructioninc.com";
const AUDIENCE_EMAIL: Partial<Record<SubNoticeAudience, string>> = {
  jorge: JORGE_EMAIL,
  ryan: RYAN_EMAIL,
  nicole: NICOLE_EMAIL,
};

/** app_settings key naming who files sub bills (Nicole, seeded by the migration). */
export const SUB_BILL_REVIEWER_SETTING = "sub_bill_reviewer_profile_id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────── Keys

/** One per sub per job per ET day: the first check-in or post pushes, later ones update it. */
export function subFieldSourceId(subId: string, projectId: string, day: string): string {
  return keyUuid(`sub_field:${subId}:${projectId}:${day}`);
}

/** One per exception chip per post, so "Problem found" and "Waiting" on one post both ping. */
export function subExceptionSourceId(kind: SubExceptionKind, logId: string): string {
  return keyUuid(`sub_exception:${kind}:${logId}`);
}

/** One digest per recipient per ET day; a second cron run only rewrites it. */
export function subDigestSourceId(day: string): string {
  return keyUuid(`sub_digest:${day}`);
}

// ─────────────────────────────── Recipients

export interface SubNoticeRecipients {
  /** Deduped, in audience order, before test mode. */
  recipients: RecipientProfile[];
  /** Jorge's profile: the actor on every row (subs have no profile). */
  carrierId: string | null;
  /** The job's assigned PM, when the job has one. */
  pmId: string | null;
}

/** Who may receive a sub bill: the office roles (the same four the new tables' RLS admits). */
const BILL_REVIEWER_ROLES: readonly string[] = ["owner", "precon_manager", "project_manager", "office_admin"];

type ProfileWithRole = RecipientProfile & { role?: string | null };

/**
 * Turn an audience into profiles. Jorge, Ryan and Nicole are matched by
 * email (never by name: Jorge has two profile rows). "pm" is
 * projects.assigned_pm. "bill_reviewer" is the first of reviewerProfileId,
 * app_settings sub_bill_reviewer_profile_id, the job PM and Jorge that is a
 * real profile with an office role. Live RLS lets any signed-in user edit
 * app_settings, so a setting pointing at a field login is skipped rather
 * than trusted.
 */
export async function resolveSubNoticeRecipients(
  admin: Admin,
  {
    projectId,
    audience,
    reviewerProfileId,
    pmId: knownPmId,
  }: {
    projectId: string | null;
    audience: SubNoticeAudience[];
    /** Overrides the reviewer setting (e.g. a bill someone already took). */
    reviewerProfileId?: string | null;
    /** Pass when already loaded, to skip the projects lookup. */
    pmId?: string | null;
  },
): Promise<SubNoticeRecipients> {
  const wantsPm = audience.includes("pm");
  const wantsReviewer = audience.includes("bill_reviewer");
  const emails = Array.from(
    new Set([JORGE_EMAIL, ...audience.map((a) => AUDIENCE_EMAIL[a]).filter((e): e is string => !!e)]),
  );

  const [officeRes, projectRes, settingRes] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, role").in("email", emails),
    projectId && knownPmId === undefined && (wantsPm || wantsReviewer)
      ? admin.from("projects").select("assigned_pm").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null as { assigned_pm: string | null } | null }),
    wantsReviewer && !reviewerProfileId
      ? admin.from("app_settings").select("value").eq("key", SUB_BILL_REVIEWER_SETTING).maybeSingle()
      : Promise.resolve({ data: null as { value: string | null } | null }),
  ]);

  const office = (officeRes.data as ProfileWithRole[] | null) ?? [];
  const byEmail = (email: string) => office.find((p) => p.email?.trim().toLowerCase() === email);
  const jorge = byEmail(JORGE_EMAIL) ?? null;
  const pmId = knownPmId !== undefined ? knownPmId : (projectRes.data?.assigned_pm ?? null);

  const settingId = (settingRes.data?.value ?? "").trim();
  const reviewerCandidates = wantsReviewer
    ? Array.from(
        new Set([reviewerProfileId, settingId, pmId, jorge?.id].filter((id): id is string => !!id && UUID_RE.test(id))),
      )
    : [];

  // PM and reviewer candidates may be anyone; fetch whichever isn't already in hand.
  const extraIds = Array.from(new Set([wantsPm ? pmId : null, ...reviewerCandidates])).filter(
    (id): id is string => !!id && !office.some((p) => p.id === id),
  );
  const { data: extra } = extraIds.length
    ? await admin.from("profiles").select("id, email, full_name, role").in("id", extraIds)
    : { data: [] as ProfileWithRole[] };
  const all = [...office, ...((extra as ProfileWithRole[] | null) ?? [])];
  const byId = (id: string | null) => (id ? all.find((p) => p.id === id) : undefined);
  const reviewerId =
    reviewerCandidates.find((id) => BILL_REVIEWER_ROLES.includes(byId(id)?.role ?? "")) ?? null;

  const recipients: RecipientProfile[] = [];
  const add = (p: RecipientProfile | undefined | null) => {
    if (p && !recipients.some((r) => r.id === p.id)) recipients.push(p);
  };
  for (const a of audience) {
    if (a === "pm") add(byId(pmId));
    else if (a === "bill_reviewer") add(byId(reviewerId));
    else add(byEmail(AUDIENCE_EMAIL[a] as string));
  }

  return { recipients, carrierId: jorge?.id ?? recipients[0]?.id ?? null, pmId };
}

// ─────────────────────────────── The writer

/** One recipient's copy of a notice. Title and body may differ per recipient (the digest). */
export interface SubNoticeDelivery {
  profile: RecipientProfile;
  title: string;
  body: string;
  /** Defaults to the notice's url. */
  url?: string;
}

export interface WriteSubNoticesInput {
  sourceType: SubNoticeSource;
  /** A uuid. Use the key helpers above for keyed notices. */
  sourceId: string;
  /** app_notifications.kind: 'post' for field activity, agreements and the digest; 'invoice' for bills. */
  kind: "post" | "invoice";
  deliveries: SubNoticeDelivery[];
  url: string;
  /** actor_profile_id on every row (Jorge). */
  carrierId: string | null;
  /** A repeat with the same sourceId rewrites title/body/url in place, no push. Default true. */
  updateExisting?: boolean;
  /** Push to the recipients whose row was just inserted. Default true. */
  push?: boolean;
}

export interface SubNoticeResult {
  sourceId: string;
  /** Recipients whose row was new (these were pushed). */
  inserted: string[];
  /** Recipients whose existing row got the new text. */
  updated: string[];
  /** Devices a push reached. */
  pushed: number;
  testMode: boolean;
  /** Why nothing was written, when nothing was. */
  skipped?: "no_recipients" | "error";
}

// The table checks char_length(title) <= 200 and body <= 500. Cut by code
// point, so an emoji in a sub's note is never split into an invalid string.
function clampText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

export async function writeSubNotices(admin: Admin, input: WriteSubNoticesInput): Promise<SubNoticeResult> {
  const { sourceType, sourceId, kind, url, carrierId } = input;
  const updateExisting = input.updateExisting ?? true;
  const push = input.push ?? true;
  const empty = (testMode: boolean, skipped?: SubNoticeResult["skipped"]): SubNoticeResult => ({
    sourceId,
    inserted: [],
    updated: [],
    pushed: 0,
    testMode,
    skipped,
  });

  // Test mode narrows the list to the tester (applyTestModeRecipients).
  const testMode = await isNotificationTestMode(admin);
  const allowed = new Set(applyTestModeRecipients(input.deliveries.map((d) => d.profile), testMode).map((p) => p.id));
  let deliveries = input.deliveries.filter(
    (d, i, list) => allowed.has(d.profile.id) && list.findIndex((x) => x.profile.id === d.profile.id) === i,
  );
  // Nobody left in test mode means the real audience didn't include the
  // tester (a sub bill goes to Nicole alone). Redirect one copy to the tester,
  // as notifyBillApprovedForPay does, so the walk-through can see it. Only a
  // redirect: with no real recipients there's nothing to redirect.
  if (testMode && deliveries.length === 0 && input.deliveries.length > 0) {
    const { data: testers } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("email", [...TEST_MODE_RECIPIENT_EMAILS])
      .limit(1);
    const tester = ((testers as RecipientProfile[] | null) ?? [])[0];
    if (tester) deliveries = [{ ...input.deliveries[0], profile: tester }];
  }
  if (deliveries.length === 0) return empty(testMode, "no_recipients");

  const rows = deliveries.map((d) => ({
    recipient_profile_id: d.profile.id,
    actor_profile_id: carrierId,
    kind,
    title: clampText(testMode ? testModeSubject(d.title) : d.title, 200),
    body: clampText(d.body, 500),
    url: d.url ?? url,
    source_type: sourceType,
    source_id: sourceId,
  }));

  // ON CONFLICT DO NOTHING ... RETURNING: only newly inserted rows come back.
  const { data: insertedRows, error } = await admin
    .from("app_notifications")
    .upsert(rows, { onConflict: "recipient_profile_id,source_type,source_id", ignoreDuplicates: true })
    .select("recipient_profile_id");
  if (error) {
    // Without the insert result we can't tell who is new, so nobody is pushed.
    console.error("[sub-field-notify] could not write notices", { sourceType, sourceId, error: error.message });
    return empty(testMode, "error");
  }
  const inserted = new Set(((insertedRows as { recipient_profile_id: string }[] | null) ?? []).map((r) => r.recipient_profile_id));

  // Later events that day: same row, new text, no push. Grouped so a shared
  // text is one UPDATE.
  const updated: string[] = [];
  if (updateExisting) {
    const groups = new Map<string, { patch: { title: string; body: string; url: string }; ids: string[] }>();
    for (const row of rows) {
      if (inserted.has(row.recipient_profile_id)) continue;
      const patch = { title: row.title, body: row.body, url: row.url };
      const key = JSON.stringify(patch);
      const group = groups.get(key) ?? { patch, ids: [] };
      group.ids.push(row.recipient_profile_id);
      groups.set(key, group);
    }
    await Promise.all(
      Array.from(groups.values()).map(async ({ patch, ids }) => {
        const { error: updateError } = await admin
          .from("app_notifications")
          .update(patch)
          .eq("source_type", sourceType)
          .eq("source_id", sourceId)
          .in("recipient_profile_id", ids);
        if (updateError) {
          console.error("[sub-field-notify] could not update notices", { sourceType, sourceId, error: updateError.message });
        } else {
          updated.push(...ids);
        }
      }),
    );
  }

  let pushed = 0;
  if (push) {
    const results = await Promise.allSettled(
      rows
        .filter((row) => inserted.has(row.recipient_profile_id))
        .map((row) =>
          sendPushToUser(admin, row.recipient_profile_id, {
            title: row.title,
            body: clampText(row.body, 120),
            url: row.url,
            tag: `${sourceType}-${sourceId}`,
          }),
        ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") pushed += r.value;
      else {
        console.error("[sub-field-notify] push failed", {
          sourceType,
          sourceId,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }

  return { sourceId, inserted: Array.from(inserted), updated, pushed, testMode };
}

// ─────────────────────────────── Shared lookups

type SubRow = { company_name: string; contact_name: string | null };
type ProjectRow = { name: string; assigned_pm: string | null };

async function loadSubAndProject(admin: Admin, subId: string, projectId: string | null) {
  const [subRes, projectRes] = await Promise.all([
    admin.from("subcontractors").select("company_name, contact_name").eq("id", subId).maybeSingle(),
    projectId
      ? admin.from("projects").select("name, assigned_pm").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null as ProjectRow | null }),
  ]);
  return { sub: (subRes.data as SubRow | null) ?? null, project: (projectRes.data as ProjectRow | null) ?? null };
}

/** "MGL Tile Inc (Marcio)" — the company, plus the contact's first name when it isn't already in it. */
export function subDisplayName(sub: { company_name: string; contact_name: string | null } | null): string {
  if (!sub) return "A sub";
  const first = (sub.contact_name ?? "").trim().split(/\s+/)[0] ?? "";
  return first && !sub.company_name.toLowerCase().includes(first.toLowerCase())
    ? `${sub.company_name} (${first})`
    : sub.company_name;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ─────────────────────────────── Field activity

/** What just happened on site. */
export type SubFieldEvent = "arrived" | "posted" | "clocked_in";

export interface NotifySubFieldInput {
  subId: string;
  projectId: string;
  event: SubFieldEvent;
  /**
   * Today's counts. Read from sub_site_visits when omitted, so call this
   * AFTER sub_record_visit and the body is always the running total.
   */
  counts?: { scans?: number; posts?: number; photos?: number; firstSeenAt?: string | null; lastSeenAt?: string | null };
  /** Is he on a phase covering today on this job? Looked up when omitted. */
  onSchedule?: boolean;
  /** For tests: the moment to treat as now. */
  now?: Date;
}

/**
 * First check-in or post by a sub at a job that day → the job PM and Jorge
 * get one in-app row, pushed once. Every later scan, post or clock-in that
 * day rewrites the same row ("· 3 posts · 14 photos") without a push. If he
 * isn't on a phase there today, the title asks the office to assign him.
 *
 * Known and accepted: two events a moment apart (a post and its photos) each
 * read the counts and then write, so the text can briefly show the older
 * total. The next event corrects it, the visit row itself is always right,
 * and the push decision doesn't depend on the counts.
 */
export async function notifySubField(input: NotifySubFieldInput): Promise<SubNoticeResult | null> {
  try {
    const admin = createAdminClient();
    const { subId, projectId, event } = input;
    const day = todayET(input.now);

    const [{ sub, project }, visitRes, phasesRes] = await Promise.all([
      loadSubAndProject(admin, subId, projectId),
      input.counts
        ? Promise.resolve({ data: null })
        : admin
            .from("sub_site_visits")
            .select("first_seen_at, last_seen_at, first_source, scans, posts, photos")
            .eq("project_id", projectId)
            .eq("subcontractor_id", subId)
            .eq("visit_date", day)
            .is("worker_id", null)
            .maybeSingle(),
      input.onSchedule !== undefined
        ? Promise.resolve({ data: null })
        : admin
            .from("schedule_phases")
            .select("start_date, end_date")
            .eq("project_id", projectId)
            .contains("assigned_sub_ids", [subId])
            .lte("start_date", day)
            .or(`end_date.gte.${day},end_date.is.null`),
    ]);

    const visit = visitRes.data as {
      first_seen_at: string | null;
      last_seen_at: string | null;
      first_source: string | null;
      scans: number;
      posts: number;
      photos: number;
    } | null;
    const counts = {
      posts: input.counts?.posts ?? visit?.posts ?? 0,
      photos: input.counts?.photos ?? visit?.photos ?? 0,
      firstSeenAt: input.counts?.firstSeenAt ?? visit?.first_seen_at ?? null,
      lastSeenAt: input.counts?.lastSeenAt ?? visit?.last_seen_at ?? null,
    };
    const onSchedule =
      input.onSchedule ??
      ((phasesRes.data as { start_date: string | null; end_date: string | null }[] | null) ?? []).some((p) =>
        coversDay(p.start_date, p.end_date, day),
      );

    const who = subDisplayName(sub);
    const where = project?.name ?? "a job";
    const title = onSchedule ? `${who} at ${where}` : `${who} at ${where}, not on the schedule: assign?`;

    // How the day started, then the running totals.
    const firstHow = (visit?.first_source ?? (event === "arrived" ? "qr" : event === "clocked_in" ? "clock" : "post")) as string;
    const firstWord = firstHow === "qr" ? "Checked in" : firstHow === "clock" ? "Clocked in" : firstHow === "office" ? "Marked on site" : "First post";
    const firstAt = counts.firstSeenAt ? etTimeLabel(counts.firstSeenAt) : "";
    const lastAt = counts.lastSeenAt ? etTimeLabel(counts.lastSeenAt) : "";
    const parts = [
      firstAt ? `${firstWord} ${firstAt}` : firstWord,
      counts.posts > 0 ? plural(counts.posts, "post") : "no posts yet",
      counts.photos > 0 ? plural(counts.photos, "photo") : null,
      lastAt && lastAt !== firstAt ? `last seen ${lastAt}` : null,
    ].filter(Boolean);
    const body = parts.join(" · ");

    const { recipients, carrierId } = await resolveSubNoticeRecipients(admin, {
      projectId,
      audience: ["pm", "jorge"],
      pmId: project ? project.assigned_pm : undefined,
    });
    return await writeSubNotices(admin, {
      sourceType: "sub_field",
      sourceId: subFieldSourceId(subId, projectId, day),
      kind: "post",
      deliveries: recipients.map((profile) => ({ profile, title, body })),
      url: `/projects/${projectId}`,
      carrierId,
    });
  } catch (err) {
    console.error("[sub-field-notify] notifySubField failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** The chips that alert the office right away, plus a failed inspection. */
export type SubExceptionKind = "problem" | "waiting" | "finished" | "inspection_failed";

const EXCEPTION_LABEL: Record<SubExceptionKind, string> = {
  problem: "Problem found",
  waiting: "Waiting on something",
  finished: "Finished here",
  inspection_failed: "Inspection failed",
};

export interface NotifySubExceptionInput {
  subId: string;
  projectId: string;
  /** The daily_logs post that carried the chip (inspection changes write a post too). */
  logId: string;
  kind: SubExceptionKind;
  /** What he wrote. Empty is fine. */
  text?: string | null;
  /** For inspection_failed: "Electrical rough". */
  inspectionName?: string | null;
}

/**
 * "Problem found" / "Waiting on something" / "Finished here", or a failed
 * inspection → the job PM and Jorge, in-app + push, every time (one notice
 * per chip per post; a retried post updates it instead of pinging twice).
 */
export async function notifySubException(input: NotifySubExceptionInput): Promise<SubNoticeResult | null> {
  try {
    const admin = createAdminClient();
    const { subId, projectId, logId, kind } = input;
    const { sub, project } = await loadSubAndProject(admin, subId, projectId);

    const label =
      kind === "inspection_failed" && input.inspectionName?.trim()
        ? `${EXCEPTION_LABEL[kind]}: ${input.inspectionName.trim()}`
        : EXCEPTION_LABEL[kind];
    const title = `${label} · ${subDisplayName(sub)} at ${project?.name ?? "a job"}`;
    const body = input.text?.trim() || "No note added.";

    const { recipients, carrierId } = await resolveSubNoticeRecipients(admin, {
      projectId,
      audience: ["pm", "jorge"],
      pmId: project ? project.assigned_pm : undefined,
    });
    return await writeSubNotices(admin, {
      sourceType: "sub_field",
      sourceId: subExceptionSourceId(kind, logId),
      kind: "post",
      deliveries: recipients.map((profile) => ({ profile, title, body })),
      url: `/projects/${projectId}`,
      carrierId,
    });
  } catch (err) {
    console.error("[sub-field-notify] notifySubException failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─────────────────────────────── Bills

export interface NotifySubInvoiceInput {
  /** sub_bill_submissions.id — one notice per submission. */
  submissionId: string;
  subId: string;
  projectId: string | null;
  /** The field-captures path; the link resumes it in the Command Center bill flow. */
  storagePath: string;
  /** Who it was filed to. Defaults to app_settings sub_bill_reviewer_profile_id, then the job PM. */
  reviewerProfileId?: string | null;
  /** What the sub confirmed ("We read: INV0325 · $600.00 · Pedersen. Right?"). */
  invoiceNumber?: string | null;
  amount?: number | null;
}

/**
 * A sub sent an invoice from the portal → the bill reviewer (Nicole), in-app
 * + push, with a link that opens it in the existing Command Center bill
 * workflow (`?billUpload=`). Nothing here files or pays anything.
 */
export async function notifySubInvoice(input: NotifySubInvoiceInput): Promise<SubNoticeResult | null> {
  try {
    const admin = createAdminClient();
    const { sub, project } = await loadSubAndProject(admin, input.subId, input.projectId);
    const company = sub?.company_name ?? "A sub";
    const money = formatMoney(input.amount, { cents: "always", empty: "amount not read" });
    const number = input.invoiceNumber?.trim() ? `invoice ${input.invoiceNumber.trim()}` : "an invoice with no number";
    const onJob = project?.name ? ` - ${project.name}` : "";

    const title = `Sub invoice to file: ${company} ${money}${onJob}`;
    const body = `${subDisplayName(sub)} sent ${number} for ${money}${project?.name ? ` on ${project.name}` : ""} from the sub portal. Open it to file it through the bill flow.`;

    const { recipients, carrierId } = await resolveSubNoticeRecipients(admin, {
      projectId: input.projectId,
      audience: ["bill_reviewer"],
      reviewerProfileId: input.reviewerProfileId ?? null,
      pmId: project ? project.assigned_pm : undefined,
    });
    return await writeSubNotices(admin, {
      sourceType: "sub_invoice",
      sourceId: input.submissionId,
      kind: "invoice",
      deliveries: recipients.map((profile) => ({ profile, title, body })),
      url: `/command-center?billUpload=${encodeURIComponent(input.storagePath)}`,
      carrierId,
    });
  } catch (err) {
    console.error("[sub-field-notify] notifySubInvoice failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─────────────────────────────── Agreements

export interface NotifySubAgreementSignedInput {
  /** sub_agreements.id — one notice per agreement. */
  agreementId: string;
  subId: string;
  projectId: string | null;
  /** "WO-046-01". */
  number: string;
  kind?: "master" | "work_order" | "change_order";
  /** The name he typed. */
  signedName: string;
  /** markSubAgreementSignedOnPaper. */
  onPaper?: boolean;
}

const AGREEMENT_WORD: Record<NonNullable<NotifySubAgreementSignedInput["kind"]>, string> = {
  master: "master subcontract agreement",
  work_order: "work order",
  change_order: "sub change order",
};

/** A sub signed (or a paper copy was filed) → Ryan, Jorge, the job PM and Nicole, in-app + push. */
export async function notifySubAgreementSigned(input: NotifySubAgreementSignedInput): Promise<SubNoticeResult | null> {
  try {
    const admin = createAdminClient();
    const { sub, project } = await loadSubAndProject(admin, input.subId, input.projectId);
    const company = sub?.company_name ?? "A sub";
    const what = input.kind ? `${AGREEMENT_WORD[input.kind]} ${input.number}` : input.number;
    const forJob = project?.name ? ` for ${project.name}` : "";

    const title = input.onPaper ? `${input.number} signed on paper: ${company}` : `${company} signed ${input.number}`;
    const body = input.onPaper
      ? `The paper copy of ${what}${forJob} was filed. It is signed and locked.`
      : `${input.signedName} signed ${what}${forJob} in the sub portal. It is signed and locked.`;

    const { recipients, carrierId } = await resolveSubNoticeRecipients(admin, {
      projectId: input.projectId,
      audience: ["ryan", "jorge", "pm", "nicole"],
      pmId: project ? project.assigned_pm : undefined,
    });
    return await writeSubNotices(admin, {
      sourceType: "sub_agreement",
      sourceId: input.agreementId,
      kind: "post",
      deliveries: recipients.map((profile) => ({ profile, title, body })),
      url: input.projectId ? `/projects/${input.projectId}` : "/subcontractors/agreements",
      carrierId,
    });
  } catch (err) {
    console.error("[sub-field-notify] notifySubAgreementSigned failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─────────────────────────────── Digest

export interface SubDigestDelivery {
  profileId: string;
  title: string;
  body: string;
  url?: string;
}

/**
 * The 5:30 PM "Subs today" digest: one in-app row per recipient per ET day,
 * pushed on insert. Each recipient gets their own text (Jorge sees every
 * job; a PM sees theirs). A second cron run that day rewrites the text and
 * pushes nobody. The digest builder (W6) decides who gets what.
 */
export async function notifySubDigest({
  day,
  deliveries,
  url = "/board",
}: {
  /** The ET day, "YYYY-MM-DD". */
  day: string;
  deliveries: SubDigestDelivery[];
  url?: string;
}): Promise<SubNoticeResult | null> {
  try {
    const admin = createAdminClient();
    const ids = Array.from(new Set(deliveries.map((d) => d.profileId)));
    const [{ data: profiles }, { carrierId }] = await Promise.all([
      ids.length
        ? admin.from("profiles").select("id, email, full_name").in("id", ids)
        : Promise.resolve({ data: [] as RecipientProfile[] }),
      resolveSubNoticeRecipients(admin, { projectId: null, audience: ["jorge"] }),
    ]);
    const byId = new Map(((profiles as RecipientProfile[] | null) ?? []).map((p) => [p.id, p]));
    return await writeSubNotices(admin, {
      sourceType: "sub_digest",
      sourceId: subDigestSourceId(day),
      kind: "post",
      deliveries: deliveries
        .filter((d) => byId.has(d.profileId))
        .map((d) => ({ profile: byId.get(d.profileId)!, title: d.title, body: d.body, url: d.url })),
      url,
      carrierId,
    });
  } catch (err) {
    console.error("[sub-field-notify] notifySubDigest failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}
