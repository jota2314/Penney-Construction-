/**
 * Gmail API integration for Penney Construction workflow.
 * Sends automated HTML emails with signature and optional attachments.
 */

import { googleFetch } from "./auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  from?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  threadId?: string;
  inReplyTo?: string;
  attachments?: Attachment[];
}

interface Attachment {
  filename: string;
  mimeType: string;
  content: string; // base64 encoded
}

interface SentMessage {
  id: string;
  threadId: string;
}

const EMAIL_SIGNATURE = `
<br/>
<table cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; border-top: 1px solid #ccc; padding-top: 12px; margin-top: 16px;">
  <tr>
    <td style="padding-right: 12px; vertical-align: top;">
      <img src="https://penney-construction-mf6m.vercel.app/logo.jpg" alt="Penney Construction" width="60" style="border-radius: 4px;" />
    </td>
    <td style="vertical-align: top; font-size: 13px; color: #555;">
      <b style="color: #222;">Penney Construction Inc.</b><br/>
      <a href="https://www.penneyconstructioninc.com" style="color: #D97706; text-decoration: none;">www.penneyconstructioninc.com</a>
    </td>
  </tr>
</table>`;

/**
 * Wrap email body text in clean HTML that looks like a normal Gmail email.
 */
function wrapInHtml(body: string): string {
  // Convert plain text line breaks to HTML — keep it simple like Gmail
  const htmlBody = body
    .split("\n\n")
    .map((p) => `<div style="margin: 0 0 12px; line-height: 1.5; color: #222; font-size: 14px;">${p.replace(/\n/g, "<br/>")}</div>`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif;">
  ${htmlBody}
  ${EMAIL_SIGNATURE}
</body>
</html>`;
}

/**
 * Send an email via Gmail API.
 *
 * On 429: log the full Google error body (which contains the real reason
 * code — userRateLimitExceeded vs dailyLimitExceeded vs domainPolicy etc.),
 * read the Retry-After header, and surface a clean error to the caller.
 * No silent retry — retrying a 429 just compounds the throttle window.
 */
export async function sendEmail(input: SendEmailInput): Promise<SentMessage> {
  const rawMessage = buildRawEmail(input);
  const payload: Record<string, string> = { raw: rawMessage };
  if (input.threadId) payload.threadId = input.threadId;
  const body = JSON.stringify(payload);

  const res = await googleFetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("retry-after");
      const waitMs = parseGmailRetryWaitMs(errText, retryAfterHeader);
      const reason = parseGmailErrorReason(errText);
      console.error(
        `[gmail-send] 429 reason=${reason ?? "unknown"} retry-after=${retryAfterHeader ?? "n/a"} body=${errText}`
      );
      throw new Error(
        `Gmail rate limit (${reason ?? "rate-limited"}). Retry in ~${Math.ceil(waitMs / 1000)}s.`
      );
    }
    console.error(`[gmail-send] HTTP ${res.status} body=${errText}`);
    throw new Error(`Failed to send email: ${errText}`);
  }

  return res.json();
}

/**
 * Compute the wait time before another send is safe.
 * Prefers the standard Retry-After HTTP header (in seconds); falls back to
 * the "Retry after <ISO-timestamp>" string Google sometimes embeds in the
 * JSON error body. Final fallback is 60s — long enough to not re-arm the
 * rolling window if Google omits both signals.
 */
function parseGmailRetryWaitMs(errText: string, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }
  const match = errText.match(/Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (match) {
    const retryAt = Date.parse(match[1]);
    if (!Number.isNaN(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  return 60_000;
}

/**
 * Extract the Google error reason code from a JSON error body, e.g.
 * "userRateLimitExceeded", "rateLimitExceeded", "dailyLimitExceeded",
 * "domainPolicy". This is the single most useful signal for distinguishing
 * a per-user burst throttle from a project-level quota exhaustion.
 */
function parseGmailErrorReason(errText: string): string | null {
  try {
    const parsed = JSON.parse(errText);
    const errors = parsed?.error?.errors;
    if (Array.isArray(errors) && errors[0]?.reason) return String(errors[0].reason);
    if (parsed?.error?.status) return String(parsed.error.status);
  } catch {
    // not JSON
  }
  return null;
}

/**
 * Send a workflow email using a template with variable replacement.
 */
export async function sendTemplateEmail(
  template: { subject: string; body: string },
  to: string,
  variables: Record<string, string>,
  cc?: string
): Promise<SentMessage> {
  const subject = replaceVariables(template.subject, variables);
  const body = replaceVariables(template.body, variables);

  return sendEmail({ to, subject, body, cc });
}

/**
 * Replace {{variable}} placeholders in a template string.
 */
function replaceVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}

/**
 * RFC 2047 encode a header value if it contains non-ASCII characters.
 * Uses Base64 encoding: =?UTF-8?B?base64text?=
 */
function encodeHeaderValue(value: string): string {
  // Check if the string contains non-ASCII characters
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  // Encode as UTF-8 Base64 per RFC 2047
  const encoded = btoa(unescape(encodeURIComponent(value)));
  return `=?UTF-8?B?${encoded}?=`;
}

/**
 * Build a RFC 2822 email message and base64url encode it for Gmail API.
 * Supports HTML content and optional file attachments.
 */
function buildRawEmail(input: SendEmailInput): string {
  const htmlBody = wrapInHtml(input.body);

  if (input.attachments && input.attachments.length > 0) {
    return buildMultipartEmail(input, htmlBody);
  }

  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
  ];

  if (input.from) headers.unshift(`From: ${input.from}`);
  const ccStr = Array.isArray(input.cc) ? input.cc.join(", ") : typeof input.cc === "string" ? input.cc : "";
  if (ccStr.trim() && ccStr.includes("@")) headers.push(`Cc: ${ccStr.trim()}`);
  const bccStr = Array.isArray(input.bcc) ? input.bcc.join(", ") : typeof input.bcc === "string" ? input.bcc : "";
  if (bccStr.trim() && bccStr.includes("@")) headers.push(`Bcc: ${bccStr.trim()}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);

  const message = `${headers.join("\r\n")}\r\n\r\n${htmlBody}`;

  return btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Build a multipart MIME email with attachments.
 */
function buildMultipartEmail(input: SendEmailInput, htmlBody: string): string {
  const boundary = `boundary_${Date.now()}`;

  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  if (input.from) headers.unshift(`From: ${input.from}`);
  const ccStr = Array.isArray(input.cc) ? input.cc.join(", ") : typeof input.cc === "string" ? input.cc : "";
  if (ccStr.trim() && ccStr.includes("@")) headers.push(`Cc: ${ccStr.trim()}`);
  const bccStr = Array.isArray(input.bcc) ? input.bcc.join(", ") : typeof input.bcc === "string" ? input.bcc : "";
  if (bccStr.trim() && bccStr.includes("@")) headers.push(`Bcc: ${bccStr.trim()}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);

  let body = `${headers.join("\r\n")}\r\n\r\n`;

  // HTML body part
  body += `--${boundary}\r\n`;
  body += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
  body += `${htmlBody}\r\n\r\n`;

  // Attachments
  for (const attachment of input.attachments || []) {
    body += `--${boundary}\r\n`;
    body += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
    body += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
    body += `Content-Transfer-Encoding: base64\r\n\r\n`;
    body += `${attachment.content}\r\n\r\n`;
  }

  body += `--${boundary}--`;

  return btoa(unescape(encodeURIComponent(body)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
