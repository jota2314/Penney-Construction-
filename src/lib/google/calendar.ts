/**
 * Google Calendar API integration for Penney Construction workflow.
 * Creates walkthrough meetings, project events, and scheduled events with Google Meet.
 */

import { googleFetch } from "./auth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface CalendarEvent {
  id: string;
  htmlLink: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType: string; uri: string }[];
  };
}

interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  attendees?: string[]; // email addresses
  calendarId?: string;
  withMeetLink?: boolean;
}

/**
 * Create a walkthrough meeting event in Google Calendar.
 */
export async function createWalkthroughEvent(input: {
  clientName: string;
  projectName: string;
  address: string;
  startTime: string;
  endTime: string;
  attendees?: string[];
  description?: string;
}): Promise<CalendarEvent> {
  return createEvent({
    summary: `Walkthrough: ${input.clientName} - ${input.projectName}`,
    description:
      input.description ||
      `Walkthrough for ${input.projectName}\nClient: ${input.clientName}\nAddress: ${input.address}`,
    location: input.address,
    startTime: input.startTime,
    endTime: input.endTime,
    attendees: input.attendees,
  });
}

/**
 * Create a scheduled event with optional Google Meet link.
 */
export async function createScheduledEvent(input: {
  name: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  attendees?: string[];
  withMeetLink?: boolean;
}): Promise<CalendarEvent> {
  return createEvent({
    summary: input.name,
    description: input.description,
    location: input.location,
    startTime: input.startTime,
    endTime: input.endTime,
    attendees: input.attendees,
    withMeetLink: input.withMeetLink ?? true,
  });
}

/**
 * Create an event in Google Calendar.
 */
export async function createEvent(
  input: CreateEventInput
): Promise<CalendarEvent> {
  const calendarId = input.calendarId || "primary";

  const event: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: {
      dateTime: input.startTime,
      timeZone: "America/New_York",
    },
    end: {
      dateTime: input.endTime,
      timeZone: "America/New_York",
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 1440 }, // 24 hours before
        { method: "popup", minutes: 60 }, // 1 hour before
      ],
    },
  };

  if (input.attendees && input.attendees.length > 0) {
    event.attendees = input.attendees.map((email) => ({ email }));
    event.sendUpdates = "all";
  }

  if (input.withMeetLink) {
    event.conferenceData = {
      createRequest: {
        requestId: `penney-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const confVersion = input.withMeetLink ? 1 : 0;
  const fields = input.withMeetLink
    ? "id,htmlLink,summary,start,end,hangoutLink,conferenceData"
    : "id,htmlLink,summary,start,end";

  const res = await googleFetch(
    `${CALENDAR_API}/calendars/${calendarId}/events?conferenceDataVersion=${confVersion}&fields=${fields}`,
    {
      method: "POST",
      body: JSON.stringify(event),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create calendar event: ${err}`);
  }

  return res.json();
}

/**
 * Delete a calendar event. Notifies attendees that the event was cancelled.
 * Returns true if deleted (or already gone), false on auth/permission failure.
 */
export async function deleteEvent(eventId: string, calendarId = "primary"): Promise<boolean> {
  const res = await googleFetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE" },
  );
  // 204 = deleted, 404/410 = already gone (counts as success)
  if (res.ok || res.status === 404 || res.status === 410) return true;
  return false;
}
