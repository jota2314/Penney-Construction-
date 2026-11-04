import { inquiryText, type Inquiry } from "@/lib/inquiries/model";

export const WALKTHROUGH_TIME_ZONE = "America/New_York" as const;
export type WalkthroughSlot = { start: string; end: string };
export type WalkthroughRequest = WalkthroughSlot & { timeZone: typeof WALKTHROUGH_TIME_ZONE; address: string };
export type RyanAvailability = {
  connected: boolean;
  timeZone: string;
  durationMinutes: number;
  slots: WalkthroughSlot[];
  busy: WalkthroughSlot[];
  message?: string;
  calendarUrl?: string;
};
export type Booking = {
  id: string;
  inquiry_id: string;
  status: "confirming" | "calendar_created" | "confirmed" | "needs_attention" | "failed" | "cancelling" | "cancelled";
  sender_profile_id: string;
  recipient_email: string;
  sender_email: string;
  subject: string;
  body: string;
  requested_updated_at: string;
  confirmation_source: string | null;
  start_at: string;
  end_at: string;
  address: string;
  calendar_event_id: string | null;
  calendar_event_url: string | null;
  confirmation_email_id: string | null;
  error: string | null;
  created_at: string;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
};
export type InquiryBookingContext = {
  availability: RyanAvailability;
  booking: Booking | null;
  sender: { email: string | null; error?: string };
  calendarWarning?: string;
  calendarVerifiedAt?: string;
};
export type ConfirmInquiryWalkthroughInput = {
  inquiryId: string;
  requestId: string;
  expectedUpdatedAt: string;
  start: string;
  end: string;
  address: string;
  subject: string;
  body: string;
  expectedSender: string;
  expectedRecipient: string;
  homeownerConfirmed?: boolean;
  confirmationSource?: string;
};
export type ConfirmInquiryWalkthroughResult = {
  success: boolean;
  error?: string;
  warning?: string;
  eventUrl?: string;
  booking?: Booking;
};

/** Website payloads are external data; do not render an unchecked date. */
export function readWalkthroughRequest(inquiry: Pick<Inquiry, "website_inquiry">): WalkthroughRequest | null {
  const value = inquiry.website_inquiry?.walkthrough;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.start !== "string" || typeof row.end !== "string" ||
    row.timeZone !== WALKTHROUGH_TIME_ZONE || typeof row.address !== "string" ||
    !row.address.trim() || row.address.length > 500) return null;
  const start = Date.parse(row.start);
  const end = Date.parse(row.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 4 * 3_600_000) return null;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), timeZone: WALKTHROUGH_TIME_ZONE, address: row.address.trim() };
}

export function sameWalkthroughSlot(a: WalkthroughSlot | null, b: WalkthroughSlot | null): boolean {
  return !!a && !!b && Number.isFinite(Date.parse(a.start)) && Number.isFinite(Date.parse(a.end)) &&
    Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
}

export function walkthroughDateLabel(start: string, end?: string): string {
  if (!Number.isFinite(Date.parse(start))) return "Time unavailable";
  const date = new Date(start).toLocaleDateString("en-US", {
    timeZone: WALKTHROUGH_TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const time = (value: string) => new Date(value).toLocaleTimeString("en-US", {
    timeZone: WALKTHROUGH_TIME_ZONE, hour: "numeric", minute: "2-digit",
  });
  return `${date}, ${time(start)}${end && Number.isFinite(Date.parse(end)) ? `–${time(end)}` : ""} Eastern`;
}

export function buildWalkthroughConfirmation(inquiry: Inquiry, slot: WalkthroughSlot, address: string, senderName: string, proposed = false): { subject: string; body: string } {
  const name = inquiryText(inquiry, "name").split(/\s+/)[0] || "there";
  const date = walkthroughDateLabel(slot.start, slot.end);
  return {
    subject: proposed ? "A time for your Penney Construction walkthrough" : "Your walkthrough with Ryan — confirmed",
    body: proposed
      ? `Hi ${name},\n\nWould ${date} work for your walkthrough with Ryan?\n\nProperty: ${address}\n\nPlease reply to let us know. This time is proposed; we’ll send the calendar invitation once you confirm. If it doesn’t work, let us know a couple of other times that would.\n\nThank you,\n${senderName || "Penney Construction"}`
      : `Hi ${name},\n\nYour walkthrough with Ryan is confirmed for ${date}.\n\nProperty: ${address}\n\nA calendar invitation is included separately. We’ll review your project together during the visit. If there are any access details or plans you’d like Ryan to have beforehand, please reply here.\n\nIf you need to reschedule, reply to this email and we’ll coordinate another time.\n\nThank you,\n${senderName || "Penney Construction"}`,
  };
}
