/**
 * The contract between the sub-portal API and the sub-portal UI (v3).
 *
 * W1's loader (load-sub-portal-data.ts) builds these; W3a/W3b render them;
 * W4, W7 and W9 fill their parts. Types only — no runtime code — so both a
 * route and a "use client" component can import it.
 *
 * Rules every field follows:
 *  - Everything is already scoped to the signed-in sub by the server: his
 *    company's posts, his phases, his own bills and quotes. Never another
 *    sub's numbers, never client pricing, markup or allowances.
 *  - Money is a number in dollars, rounded to the cent (roundCents). The UI
 *    always prints cents (fmtMoney). null means "not known", never 0.
 *  - A calendar day is "YYYY-MM-DD" in America/New_York (et-day.ts). A moment
 *    is an ISO timestamp string.
 *  - Signed URLs are ready to open; the UI never builds storage paths.
 *  - No crew notes: schedule `notes` and inspection office notes stay out
 *    (they leaked crew details into sub emails).
 */

// Type-only, so this file still has no runtime code. statuses.ts owns these
// unions; they're re-exported so the UI needs one import.
import type { SubAgreementStatus, SubQuoteStage, SubTemplateStatus, SubVisitSource } from "./statuses";
export type { SubAgreementStatus, SubQuoteStage, SubTemplateStatus, SubVisitSource };

/** "YYYY-MM-DD", an America/New_York calendar day. */
export type DayString = string;
/** An ISO 8601 timestamp, e.g. "2026-10-16T11:12:00.000Z". */
export type Timestamp = string;

/** Who the loader is building for: the sub himself, or office staff in the read-only preview. */
export type SubPortalMode = "sub" | "preview";

// ───────────────────────────────────────── identity, flags, visits

/** The signed-in company (R1: every login is the company owner). */
export interface SubIdentity {
  /** subcontractors.id */
  sub_id: string;
  /** sub_portal_access.id; null in a preview of a sub who has no access row. */
  access_id: string | null;
  company_name: string;
  contact_name: string | null;
  /** First word of contact_name, for "Hi Marcio" lines. */
  first_name: string | null;
  /** Directory trades, lowercased ("tile", "demolition"). */
  trades: string[];
  /** R1 always "owner". R2 workers see no money and can't sign. */
  role: "owner" | "worker";
}

/** Switches the UI reads instead of guessing. */
export interface SubPortalFlags {
  /** Money tab + money fields present (company login only). */
  show_money: boolean;
  /** "Send an invoice" is live (W7). On unless NEXT_PUBLIC_SUB_BILLS is 0/false/off (flags.ts). */
  bills_enabled: boolean;
  /** Agreement rows and signing are live (W9). On unless NEXT_PUBLIC_SUB_AGREEMENTS is 0/false/off (flags.ts). */
  agreements_enabled: boolean;
  /** app_settings.sub_portal_loom_url; null when blank (hide "Watch how"). */
  loom_url: string | null;
  /** "978-621-4387" — the Call office button. */
  office_phone: string;
}

/** One sub_site_visits row: he was at this job on this ET day. Presence, not payroll. */
export interface SubVisitSummary {
  id: string;
  project_id: string;
  project_name: string;
  visit_date: DayString;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  first_source: SubVisitSource;
  scans: number;
  posts: number;
  photos: number;
}

/**
 * His open shift: the daily_logs row with kind 'shift' and status
 * 'in_progress', on any job. One at a time (the clock route refuses a second).
 * The optional "Time clock" row and the clock-out sheet read this; it replaces
 * the `clock` the old GET /api/sub-portal/logs returned.
 */
export interface SubClockState {
  /** daily_logs.id. The clock-out post and its photos land on this row. */
  log_id: string;
  project_id: string;
  project_name: string;
  started_at: Timestamp;
}

// ───────────────────────────────────────── Today: jobs

/** Which Today section a job sits in. */
export type SubJobBucket = "today" | "this_week" | "other";

/** The next (or current) phase of his on a job, for the one-line summary and sorting. */
export interface SubJobPhaseRef {
  id: string;
  name: string;
  start_date: DayString | null;
  end_date: DayString | null;
  /** Exact dates (office confirmed) vs "Week of" (penciled in). */
  firm: boolean;
}

/** One 60px row in "Your jobs". Tap opens the job screen (GET /api/sub-portal/job/[id]). */
export interface SubJobRow {
  project_id: string;
  name: string;
  project_number: string;
  /** City only ("Peabody"); null when unknown. */
  town: string | null;
  /** One-line street address, "12 Elm St, Peabody, MA". */
  address: string;
  /** projects.status (one of SUB_LIVE_STATUSES). */
  status: string;
  bucket: SubJobBucket;
  /** The line under the name: "Demo · Mon–Tue (penciled in)" or "Last post Thu". */
  summary: string;
  /** His phase covering today, else his next one; null when none in the window. */
  phase: SubJobPhaseRef | null;
  /** Newest visit or post of his on this job. Sorts "Other open jobs". */
  last_activity_at: Timestamp | null;
  /** He scanned the sign here today (a post or clock-in alone doesn't count). */
  here_now: boolean;
}

/** "Your jobs" in its three sections, each already sorted. */
export interface SubJobGroups {
  today: SubJobRow[];
  this_week: SubJobRow[];
  other: SubJobRow[];
}

// ───────────────────────────────────────── Today: needed from you

/** Fields every Needed row has. One 60px row, one button. */
export interface SubNeededBase {
  /** Stable React key: "{kind}:{record id}". */
  key: string;
  /** "Confirm your dates · Pedersen". */
  title: string;
  /** Second line; null when the title says it all. */
  detail: string | null;
  /** The button text: "Answer", "Review & sign", "Fix & resend", "Add photos". */
  action_label: string;
  project_id: string | null;
  project_name: string | null;
}

/** A confirmed phase waiting for his answer. The button opens Dates (#dates). */
export interface SubNeededAnswerDates extends SubNeededBase {
  kind: "answer_dates";
  phase_id: string;
  start_date: DayString | null;
  end_date: DayString | null;
}

/** A sent work order / MSA waiting for his signature. Only when flags.agreements_enabled. */
export interface SubNeededSignAgreement extends SubNeededBase {
  kind: "sign_agreement";
  agreement_id: string;
  /** "WO-046-01". */
  number: string;
}

/** An invoice Penney sent back, with the reason. Only when flags.bills_enabled. */
export interface SubNeededBillReturned extends SubNeededBase {
  kind: "bill_returned";
  submission_id: string;
  reason: string | null;
}

/** After 3 PM ET: he checked in at a job today and posted nothing there. Opens the composer. */
export interface SubNeededAddPhotos extends SubNeededBase {
  kind: "add_photos";
  visit_id: string;
}

/**
 * Everything that can sit in "Needed from you". Switch on `kind`.
 * There is deliberately no "price needed" row in R1: the last bid invite went
 * out in April, and subs send prices by email (the portal quote upload was
 * used once). His quotes and bids still show, read-only, on the job screen
 * (SubJobPayload.quotes) for jobs on his list.
 */
export type SubNeededItem =
  | SubNeededAnswerDates
  | SubNeededSignAgreement
  | SubNeededBillReturned
  | SubNeededAddPhotos;

export type SubNeededKind = SubNeededItem["kind"];

// ───────────────────────────────────────── Dates

/** Dates tab sections. Past work is folded. */
export type SubDateBucket = "past" | "this_week" | "next_week" | "later" | "unscheduled";

/** schedule_phases.status (the live enum schedule_phase_status). */
export type SubPhaseStatus = "not_started" | "in_progress" | "completed" | "on_hold";

/** One of his phases (or an inspection milestone on his jobs) on the timeline. */
export interface SubDatePhase {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  /** Client-safe phase description; never the internal notes. */
  description: string | null;
  start_date: DayString | null;
  end_date: DayString | null;
  status: SubPhaseStatus;
  /** "work", "inspection", …; inspections draw as a diamond. */
  event_type: string | null;
  /** The office confirmed it (the "you're scheduled" email went out). */
  is_confirmed: boolean;
  /** Show exact dates; false = "Week of" / "Penciled in · Penney will confirm". */
  firm: boolean;
  /** His answer, if any. */
  sub_response: "confirmed" | "declined" | null;
  sub_responded_at: Timestamp | null;
  /** His own words with the answer ("Can't make it, can do Thursday"). Safe to show him. */
  sub_response_note: string | null;
  /** He added these dates himself ("Add my dates"). */
  mine: boolean;
  /** Confirm / Can't make it buttons show: is_confirmed && !sub_response && !mine. */
  needs_answer: boolean;
  bucket: SubDateBucket;
}

/** The Dates tab. */
export interface SubDatesPayload {
  /** Sorted by start date (unscheduled last). */
  phases: SubDatePhase[];
  /** The Dates tab badge: phases with needs_answer. */
  answers_needed: number;
  /** Jobs he can "Add my dates" on (his live jobs). */
  can_propose_on: { project_id: string; name: string }[];
}

// ───────────────────────────────────────── Money

/** How a job's agreed amount was found (plan §2.3 Job info). */
export type SubAgreedBasis =
  /** project_subcontractors.contract_amount locked by a signed work order. */
  | "work_order"
  /** project_subcontractors.contract_amount > 0, not locked. */
  | "contract"
  /** Σ estimate_line_items.awarded_cost of his lines. */
  | "awarded_lines"
  /** Σ accepted/approved quotes — shown as "Quoted $X.XX". */
  | "quoted"
  /** Nothing on record. */
  | "none";

/** What he and Penney agreed on one job. */
export interface SubAgreedAmount {
  /** Dollars to the cent; null when basis is "none". */
  amount: number | null;
  basis: SubAgreedBasis;
  /** The signed work order number when basis is "work_order". */
  agreement_number: string | null;
  /** For T&M work orders: amount is the not-to-exceed. */
  is_not_to_exceed: boolean;
}

/**
 * Invoice row states: With Penney / Owed / Paid Oct 15 / Sent back: {reason}.
 * The FIRST that applies wins, in this order:
 *  1. sent_back: an unfiled submission Penney returned (status 'returned').
 *  2. paid: open ≤ 0, or every bill in the group has payment_status 'paid'.
 *     This beats needs_review: live has paid bills still marked needs_review,
 *     and those are Paid, not "With Penney".
 *  3. with_penney: an unfiled submission, or any bill in the group still
 *     review_status 'needs_review'.
 *  4. owed: reviewed and open > 0.
 */
export type SubInvoiceStatus = "with_penney" | "owed" | "paid" | "sent_back";

/** One job's share of an invoice (a bill split across jobs or lines is several invoices rows). */
export interface SubInvoiceAllocation {
  /** invoices.id */
  bill_id: string;
  project_id: string | null;
  project_name: string | null;
  description: string | null;
  amount: number;
  paid: number;
  open: number;
}

/** One invoice as he sent it, grouped by invoice number, splits underneath. */
export interface SubInvoiceGroup {
  /** Invoice number, or "bill:{id}" / "submission:{id}" when there is none. */
  key: string;
  /** null → the UI prints "No invoice #". */
  invoice_number: string | null;
  /** Invoice date, or the received day for a portal submission. */
  date: DayString | null;
  amount: number;
  paid: number;
  open: number;
  status: SubInvoiceStatus;
  /** Latest paid date when status is "paid". */
  paid_date: DayString | null;
  /** When status is "sent_back". */
  returned_reason: string | null;
  /** "bill" = an invoices row (filed); "submission" = sent from the portal, not filed yet. */
  source: "bill" | "submission";
  /** Empty for an unfiled submission. */
  allocations: SubInvoiceAllocation[];
}

/** The Money summary card. */
export interface SubMoneySummary {
  /** "Your work on open jobs": Σ agreed over his live jobs. */
  agreed_open_jobs: number;
  /** Paid to him this calendar year (ET). */
  paid_this_year: number;
  /** Owed to you: Σ (amount − paid) over bills with review_status <> 'needs_review'. */
  owed: number;
  /** "Sent, waiting for Penney": invoice groups whose status is with_penney (a count, kept apart from owed). */
  waiting_count: number;
}

/** One row of "By job": agreed · billed · paid · open. Tap opens that job's Job info. */
export interface SubMoneyByJob {
  project_id: string;
  project_name: string;
  agreed: SubAgreedAmount;
  billed: number;
  paid: number;
  /** Σ (amount − paid) over bills with review_status <> 'needs_review' (same rule as Owed to you). */
  open: number;
}

/** The Money tab. Absent (null) when flags.show_money is false. */
export interface SubMoneyPayload {
  summary: SubMoneySummary;
  /** Newest first. The UI filters Open (status owed / with_penney / sent_back) vs All. */
  invoices: SubInvoiceGroup[];
  by_job: SubMoneyByJob[];
  /** His portal submissions from the last 90 days (feeds Needed and the send sheet). */
  submissions: SubBillSubmissionSummary[];
}

// ───────────────────────────────────────── preview banner

/** sub_portal_access.invite_channel. */
export type SubInviteChannel = "text" | "email" | "copy" | "qr";

/** Staff preview only: what the maroon banner says about this sub's login. */
export interface SubPreviewMeta {
  /** "MGL Tile Inc". */
  sub_name: string;
  /** An access row exists. */
  has_access: boolean;
  /** The access row is enabled. */
  portal_on: boolean;
  /** A PIN is set (pin_hash present). Never the hash itself. */
  pin_set: boolean;
  /** sub_portal_access.link_sent_at. */
  invited_at: Timestamp | null;
  invite_channel: SubInviteChannel | null;
  /** Last GET by the sub himself (office previews never bump it after the v3 fix). */
  last_real_visit_at: Timestamp | null;
  view_count: number;
  /**
   * The banner's free-text line, built by the loader:
   * "Portal on · PIN set · Invited Oct 17 · Last real visit Oct 16 · Nothing you tap here is saved."
   */
  detail: string;
}

// ───────────────────────────────────────── home payload

/** GET /api/sub-portal (and preview-data): the light payload for Today, Dates and Money. */
export interface SubHomePayload {
  mode: SubPortalMode;
  generated_at: Timestamp;
  /** The ET day the server used for every "today" decision. */
  today: DayString;
  sub: SubIdentity;
  flags: SubPortalFlags;
  /** His most recent SCANNED visit today (the Here-now card); null when he hasn't scanned a sign today. */
  here_now: SubVisitSummary | null;
  /** All his visits today (rarely more than one). */
  visits_today: SubVisitSummary[];
  /** His open shift on any job; null when he isn't clocked in. */
  clock: SubClockState | null;
  /** The Today badge is needed.length. */
  needed: SubNeededItem[];
  jobs: SubJobGroups;
  dates: SubDatesPayload;
  /** null when flags.show_money is false. */
  money: SubMoneyPayload | null;
  /** Present only when mode is "preview". */
  preview: SubPreviewMeta | null;
}

// ───────────────────────────────────────── job payload

/** The job's Penney contact (projects.assigned_pm). */
export interface SubJobContact {
  name: string | null;
  first_name: string | null;
  /** Digits or formatted; null when not on file (the UI falls back to the office phone). */
  phone: string | null;
}

/** The job screen header. */
export interface SubJobHeader {
  project_id: string;
  name: string;
  project_number: string;
  address: string;
  town: string | null;
  status: string;
  /** Ready-made maps link for the 44px Directions button; null without an address. */
  directions_url: string | null;
  /** "Your Penney contact: Ryan" + call button; null when the job has no PM. */
  pm: SubJobContact | null;
  /** Today's visit here when he scanned the sign (scans > 0), for the "✓ Checked in 7:12 AM" chip. */
  visit_today: SubVisitSummary | null;
}

/** A photo ready for the swipe viewer (PhotoViewer takes these as-is). */
export interface SubPhoto {
  thumb: string;
  full: string;
  /** The ET day it was posted. */
  date: DayString;
}

/** One of his company's posts on this job. Crew chatter never appears here. */
export interface SubPost {
  /** daily_logs.id (generated on his phone in v3). */
  id: string;
  project_id: string;
  /** daily_logs.started_at. */
  posted_at: Timestamp;
  /** ET day, for "group by day". */
  day: DayString;
  /** "post" = an update; "shift" = a clock in/out record with a note or photos. */
  kind: "post" | "shift";
  text: string | null;
  /** "MGL Tile" in R1; "Luis · MGL Tile" once R2 workers post. */
  author_label: string;
  /** Signed; may be fewer than photo_count while uploads finish. */
  photos: SubPhoto[];
  /** Paths stored on the row, signed or not. */
  photo_count: number;
  /** The office hid this post's photos from the homeowner. */
  client_hidden: boolean;
}

/** His posts on a job, 20 at a time. Thumbnails are signed only for this page. */
export interface SubPostsPage {
  items: SubPost[];
  /** Pass as ?cursor= for the next 20; null at the end. Opaque. */
  next_cursor: string | null;
}

/** Job-screen drawing groups. */
export type SubFileGroup = "drawings" | "specs" | "permits" | "design";

/** One document row (60px, PDF badge, opens in a new tab for the native viewer). */
export interface SubDocument {
  id: string;
  /** Display name (office renames applied). */
  title: string;
  /** "Rev 3" or the category; null when nothing useful. */
  subtitle: string | null;
  date: DayString | null;
  /** Signed URL. */
  url: string;
  mime: string | null;
  group: SubFileGroup;
}

/** A labelled group of documents, already in display order; empty groups are left out. */
export interface SubDocumentGroup {
  key: SubFileGroup;
  /** "Drawings" | "Specs" | "Permits" | "Design & selections". */
  label: string;
  docs: SubDocument[];
}

/** His trade's scope on this job (sub_portal_trade_scope: descriptions only, no prices). */
export interface SubScopeLine {
  trade: string;
  description: string;
  scope: string | null;
}

/**
 * Every inspection on the job, so gaps show as gaps. Book / Passed / Failed /
 * Undo work only when my_trade is true; the rest are read-only.
 */
export interface SubInspection {
  id: string;
  name: string;
  status: "pending" | "passed" | "failed";
  /** project_inspections.scheduled_for — "booked Oct 20". */
  scheduled_for: DayString | null;
  completed_at: Timestamp | null;
  is_final: boolean;
  /** Matches one of his trades; only these get buttons. */
  my_trade: boolean;
}

/** A homeowner selection on the job (client_selections; never allowances). */
export interface SubSelection {
  id: string;
  category: string;
  description: string | null;
  status: string;
  selected_value: string | null;
}

/**
 * One of his quotes (quote_requests) or bids (subcontractor_bids) on this
 * job: his own price, never anyone else's. Read-only in R1.
 */
export interface SubQuote {
  id: string;
  source: "quote" | "bid";
  /** "Tile", or the bid package name. */
  title: string;
  trade: string | null;
  /** His scope text as he sent it (or the package scope for a bid). */
  scope: string | null;
  amount: number | null;
  /** The raw row status, for support. Render `stage`. */
  status: string;
  /** Awarded / Under review / Not selected / Price needed, from subQuoteStage(status). */
  stage: SubQuoteStage;
  /** A quote's received_at (else sent_at); a bid's created_at. */
  date: Timestamp | null;
  /** Signed link to his PDF; null when there's no file. */
  pdf_url: string | null;
}

/** What the composer needs for this job. */
export interface SubComposerContext {
  /** His trades, lowercased, for the chips (work-tags.ts). */
  trades: string[];
  /**
   * His phase covering today on this job, if exactly one. Its trade chip comes
   * first and is pre-picked. `trade` is resolved on the server with the same
   * phase-name → trade keywords the board uses (W2's trade-keywords.ts, so
   * "Demo" → "demolition"), lowercased like `trades`; null when no keyword
   * matches, and then nothing is pre-picked.
   */
  today_phase: { id: string; name: string; trade: string | null } | null;
}

/** GET /api/sub-portal/job/[id]: everything on one job, loaded when he opens it. */
export interface SubJobPayload {
  mode: SubPortalMode;
  generated_at: Timestamp;
  today: DayString;
  job: SubJobHeader;
  /**
   * isSubOnJob: the capture routes (post, clock in, inspections) accept
   * writes here. False on a closed job, or one he only billed: the screen
   * opens read-only (an open shift can still be clocked out).
   */
  can_post: boolean;
  posts: SubPostsPage;
  files: SubDocumentGroup[];
  scope: SubScopeLine[];
  inspections: SubInspection[];
  selections: SubSelection[];
  /** His dates on this job (read-only here; buttons live in Dates). */
  dates: SubDatePhase[];
  agreed: SubAgreedAmount;
  /** His quotes and bids on this job: awarded first, then newest first. Prices are his own. */
  quotes: SubQuote[];
  /** null when flags.show_money is false. */
  billing: { summary: SubMoneyByJob; invoices: SubInvoiceGroup[] } | null;
  /** His agreements on this job (work orders and SCOs; the MSA lives in Papers). */
  agreements: SubAgreementSummary[];
  composer: SubComposerContext;
  /**
   * His open shift on ANY job, so the clock row can say "Clocked in here since
   * 7:12 AM" (clock.project_id === job.project_id) or "You're clocked in at
   * Arnott" (clock out there first). null when he isn't clocked in.
   */
  clock: SubClockState | null;
}

// ───────────────────────────────────────── agreements (W9)

export type SubAgreementKind = "master" | "work_order" | "change_order";
export type SubPriceBasis = "lump_sum" | "unit" | "time_and_material";

/** One agreement as a list row / Needed row. */
export interface SubAgreementSummary {
  id: string;
  /** "MSA-MGL-2026", "WO-046-01", "SCO-046-01-1". */
  number: string;
  kind: SubAgreementKind;
  status: SubAgreementStatus;
  project_id: string | null;
  project_name: string | null;
  /** "Work order · Pedersen demo". */
  title: string;
  /** For an SCO: the work order it changes ("WO-046-01"); null otherwise. */
  parent_number: string | null;
  /** The scope as written on the agreement (Job info shows it under the number). */
  scope_text: string | null;
  price_basis: SubPriceBasis | null;
  /** Lump sum price. */
  price: number | null;
  /** Unit price or T&M rate. */
  unit_rate: number | null;
  /** "sq ft", "hour". */
  unit_label: string | null;
  not_to_exceed: number | null;
  sent_at: Timestamp | null;
  sub_signed_at: Timestamp | null;
  signed_on_paper: boolean;
  /** Why Penney voided it, when status is "void". He reads it, so W9 labels the office's field that way. */
  void_reason: string | null;
  /** He can sign it now: sent/viewed, approved template, owner login, not preview. */
  can_sign: boolean;
  /** GET /api/generate-sub-agreement?id= (DRAFT watermark until the template is approved). */
  pdf_url: string;
}

/** A payment draw on a work order. */
export interface SubAgreementDraw {
  label: string;
  amount: number | null;
  percent: number | null;
  /** "On completion", "After rough inspection". */
  when: string | null;
}

/** One section of approved template text. */
export interface SubAgreementSection {
  title: string;
  body: string;
}

/** The sign sheet: the agreement, the template text he accepts, and both signatures. */
export interface SubAgreementDetail extends SubAgreementSummary {
  exclusions_text: string | null;
  draws: SubAgreementDraw[];
  start_date: DayString | null;
  end_date: DayString | null;
  /** Owner / association requirements flowed down (projects.contract_additional_terms). */
  additional_terms: SubAgreementSection[];
  /** The MSA a work order sits under. */
  master: { id: string; number: string; sub_signed_at: Timestamp | null } | null;
  template: {
    id: string;
    kind: SubAgreementKind;
    version: number;
    title: string;
    status: SubTemplateStatus;
    test_only: boolean;
    sections: SubAgreementSection[];
    acceptance_text: string;
    esign_consent_text: string;
  };
  /** Penney signs first, with the signer's own name and title. */
  penney_signed: { name: string; title: string | null; at: Timestamp } | null;
  sub_signed: { name: string; at: Timestamp; on_paper: boolean } | null;
  /** SHA-256 of the exact PDF shown; the sign request echoes it back. */
  pdf_sha256: string | null;
}

// ───────────────────────────────────────── bills (W7)

/** What the extraction read off his invoice ("We read: INV0325 · $600.00 · Pedersen. Right?"). */
export interface SubBillAiRead {
  invoice_number: string | null;
  amount: number | null;
  invoice_date: DayString | null;
  vendor_name: string | null;
  /** The job the file seems to be for, by name; the sub's pick wins. */
  project_hint: string | null;
}

/** One invoice he sent from the portal (sub_bill_submissions), with "filed" worked out at read. */
export interface SubBillSubmissionSummary {
  id: string;
  project_id: string | null;
  project_name: string | null;
  original_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  /** ET Monday of the week it came in. */
  received_week: DayString;
  created_at: Timestamp;
  /** "filed" = an invoices row has attachment_storage_path = this storage path. */
  status: "sent" | "returned" | "filed";
  ai_read: SubBillAiRead | null;
  /** What he typed when he tapped Fix. */
  sub_stated_number: string | null;
  sub_stated_amount: number | null;
  returned_reason: string | null;
  returned_at: Timestamp | null;
  /** The filed bill, once filed: "Filed · INV0325 · $600.00 · Open". */
  filed: { bill_id: string; invoice_number: string | null; amount: number; paid: number; open: number } | null;
}

// ───────────────────────────────────────── capture seam (W3b composer ↔ W4 routes)

/** The chips that alert the office right away (sub-field-notify notifySubException). */
export type SubExceptionChip = "problem" | "waiting" | "finished";

/**
 * POST /api/sub-portal/logs. The row id is made on the phone so a retry is
 * idempotent: a repeat insert hits the primary key and the server re-selects
 * by id + subcontractor_id instead of posting twice.
 */
export interface SubPostCreateRequest {
  /** crypto.randomUUID() on the phone, kept in the outbox until the row exists. */
  id: string;
  projectId: string;
  /** Chips are written into the text the way the crew composer does. */
  text: string;
  /**
   * The exception chips he tapped, any combination ([] = none). The route
   * calls notifySubException once per chip, so "Problem found" and "Waiting
   * on something" on one post are two pings; a retried post re-sends the
   * same chips and updates those notices instead of pinging again.
   */
  exceptions: SubExceptionChip[];
  /** Photos that will follow through /logs/photo. */
  pendingPhotoCount: number;
  /**
   * When he tapped Post (the outbox entry's createdAt), sent on every try so
   * a late send is dated when he posted. Old shells send none: the server
   * uses now. Clamped server-side (~2 min ahead, 7 days back).
   */
  postedAt?: Timestamp;
  /**
   * The company the phone saved it under (the outbox stamps it). The route
   * answers 409 when the signed-in company is another one.
   */
  subId?: string;
}

/** The answer to SubPostCreateRequest. `created: false` = the row already existed (a retry). */
export type SubPostCreateResponse =
  | { ok: true; logId: string; created: boolean }
  | { ok?: false; error: string };

/**
 * POST /api/sub-portal/clock, the optional time clock (W3b clock row and
 * clock-out sheet → W4 route). One open shift at a time. No location is sent.
 *  - in: opens a shift on the job (writes the visit with source 'clock').
 *    Clocking in again on the same job returns the open shift.
 *  - out: closes the open shift. `logId` is the shift the screen showed
 *    (SubClockState.log_id); the route refuses when it isn't the open one, so
 *    a stale screen can't close the wrong shift. The composer's text and
 *    chips go on the shift row, exceptions notify like a post, and the photos
 *    follow through /logs/photo with that logId. `endedAt` is for "I forgot
 *    to clock out" (after clock-in, not in the future).
 */
export type SubClockRequest =
  | { action: "in"; projectId: string }
  | {
      action: "out";
      logId: string;
      text?: string;
      exceptions?: SubExceptionChip[];
      pendingPhotoCount?: number;
      endedAt?: Timestamp;
      /** The company the phone saved it under; another signed-in company gets 409. */
      subId?: string;
    };

/** The clock answer: the shift's id, its start (in) or its hours (out). */
export type SubClockResponse = SubActionResponse<{ logId: string; started_at?: Timestamp; hours?: number }>;

/**
 * POST /api/sub-portal/schedule, the Dates buttons (W3a → the schedule
 * route). Same shapes the route takes today; this replaced ScheduleAction in
 * the old src/components/sub-portal/types.ts (deleted at cutover).
 */
export type SubScheduleAction =
  /** "Confirm": he'll be there. */
  | { action: "confirm"; phaseId: string; note?: string }
  /** "Can't make it (when can you?)", his note says when. */
  | { action: "decline"; phaseId: string; note?: string }
  /** "Add my dates": his own dates on one of his live jobs. */
  | { action: "propose"; projectId: string; startDate: DayString; endDate: DayString; name: string; crew?: number; note?: string }
  /** Take back dates he added himself. */
  | { action: "cancel"; phaseId: string };

/** confirm/decline answer with `response`; propose with the new `phaseId`; cancel with neither. */
export type SubScheduleResponse = SubActionResponse<{ response?: "confirmed" | "declined"; phaseId?: string }>;

/**
 * POST /api/sub-portal/inspections, the job-log buttons (W3b → W4 route).
 * Book date = scheduledFor; Passed / Failed = status; Undo = status "pending".
 * The route refuses inspections outside his trades (SubInspection.my_trade)
 * and sends a "failed" one to the office as an exception notice.
 */
export interface SubInspectionActionRequest {
  /** project_inspections.id */
  id: string;
  status?: SubInspection["status"];
  scheduledFor?: DayString;
  note?: string;
}

/** `line` is the one-liner the feed post got ("Electrical rough: scheduled for Tue, Oct 20"). */
export type SubInspectionActionResponse = SubActionResponse<{ by: string; line: string }>;

/**
 * POST /api/sub-portal/logs/photo, multipart form fields. The photo lands at
 * `{logId}/{uploadId}.jpg`, so a retry overwrites the same object instead of
 * adding a copy.
 */
export interface SubPhotoUploadFields {
  logId: string;
  /** Made on the phone, one per photo, kept with the queued blob. */
  uploadId: string;
  /** The shrunk JPEG. */
  file: Blob;
}

/** Every portal POST answers in this shape; usePortalAction reads `ok` / `error`. */
export type SubActionResponse<T extends object = object> = ({ ok: true } & T) | { ok?: false; error: string };
