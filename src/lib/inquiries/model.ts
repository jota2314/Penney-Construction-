import { addDays, etDate, etStartOfDay } from "@/lib/sub-portal/et-day";

export const INTAKE_STATUSES = ["new", "contacted", "walkthrough", "qualified", "closed", "spam"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];
export const INTAKE_LABELS: Record<IntakeStatus, string> = {
  new: "New", contacted: "Contacted", walkthrough: "Walkthrough booked",
  qualified: "Qualified", closed: "Closed", spam: "Spam",
};
export function canManageWebsiteInquiries(role: string | null | undefined): boolean {
  return !!role && ["owner", "precon_manager", "office_admin"].includes(role);
}
export type Inquiry = {
  id: string; contact_name: string; description: string; created_at: string; updated_at: string;
  assignee: string | null; due_date: string | null; status: string; snooze_until: string | null;
  intake_status: IntakeStatus | null; lead_id: string | null;
  website_inquiry: Record<string, unknown> | null;
};
export type InquirySummary = { open: number; new: number; overdue: number; unavailable?: boolean };
export type MatchingInquiryLead = { id: string; first_name: string; last_name: string; city: string | null; project_type: string | null; status: string };
export type InquiryState = Pick<Inquiry, "intake_status" | "status" | "due_date" | "snooze_until">;
export function intakeStatus(row: Pick<Inquiry, "intake_status" | "status">): IntakeStatus {
  return row.intake_status || (row.status === "done" ? "closed" : "new");
}
export function isPendingInquiry(row: Pick<Inquiry, "intake_status" | "status">): boolean {
  return !["qualified", "closed", "spam"].includes(intakeStatus(row));
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
/** The office picks an ET calendar day; deadlines are always 5 PM ET, including DST transitions. */
export function inquiryDueIso(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  return new Date(etStartOfDay(addDays(day, 1)).getTime() - 7 * 3_600_000).toISOString();
}
