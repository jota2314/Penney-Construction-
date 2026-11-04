import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { etDate } from "@/lib/sub-portal/et-day";
import {
  availabilityRange, validAvailabilityDay, validWalkthroughSlot, walkthroughSlots,
  WALKTHROUGH_BUFFER_MINUTES, WALKTHROUGH_DURATION_MINUTES, WALKTHROUGH_TIME_ZONE,
  type CalendarInterval,
} from "@/lib/inquiries/calendar-time";

const RYAN_ID = "7a44f1ab-70db-4d9a-af26-dc2a37f89091";
const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CALENDAR_URL = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(RYAN_EMAIL)}`;
const UNAVAILABLE = "Ryan's calendar could not be checked. Reconnect his Google account in Settings before confirming a walkthrough.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RyanAvailability = {
  connected: boolean; timeZone: typeof WALKTHROUGH_TIME_ZONE; durationMinutes: typeof WALKTHROUGH_DURATION_MINUTES;
  slots: CalendarInterval[]; busy: CalendarInterval[]; message?: string; calendarUrl?: string;
};
export type RyanWalkthroughInput = {
  bookingId: string; inquiryId: string; clientName: string; clientEmail: string;
  address: string; start: string; end: string; description: string;
};
export type RyanWalkthroughEvent = { id: string; htmlLink: string; warning?: string };
type GoogleEvent = {
  id?: string; htmlLink?: string; status?: string; location?: string; etag?: string;
  start?: { dateTime?: string }; end?: { dateTime?: string };
  attendees?: { email?: string; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
};

/** retrySafe means this write was not attempted or was explicitly rejected; ambiguous attempts retain their reservation. */
export class CalendarBookingError extends Error {
  constructor(message: string, public readonly retrySafe: boolean) { super(message); this.name = "CalendarBookingError"; }
}

function unavailable(): never { throw new CalendarBookingError(UNAVAILABLE, true); }

async function ryanToken(): Promise<string> {
  const db = createAdminClient();
  const { data: profile, error } = await db.from("profiles").select("id,email,google_refresh_token")
    .eq("id", RYAN_ID).maybeSingle();
  if (error || profile?.email?.trim().toLowerCase() !== RYAN_EMAIL || !profile?.google_refresh_token) unavailable();
  let clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const { data: settings, error: settingsError } = await db.from("app_settings").select("key,value")
      .in("key", ["google_client_id", "google_client_secret"]);
    if (settingsError) unavailable();
    clientId = settings?.find((row) => row.key === "google_client_id")?.value;
    clientSecret = settings?.find((row) => row.key === "google_client_secret")?.value;
  }
  if (!clientId || !clientSecret) unavailable();
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
        refresh_token: profile.google_refresh_token, grant_type: "refresh_token" }),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) unavailable();
    const result = await response.json() as { access_token?: unknown };
    if (typeof result.access_token !== "string" || !result.access_token) unavailable();
    return result.access_token;
  } catch { unavailable(); }
}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${CALENDAR_API}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
}

async function verifiedConnection(): Promise<{ token: string; calendars: string[] }> {
  const token = await ryanToken();
  const primary = await request(token, "/calendars/primary?fields=id");
  if (!primary.ok || (await primary.json() as { id?: string }).id?.toLowerCase() !== RYAN_EMAIL) unavailable();
  const calendars = new Set([RYAN_EMAIL]);
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250", fields: "items(id,selected,primary,deleted),nextPageToken" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await request(token, `/users/me/calendarList?${params}`);
    if (!response.ok) unavailable();
    const result = await response.json() as { items?: { id?: string; selected?: boolean; primary?: boolean; deleted?: boolean }[]; nextPageToken?: string };
    if (!Array.isArray(result.items)) unavailable();
    for (const item of result.items) if (item.id && !item.deleted && (item.selected || item.primary)) calendars.add(item.id);
    pageToken = result.nextPageToken;
    // Google's free/busy API supports at most 50 calendars. Never silently drop one.
    if (calendars.size > 50) throw new CalendarBookingError("Ryan has more than 50 selected calendars. Choose the calendars used for scheduling before booking a walkthrough.", true);
  } while (pageToken);
  return { token, calendars: [...calendars] };
}

async function readBusy(connection: { token: string; calendars: string[] }, range: CalendarInterval): Promise<CalendarInterval[]> {
  // Include adjacent bookings so a visit at the edge of the range still gets travel time.
  const response = await request(connection.token, "/freeBusy", { method: "POST", body: JSON.stringify({
    timeMin: new Date(Date.parse(range.start) - WALKTHROUGH_BUFFER_MINUTES * 60_000).toISOString(),
    timeMax: new Date(Date.parse(range.end) + WALKTHROUGH_BUFFER_MINUTES * 60_000).toISOString(),
    timeZone: WALKTHROUGH_TIME_ZONE, calendarExpansionMax: 50, items: connection.calendars.map((id) => ({ id })),
  }) });
  if (!response.ok) unavailable();
  const result = await response.json() as { calendars?: Record<string, { errors?: unknown[]; busy?: CalendarInterval[] }> };
  const busy: CalendarInterval[] = [];
  for (const id of connection.calendars) {
    const calendar = result.calendars?.[id];
    if (!calendar || (calendar.errors?.length ?? 0) > 0 || !Array.isArray(calendar.busy)) unavailable();
    for (const item of calendar.busy) {
      if (!item || !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end)) || Date.parse(item.end) <= Date.parse(item.start)) unavailable();
      busy.push({ start: item.start, end: item.end });
    }
  }
  return busy.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

async function reservedBusy(range: CalendarInterval): Promise<CalendarInterval[]> {
  const buffer = WALKTHROUGH_BUFFER_MINUTES * 60_000;
  const { data, error } = await createAdminClient().from("website_walkthrough_bookings")
    .select("start_at,end_at")
    .in("status", ["confirming", "calendar_created", "confirmed", "needs_attention", "cancelling"])
    .lt("start_at", new Date(Date.parse(range.end) + buffer).toISOString())
    .gt("end_at", new Date(Date.parse(range.start) - buffer).toISOString());
  // A missing/unreadable reservation ledger must not expose apparently free times.
  if (error || !Array.isArray(data)) unavailable();
  return data.map((row) => {
    if (!Number.isFinite(Date.parse(row.start_at)) || !Number.isFinite(Date.parse(row.end_at)) || Date.parse(row.end_at) <= Date.parse(row.start_at)) unavailable();
    return { start: row.start_at as string, end: row.end_at as string };
  });
}

/** Called by authorized staff actions or the service-authenticated website endpoint only. */
export async function getRyanAvailability(fromDay: string): Promise<RyanAvailability> {
  const base = { timeZone: WALKTHROUGH_TIME_ZONE, durationMinutes: WALKTHROUGH_DURATION_MINUTES, slots: [], busy: [] };
  if (!validAvailabilityDay(fromDay)) return { ...base, connected: false, message: "Choose a date within the next 60 days." };
  try {
    const connection = await verifiedConnection();
    const range = availabilityRange(fromDay);
    const [calendarBusy, bookingBusy] = await Promise.all([readBusy(connection, range), reservedBusy(range)]);
    const busy = [...calendarBusy, ...bookingBusy].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return { ...base, connected: true, slots: walkthroughSlots(fromDay, busy), busy, calendarUrl: CALENDAR_URL };
  } catch (error) {
    return { ...base, connected: false, message: error instanceof CalendarBookingError ? error.message : UNAVAILABLE };
  }
}

export function walkthroughEventId(bookingId: string): string {
  // Google event IDs permit base32hex characters a-v and 0-9. SHA-256 hex fits.
  return `pc${createHash("sha256").update(`website-walkthrough:${bookingId}`).digest("hex")}`;
}

function verifyExisting(event: GoogleEvent, input: RyanWalkthroughInput): RyanWalkthroughEvent {
  const tags = event.extendedProperties?.private;
  if (event.id !== walkthroughEventId(input.bookingId) || event.status === "cancelled" ||
    tags?.penneyBookingId !== input.bookingId || tags?.penneyInquiryId !== input.inquiryId ||
    Date.parse(event.start?.dateTime || "") !== Date.parse(input.start) || Date.parse(event.end?.dateTime || "") !== Date.parse(input.end) ||
    event.location !== input.address || !event.attendees?.some((a) => a.email?.toLowerCase() === input.clientEmail.toLowerCase()) ||
    (!event.htmlLink?.startsWith("https://www.google.com/calendar/") && !event.htmlLink?.startsWith("https://calendar.google.com/"))) {
    throw new CalendarBookingError("The calendar appointment differs from this request. Review Ryan's calendar before continuing; no second invitation was sent.", false);
  }
  const responseStatus = event.attendees?.find((attendee) => attendee.email?.toLowerCase() === input.clientEmail.toLowerCase())?.responseStatus;
  const warning = responseStatus === "declined"
    ? "The homeowner declined this calendar invitation. Contact them to agree on another time before treating the walkthrough as confirmed."
    : responseStatus === "tentative"
      ? "The homeowner marked this calendar invitation as tentative. Confirm the time with them before the walkthrough."
      : undefined;
  return { id: event.id, htmlLink: event.htmlLink!, ...(warning ? { warning } : {}) };
}

async function existingEvent(token: string, input: RyanWalkthroughInput): Promise<RyanWalkthroughEvent | null> {
  const response = await request(token, `/calendars/${encodeURIComponent(RYAN_EMAIL)}/events/${walkthroughEventId(input.bookingId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new CalendarBookingError("The existing calendar invitation could not be checked. Keep this request and check again before sending anything else.", false);
  return verifyExisting(await response.json() as GoogleEvent, input);
}

export async function findRyanWalkthroughEvent(input: RyanWalkthroughInput): Promise<RyanWalkthroughEvent | null> {
  if (!UUID.test(input.bookingId) || !UUID.test(input.inquiryId)) throw new CalendarBookingError("Invalid walkthrough request.", true);
  try { return await existingEvent((await verifiedConnection()).token, input); }
  catch (error) {
    if (error instanceof CalendarBookingError) throw error;
    throw new CalendarBookingError("The saved calendar invitation could not be checked. Keep this request and check again.", false);
  }
}

/** An explicit reviewed cancellation, after the app claims this booking's lease. */
export async function cancelRyanWalkthroughEvent(input: RyanWalkthroughInput): Promise<{ cancelled: true }> {
  if (!UUID.test(input.bookingId) || !UUID.test(input.inquiryId)) throw new CalendarBookingError("Invalid walkthrough request.", true);
  let connection: { token: string; calendars: string[] };
  try { connection = await verifiedConnection(); }
  catch (error) { throw new CalendarBookingError(error instanceof CalendarBookingError ? error.message : UNAVAILABLE, true); }
  const eventId = walkthroughEventId(input.bookingId);
  const path = `/calendars/${encodeURIComponent(RYAN_EMAIL)}/events/${eventId}`;
  let current: Response;
  try { current = await request(connection.token, path); }
  catch { throw new CalendarBookingError("The current calendar invitation could not be checked. Keep this booking until its cancellation can be verified.", false); }
  if (current.status === 404 || current.status === 410) return { cancelled: true };
  if (!current.ok) throw new CalendarBookingError("The current calendar invitation could not be checked. Keep this booking until its cancellation can be verified.", false);
  let currentEvent: GoogleEvent;
  try { currentEvent = await current.json() as GoogleEvent; }
  catch { throw new CalendarBookingError("Google returned an unreadable appointment. No cancellation was attempted.", true); }
  // Deleted Google events may retain only their ID and cancelled status.
  // The deterministic ID and verified Ryan calendar identify this exact record.
  if (currentEvent.id === eventId && currentEvent.status === "cancelled") return { cancelled: true };
  verifyExisting(currentEvent, input);
  if (!currentEvent.etag) throw new CalendarBookingError("Google did not return the appointment version. No cancellation was attempted; refresh before trying again.", true);
  let cancelled: Response;
  try { cancelled = await request(connection.token, `${path}?sendUpdates=all`, { method: "DELETE", headers: { "If-Match": currentEvent.etag } }); }
  catch { throw new CalendarBookingError("Google did not confirm the cancellation. Keep the appointment reserved and check this same cancellation again; do not create a replacement yet.", false); }
  if (cancelled.status === 204 || cancelled.status === 404 || cancelled.status === 410) return { cancelled: true };
  if (cancelled.status === 412) throw new CalendarBookingError("The calendar appointment changed while its cancellation was being reviewed. Refresh and review the current appointment before trying again.", true);
  if ([400, 401, 403, 429].includes(cancelled.status)) {
    throw new CalendarBookingError("Google did not accept the cancellation. The appointment remains reserved; check Ryan's calendar connection before trying again.", true);
  }
  throw new CalendarBookingError("The cancellation could not be confirmed. Keep the appointment reserved and check this same cancellation before arranging a replacement.", false);
}

/** Only after a reviewed human confirmation and a DB reservation for this booking. */
export async function ensureRyanWalkthroughEvent(input: RyanWalkthroughInput): Promise<RyanWalkthroughEvent> {
  if (!UUID.test(input.bookingId) || !UUID.test(input.inquiryId) || !input.clientName?.trim() || !input.address?.trim() ||
    input.address.length > 500 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.clientEmail) ||
    !Number.isFinite(Date.parse(input.start)) || !Number.isFinite(Date.parse(input.end))) throw new CalendarBookingError("Check the walkthrough details before confirming.", true);
  let connection: { token: string; calendars: string[] };
  try { connection = await verifiedConnection(); }
  catch (error) { throw new CalendarBookingError(error instanceof CalendarBookingError ? error.message : UNAVAILABLE, true); }
  // Recovery comes first: a completed invitation must remain recoverable even
  // after its start time or the minimum-notice cutoff has passed.
  const prior = await existingEvent(connection.token, input);
  if (prior) return prior;
  if (!validWalkthroughSlot(input.start, input.end)) throw new CalendarBookingError("Choose an available one-hour visit at least 24 hours ahead, within the next 60 days.", true);
  const day = etDate(input.start)!;
  let busy: CalendarInterval[];
  try { busy = await readBusy(connection, { start: input.start, end: input.end }); }
  catch (error) { throw new CalendarBookingError(error instanceof CalendarBookingError ? error.message : UNAVAILABLE, true); }
  if (!walkthroughSlots(day, busy).some((slot) => Date.parse(slot.start) === Date.parse(input.start) && Date.parse(slot.end) === Date.parse(input.end))) {
    throw new CalendarBookingError("Ryan is no longer free at this time, including travel time. Refresh his calendar and choose another time.", true);
  }
  const path = `/calendars/${encodeURIComponent(RYAN_EMAIL)}/events?sendUpdates=all`;
  const event = {
    id: walkthroughEventId(input.bookingId), summary: `Walkthrough: ${input.clientName.trim()}`,
    description: input.description, location: input.address,
    start: { dateTime: input.start, timeZone: WALKTHROUGH_TIME_ZONE },
    end: { dateTime: input.end, timeZone: WALKTHROUGH_TIME_ZONE },
    attendees: [{ email: input.clientEmail.toLowerCase() }],
    guestsCanInviteOthers: false, guestsCanModify: false,
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 60 }] },
    extendedProperties: { private: { penneyBookingId: input.bookingId, penneyInquiryId: input.inquiryId } },
  };
  try {
    const response = await request(connection.token, path, { method: "POST", body: JSON.stringify(event) });
    if (response.ok) return verifyExisting(await response.json() as GoogleEvent, input);
    if (response.status === 409) {
      const recovered = await existingEvent(connection.token, input);
      if (recovered) return recovered;
    }
    if ([400, 401, 403, 404, 429].includes(response.status)) {
      throw new CalendarBookingError("Google did not accept the calendar invitation. Check Ryan's calendar connection and try this request again.", true);
    }
  } catch (error) {
    if (error instanceof CalendarBookingError && error.retrySafe) throw error;
    // A timeout can follow a successful insert. A deterministic GET can recover
    // it without generating another event or resending the invitation.
    try { const recovered = await existingEvent(connection.token, input); if (recovered) return recovered; } catch { /* Keep the reservation for reconciliation. */ }
    throw new CalendarBookingError("The invitation may have been created, but Google did not confirm it. Keep this booking and check its status; do not choose a new request.", false);
  }
  throw new CalendarBookingError("The calendar invitation could not be confirmed. Keep this booking and check its status before sending again.", false);
}
