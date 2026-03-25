/**
 * Google Calendar API integration for Penney Construction workflow.
 * Creates walkthrough meetings and project events.
 */

import { googleFetch } from "./auth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface CalendarEvent {
  id: string;
  htmlLink: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  attendees?: string[]; // email addresses
  calendarId?: string;
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

  const res = await googleFetch(
    `${CALENDAR_API}/calendars/${calendarId}/events?fields=id,htmlLink,summary,start,end`,
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
