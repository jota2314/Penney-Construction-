"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarCheck2, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, Loader2, Mail, MapPin, RefreshCw, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelInquiryWalkthrough, confirmInquiryWalkthrough, getInquiryBookingContext } from "@/lib/actions/website-inquiry-booking";
import { sendWebsiteInquiryEmail } from "@/lib/actions/website-inquiry-email";
import { buildWalkthroughConfirmation, readWalkthroughRequest, sameWalkthroughSlot, walkthroughDateLabel, type InquiryBookingContext, type WalkthroughSlot } from "@/lib/inquiries/booking-model";
import { inquiryText, intakeStatus, type Inquiry } from "@/lib/inquiries/model";
import { addDays, etDate, etDayRange, etTimeLabel, todayET } from "@/lib/sub-portal/et-day";

const fieldClass = "mt-1.5 min-h-11 w-full rounded-lg border bg-background px-3 text-sm disabled:opacity-60";
const GOOGLE_CALENDAR = "https://calendar.google.com/calendar/u/0/r";
function dayLabel(day: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York", ...options });
}
function safeCalendarLink(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

export function InquiryBooking({ inquiry, senderName, readOnly, emailBlocked }: {
  inquiry: Inquiry; senderName: string; readOnly: boolean; emailBlocked: boolean;
}) {
  const router = useRouter();
  const requested = readWalkthroughRequest(inquiry);
  const today = todayET();
  const requestedDay = requested ? etDate(requested.start) : null;
  const initialDay = requestedDay && requestedDay >= today && requestedDay <= addDays(today, 60) ? requestedDay : today;
  const [fromDay, setFromDay] = useState(initialDay);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [selectedSlot, setSelectedSlot] = useState<WalkthroughSlot | null>(requested);
  const [context, setContext] = useState<InquiryBookingContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState(false);
  const [cancelReview, setCancelReview] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [address, setAddress] = useState(requested?.address || "");
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [pending, startTransition] = useTransition();
  const [uncertain, setUncertain] = useState(false);
  const [sent, setSent] = useState(false);
  const [homeownerConfirmed, setHomeownerConfirmed] = useState(false);
  const [confirmationSource, setConfirmationSource] = useState("");
  const sending = useRef(false);
  const requestId = useRef<string | null>(null);
  const cancelRequestId = useRef<string | null>(null);
  const cancelledSeen = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setLoadError("");
    getInquiryBookingContext(inquiry.id, fromDay).then((result) => {
      if (!active) return;
      setContext(result);
      if (result.booking && !["failed", "cancelled"].includes(result.booking.status)) {
        requestId.current = result.booking.id;
        setSelectedSlot({ start: result.booking.start_at, end: result.booking.end_at });
        setAddress(result.booking.address);
        setDraft({ subject: result.booking.subject, body: result.booking.body });
        setConfirmationSource(result.booking.confirmation_source || "");
      } else if (result.booking?.status === "failed") requestId.current = null;
      else if (result.booking?.status === "cancelled" && cancelledSeen.current !== result.booking.id) {
        cancelledSeen.current = result.booking.id;
        requestId.current = null;
        setSelectedSlot(null);
        setHomeownerConfirmed(false);
        setConfirmationSource("");
        setSent(false);
        setUncertain(false);
      }
    }).catch(() => {
      if (active) { setContext(null); setLoadError("Ryan’s calendar could not be checked. Refresh availability before confirming a visit."); }
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [inquiry.id, inquiry.updated_at, fromDay, refreshKey]);

  const availability = context?.availability;
  const booking = context?.booking;
  const confirmed = booking?.status === "confirmed";
  const cancelled = booking?.status === "cancelled";
  const cancelling = booking?.status === "cancelling" || (!!booking?.cancel_requested_at && !cancelled);
  const calendarNeedsReview = confirmed && !!context?.calendarWarning;
  const partialBooking = !!booking && !cancelling && ["confirming", "calendar_created", "needs_attention"].includes(booking.status);
  const requestedSelected = sameWalkthroughSlot(selectedSlot, requested);
  const canResume = partialBooking && !!selectedSlot &&
    sameWalkthroughSlot(selectedSlot, { start: booking.start_at, end: booking.end_at });
  const selectedAvailable = !!selectedSlot && !!availability?.slots.some((slot) => sameWalkthroughSlot(slot, selectedSlot));
  const closed = ["closed", "spam"].includes(intakeStatus(inquiry));
  const disabled = readOnly || closed || checking || pending || confirmed || cancelling || uncertain || sent || !availability?.connected;
  const recipient = inquiryText(inquiry, "email");
  const days = Array.from({ length: 7 }, (_, index) => addDays(fromDay, index));
  const daySlots = availability?.slots.filter((slot) => etDate(slot.start) === selectedDay) || [];
  const dayRange = etDayRange(selectedDay);
  const dayBusy = availability?.busy.filter((block) => Date.parse(block.start) < Date.parse(dayRange.end) && Date.parse(block.end) > Date.parse(dayRange.start)) || [];
  const calendarLink = safeCalendarLink(availability?.calendarUrl) || GOOGLE_CALENDAR;
  const eventLink = safeCalendarLink(booking?.calendar_event_url);
  const selectedNeedsAgreement = (!requestedSelected || cancelled) && !canResume;
  const selectedIsProposal = selectedNeedsAgreement && !homeownerConfirmed;
  const resumeSenderMismatch = partialBooking && booking.sender_email !== context?.sender.email;
  const canCancel = !!booking?.calendar_event_id && ["confirmed", "calendar_created", "needs_attention", "cancelling"].includes(booking.status);

  function moveWeek(direction: number) {
    const next = addDays(fromDay, direction * 7);
    const day = next < today ? today : next;
    setFromDay(day);
    setSelectedDay(day);
  }
  function openReview() {
    if (!selectedSlot || !address.trim()) return;
    setError("");
    setSent(false);
    setDraft(partialBooking ? { subject: booking.subject, body: booking.body } : buildWalkthroughConfirmation(inquiry, selectedSlot, address.trim(), senderName, selectedIsProposal));
    setReview(true);
  }
  async function submit() {
    if (sending.current || !selectedSlot || !context?.sender.email || uncertain || sent) return;
    sending.current = true;
    requestId.current ??= crypto.randomUUID();
    setError("");
    try {
      if (selectedIsProposal) {
        const result = await sendWebsiteInquiryEmail({
          id: inquiry.id, expectedUpdatedAt: inquiry.updated_at,
          expectedRecipient: recipient, expectedSender: context.sender.email,
          requestId: requestId.current, subject: draft.subject, body: draft.body,
        });
        if (!result.success) {
          setError(result.error);
          if (result.deliveryUncertain) setUncertain(true);
          if (result.retrySafe) requestId.current = null;
          return;
        }
        setMessage(result.warning || "Suggested time sent. Waiting for the homeowner to agree; no appointment has been booked.");
        setSent(true);
      } else {
        const result = await confirmInquiryWalkthrough({
          inquiryId: inquiry.id, requestId: requestId.current, expectedUpdatedAt: partialBooking ? booking.requested_updated_at : inquiry.updated_at,
          start: selectedSlot.start, end: selectedSlot.end, address: address.trim(),
          subject: draft.subject, body: draft.body, expectedSender: context.sender.email, expectedRecipient: recipient,
          homeownerConfirmed: homeownerConfirmed || canResume,
          confirmationSource: confirmationSource.trim(),
        });
        if (!result.success) {
          setError(result.error || "The walkthrough could not be confirmed. Refresh the booking status before trying again.");
          setRefreshKey((value) => value + 1);
          return;
        }
        setMessage(result.warning || "Walkthrough confirmed. Ryan’s calendar and the homeowner’s invitation are connected to this inquiry.");
        setSent(true);
        if (result.booking) setContext({ ...context, booking: result.booking });
        setRefreshKey((value) => value + 1);
      }
      setReview(false);
      router.refresh();
    } catch {
      setUncertain(true);
      setError("The result could not be confirmed. Refresh this page and check the saved booking and email history before another attempt.");
    } finally { sending.current = false; }
  }
  async function cancel() {
    if (sending.current || readOnly || !booking || !canCancel) return;
    sending.current = true;
    cancelRequestId.current ??= crypto.randomUUID();
    setCancelError("");
    try {
      const result = await cancelInquiryWalkthrough({ inquiryId: inquiry.id, bookingId: booking.id, requestId: cancelRequestId.current });
      if (result.booking && context) setContext({ ...context, booking: result.booking });
      if (!result.success) {
        setCancelError(result.error || "Cancellation could not be confirmed. Check the saved appointment before making a new booking.");
        setRefreshKey((value) => value + 1);
        return;
      }
      requestId.current = null;
      cancelRequestId.current = null;
      setSelectedSlot(null);
      setHomeownerConfirmed(false);
      setConfirmationSource("");
      setSent(false);
      setUncertain(false);
      setError("");
      setReview(false);
      setCancelReview(false);
      setMessage(result.warning || "Walkthrough cancelled. The calendar cancellation was sent to the homeowner. Agree on a new time before booking again.");
      setRefreshKey((value) => value + 1);
      router.refresh();
    } catch {
      setCancelError("The cancellation result could not be confirmed. Refresh the saved appointment, then review this same cancellation before booking another time.");
      setRefreshKey((value) => value + 1);
    } finally { sending.current = false; }
  }

  return <section id="walkthrough" aria-labelledby="walkthrough-heading" className="overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/25 px-5 py-5">
      <div className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="size-5" aria-hidden="true" /></span><div><h2 id="walkthrough-heading" className="font-semibold">Walkthrough with Ryan</h2><p className="mt-0.5 text-xs text-muted-foreground">One inquiry. One visit. Everyone connected.</p></div></div>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${confirmed && !calendarNeedsReview ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
        {confirmed && !calendarNeedsReview ? <Check className="size-3" aria-hidden="true" /> : <Clock3 className="size-3" aria-hidden="true" />}
        {cancelled ? "Cancelled" : cancelling ? "Cancellation needs attention" : calendarNeedsReview ? "Calendar needs review" : confirmed ? "Confirmed" : partialBooking ? "Confirmation needs attention" : requested ? "Waiting on Ryan" : "Choose a time to propose"}
      </span>
    </div>

    <div className="space-y-5 p-4 sm:p-5">
      {(requested || partialBooking || confirmed || cancelled || cancelling) && <div className={`rounded-xl border p-4 ${confirmed && !calendarNeedsReview ? "border-emerald-500/25 bg-emerald-500/5" : cancelled ? "border-border bg-muted/30" : "border-primary/20 bg-primary/5"}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{cancelled ? "Cancelled walkthrough" : cancelling ? "Walkthrough being cancelled" : calendarNeedsReview ? "Previously confirmed walkthrough" : confirmed ? "Your confirmed walkthrough" : partialBooking ? "Saved walkthrough" : "Homeowner’s requested time"}</p>
        <p className="mt-2 text-base font-semibold leading-relaxed">{walkthroughDateLabel((partialBooking || confirmed || cancelled || cancelling) ? booking!.start_at : requested!.start, (partialBooking || confirmed || cancelled || cancelling) ? booking!.end_at : requested!.end)}</p>
        <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{(partialBooking || confirmed || cancelled || cancelling) ? booking!.address : requested?.address}</p>
        {eventLink && !cancelled && <a href={eventLink} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded text-sm font-medium underline underline-offset-4">Open walkthrough in Google Calendar<ExternalLink className="size-3.5" aria-hidden="true" /></a>}
        {context?.calendarWarning && <p role="alert" className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">{context.calendarWarning}</p>}
        {confirmed && !context?.calendarWarning && context?.calendarVerifiedAt && <p className="mt-2 text-xs text-muted-foreground">Appointment verified against Ryan’s calendar at {etTimeLabel(context.calendarVerifiedAt)} Eastern.</p>}
        {!confirmed && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{cancelled ? "The original appointment is cancelled. Choose a new time below and record the homeowner’s agreement before confirming it." : cancelling ? booking?.error || "The cancellation is saved but not yet complete. Review this cancellation before scheduling another time." : partialBooking ? booking.error || "Part of the confirmation is saved. Review the current status before completing it." : "This time is requested, not booked. Review Ryan’s availability and the confirmation below."}</p>}
        {canCancel && <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3"><Button type="button" variant="outline" className="min-h-10" disabled={readOnly || checking || pending} onClick={() => { setCancelError(""); setCancelReview(true); }}><XCircle className="size-4" aria-hidden="true" />{cancelling ? "Review cancellation" : "Cancel walkthrough"}</Button><p className="text-xs text-muted-foreground">{cancelling ? "Complete the saved cancellation before making another booking." : "For a new date, cancel this visit first, then confirm the agreed replacement."}</p></div>}
      </div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Ryan’s calendar</h3><p className="mt-1 text-xs text-muted-foreground">Eastern time · 60-minute visits · Travel buffer included</p></div>
        <div className="flex items-center gap-1"><Button type="button" size="sm" variant="ghost" disabled={checking || pending} onClick={() => setRefreshKey((value) => value + 1)} aria-label="Refresh Ryan’s availability"><RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden="true" /></Button><Button type="button" size="sm" variant="outline" asChild><a href={calendarLink} target="_blank" rel="noopener noreferrer">Open calendar<ExternalLink className="size-3.5" aria-hidden="true" /></a></Button></div>
      </div>
      <p className="text-xs text-muted-foreground">The calendar link opens Google Calendar with your existing access. Private appointment details stay in Google Calendar.</p>

      <div className="rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3">
          <div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" className="size-9" disabled={fromDay <= today || checking || pending} onClick={() => moveWeek(-1)} aria-label="Previous week"><ChevronLeft aria-hidden="true" /></Button><p className="min-w-32 text-center text-sm font-medium">{dayLabel(fromDay, { month: "short", day: "numeric" })} – {dayLabel(addDays(fromDay, 6), { month: "short", day: "numeric" })}</p><Button type="button" variant="ghost" size="icon" className="size-9" disabled={addDays(fromDay, 7) > addDays(today, 60) || checking || pending} onClick={() => moveWeek(1)} aria-label="Next week"><ChevronRight aria-hidden="true" /></Button></div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Jump to<input type="date" aria-label="Calendar start date" min={today} max={addDays(today, 60)} value={fromDay} disabled={checking || pending} onChange={(event) => { if (event.target.value >= today && event.target.value <= addDays(today, 60)) { setFromDay(event.target.value); setSelectedDay(event.target.value); } }} className="min-h-9 max-w-36 rounded-md border bg-background px-2 text-xs text-foreground" /></label>
        </div>
        <div className="grid grid-cols-7 gap-1 border-b p-2" aria-label="Choose a calendar day">{days.map((day) => {
          const count = availability?.slots.filter((slot) => etDate(slot.start) === day).length || 0;
          return <button type="button" key={day} aria-pressed={selectedDay === day} aria-label={`${dayLabel(day, { weekday: "long", month: "long", day: "numeric" })}${availability?.connected ? `, ${count} available times` : ""}`} onClick={() => setSelectedDay(day)} disabled={checking || pending} className={`min-h-20 min-w-0 rounded-lg border px-1 py-2 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selectedDay === day ? "border-primary bg-primary text-primary-foreground" : "border-transparent hover:bg-muted"}`}><span className={`block text-[10px] sm:text-xs ${selectedDay === day ? "opacity-80" : "text-muted-foreground"}`}>{dayLabel(day, { weekday: "short" })}</span><span className="mt-1 block text-base font-semibold">{dayLabel(day, { day: "numeric" })}</span><span className={`mx-auto mt-2 block size-1.5 rounded-full ${count && !checking ? selectedDay === day ? "bg-primary-foreground" : "bg-emerald-500" : "bg-current opacity-15"}`} aria-hidden="true" /></button>;
        })}</div>

        <div className="space-y-4 p-4" aria-live="polite" aria-busy={checking}>
          {checking ? <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Checking Ryan’s calendar…</div> : !availability?.connected ? <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4"><p className="text-sm font-medium">Calendar connection needs attention</p><p className="mt-1 text-sm text-muted-foreground">{availability?.message || loadError || "Ryan’s calendar is unavailable. Reconnect his Google account in Settings before confirming a visit."}</p></div> : <>
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{dayLabel(selectedDay, { weekday: "long", month: "long", day: "numeric" })}</h4><span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Availability checked</span></div>
            {daySlots.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{daySlots.map((slot) => <button type="button" key={slot.start} disabled={pending || confirmed || partialBooking || cancelling} onClick={() => { setSelectedSlot(slot); setHomeownerConfirmed(false); setConfirmationSource(""); }} aria-pressed={sameWalkthroughSlot(selectedSlot, slot)} className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${sameWalkthroughSlot(selectedSlot, slot) ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/50 hover:bg-muted/40"}`}><span>{etTimeLabel(slot.start)}</span>{sameWalkthroughSlot(slot, requested) && !cancelled ? <span className="text-[10px] font-normal">Requested</span> : sameWalkthroughSlot(selectedSlot, slot) ? <Check className="size-3.5" aria-hidden="true" /> : null}</button>)}</div> : <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">No available walkthrough windows on this day. Choose another day to see options.</p>}
            {dayBusy.length > 0 && <details className="border-t pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">{dayBusy.length} busy {dayBusy.length === 1 ? "block" : "blocks"} on Ryan’s calendar</summary><ul className="mt-3 space-y-2">{dayBusy.map((block, index) => <li key={`${block.start}-${index}`} className="flex items-center justify-between gap-3 rounded-md border-l-2 border-muted-foreground/30 bg-muted/40 px-3 py-2 text-xs"><span>Busy</span><span>{Date.parse(block.start) < Date.parse(dayRange.start) ? "Start of day" : etTimeLabel(block.start)} – {Date.parse(block.end) >= Date.parse(dayRange.end) ? "End of day" : etTimeLabel(block.end)}</span></li>)}</ul></details>}
          </>}
        </div>
      </div>

      {!confirmed && !cancelling && <div className="space-y-4 border-t pt-5">
        {requested && (!requestedSelected || requestedDay !== selectedDay) && !partialBooking && !cancelled && <button type="button" disabled={pending} onClick={() => { setSelectedSlot(requested); if (requestedDay && requestedDay >= today && requestedDay <= addDays(today, 60)) { setFromDay(requestedDay); setSelectedDay(requestedDay); } }} className="text-sm font-medium underline underline-offset-4">Return to the homeowner’s requested time</button>}
        {selectedSlot ? <div className="flex items-start gap-2 text-sm"><Clock3 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div><p className="font-medium">{walkthroughDateLabel(selectedSlot.start, selectedSlot.end)}</p><p className="mt-1 text-xs text-muted-foreground">{cancelled ? "A new booking needs fresh agreement from the homeowner, even if you choose the original time again." : selectedIsProposal ? "A different time. Send it as a suggestion and wait for the homeowner’s agreement." : canResume ? "The saved booking will be checked before completing confirmation." : "Matches the time the homeowner requested."}</p></div></div> : <p className="text-sm text-muted-foreground">Select an available time to suggest to the homeowner.</p>}
        <label className="block text-sm font-medium">Walkthrough address<input value={address} maxLength={500} disabled={disabled || partialBooking} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" placeholder="Street address, town, state and ZIP" className={fieldClass} /></label>
        {selectedSlot && selectedNeedsAgreement && <div className="rounded-lg border bg-muted/20 p-3"><label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={homeownerConfirmed} disabled={disabled} onChange={(event) => setHomeownerConfirmed(event.target.checked)} /><span>Homeowner has agreed to this time<span className="mt-1 block text-xs text-muted-foreground">Select only after their email reply or a conversation confirming the appointment.</span></span></label>{homeownerConfirmed && <label className="mt-3 block text-xs font-medium">Where was this confirmed?<input className={fieldClass} required value={confirmationSource} maxLength={1000} placeholder="Email reply on Nov 4, or call details" disabled={disabled} onChange={(event) => setConfirmationSource(event.target.value)} /></label>}</div>}
        {!checking && requestedSelected && !selectedAvailable && !canResume && availability?.connected && <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm">The requested time is no longer available or falls outside the booking window. Choose another available time to suggest.</p>}
        {emailBlocked && !partialBooking && <p className="text-sm text-amber-700 dark:text-amber-300">An earlier email needs review. Check email history before sending a confirmation.</p>}
        {context?.sender.error && <p className="text-sm text-muted-foreground">{context.sender.error}</p>}
        {resumeSenderMismatch && <p className="text-sm text-amber-700 dark:text-amber-300">This confirmation was started by {booking.sender_email}. That person must finish the saved attempt.</p>}
        <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={disabled || !selectedSlot || (!selectedAvailable && !canResume) || !address.trim() || !recipient || !context?.sender.email || (emailBlocked && !partialBooking) || resumeSenderMismatch || (selectedNeedsAgreement && homeownerConfirmed && !confirmationSource.trim())} onClick={openReview}>{selectedIsProposal ? <Mail aria-hidden="true" /> : <CalendarCheck2 aria-hidden="true" />}{selectedIsProposal ? "Review suggested time" : partialBooking ? "Review saved confirmation" : "Review confirmation"}<ArrowRight aria-hidden="true" /></Button>
        <p className="text-xs leading-relaxed text-muted-foreground">{readOnly ? "Exit View as to send or confirm." : closed ? "Reopen this inquiry before scheduling a visit." : "Review the full message before sending. Confirmation creates the appointment on Ryan’s calendar and sends the homeowner an invitation."}</p>
      </div>}
      {error && !review && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />{message}</p>}
    </div>

    <Dialog open={review} onOpenChange={(open) => { if (!pending) setReview(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending}>
        <DialogHeader><DialogTitle>{selectedIsProposal ? "Suggest a walkthrough time" : "Confirm the walkthrough"}</DialogTitle><DialogDescription>{selectedIsProposal ? "This sends a proposed time. The appointment stays unconfirmed until the homeowner agrees." : "Review the email and appointment. The button below creates Ryan’s calendar event and sends the confirmation and invitation."}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); startTransition(submit); }}>
          <dl className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm"><div className="flex gap-3"><dt className="w-12 shrink-0 text-muted-foreground">From</dt><dd className="min-w-0 break-all">{context?.sender.email || "Not connected"}</dd></div><div className="flex gap-3"><dt className="w-12 shrink-0 text-muted-foreground">To</dt><dd className="min-w-0 break-all">{recipient}</dd></div><div className="flex gap-3"><dt className="w-12 shrink-0 text-muted-foreground">When</dt><dd>{selectedSlot && walkthroughDateLabel(selectedSlot.start, selectedSlot.end)}</dd></div><div className="flex gap-3"><dt className="w-12 shrink-0 text-muted-foreground">Where</dt><dd className="break-words">{address}</dd></div></dl>
          <label className="block text-sm">Subject<input required value={draft.subject} maxLength={200} disabled={pending || uncertain || sent || partialBooking} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} className={fieldClass} /></label>
          <label className="block text-sm">Message<textarea required rows={11} maxLength={12000} value={draft.body} disabled={pending || uncertain || sent || partialBooking} onChange={(event) => setDraft({ ...draft, body: event.target.value })} className={`${fieldClass} min-h-56 resize-y py-3 leading-relaxed`} /></label>
          {partialBooking && <p className="text-xs text-muted-foreground">This is the exact message saved with the original confirmation. Completing it keeps the same appointment and prevents duplicate invitations.</p>}
          <p className="text-xs text-muted-foreground">Penney’s standard email signature is added when sent.</p>
          {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setReview(false)}>Back</Button><Button type="submit" className="min-h-11" disabled={pending || uncertain || sent || !draft.subject.trim() || !draft.body.trim() || !context?.sender.email}>{pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{pending ? "Connecting the details…" : selectedIsProposal ? "Send suggested time" : "Confirm & send invitation"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={cancelReview} onOpenChange={(open) => { if (!pending) setCancelReview(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!pending}>
        <DialogHeader><DialogTitle>Cancel this walkthrough?</DialogTitle><DialogDescription>This removes the appointment from Ryan’s calendar and sends the homeowner a calendar cancellation. A replacement visit requires a separately agreed time.</DialogDescription></DialogHeader>
        {booking && <dl className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm"><div><dt className="text-xs text-muted-foreground">Homeowner</dt><dd className="mt-1 font-medium">{inquiryText(inquiry, "name")}</dd><dd className="mt-1 break-all text-muted-foreground">{booking.recipient_email}</dd></div><div><dt className="text-xs text-muted-foreground">Appointment</dt><dd className="mt-1">{walkthroughDateLabel(booking.start_at, booking.end_at)}</dd></div><div><dt className="text-xs text-muted-foreground">Property</dt><dd className="mt-1 break-words">{booking.address}</dd></div></dl>}
        {cancelError && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{cancelError}</p>}
        <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setCancelReview(false)}>Keep walkthrough</Button><Button type="button" variant="destructive" className="min-h-11" disabled={readOnly || pending || !canCancel} onClick={() => startTransition(cancel)}>{pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <XCircle aria-hidden="true" />}{pending ? "Cancelling…" : "Cancel & notify homeowner"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
