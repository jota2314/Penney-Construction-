// Shapes returned by /api/sub-portal and /api/sub-portal/logs, plus the
// per-job rollup the tabs share. Everything here is already scoped to the
// signed-in sub by the API — no other sub's numbers, no client pricing.

export interface Project {
  id: string;
  name: string;
  project_number: string;
  address: string;
  status: string;
}
export interface Phase {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
  /** Office put it live. False = still tentative, no answer asked. */
  is_confirmed: boolean;
  /** The sub's answer, if any. */
  sub_response: "confirmed" | "declined" | null;
  sub_responded_at: string | null;
  /** The sub created this from his portal. */
  mine: boolean;
}

export type ScheduleAction =
  | { action: "confirm"; phaseId: string; note?: string }
  | { action: "decline"; phaseId: string; note?: string }
  | { action: "propose"; projectId: string; startDate: string; endDate: string; name: string; crew?: number; note?: string }
  | { action: "cancel"; phaseId: string };
export interface Quote {
  id: string;
  project_id: string | null;
  project_name: string | null;
  trade: string | null;
  scope: string | null;
  amount: number | null;
  status: string;
  document_type: string | null;
  received_at: string | null;
  pdf_url: string | null;
}
export interface Bid {
  id: string;
  project_id: string | null;
  package_name: string | null;
  trade: string | null;
  scope: string | null;
  amount: number | null;
  status: string;
  pdf_url: string | null;
}
export interface Awarded {
  id: string;
  project_id: string;
  description: string;
  scope: string | null;
  amount: number | null;
}
export interface PortalFile {
  id: string;
  project_id: string;
  filename: string;
  category: string;
  url: string;
}
export interface Selection {
  id: string;
  project_id: string;
  category: string;
  description: string | null;
  status: string;
  selected_value: string | null;
}
export interface Inspection {
  id: string;
  project_id: string;
  name: string;
  status: string;
  completed_at: string | null;
  is_final: boolean;
  notes: string | null;
}
export interface ScopeLine {
  project_id: string;
  trade: string;
  description: string;
  scope: string | null;
}
export interface BillingRow {
  id: string;
  project_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  description: string | null;
  amount: number;
  paid: number;
  open: number;
  payment_status: string | null;
  paid_date: string | null;
}
export interface PortalData {
  sub: { company_name: string; contact_name: string | null };
  projects: Project[];
  phases: Phase[];
  quotes: Quote[];
  bids: Bid[];
  awarded: Awarded[];
  files: PortalFile[];
  selections: Selection[];
  inspections: Inspection[];
  scope: ScopeLine[];
  billing: BillingRow[];
}

export interface FieldJob {
  id: string;
  name: string;
  project_number: string;
  address: string;
  /** Job pin; null when the address never geocoded. */
  lat: number | null;
  lng: number | null;
}
export interface FieldLog {
  id: string;
  project_id: string;
  project_name: string;
  author_name: string;
  is_mine: boolean;
  /** 'shift' = a clock in/out record, 'post' = an update. */
  kind: string | null;
  /** Length of a completed shift, hours. Null for posts and open shifts. */
  hours: number | null;
  text: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  photo_urls: string[];
  photo_thumb_urls: string[];
}
export interface FieldClock {
  logId: string;
  project_id: string;
  project_name: string;
  address: string;
  started_at: string;
  /** Geofence result at clock-in: true = at the job pin, false = away, null = no fix / no pin. */
  on_site: boolean | null;
  distance_m: number | null;
}
/** One of the sub's own shifts (open or closed) — feeds the hours strip. */
export interface FieldShift {
  id: string;
  project_id: string;
  project_name: string;
  started_at: string;
  ended_at: string | null;
  on_site: boolean | null;
}
export interface FieldData {
  clock: FieldClock | null;
  jobs: FieldJob[];
  logs: FieldLog[];
  /** The sub's shifts from the last two weeks, newest first. */
  shifts: FieldShift[];
  /** Trades on the sub's directory record — picks the "what got done" chips. */
  trades: string[];
}

/** One job, everything the sub has on it, rolled up for the cards. */
export interface JobRollup {
  proj: Project;
  awarded: Awarded[];
  quotes: Quote[];
  bids: Bid[];
  files: PortalFile[];
  selections: Selection[];
  phases: Phase[];
  inspections: Inspection[];
  scope: ScopeLine[];
  billing: { rows: BillingRow[]; billed: number; paid: number; open: number };
  /** Awarded price on this job — awarded lines + accepted/approved quotes + accepted bids. */
  agreed: number;
  /** Quotes/bids with a number that we haven't come back on yet. */
  pendingPrice: number;
  /** Quotes we passed on. */
  declined: number;
  isLive: boolean;
}

export type Tab = "home" | "schedule" | "jobs" | "money" | "field";

/** Quote/bid statuses that count as "you got the job". */
export const AWARDED_STATUSES = ["accepted", "approved"];
/** Job statuses that belong on the live list — building, or signed and coming. */
export const LIVE_STATUSES = ["in_progress", "contracted", "on_hold"];
