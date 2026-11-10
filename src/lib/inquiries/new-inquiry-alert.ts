import "server-only";

import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerGmailAccessToken } from "@/lib/notifications/tagged-mentions";
import { isNotificationTestMode, testModeSubject, TEST_MODE_RECIPIENT_EMAILS } from "@/lib/notifications/test-mode";
import { inquiryText, type Inquiry } from "@/lib/inquiries/model";
import { readWalkthroughRequest, walkthroughDateLabel } from "@/lib/inquiries/booking-model";

/** Jorge 2026-11-10: every new website inquiry emails Jorge, Ryan and Shannon. */
export const NEW_INQUIRY_ALERT_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
  "rpenney@penneyconstructioninc.com",
  "spenney@penneyconstructioninc.com",
];
/** Sent from Jorge's mailbox when it is connected; any connected teammate otherwise. */
const SENDER_EMAIL = "jbetancur@penneyconstructioninc.com";
const APP_URL = process.env.APP_BASE_URL ?? "https://www.penneyconstruction.build";
const COLUMNS = "id,contact_name,description,created_at,updated_at,assignee,due_date,status,snooze_until,intake_status,lead_id,website_inquiry";

export type NewInquiryAlertResult = { claimed: number; sent: number; failed: number; skipped: number; error?: string };

/** The email body is HTML: everything the homeowner typed is escaped. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function oneLine(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function projectLabel(type: string): string {
  if (!type) return "Not given";
  if (type === "adu") return "ADU";
  const text = type.replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function propertyAddress(row: Inquiry): string {
  const context = row.website_inquiry?.propertyContext as { property?: { address?: unknown } } | null | undefined;
  return typeof context?.property?.address === "string" ? context.property.address.trim() : "";
}

export function buildNewInquiryAlert(row: Inquiry): { subject: string; body: string } {
  const name = oneLine(inquiryText(row, "name"), 120) || "Website visitor";
  const town = oneLine(inquiryText(row, "town"), 80);
  const walkthrough = readWalkthroughRequest(row);
  const address = walkthrough?.address || propertyAddress(row);
  const details = [
    `Name: ${name}`,
    town && `Town: ${town}`,
    address && `Address: ${address}`,
    `Project: ${projectLabel(inquiryText(row, "projectType"))}`,
    inquiryText(row, "timeline") && `Timeline: ${inquiryText(row, "timeline")}`,
    `Email: ${inquiryText(row, "email") || "Not given"}`,
    `Phone: ${inquiryText(row, "phone") || "Not given"}`,
    walkthrough && `Walkthrough requested: ${walkthroughDateLabel(walkthrough.start, walkthrough.end)}`,
    inquiryText(row, "heardAbout") && `Heard about us: ${inquiryText(row, "heardAbout")}`,
  ].filter((line): line is string => !!line).map(escapeHtml).join("\n");
  const message = inquiryText(row, "message").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 3000);
  const link = `${APP_URL}/command-center/inquiries/${row.id}`;
  const body = [
    "New website lead.",
    details,
    message ? `Message:\n${escapeHtml(message)}` : "",
    `<a href="${escapeHtml(link)}">Open it in the app</a>`,
  ].filter(Boolean).join("\n\n");
  return { subject: `New website lead: ${name}${town ? `, ${town}` : ""}`, body };
}

/**
 * Email each new website inquiry to Jorge, Ryan and Shannon once. Run by the
 * cron every minute. Never throws; a failed send is retried on later runs.
 */
export async function sendNewWebsiteInquiryAlerts(): Promise<NewInquiryAlertResult> {
  const result: NewInquiryAlertResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("claim_website_inquiry_alerts", { p_limit: 10 });
  if (claimError) return { ...result, error: "claim failed" };
  const ids = ((claimed as string[] | null) ?? []).filter((id) => typeof id === "string");
  result.claimed = ids.length;
  if (ids.length === 0) return result;

  const finish = (id: string, patch: Record<string, unknown>) =>
    admin.from("website_inquiry_alerts").update(patch).eq("inquiry_id", id);

  const { data: rows, error: rowsError } = await admin.from("todos").select(COLUMNS).eq("source", "website").in("id", ids);
  if (rowsError) {
    await Promise.all(ids.map((id) => finish(id, { status: "failed", error: "inquiry load failed" })));
    return { ...result, failed: ids.length, error: "inquiry load failed" };
  }
  const byId = new Map(((rows as Inquiry[] | null) ?? []).map((row) => [row.id, row]));

  const { data: sender } = await admin.from("profiles").select("id").eq("email", SENDER_EMAIL)
    .not("google_refresh_token", "is", null).limit(1).maybeSingle();
  const accessToken = await getServerGmailAccessToken(admin, sender?.id ?? "");
  const testMode = await isNotificationTestMode(admin);
  const recipients = testMode ? [...TEST_MODE_RECIPIENT_EMAILS] : [...NEW_INQUIRY_ALERT_EMAILS];

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { result.skipped++; await finish(id, { status: "skipped", error: "inquiry not found" }); continue; }
    if (!accessToken) { result.failed++; await finish(id, { status: "failed", error: "no connected Gmail account" }); continue; }
    const alert = buildNewInquiryAlert(row);
    try {
      await sendEmailWithAccessToken({
        to: recipients.join(", "),
        subject: testMode ? testModeSubject(alert.subject) : alert.subject,
        body: alert.body,
      }, accessToken);
    } catch (err) {
      result.failed++;
      console.error("[inquiry-alert] Email failed", { inquiryId: id, error: err instanceof Error ? err.message.slice(0, 300) : "unknown" });
      await finish(id, { status: "failed", error: (err instanceof Error ? err.message : "send failed").slice(0, 500) });
      continue;
    }
    result.sent++;
    const { error } = await finish(id, { status: "sent", sent_at: new Date().toISOString(), recipients, error: null });
    if (error) console.error("[inquiry-alert] Sent but not recorded", { inquiryId: id });
  }
  return result;
}
