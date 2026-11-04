"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { isJorge } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { googleFetch } from "@/lib/google/auth";
import { sendEmail } from "@/lib/google/gmail";
import { canManageWebsiteInquiries, inquiryText, type Inquiry } from "@/lib/inquiries/model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const HISTORY_COLUMNS = "id,inquiry_id,sender_profile_id,recipient_email,subject,body,status,gmail_message_id,gmail_thread_id,created_at,sent_at,error";
const UNCERTAIN = "Delivery could not be confirmed. Check the sender's Sent folder before another email is attempted. This attempt will not be sent again automatically.";

export type WebsiteInquiryEmail = {
  id: string; inquiry_id: string | null; sender_profile_id: string; recipient_email: string;
  subject: string; body: string; status: "sending" | "sent" | "uncertain" | "failed";
  gmail_message_id: string | null; gmail_thread_id: string | null;
  created_at: string; sent_at: string | null; error: string | null;
  sender_name: string | null;
};
export type WebsiteInquiryEmailInput = {
  id: string; expectedUpdatedAt: string; expectedRecipient: string; expectedSender: string;
  requestId: string; subject: string; body: string;
};
export type WebsiteInquiryEmailResult =
  | { success: true; messageId: string; warning?: string; alreadySent?: boolean }
  | { success: false; error: string; deliveryUncertain?: boolean; retrySafe?: boolean };

async function emailAccess(write = false) {
  const user = await getUser();
  if (!user || !canManageWebsiteInquiries(user.email) ||
    !canManageWebsiteInquiries(user.realProfile?.email) || !canManageWebsiteInquiries(user.profile?.email)) {
    throw new Error("Website inquiries are available only to Jorge, Ryan, Nico, and Shannon.");
  }
  if (write && user.isImpersonating) throw new Error("Exit View as before emailing a client.");
  const db = await createClient();
  const { data: member, error } = await db.rpc("can_access_website_inquiries");
  if (error || member !== true) throw new Error("Website inquiry access could not be confirmed. Refresh before continuing.");
  return { user, db };
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const local = email.split("@")[0];
  return email.length <= 254 && local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") &&
    !local.includes("..") && EMAIL.test(email) ? email : null;
}

async function connectedMailbox(signedInEmail: string): Promise<string> {
  // Read the same current-user Google connection that the app send transport uses.
  // Never select another teammate's token or fall back to a company mailbox.
  let response: Response;
  try { response = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile"); }
  catch { throw new Error("Your Google email connection is unavailable. Reconnect Google in Settings before sending."); }
  if (!response.ok) throw new Error("Your Google email connection is unavailable. Reconnect Google in Settings before sending.");
  let profile: { emailAddress?: unknown };
  try { profile = await response.json() as { emailAddress?: unknown }; }
  catch { throw new Error("Your Google mailbox could not be confirmed. Reconnect Google in Settings before sending."); }
  const email = normalizedEmail(profile.emailAddress);
  // Jorge's two verified sign-ins belong to the same person. Other teammates
  // must use their own exact mailbox; membership never authorizes cross-sending.
  if (!email || (email !== normalizedEmail(signedInEmail) && !(isJorge(email) && isJorge(signedInEmail)))) {
    throw new Error("The connected Google mailbox does not match your signed-in account. Reconnect your own Google account in Settings before sending.");
  }
  return email;
}

/** Only reads the connected mailbox; opening the editor never sends an email. */
export async function getWebsiteInquiryEmailSender(): Promise<{ email: string | null; error?: string }> {
  try {
    const { user } = await emailAccess(true);
    return { email: await connectedMailbox(user.email) };
  } catch (error) {
    return { email: null, error: error instanceof Error ? error.message : "Your Google email connection could not be checked." };
  }
}

export async function listWebsiteInquiryEmails(id: string): Promise<WebsiteInquiryEmail[]> {
  const { db } = await emailAccess();
  if (!UUID.test(id)) return [];
  type HistoryRow = Omit<WebsiteInquiryEmail, "sender_name"> & {
    sender: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const rows = await fetchAllRows<HistoryRow>((from, to) => db.from("website_inquiry_emails")
    .select(`${HISTORY_COLUMNS},sender:profiles!website_inquiry_emails_sender_profile_id_fkey(full_name)`)
    .eq("inquiry_id", id).order("created_at", { ascending: false })
    .order("id").range(from, to).throwOnError());
  return rows.map(({ sender, ...email }) => ({
    ...email,
    sender_name: (Array.isArray(sender) ? sender[0] : sender)?.full_name?.trim() || null,
  }));
}

function refreshInquiry(id: string) {
  try {
    revalidatePath("/command-center");
    revalidatePath("/command-center/inquiries");
    revalidatePath(`/command-center/inquiries/${id}`);
    revalidatePath("/command-center/todos");
  } catch { /* A cache refresh failure must never turn a sent email into a retry. */ }
}

function escapePlainText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function definitelyRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "GmailRateLimitError") return true;
  const prefix = "Failed to send email:";
  if (!error.message.startsWith(prefix)) return false;
  try {
    const response = JSON.parse(error.message.slice(prefix.length)) as { error?: { code?: number } };
    // Server errors and unrecognized responses can follow an accepted message.
    // Only explicit client/auth/quota rejections can safely permit another send.
    return [400, 401, 403, 404, 429].includes(response.error?.code ?? 0);
  } catch { return false; }
}

/** Called only by the user's Send click after the full editable draft is displayed. */
export async function sendWebsiteInquiryEmail(input: WebsiteInquiryEmailInput): Promise<WebsiteInquiryEmailResult> {
  try {
    const { user, db } = await emailAccess(true);
    if (!input || !UUID.test(input.id) || !UUID.test(input.requestId) ||
      typeof input.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) ||
      typeof input.subject !== "string" || !input.subject.trim() || input.subject.trim().length > 200 ||
      /[\u0000-\u001f\u007f]/.test(input.subject) || typeof input.body !== "string" ||
      !input.body.trim() || input.body.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.body)) {
      return { success: false, error: "Check the email draft: a subject of up to 200 characters and a message of up to 20,000 characters are required." };
    }
    const reviewedRecipient = normalizedEmail(input.expectedRecipient);
    const reviewedSender = normalizedEmail(input.expectedSender);
    if (!reviewedRecipient || !reviewedSender) return { success: false, error: "Confirm the client email and your sending mailbox before sending." };

    // RLS must admit this exact inquiry before a service-role operation is possible.
    const { data, error: inquiryError } = await db.from("todos")
      .select("id,updated_at,contact_name,description,website_inquiry,intake_status,status")
      .eq("id", input.id).eq("source", "website").maybeSingle();
    if (inquiryError || !data) return { success: false, error: "The inquiry is no longer available. Refresh before continuing." };
    const inquiry = data as Inquiry;
    const recipient = normalizedEmail(inquiryText(inquiry, "email"));
    if (!recipient || recipient !== reviewedRecipient) return { success: false, error: "The client email changed or is invalid. Refresh and review the recipient before sending." };
    const subject = input.subject.trim();

    // A repeated request can report its previous outcome without another Gmail call.
    const { data: prior, error: priorError } = await db.from("website_inquiry_emails")
      .select(HISTORY_COLUMNS).eq("id", input.requestId).maybeSingle();
    if (priorError) return { success: false, error: "Email history could not be checked. No email was sent." };
    if (prior) {
      if (prior.inquiry_id !== input.id || prior.sender_profile_id !== user.id ||
        prior.recipient_email !== recipient || prior.subject !== subject || prior.body !== input.body) {
        return { success: false, error: "This email request was already used for a different draft. Close the editor and review a new draft." };
      }
      if (prior.status === "sent" && typeof prior.gmail_message_id === "string" && prior.gmail_message_id) {
        return { success: true, messageId: prior.gmail_message_id, alreadySent: true };
      }
      if (prior.status !== "failed") return { success: false, error: UNCERTAIN, deliveryUncertain: true };
    }

    const sender = await connectedMailbox(user.email);
    if (sender !== reviewedSender) return { success: false, error: "Your sending mailbox changed. Close and reopen the email editor to review the current sender." };
    const admin = createAdminClient();
    const { data: claim, error: claimError } = await admin.rpc("begin_website_inquiry_email", {
      p_email_id: input.requestId, p_todo_id: input.id, p_sender_profile_id: user.id,
      p_recipient_email: recipient, p_subject: subject, p_body: input.body,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (claimError) return { success: false, error: claimError.message };
    if (!claim || claim.claimed !== true) {
      if (claim?.status === "sent" && typeof claim.gmail_message_id === "string" && claim.gmail_message_id) {
        return { success: true, messageId: claim.gmail_message_id, alreadySent: true };
      }
      return { success: false, error: UNCERTAIN, deliveryUncertain: true };
    }

    let sent: { id: string; threadId: string };
    try {
      sent = await sendEmail({ to: recipient, subject, body: escapePlainText(input.body) });
      if (!sent || typeof sent.id !== "string" || !sent.id.trim()) throw new Error("Gmail did not confirm a message ID.");
    } catch (error) {
      // These are explicit Gmail rejections from the existing transport, not
      // ambiguous timeouts or malformed success responses. Retry is user-only.
      const rejected = definitelyRejected(error);
      if (rejected) {
        const message = error instanceof Error && error.name === "GmailRateLimitError"
          ? "Google did not accept this email because of its sending limit. Wait before pressing Send again."
          : "Google did not accept this email. Check your Google connection before pressing Send again.";
        try {
          const { data: failed, error: failedError } = await admin.rpc("mark_website_inquiry_email_failed", { p_email_id: input.requestId, p_error: message });
          if (!failedError && failed?.status === "failed") {
            refreshInquiry(input.id);
            return { success: false, error: message, retrySafe: true };
          }
        } catch { /* The reservation remains blocked until its status is reconciled. */ }
        refreshInquiry(input.id);
        return { success: false, error: "Google rejected the email, but its saved status could not be updated. Check the email history before another attempt.", deliveryUncertain: true };
      }
      // A timeout can occur after Gmail accepted the message. Keep the reservation
      // blocked even when recording the error fails; never offer an automatic retry.
      try { await admin.rpc("mark_website_inquiry_email_uncertain", { p_email_id: input.requestId, p_error: UNCERTAIN }); } catch { /* Existing sending reservation remains blocked. */ }
      refreshInquiry(input.id);
      return { success: false, error: UNCERTAIN, deliveryUncertain: true };
    }

    let finalized = false;
    try {
      const { data: result, error } = await admin.rpc("finish_website_inquiry_email", {
        p_email_id: input.requestId, p_gmail_message_id: sent.id, p_gmail_thread_id: sent.threadId || null,
      });
      finalized = !error && result?.status === "sent";
    } catch { /* Gmail delivery succeeded; the caller must not retry the email. */ }
    refreshInquiry(input.id);
    return finalized
      ? { success: true, messageId: sent.id }
      : { success: true, messageId: sent.id, warning: "Email sent, but the inquiry history could not be updated. Do not send it again. Check your Sent folder and have the saved status reconciled." };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The email could not be prepared. No email was sent." };
  }
}
