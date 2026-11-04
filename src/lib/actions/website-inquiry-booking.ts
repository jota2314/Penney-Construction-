"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageWebsiteInquiries, inquiryText, type Inquiry } from "@/lib/inquiries/model";
import { getRyanAvailability, ensureRyanWalkthroughEvent, findRyanWalkthroughEvent, cancelRyanWalkthroughEvent, CalendarBookingError } from "@/lib/inquiries/calendar";
import { getWebsiteInquiryEmailSender, sendWebsiteInquiryEmail } from "@/lib/actions/website-inquiry-email";
import { todayET, etDate } from "@/lib/sub-portal/et-day";
import type { Booking, InquiryBookingContext, ConfirmInquiryWalkthroughInput, ConfirmInquiryWalkthroughResult } from "@/lib/inquiries/booking-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id,contact_name,description,created_at,updated_at,assignee,due_date,status,snooze_until,intake_status,lead_id,website_inquiry";

async function bookingAccess(id: string, write = false) {
  const user = await getUser();
  if (!user || !canManageWebsiteInquiries(user.email) || !canManageWebsiteInquiries(user.realProfile?.email) ||
    !canManageWebsiteInquiries(user.profile?.email)) throw new Error("Website inquiry access is required.");
  if (write && user.isImpersonating) throw new Error("Exit View as before confirming a walkthrough.");
  if (!UUID.test(id)) throw new Error("The inquiry is invalid.");
  const db = await createClient();
  const { data: member, error: accessError } = await db.rpc("can_access_website_inquiries");
  if (accessError || member !== true) throw new Error("Website inquiry access could not be verified.");
  const { data, error } = await db.from("todos").select(COLUMNS).eq("id", id).eq("source", "website").maybeSingle();
  if (error || !data) throw new Error("The inquiry is unavailable. Refresh before continuing.");
  return { user, db, inquiry: data as Inquiry };
}

function refresh(id: string) {
  try {
    revalidatePath("/command-center/inquiries");
    revalidatePath(`/command-center/inquiries/${id}`);
    revalidatePath("/command-center");
  } catch { /* A cache failure must not turn a completed booking into another send. */ }
}

/** Read-only: no calendar event or email is created by opening this panel. */
export async function getInquiryBookingContext(id: string, fromDay?: string): Promise<InquiryBookingContext> {
  const { db, inquiry } = await bookingAccess(id);
  const { data, error } = await db.from("website_walkthrough_bookings").select("*")
    .eq("inquiry_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Saved appointments could not be checked. Refresh before scheduling.");
  const requested = inquiry.website_inquiry?.walkthrough as { start?: unknown } | undefined;
  const requestedDay = typeof requested?.start === "string" ? etDate(requested.start) : null;
  const today = todayET();
  const day = fromDay || (requestedDay && requestedDay >= today ? requestedDay : today);
  const [availability, sender] = await Promise.all([getRyanAvailability(day), getWebsiteInquiryEmailSender()]);
  const booking = data as Booking | null;
  let calendarWarning: string | undefined;
  let calendarVerifiedAt: string | undefined;
  if (booking?.status === "confirmed") {
    try {
      const event = await findRyanWalkthroughEvent({ bookingId: booking.id, inquiryId: id,
        clientName: inquiryText(inquiry, "name"), clientEmail: booking.recipient_email,
        address: booking.address, start: booking.start_at, end: booking.end_at, description: booking.body });
      if (!event) calendarWarning = "This appointment is no longer on Ryan's calendar. Review the calendar before arranging another time.";
      else if (event.warning) calendarWarning = event.warning;
      else calendarVerifiedAt = new Date().toISOString();
    } catch (error) {
      calendarWarning = error instanceof Error ? error.message : "The saved appointment could not be verified against Ryan's calendar.";
    }
  }
  return { availability, booking, sender, calendarWarning, calendarVerifiedAt };
}

function validInput(input: ConfirmInquiryWalkthroughInput): boolean {
  return !!input && UUID.test(input.inquiryId) && UUID.test(input.requestId) &&
    typeof input.expectedUpdatedAt === "string" && Number.isFinite(Date.parse(input.expectedUpdatedAt)) &&
    typeof input.start === "string" && Number.isFinite(Date.parse(input.start)) &&
    typeof input.end === "string" && Date.parse(input.end) - Date.parse(input.start) === 3_600_000 &&
    typeof input.address === "string" && input.address.trim().length >= 5 && input.address.length <= 500 &&
    !/[\u0000-\u001f\u007f]/.test(input.address) &&
    typeof input.subject === "string" && !!input.subject.trim() && input.subject.trim().length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(input.subject) &&
    typeof input.body === "string" && !!input.body.trim() && input.body.length <= 20_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.body) &&
    typeof input.expectedRecipient === "string" && typeof input.expectedSender === "string" &&
    (input.confirmationSource === undefined || (typeof input.confirmationSource === "string" && input.confirmationSource.length <= 1000));
}

/** One explicit review/confirm click orchestrates durable, independently recoverable steps. */
export async function confirmInquiryWalkthrough(input: ConfirmInquiryWalkthroughInput): Promise<ConfirmInquiryWalkthroughResult> {
  let booking: Booking | null = null;
  const operationId = randomUUID();
  try {
    if (!validInput(input)) return { success: false, error: "Review the walkthrough time, address and full confirmation message." };
    const { user, db, inquiry } = await bookingAccess(input.inquiryId, true);
    const recipient = inquiryText(inquiry, "email").toLowerCase();
    if (!recipient || recipient !== input.expectedRecipient.trim().toLowerCase()) {
      return { success: false, error: "The homeowner email changed. Refresh and review the recipient." };
    }
    const sender = await getWebsiteInquiryEmailSender();
    if (!sender.email || sender.email !== input.expectedSender.trim().toLowerCase()) {
      return { success: false, error: sender.error || "Your sending account changed. Reopen the confirmation preview." };
    }
    const admin = createAdminClient();
    const { data: reserved, error: reserveError } = await admin.rpc("begin_website_walkthrough", {
      p_id: input.requestId, p_inquiry_id: input.inquiryId, p_actor: user.id,
      p_expected_updated_at: input.expectedUpdatedAt, p_start: input.start, p_end: input.end,
      p_address: input.address.trim(), p_recipient: recipient, p_sender: sender.email,
      p_subject: input.subject.trim(), p_body: input.body,
      p_homeowner_confirmed: input.homeownerConfirmed === true, p_confirmation_source: input.confirmationSource || "",
      p_operation_id: operationId,
    });
    if (reserveError || !reserved?.id) return { success: false, error: reserveError?.message || "The appointment could not be reserved. No invitation was created." };
    booking = reserved as Booking;
    if (booking.status === "confirmed") return { success: true, booking, eventUrl: booking.calendar_event_url || undefined };
    if (reserved.claimed !== true) return { success: false, booking, error: "This confirmation is already processing. Refresh to check its result before trying again." };

    let event: { id: string; htmlLink: string };
    try {
      event = await ensureRyanWalkthroughEvent({
        bookingId: booking.id, inquiryId: inquiry.id, clientName: inquiryText(inquiry, "name"),
        clientEmail: recipient, address: booking.address, start: booking.start_at, end: booking.end_at,
        description: [booking.body, "", `Inquiry: ${inquiryText(inquiry, "reference") || inquiry.id}`,
          `Project: ${inquiryText(inquiry, "projectType")}`, `Phone: ${inquiryText(inquiry, "phone") || "Not provided"}`].join("\n"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The calendar invitation could not be verified.";
      const definite = reserved.newly_created === true && error instanceof CalendarBookingError && error.retrySafe;
      const { data: marked } = await admin.rpc("mark_website_walkthrough_problem", {
        p_id: booking.id, p_error: message, p_definitely_not_created: definite, p_operation_id: operationId,
      });
      refresh(inquiry.id);
      return { success: false, error: message, booking: (marked || booking) as Booking };
    }
    const { data: recorded, error: recordError } = await admin.rpc("record_website_walkthrough_event", {
      p_id: booking.id, p_event_id: event.id, p_event_url: event.htmlLink, p_operation_id: operationId,
    });
    if (recordError || !recorded?.id) {
      refresh(inquiry.id);
      return { success: false, eventUrl: event.htmlLink, booking,
        error: "The calendar invitation was created, but its saved status could not be verified. Resume this same confirmation; it will check the existing event before continuing." };
    }
    booking = recorded as Booking;

    // The existing, reviewed app email workflow owns mailbox validation, send
    // reservations, delivery receipts and uncertain-send handling. Reuse it.
    const { data: current, error: currentError } = await db.from("todos").select("updated_at")
      .eq("id", inquiry.id).eq("source", "website").maybeSingle();
    if (currentError || !current) throw new Error("The invitation exists, but the inquiry could not be checked before sending its confirmation.");
    const sent = await sendWebsiteInquiryEmail({
      id: inquiry.id, requestId: booking.confirmation_email_id!, expectedUpdatedAt: current.updated_at,
      expectedRecipient: recipient, expectedSender: sender.email, subject: booking.subject, body: booking.body,
    });
    if (!sent.success || sent.warning) {
      const message = sent.success ? sent.warning! : sent.error;
      const detail = `Calendar invitation created. Confirmation email needs attention: ${message}`;
      const { data: marked } = await admin.rpc("mark_website_walkthrough_problem", {
        p_id: booking.id, p_error: detail, p_definitely_not_created: false, p_operation_id: operationId,
      });
      refresh(inquiry.id);
      return { success: false, error: detail, eventUrl: event.htmlLink, booking: (marked || booking) as Booking };
    }
    const { data: complete, error: finishError } = await admin.rpc("finish_website_walkthrough", { p_id: booking.id, p_operation_id: operationId });
    refresh(inquiry.id);
    if (finishError || complete?.status !== "confirmed") {
      return { success: false, error: "The invitation and confirmation email were sent, but the inquiry status needs to be reconciled. Resume the saved confirmation; neither message will be sent again.",
        eventUrl: event.htmlLink, booking };
    }
    return { success: true, eventUrl: event.htmlLink, booking: complete as Booking };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The walkthrough could not be confirmed.";
    if (booking) {
      try {
        const { data } = await createAdminClient().rpc("mark_website_walkthrough_problem", {
          p_id: booking.id, p_error: message, p_definitely_not_created: false, p_operation_id: operationId,
        });
        if (data) booking = data as Booking;
      } catch { /* Durable reservation remains in place; no automatic resend. */ }
      refresh(input.inquiryId);
    }
    return { success: false, error: message, ...(booking ? { booking, eventUrl: booking.calendar_event_url || undefined } : {}) };
  }
}

/** Explicit cancellation review is required; opening the calendar never calls this. */
export async function cancelInquiryWalkthrough(input: { inquiryId: string; bookingId: string; requestId: string }): Promise<ConfirmInquiryWalkthroughResult> {
  let booking: Booking | null = null;
  let operationId: string | null = null;
  try {
    if (!input || !UUID.test(input.inquiryId) || !UUID.test(input.bookingId) || !UUID.test(input.requestId)) {
      return { success: false, error: "The saved appointment is invalid. Refresh before cancelling." };
    }
    const { user, db, inquiry } = await bookingAccess(input.inquiryId, true);
    const { data: target, error } = await db.from("website_walkthrough_bookings").select("*")
      .eq("id", input.bookingId).eq("inquiry_id", inquiry.id).maybeSingle();
    if (error || !target) return { success: false, error: "The saved appointment could not be found on this inquiry." };
    const admin = createAdminClient();
    // A fresh fencing token per invocation prevents a replayed UI request ID
    // from reusing ownership of a still-running cancellation.
    operationId = randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc("begin_cancel_website_walkthrough", {
      p_id: target.id, p_actor: user.id, p_operation_id: operationId,
    });
    if (claimError || !claimed?.id) return { success: false, error: claimError?.message || "The cancellation could not be reserved." };
    booking = claimed as Booking;
    if (booking.status === "cancelled") return { success: true, booking };
    if (claimed.claimed !== true) return { success: false, booking, error: "This appointment is already processing. Refresh to check the result before trying again." };
    await cancelRyanWalkthroughEvent({ bookingId: booking.id, inquiryId: inquiry.id,
      clientName: inquiryText(inquiry, "name"), clientEmail: booking.recipient_email,
      address: booking.address, start: booking.start_at, end: booking.end_at, description: booking.body });
    const { data: complete, error: finishError } = await admin.rpc("finish_cancel_website_walkthrough", {
      p_id: booking.id, p_operation_id: operationId,
    });
    if (finishError || complete?.status !== "cancelled") {
      throw new Error("The calendar cancellation completed, but the inquiry could not be updated. Resume cancellation to verify it; no second cancellation notice will be sent.");
    }
    refresh(inquiry.id);
    return { success: true, booking: complete as Booking };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The cancellation could not be verified. The time remains reserved.";
    if (booking && operationId) {
      try {
        const { data } = await createAdminClient().rpc("mark_website_walkthrough_problem", {
          p_id: booking.id, p_error: message, p_definitely_not_created: false, p_operation_id: operationId,
        });
        if (data) booking = data as Booking;
      } catch { /* Preserve the cancellation intent and reservation for recovery. */ }
      refresh(input.inquiryId);
    }
    return { success: false, error: message, ...(booking ? { booking } : {}) };
  }
}
