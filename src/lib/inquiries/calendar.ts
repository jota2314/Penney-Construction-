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
const UNAVAILABLE = "Ryan's calendar could not be checked. Try again before confirming a walkthrough.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CalendarDiagnosticStage = "profile" | "configuration" | "refresh" | "primary" | "calendar_list" | "free_busy" | "reservations" | "validation" | "availability" | "complete";
const DIAGNOSTIC_REASONS = ["invalid_client", "unauthorized_client", "invalid_grant", "invalid_scope", "access_denied",
  "temporarily_unavailable", "server_error", "insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "accessNotConfigured",
  "SERVICE_DISABLED", "forbidden", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded",
  "RATE_LIMIT_EXCEEDED", "notFound", "internalError", "tooManyCalendarsRequested", "groupTooBig",
  "http_error", "network_error", "timeout", "invalid_response", "database_error", "missing_refresh_token",
  "missing_client_credentials", "account_mismatch", "too_many_calendars", "invalid_day", "unknown", "ok"] as const;
export type CalendarDiagnosticReason = (typeof DIAGNOSTIC_REASONS)[number];
type CalendarScopeFlags = { calendarMetadata: boolean; calendarList: boolean; freeBusy: boolean; calendarWrite: boolean };
export type CalendarAvailabilityDiagnostic = {
  stage: CalendarDiagnosticStage; reason: CalendarDiagnosticReason; status?: number; scopes?: CalendarScopeFlags;
};

export type RyanAvailability = {
  connected: boolean; timeZone: typeof WALKTHROUGH_TIME_ZONE; durationMinutes: typeof WALKTHROUGH_DURATION_MINUTES;
  slots: CalendarInterval[]; busy: CalendarInterval[]; message?: string; calendarUrl?: string; diagnostic?: CalendarAvailabilityDiagnostic;
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
  constructor(message: string, public readonly retrySafe: boolean, public readonly diagnostic?: CalendarAvailabilityDiagnostic) { super(message); this.name = "CalendarBookingError"; }
}

function availabilityMessage(stage: CalendarDiagnosticStage, reason: CalendarDiagnosticReason): string {
  if (reason === "missing_refresh_token" || reason === "invalid_grant") return "Ryan’s saved Google connection is missing, expired or revoked. Ryan needs to reconnect Google in Settings.";
  if (reason === "account_mismatch") return "The saved Google connection does not match Ryan’s account. Ryan needs to reconnect the correct Google account in Settings.";
  if (stage === "configuration") return "The app’s Google sign-in credentials could not be loaded. Check the app’s Google configuration before reconnecting.";
  if (reason === "invalid_client" || reason === "unauthorized_client") return "Google rejected Ryan’s saved connection. Verify the app’s Google configuration, then have Ryan reconnect Google in Settings.";
  if (["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "invalid_scope"].includes(reason)) return "Ryan’s Google connection lacks the Calendar permissions needed to check availability. Ryan needs to reconnect Google in Settings and allow the requested Calendar permissions.";
  if (["accessNotConfigured", "SERVICE_DISABLED"].includes(reason)) return "The Google Calendar API is not enabled for the app’s Google project. The app’s Google configuration needs to be checked.";
  if (["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded", "RATE_LIMIT_EXCEEDED"].includes(reason)) return "Google is limiting Calendar requests. Wait a few minutes, then check availability again.";
  if (stage === "reservations") return "Saved walkthrough reservations could not be checked. Try again before confirming a time; the booking records may need attention.";
  if (stage === "profile") return "Ryan’s saved Google connection could not be read. Try again; the app’s connection records may need attention.";
  if (stage === "free_busy" && ["notFound", "forbidden", "groupTooBig", "tooManyCalendarsRequested"].includes(reason)) return "One of Ryan’s selected calendars could not be checked. Review his selected calendars and their permissions before confirming a walkthrough.";
  if (reason === "too_many_calendars") return "Ryan has more than 50 selected calendars. Choose the calendars used for scheduling before booking a walkthrough.";
  if (reason === "timeout" || reason === "network_error") return "The calendar service did not respond. Try checking availability again.";
  if (reason === "forbidden" || reason === "access_denied") return "Google denied access to Ryan’s calendar. Check the Calendar permissions on his Google connection.";
  return UNAVAILABLE;
}

function unavailable(stage: CalendarDiagnosticStage, reason: CalendarDiagnosticReason, status?: number, scopes?: CalendarScopeFlags): never {
  throw new CalendarBookingError(availabilityMessage(stage, reason), true, { stage, reason,
    ...(status && status >= 100 && status <= 599 ? { status } : {}), ...(scopes ? { scopes } : {}) });
}

async function availabilityStep<T>(stage: CalendarDiagnosticStage, run: () => PromiseLike<T>, scopes?: CalendarScopeFlags): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof CalendarBookingError) throw error;
    const name = error && typeof error === "object" && "name" in error ? error.name : "";
    const reason = name === "AbortError" || name === "TimeoutError" ? "timeout" :
      ["profile", "configuration", "reservations"].includes(stage) ? "database_error" : "network_error";
    unavailable(stage, reason, undefined, scopes);
  }
}

/** Keep only documented codes. Never retain Google's message, body, IDs or credentials. */
function safeGoogleReason(body: unknown): CalendarDiagnosticReason {
  if (!body || typeof body !== "object") return "http_error";
  const error = (body as { error?: unknown }).error;
  const candidates: unknown[] = [error];
  if (error && typeof error === "object") {
    const detail = error as { errors?: { reason?: unknown }[]; details?: { reason?: unknown }[]; status?: unknown };
    candidates.push(...(Array.isArray(detail.errors) ? detail.errors.map((item) => item?.reason) : []));
    candidates.push(...(Array.isArray(detail.details) ? detail.details.map((item) => item?.reason) : []), detail.status);
  }
  return candidates.find((value): value is CalendarDiagnosticReason => typeof value === "string" && (DIAGNOSTIC_REASONS as readonly string[]).includes(value)) || "http_error";
}

async function requireGoogleOk(response: Response, stage: CalendarDiagnosticStage, scopes?: CalendarScopeFlags) {
  if (!response.ok) unavailable(stage, safeGoogleReason(await response.json().catch(() => null)), response.status, scopes);
}

async function googleJson<T>(response: Response, stage: CalendarDiagnosticStage, scopes?: CalendarScopeFlags): Promise<T> {
  try { return await response.json() as T; }
  catch { unavailable(stage, "invalid_response", response.status, scopes); }
}

function scopeFlags(value: unknown): CalendarScopeFlags | undefined {
  if (typeof value !== "string") return undefined;
  const scopes = new Set(value.split(/\s+/));
  const has = (...names: string[]) => names.some((name) => scopes.has(`https://www.googleapis.com/auth/${name}`));
  return {
    calendarMetadata: has("calendar", "calendar.readonly", "calendar.calendars", "calendar.calendars.readonly", "calendar.app.created"),
    calendarList: has("calendar", "calendar.readonly", "calendar.calendarlist", "calendar.calendarlist.readonly"),
    freeBusy: has("calendar", "calendar.readonly", "calendar.events.freebusy", "calendar.freebusy"),
    calendarWrite: has("calendar", "calendar.events", "calendar.events.owned", "calendar.app.created"),
  };
}

async function ryanToken(): Promise<{ token: string; scopes?: CalendarScopeFlags }> {
  const { data: profile, error } = await availabilityStep("profile", () => createAdminClient().from("profiles").select("id,email,google_refresh_token")
    .eq("id", RYAN_ID).maybeSingle().then((result) => result));
  if (error) unavailable("profile", "database_error");
  if (profile?.email?.trim().toLowerCase() !== RYAN_EMAIL) unavailable("profile", "account_mismatch");
  if (!profile?.google_refresh_token) unavailable("profile", "missing_refresh_token");
  let clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const { data: settings, error: settingsError } = await availabilityStep("configuration", () => createAdminClient().from("app_settings").select("key,value")
      .in("key", ["google_client_id", "google_client_secret"]).then((result) => result));
    if (settingsError) unavailable("configuration", "database_error");
    clientId = settings?.find((row) => row.key === "google_client_id")?.value;
    clientSecret = settings?.find((row) => row.key === "google_client_secret")?.value;
  }
  if (!clientId || !clientSecret) unavailable("configuration", "missing_client_credentials");
  return availabilityStep("refresh", async () => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
        refresh_token: profile.google_refresh_token, grant_type: "refresh_token" }),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    await requireGoogleOk(response, "refresh");
    const result = await googleJson<{ access_token?: unknown; scope?: unknown }>(response, "refresh");
    if (typeof result.access_token !== "string" || !result.access_token) unavailable("refresh", "invalid_response", response.status);
    return { token: result.access_token, scopes: scopeFlags(result.scope) };
  });
}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${CALENDAR_API}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
}

async function verifiedConnection(): Promise<{ token: string; calendars: string[]; scopes?: CalendarScopeFlags }> {
  const { token, scopes } = await ryanToken();
  const primary = await availabilityStep("primary", () => request(token, "/calendars/primary?fields=id"), scopes);
  await requireGoogleOk(primary, "primary", scopes);
  const primaryCalendar = await googleJson<{ id?: unknown }>(primary, "primary", scopes);
  if (typeof primaryCalendar.id !== "string") unavailable("primary", "invalid_response", primary.status, scopes);
  if (primaryCalendar.id.toLowerCase() !== RYAN_EMAIL) unavailable("primary", "account_mismatch", primary.status, scopes);
  const calendars = new Set([RYAN_EMAIL]);
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250", fields: "items(id,selected,primary,deleted),nextPageToken" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await availabilityStep("calendar_list", () => request(token, `/users/me/calendarList?${params}`), scopes);
    await requireGoogleOk(response, "calendar_list", scopes);
    const result = await googleJson<{ items?: { id?: string; selected?: boolean; primary?: boolean; deleted?: boolean }[]; nextPageToken?: string }>(response, "calendar_list", scopes);
    if (!Array.isArray(result.items)) unavailable("calendar_list", "invalid_response", response.status, scopes);
    for (const item of result.items) if (item.id && !item.deleted && (item.selected || item.primary)) calendars.add(item.id);
    pageToken = result.nextPageToken;
    // Google's free/busy API supports at most 50 calendars. Never silently drop one.
    if (calendars.size > 50) unavailable("calendar_list", "too_many_calendars", response.status, scopes);
  } while (pageToken);
  return { token, calendars: [...calendars], scopes };
}

async function readBusy(connection: { token: string; calendars: string[]; scopes?: CalendarScopeFlags }, range: CalendarInterval): Promise<CalendarInterval[]> {
  // Include adjacent bookings so a visit at the edge of the range still gets travel time.
  const response = await availabilityStep("free_busy", () => request(connection.token, "/freeBusy", { method: "POST", body: JSON.stringify({
    timeMin: new Date(Date.parse(range.start) - WALKTHROUGH_BUFFER_MINUTES * 60_000).toISOString(),
    timeMax: new Date(Date.parse(range.end) + WALKTHROUGH_BUFFER_MINUTES * 60_000).toISOString(),
    timeZone: WALKTHROUGH_TIME_ZONE, calendarExpansionMax: 50, items: connection.calendars.map((id) => ({ id })),
  }) }), connection.scopes);
  await requireGoogleOk(response, "free_busy", connection.scopes);
  const result = await googleJson<{ calendars?: Record<string, { errors?: { reason?: unknown }[]; busy?: CalendarInterval[] }> }>(response, "free_busy", connection.scopes);
  const busy: CalendarInterval[] = [];
  for (const id of connection.calendars) {
    const calendar = result.calendars?.[id];
    if (calendar?.errors?.length) unavailable("free_busy", safeGoogleReason({ error: { errors: calendar.errors } }), response.status, connection.scopes);
    if (!calendar || !Array.isArray(calendar.busy)) unavailable("free_busy", "invalid_response", response.status, connection.scopes);
    for (const item of calendar.busy) {
      if (!item || !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end)) || Date.parse(item.end) <= Date.parse(item.start)) unavailable("free_busy", "invalid_response", response.status, connection.scopes);
      busy.push({ start: item.start, end: item.end });
    }
  }
  return busy.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

async function reservedBusy(range: CalendarInterval): Promise<CalendarInterval[]> {
  const buffer = WALKTHROUGH_BUFFER_MINUTES * 60_000;
  const { data, error } = await availabilityStep("reservations", () => createAdminClient().from("website_walkthrough_bookings")
    .select("start_at,end_at")
    .in("status", ["confirming", "calendar_created", "confirmed", "needs_attention", "cancelling"])
    .lt("start_at", new Date(Date.parse(range.end) + buffer).toISOString())
    .gt("end_at", new Date(Date.parse(range.start) - buffer).toISOString()).then((result) => result));
  // A missing/unreadable reservation ledger must not expose apparently free times.
  if (error || !Array.isArray(data)) unavailable("reservations", "database_error");
  return data.map((row) => {
    if (!Number.isFinite(Date.parse(row.start_at)) || !Number.isFinite(Date.parse(row.end_at)) || Date.parse(row.end_at) <= Date.parse(row.start_at)) unavailable("reservations", "invalid_response");
    return { start: row.start_at as string, end: row.end_at as string };
  });
}

/** Called by authorized staff actions or the service-authenticated website endpoint only. */
export async function getRyanAvailability(fromDay: string): Promise<RyanAvailability> {
  const base = { timeZone: WALKTHROUGH_TIME_ZONE, durationMinutes: WALKTHROUGH_DURATION_MINUTES, slots: [], busy: [] };
  if (!validAvailabilityDay(fromDay)) return { ...base, connected: false, message: "Choose a date within the next 60 days.", diagnostic: { stage: "validation", reason: "invalid_day" } };
  try {
    const connection = await verifiedConnection();
    const range = availabilityRange(fromDay);
    const [calendarBusy, bookingBusy] = await Promise.all([readBusy(connection, range), reservedBusy(range)]);
    const busy = [...calendarBusy, ...bookingBusy].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return { ...base, connected: true, slots: walkthroughSlots(fromDay, busy), busy, calendarUrl: CALENDAR_URL,
      diagnostic: { stage: "complete", reason: "ok", ...(connection.scopes ? { scopes: connection.scopes } : {}) } };
  } catch (error) {
    return { ...base, connected: false, message: error instanceof CalendarBookingError ? error.message : UNAVAILABLE,
      diagnostic: error instanceof CalendarBookingError && error.diagnostic ? error.diagnostic : { stage: "availability", reason: "unknown" } };
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
