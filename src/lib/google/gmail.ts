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
<table cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; margin-top: 24px; border-top: 2px solid #D97706; padding-top: 16px;">
  <tr>
    <td style="padding-right: 16px; vertical-align: top;">
      <img src="https://penney-construction-mf6m.vercel.app/logo.jpg" alt="Penney Construction" width="80" style="border-radius: 4px;" />
    </td>
    <td style="vertical-align: top;">
      <p style="margin: 0; font-weight: bold; font-size: 14px; color: #1a1a1a;">Penney Construction Inc.</p>
      <p style="margin: 2px 0 0; font-size: 12px; color: #666;">Building Quality, Building Trust</p>
      <p style="margin: 8px 0 0; font-size: 12px; color: #666;">
        <a href="https://www.penneyconstructioninc.com" style="color: #D97706; text-decoration: none;">www.penneyconstructioninc.com</a>
      </p>
    </td>
  </tr>
</table>`;

/**
 * Wrap email body text in a professional HTML template with signature.
 */
function wrapInHtml(body: string): string {
  // Convert plain text line breaks to HTML
  const htmlBody = body
    .split("\n\n")
    .map((p) => `<p style="margin: 0 0 12px; line-height: 1.6; color: #333;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
  <div style="background-color: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e5e5;">
    ${htmlBody}
    ${EMAIL_SIGNATURE}
  </div>
</body>
</html>`;
}

/**
 * Send an email via Gmail API.
 */
export async function sendEmail(input: SendEmailInput): Promise<SentMessage> {
  const rawMessage = buildRawEmail(input);

  const payload: Record<string, string> = { raw: rawMessage };
  if (input.threadId) payload.threadId = input.threadId;

  const res = await googleFetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to send email: ${err}`);
  }

  return res.json();
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
  if (input.cc) headers.push(`Cc: ${input.cc}`);
  if (input.bcc) headers.push(`Bcc: ${input.bcc}`);
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
  if (input.cc) headers.push(`Cc: ${input.cc}`);
  if (input.bcc) headers.push(`Bcc: ${input.bcc}`);
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
