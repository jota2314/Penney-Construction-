import { CalendarCheck2 } from "lucide-react";
import { connectRyanCalendar } from "@/lib/auth/actions";
import { getRyanCalendarConnection, type CalendarFix, type RyanCalendarConnection } from "@/lib/inquiries/calendar";
import { RYAN_EMAIL } from "@/lib/inquiries/model";
import { CalendarConnectButton } from "@/components/inquiries/calendar-connect-button";

/** Fixes that Ryan's own Google sign-in can clear. */
const RYAN_CAN_FIX: readonly CalendarFix[] = ["reconnect", "permissions", "wrong_account", "other"];
/** One line under the button, only after Ryan tried and it still is not connected. */
const TRY_AGAIN: Record<CalendarFix, string> = {
  reconnect: "Still not connected. Tap the button and finish Google's screens.",
  permissions: "Still not connected. On Google's screen, tick Select all, then Continue.",
  wrong_account: `Still not connected. Choose ${RYAN_EMAIL} on Google's screen.`,
  other: "Still not connected. Google would not let the app read the calendar.",
  setup: "", calendars: "",
};
/** For problems the button cannot fix, and for people who are not Ryan. */
const NOTE: Record<CalendarFix, string> = {
  reconnect: "Only Ryan can connect it, from this page on his phone.",
  permissions: "Only Ryan can connect it, from this page on his phone.",
  wrong_account: "Only Ryan can connect it, from this page on his phone.",
  other: "Only Ryan can connect it, from this page on his phone.",
  setup: "The app's Google setup needs Jorge.",
  calendars: "One of the calendars Ryan has switched on in Google Calendar could not be read.",
};
const LINE = "text-sm text-muted-foreground";

/**
 * Jorge, 11/14: no banner, just the orange button. Ryan sees only the button;
 * a short line appears under it after a try that did not work. Everyone else
 * gets one quiet line, because the button would do nothing for them.
 * `attempt` is the page's ?calendar= value: "check" after Google returns.
 */
export function CalendarConnectionNotice({ connection, viewerIsRyan, readOnly, attempt }: {
  connection: RyanCalendarConnection; viewerIsRyan: boolean; readOnly: boolean; attempt: string;
}) {
  if (connection.state === "connected") {
    return attempt !== "check" ? null : <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CalendarCheck2 className="size-4 shrink-0" aria-hidden="true" />Google Calendar is connected.</p>;
  }
  if (connection.state === "unknown") {
    return attempt !== "check" ? null : <p role="status" className={LINE}>Google has not answered yet. Refresh this page in a minute.</p>;
  }
  const { fix } = connection;
  if (!viewerIsRyan || readOnly || !RYAN_CAN_FIX.includes(fix)) return <p className={LINE}>Ryan&apos;s calendar is not connected. {NOTE[fix]}</p>;
  return <form action={connectRyanCalendar}>
    <CalendarConnectButton label="Connect Google Calendar" />
    {attempt === "check" && <p role="alert" className={`mt-2 ${LINE}`}>{TRY_AGAIN[fix]}</p>}
    {attempt === "start-failed" && <p role="alert" className={`mt-2 ${LINE}`}>Google sign-in could not start. Tap the button again.</p>}
  </form>;
}

/** Streams in after the lead list, so a slow Google reply never holds up the page. */
export async function CalendarConnectionBanner(props: { viewerIsRyan: boolean; readOnly: boolean; attempt: string }) {
  return <CalendarConnectionNotice connection={await getRyanCalendarConnection()} {...props} />;
}
