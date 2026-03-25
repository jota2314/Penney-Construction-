/**
 * Gmail API integration for Penney Construction workflow.
 * Sends automated emails at each workflow stage.
 */

import { googleFetch } from "./auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
}

interface SentMessage {
  id: string;
  threadId: string;
}

/**
 * Send an email via Gmail API.
 */
export async function sendEmail(input: SendEmailInput): Promise<SentMessage> {
  const rawMessage = buildRawEmail(input);

  const res = await googleFetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: rawMessage }),
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
 * Build a RFC 2822 email message and base64url encode it for Gmail API.
 */
function buildRawEmail(input: SendEmailInput): string {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];

  if (input.cc) headers.push(`Cc: ${input.cc}`);
  if (input.bcc) headers.push(`Bcc: ${input.bcc}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);

  const message = `${headers.join("\r\n")}\r\n\r\n${input.body}`;

  // Base64url encode
  return btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
