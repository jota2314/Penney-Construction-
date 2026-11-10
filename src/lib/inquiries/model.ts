import { addDays, etDate, etStartOfDay, todayET, weekdayOf } from "@/lib/sub-portal/et-day";

/** Pipeline order. Lead, Estimating, Proposal sent and Won also move on their own (advance_website_inquiries). */
export const INTAKE_STATUSES = ["new", "contacted", "lead", "walkthrough", "qualified", "estimating", "proposal_sent", "won", "closed", "spam"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];
export const INTAKE_LABELS: Record<IntakeStatus, string> = {
  new: "New", contacted: "Contacted", lead: "Lead", walkthrough: "Walkthrough booked",
  qualified: "Qualified", estimating: "Estimating", proposal_sent: "Proposal sent", won: "Won",
  closed: "Closed", spam: "Spam",
};
/** Past the office's follow-up: the Todo is done and there is no next follow-up date. */
export const HANDED_OFF_STATUSES: readonly IntakeStatus[] = ["qualified", "estimating", "proposal_sent", "won", "closed", "spam"];
export function isHandedOffStatus(status: string): boolean {
  return (HANDED_OFF_STATUSES as readonly string[]).includes(status);
}
export type InquiryProject = { id: string; project_number: string | null; name: string | null; status: string | null };
/** Jorge's two sign-ins, Ryan, Nicole (Nico), and Shannon only. */
export const WEBSITE_INQUIRY_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
  "jorgebetancurfx@gmail.com",
  "rpenney@penneyconstructioninc.com",
  "nsmith@penneyconstructioninc.com",
  "spenney@penneyconstructioninc.com",
];
export function canManageWebsiteInquiries(email: string | null | undefined): boolean {
  return !!email && WEBSITE_INQUIRY_EMAILS.includes(email.trim().toLowerCase());
}
export type Inquiry = {
  id: string; contact_name: string; description: string; created_at: string; updated_at: string;
  assignee: string | null; due_date: string | null; status: string; snooze_until: string | null;
  intake_status: IntakeStatus | null; lead_id: string | null;
  website_inquiry: Record<string, unknown> | null;
  project_id?: string | null; project?: InquiryProject | InquiryProject[] | null;
};
/** The project this inquiry turned into, when one is linked. */
export function inquiryProject(row: Pick<Inquiry, "project">): InquiryProject | null {
  return (Array.isArray(row.project) ? row.project[0] : row.project) ?? null;
}
export type InquirySummary = { open: number; new: number; overdue: number; unavailable?: boolean };
export type MatchingInquiryLead = { id: string; first_name: string; last_name: string; city: string | null; project_type: string | null; status: string };
export type InquiryState = Pick<Inquiry, "intake_status" | "status" | "due_date" | "snooze_until">;
export function intakeStatus(row: Pick<Inquiry, "intake_status" | "status">): IntakeStatus {
  return row.intake_status || (row.status === "done" ? "closed" : "new");
}
/** Waiting on the office: not handed off, and its follow-up Todo is not ticked off. */
export function isPendingInquiry(row: Pick<Inquiry, "intake_status" | "status">): boolean {
  return !isHandedOffStatus(intakeStatus(row)) && row.status !== "done";
}
/** The page's left-to-right workflow. Closed and Spam sit off the line. */
export const WORKFLOW_STEPS = ["new", "contacted", "lead", "walkthrough", "estimating", "proposal_sent", "won"] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];
/** Where a stage sits on the workflow, or -1 for Closed and Spam. Qualified shares the Walkthrough step. */
export function workflowStepOf(status: IntakeStatus): number {
  return status === "qualified" ? WORKFLOW_STEPS.indexOf("walkthrough") : (WORKFLOW_STEPS as readonly string[]).indexOf(status);
}
export function isInWorkflow(row: Pick<Inquiry, "intake_status" | "status">): boolean {
  return workflowStepOf(intakeStatus(row)) >= 0;
}
export function isOverdueInquiry(row: InquiryState, now = Date.now()): boolean {
  return isPendingInquiry(row) && !!row.due_date && Date.parse(row.due_date) < now &&
    !(row.status === "snoozed" && row.snooze_until && Date.parse(row.snooze_until) > now);
}
export function summarizeInquiries(rows: InquiryState[], now = Date.now()): InquirySummary {
  return {
    open: rows.filter(isPendingInquiry).length,
    new: rows.filter((row) => intakeStatus(row) === "new").length,
    overdue: rows.filter((row) => isOverdueInquiry(row, now)).length,
  };
}
export function inquiryText(row: Inquiry, key: string): string {
  const value = row.website_inquiry?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  // Preserve visibility of inquiries received before structured capture existed.
  const labels: Record<string, string> = { name: "Name", email: "Email", phone: "Phone", timeline: "Timeline", config: "Configurator", page: "Sent from" };
  if (labels[key]) {
    const line = row.description.split("\n").find((text) => text.startsWith(`${labels[key]}:`));
    if (line) return line.slice(labels[key].length + 1).trim();
  }
  if (key === "name") return row.contact_name;
  const heading = row.description.match(/^WEBSITE INQUIRY\s*[—–-]\s*(.+?) in (.+)$/m);
  if (key === "projectType") return heading?.[1]?.toLowerCase() || "";
  if (key === "town") return heading?.[2] || "";
  return "";
}
export function inquiryDateLabel(value: string | null): string {
  if (!value) return "Not set";
  return new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
}
export function inquiryAge(createdAt: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 3_600_000));
  return hours < 1 ? "Under an hour" : hours < 24 ? `${hours}h old` : `${Math.floor(hours / 24)}d old`;
}
export function inquiryDueDay(value: string | null): string { return value ? etDate(value) || "" : ""; }
/** The next weekday in Eastern time: the follow-up date a quick stage change uses when none is set. */
export function nextFollowUpDay(now: number = Date.now()): string {
  let day = addDays(todayET(new Date(now)), 1);
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) day = addDays(day, 1);
  return day;
}
/** The office picks an ET calendar day; deadlines are always 5 PM ET, including DST transitions. */
export function inquiryDueIso(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  return new Date(etStartOfDay(addDays(day, 1)).getTime() - 7 * 3_600_000).toISOString();
}
