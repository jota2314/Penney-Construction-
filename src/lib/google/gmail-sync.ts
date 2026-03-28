/**
 * Gmail Sync Engine for Penney Construction Command Center.
 * Pulls emails from Gmail, categorizes them, matches to projects,
 * extracts quote data from attachments and email bodies, and
 * populates the command center tables automatically.
 */

import { googleFetch } from "./auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

// ── Types ──────────────────────────────────────

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload: GmailPayload;
}

interface GmailPayload {
  mimeType: string;
  headers: GmailHeader[];
  body?: { data?: string; size: number };
  parts?: GmailPart[];
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType: string;
  filename?: string;
  body?: { data?: string; size: number; attachmentId?: string };
  headers?: GmailHeader[];
  parts?: GmailPart[];
}

export interface ParsedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  date: string;
  snippet: string;
  body: string;
  direction: "inbound" | "outbound";
  attachments: AttachmentInfo[];
}

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

export interface ExtractedQuoteData {
  subcontractorName: string;
  amount: number | null;
  trade: string | null;
  projectName: string | null;
  description: string | null;
}

// Known email addresses for Penney Construction
const COMPANY_EMAILS = [
  "jbetancur@penneyconstructioninc.com",
  "info@penneyconstructioninc.com",
  "rpenney@penneyconstructioninc.com",
  "nsmith@penneyconstructioninc.com",
];

// ── Fetch Messages ──────────────────────────────────────

/**
 * Fetch recent emails from Gmail inbox.
 * @param maxResults - Number of messages to fetch (default 50)
 * @param query - Gmail search query (default: all inbox + sent)
 */
export async function fetchRecentEmails(
  maxResults: number = 50,
  query?: string
): Promise<ParsedEmail[]> {
  const defaultQuery = query || "in:inbox OR in:sent";

  const allMessageIds: { id: string }[] = [];
  let pageToken: string | undefined;

  // Paginate through Gmail to get all requested messages
  while (allMessageIds.length < maxResults) {
    const pageSize = Math.min(500, maxResults - allMessageIds.length);
    let url = `${GMAIL_API}/users/me/messages?maxResults=${pageSize}&q=${encodeURIComponent(defaultQuery)}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const listRes = await googleFetch(url);

    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Failed to list messages: ${err}`);
    }

    const listData = await listRes.json();
    const messages: { id: string }[] = listData.messages || [];

    if (messages.length === 0) break;

    allMessageIds.push(...messages);

    // Check for next page
    pageToken = listData.nextPageToken;
    if (!pageToken) break;
  }

  // Trim to exact count
  const messageIds = allMessageIds.slice(0, maxResults);

  if (messageIds.length === 0) return [];

  // Fetch full message details in batches of 10
  const parsedMessages: ParsedEmail[] = [];
  const batchSize = 10;

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((msg) => fetchFullMessage(msg.id))
    );
    parsedMessages.push(...batchResults.filter((m): m is ParsedEmail => m !== null));
  }

  return parsedMessages;
}

/**
 * Fetch emails related to a specific project by searching Gmail.
 */
export async function fetchProjectEmails(
  projectName: string,
  address?: string
): Promise<ParsedEmail[]> {
  const searchTerms = [projectName];
  if (address) searchTerms.push(address);

  const query = searchTerms.map((t) => `"${t}"`).join(" OR ");
  return fetchRecentEmails(30, query);
}

/**
 * Fetch a single full message from Gmail.
 */
async function fetchFullMessage(
  messageId: string
): Promise<ParsedEmail | null> {
  const res = await googleFetch(
    `${GMAIL_API}/users/me/messages/${messageId}?format=full`
  );

  if (!res.ok) return null;

  const msg: GmailMessage = await res.json();
  return parseMessage(msg);
}

// ── Parse Message ──────────────────────────────────────

function parseMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload.headers;

  const getHeader = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  const from = getHeader("From");
  const to = getHeader("To");
  const subject = getHeader("Subject");
  const date = getHeader("Date");

  const fromEmail = extractEmail(from);
  const toEmail = extractEmail(to);

  // Determine direction
  const isOutbound = COMPANY_EMAILS.some(
    (e) => fromEmail.toLowerCase() === e.toLowerCase()
  );

  // Extract body text
  const body = extractBody(msg.payload);

  // Extract attachments
  const attachments = extractAttachments(msg.payload);

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    from,
    fromEmail,
    to,
    toEmail,
    date: new Date(parseInt(msg.internalDate)).toISOString(),
    snippet: msg.snippet,
    body,
    direction: isOutbound ? "outbound" : "inbound",
    attachments,
  };
}

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return match ? match[1] : headerValue.trim();
}

function extractBody(payload: GmailPayload): string {
  // Try to get text/plain first, then text/html
  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    // Look for text/plain first
    const textPart = findPartByMimeType(payload.parts, "text/plain");
    if (textPart?.body?.data) {
      return decodeBase64(textPart.body.data);
    }

    // Fall back to text/html
    const htmlPart = findPartByMimeType(payload.parts, "text/html");
    if (htmlPart?.body?.data) {
      const html = decodeBase64(htmlPart.body.data);
      return stripHtml(html);
    }

    // Recurse into nested parts
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody({
          mimeType: part.mimeType,
          headers: part.headers || [],
          parts: part.parts,
        });
        if (nested) return nested;
      }
    }
  }

  return "";
}

function findPartByMimeType(
  parts: GmailPart[],
  mimeType: string
): GmailPart | undefined {
  return parts.find((p) => p.mimeType === mimeType);
}

function extractAttachments(payload: GmailPayload): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  function walk(parts: GmailPart[]) {
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }

  if (payload.parts) walk(payload.parts);
  return attachments;
}

function decodeBase64(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Email Categorization ──────────────────────────────────────

export type EmailCategory =
  | "client_update"
  | "sub_outreach"
  | "internal"
  | "quote"
  | "follow_up"
  | "other";

/**
 * Categorize an email based on content, sender, and subject.
 */
export function categorizeEmail(
  email: ParsedEmail,
  knownSubEmails: string[],
  knownClientEmails: string[]
): EmailCategory {
  const subject = email.subject.toLowerCase();
  const body = email.body.toLowerCase();
  const fromEmail = email.fromEmail.toLowerCase();

  // Check for quotes
  if (
    subject.includes("quote") ||
    subject.includes("proposal") ||
    subject.includes("estimate") ||
    subject.includes("pricing") ||
    subject.includes("bid") ||
    hasQuoteAttachment(email)
  ) {
    return "quote";
  }

  // Check if from/to a known sub
  if (
    knownSubEmails.some(
      (e) =>
        fromEmail === e.toLowerCase() ||
        email.toEmail.toLowerCase() === e.toLowerCase()
    )
  ) {
    return "sub_outreach";
  }

  // Check if from/to a known client
  if (
    knownClientEmails.some(
      (e) =>
        fromEmail === e.toLowerCase() ||
        email.toEmail.toLowerCase() === e.toLowerCase()
    )
  ) {
    return "client_update";
  }

  // Internal emails
  if (
    COMPANY_EMAILS.some((e) => fromEmail === e.toLowerCase()) &&
    COMPANY_EMAILS.some((e) => email.toEmail.toLowerCase() === e.toLowerCase())
  ) {
    return "internal";
  }

  // Check body for follow-up keywords
  if (
    subject.includes("follow up") ||
    subject.includes("following up") ||
    subject.includes("reminder") ||
    body.includes("just checking in") ||
    body.includes("following up")
  ) {
    return "follow_up";
  }

  return "other";
}

function hasQuoteAttachment(email: ParsedEmail): boolean {
  return email.attachments.some(
    (a) =>
      a.mimeType === "application/pdf" ||
      a.filename.toLowerCase().includes("quote") ||
      a.filename.toLowerCase().includes("estimate") ||
      a.filename.toLowerCase().includes("proposal") ||
      a.filename.toLowerCase().includes("bid")
  );
}

// ── Project Matching ──────────────────────────────────────

interface ProjectInfo {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  customer_name: string | null;
}

/**
 * Match an email to a project based on subject, body, and addresses.
 */
export function matchEmailToProject(
  email: ParsedEmail,
  projects: ProjectInfo[]
): ProjectInfo | null {
  const searchText = `${email.subject} ${email.body} ${email.snippet}`.toLowerCase();

  // Score each project
  let bestMatch: ProjectInfo | null = null;
  let bestScore = 0;

  for (const project of projects) {
    let score = 0;

    // Project name match
    if (project.name && searchText.includes(project.name.toLowerCase())) {
      score += 10;
    }

    // Address match
    if (project.address) {
      const addrParts = project.address.toLowerCase().split(/[\s,]+/);
      const matchingParts = addrParts.filter(
        (p) => p.length > 3 && searchText.includes(p)
      );
      score += matchingParts.length * 3;
    }

    // City match
    if (project.city && searchText.includes(project.city.toLowerCase())) {
      score += 2;
    }

    // Customer name match
    if (
      project.customer_name &&
      searchText.includes(project.customer_name.toLowerCase())
    ) {
      score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = project;
    }
  }

  // Require a minimum score to match
  return bestScore >= 3 ? bestMatch : null;
}

// ── Quote Data Extraction ──────────────────────────────────────

/**
 * Extract quote/pricing data from email body text.
 * Looks for dollar amounts, trade mentions, and sub names.
 */
export function extractQuoteInfo(email: ParsedEmail): ExtractedQuoteData {
  const body = email.body;
  const subject = email.subject;

  // Extract dollar amounts
  const amounts = extractDollarAmounts(body);
  const amount = amounts.length > 0 ? Math.max(...amounts) : null;

  // Try to determine trade from content
  const trade = detectTrade(subject + " " + body);

  // Subcontractor name from sender
  const subName = extractSenderName(email.from);

  return {
    subcontractorName: subName,
    amount,
    trade,
    projectName: null, // Will be matched separately
    description: email.snippet.substring(0, 200),
  };
}

function extractDollarAmounts(text: string): number[] {
  const amounts: number[] = [];

  // Match $X,XXX.XX patterns
  const regex = /\$[\s]*([\d,]+(?:\.\d{1,2})?)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const value = parseFloat(match[1].replace(/,/g, ""));
    if (value > 0 && value < 10_000_000) {
      amounts.push(value);
    }
  }

  return amounts;
}

const TRADE_KEYWORDS: Record<string, string[]> = {
  "Electrical": ["electrical", "electric", "wiring", "panel", "outlet", "switch", "circuit", "sconce"],
  "Plumbing": ["plumbing", "plumber", "pipe", "fixture", "faucet", "toilet", "shower", "drain"],
  "HVAC": ["hvac", "heating", "cooling", "furnace", "ac", "air conditioning", "ductwork", "mini split"],
  "Framing": ["framing", "frame", "stud", "joist", "rafter", "sheathing"],
  "Roofing": ["roofing", "roof", "shingle", "flashing", "gutter"],
  "Siding": ["siding", "clapboard", "vinyl siding", "cedar"],
  "Windows": ["window", "door", "glass", "pane", "casement", "double hung"],
  "Insulation": ["insulation", "spray foam", "fiberglass", "cellulose", "r-value"],
  "Tile": ["tile", "backsplash", "floor tile", "shower tile", "grout"],
  "Hardwood": ["hardwood", "flooring", "wood floor", "oak floor", "refinish"],
  "Painting": ["painting", "paint", "primer", "stain"],
  "Foundation": ["foundation", "slab", "concrete", "footing", "frost wall"],
  "Drywall": ["drywall", "sheetrock", "plaster", "skim coat"],
  "Cabinets": ["cabinet", "vanity", "millwork", "countertop"],
  "Demolition": ["demo", "demolition", "tear out", "strip"],
  "Lumber": ["lumber", "material", "wood", "plywood", "2x4", "2x6"],
};

function detectTrade(text: string): string | null {
  const lower = text.toLowerCase();
  let bestTrade: string | null = null;
  let bestCount = 0;

  for (const [trade, keywords] of Object.entries(TRADE_KEYWORDS)) {
    const count = keywords.filter((kw) => lower.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      bestTrade = trade;
    }
  }

  return bestCount >= 1 ? bestTrade : null;
}

function extractSenderName(from: string): string {
  // "John Smith <john@example.com>" -> "John Smith"
  const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) return nameMatch[1].trim();

  // "john@example.com" -> "john"
  const emailMatch = from.match(/^([^@]+)@/);
  if (emailMatch) return emailMatch[1].replace(/[._-]/g, " ");

  return from;
}

// ── Attachment Download ──────────────────────────────────────

/**
 * Download an attachment from Gmail by its attachment ID.
 */
export async function downloadAttachment(
  messageId: string,
  attachmentId: string
): Promise<string> {
  const res = await googleFetch(
    `${GMAIL_API}/users/me/messages/${messageId}/attachments/${attachmentId}`
  );

  if (!res.ok) {
    throw new Error("Failed to download attachment");
  }

  const data = await res.json();
  return data.data; // base64url encoded content
}
