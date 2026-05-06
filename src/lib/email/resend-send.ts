/**
 * Resend transactional email sender.
 *
 * Bypasses Gmail's API entirely — sends go through Resend's HTTPS API
 * with our domain's SPF/DKIM. This is the escape hatch for when Gmail's
 * anti-abuse system has flagged the account: Resend uses different
 * infrastructure with its own quota.
 *
 * Activated when RESEND_API_KEY env var is set. Falls through to the
 * existing Gmail path otherwise so this can ship behind a flag.
 */

const RESEND_API = "https://api.resend.com/emails";

export interface ResendInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; mimeType: string; content: string }>;
}

export interface ResendResult {
  id: string;
}

export class ResendError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Resend send failed: HTTP ${status} — ${body.slice(0, 300)}`);
    this.name = "ResendError";
    this.status = status;
    this.body = body;
  }
}

export function isResendEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Default From address. If the user's domain isn't verified in Resend
 * yet, Resend will reject sends from that address — fall back to
 * onboarding@resend.dev which works without DNS verification (recipient
 * sees it as from Resend, but the email *will* deliver).
 */
function defaultFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL
    || "Penney Construction <onboarding@resend.dev>"
  );
}

export async function sendViaResend(input: ResendInput): Promise<ResendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY env var not set");

  const payload: Record<string, unknown> = {
    from: input.from || defaultFromAddress(),
    to: input.to,
    subject: input.subject,
    html: input.html,
  };
  if (input.cc) payload.cc = input.cc;
  if (input.bcc) payload.bcc = input.bcc;
  if (input.replyTo) payload.reply_to = input.replyTo;
  if (input.attachments?.length) {
    payload.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.mimeType,
    }));
  }

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[resend] HTTP ${res.status} body=${body}`);
    throw new ResendError(res.status, body);
  }

  const data = (await res.json()) as { id: string };
  return { id: data.id };
}
