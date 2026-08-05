import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { loadSubDirectory, matchSubId } from "@/lib/subs/resolve-subcontractor";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cap Claude extractions per call so a project with dozens of attachments
// doesn't blow the function timeout. If there are more, the response reports
// `remaining` and the user can run it again.
const EXTRACTION_CAP = 12;

type Attachment = {
  filename: string;
  mimeType: string;
  size: number;
  storage_path: string | null;
  text_content?: string;
};

type InboxEmail = {
  id: string;
  gmail_message_id: string | null;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  date: string | null;
  attachments: Attachment[] | null;
};

const basename = (p: string | null | undefined) =>
  (p || "").split("/").pop()!.toLowerCase();

// Obvious non-quote documents — skip these before spending a Claude call.
const NEGATIVE = /(drawing|blueprint|floor\s*plan|site\s*plan|elevation|section|permit|zoning|variance|contract|agreement|w-?9|insurance|\bcoi\b|certificate|license|\.dwg|\.dxf)/i;
// Strong positive signals a PDF is sub pricing.
const POSITIVE = /(quote|proposal|bid|estimate|pricing|rfp|rfq|\bcost\b)/i;

/**
 * Scan a project's linked emails for subcontractor proposal/quote/bid PDFs and
 * promote each one into a quote_requests row (with the REAL storage path so the
 * PDF opens). Dedups against existing quotes, collapses thread re-sends, and
 * backfills missing PDF links on quotes that already exist. Insert/enrich only
 * — never deletes.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { projectId } = await request.json();
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [{ data: emailsRaw }, { data: existingQuotes }] = await Promise.all([
      supabase
        .from("inbox_emails")
        .select("id, gmail_message_id, subject, from_name, from_email, date, attachments")
        .eq("project_id", projectId)
        .order("date", { ascending: false }),
      supabase
        .from("quote_requests")
        .select("id, subcontractor_name, amount, gmail_message_id, attachment_storage_path")
        .eq("project_id", projectId),
    ]);

    const emails = (emailsRaw ?? []) as InboxEmail[];
    const existing = existingQuotes ?? [];

    // ── Dedup sets from quotes that already exist ──
    const existingPaths = new Set(
      existing.map((q) => q.attachment_storage_path).filter(Boolean) as string[]
    );
    const existingEmailFile = new Set(
      existing
        .filter((q) => q.gmail_message_id)
        .map((q) => `${q.gmail_message_id}|${basename(q.attachment_storage_path)}`)
    );
    const existingVendorAmount = new Set(
      existing
        .filter((q) => q.subcontractor_name && q.amount != null)
        .map((q) => `${q.subcontractor_name!.trim().toLowerCase()}|${Math.round(Number(q.amount))}`)
    );

    // ── Backfill broken/bare PDF links on existing quotes ──
    let backfilled = 0;
    for (const q of existing) {
      const path = q.attachment_storage_path;
      const needsPath = !path || !path.includes("/");
      if (!needsPath || !q.gmail_message_id) continue;
      const email = emails.find((e) => e.gmail_message_id === q.gmail_message_id);
      if (!email?.attachments) continue;
      const match =
        (path && email.attachments.find((a) => a.storage_path && basename(a.storage_path) === basename(path))) ||
        email.attachments.find((a) => a.storage_path && a.mimeType?.includes("pdf")) ||
        email.attachments.find((a) => a.storage_path);
      if (match?.storage_path) {
        const { error } = await supabase
          .from("quote_requests")
          .update({ attachment_storage_path: match.storage_path })
          .eq("id", q.id);
        if (!error) {
          existingPaths.add(match.storage_path);
          backfilled++;
        }
      }
    }

    // ── Gather candidate proposal attachments (collapse thread re-sends) ──
    type Candidate = { email: InboxEmail; att: Attachment };
    const byFileKey = new Map<string, Candidate>();
    for (const email of emails) {
      const subject = (email.subject || "").toLowerCase();
      for (const att of email.attachments ?? []) {
        if (!att.storage_path) continue;
        const isPdf = att.mimeType?.includes("pdf");
        const isImage = att.mimeType?.startsWith("image/");
        if (!isPdf && !isImage) continue;
        const hay = `${att.filename || ""} ${subject}`;
        if (NEGATIVE.test(hay)) continue;
        // Keep if it looks like pricing, or it's a plain PDF we'll let Claude judge.
        if (!POSITIVE.test(hay) && !isPdf) continue;

        // Already a quote?
        if (existingPaths.has(att.storage_path)) continue;
        if (email.gmail_message_id && existingEmailFile.has(`${email.gmail_message_id}|${(att.filename || "").toLowerCase()}`)) continue;

        const fileKey = `${(att.filename || "").toLowerCase()}|${att.size ?? 0}`;
        if (!byFileKey.has(fileKey)) byFileKey.set(fileKey, { email, att });
      }
    }

    const candidates = Array.from(byFileKey.values());
    const toProcess = candidates.slice(0, EXTRACTION_CAP);
    const remaining = Math.max(0, candidates.length - toProcess.length);

    const anthropic = await getAnthropicClient();
    const created: { id: string; subcontractor_name: string; trade: string | null; amount: number | null }[] = [];
    let skippedNotQuote = 0;
    // Loaded lazily on the first promoted quote.
    let subDirectory: Awaited<ReturnType<typeof loadSubDirectory>> | null = null;

    for (const { email, att } of toProcess) {
      try {
        const { data: blob } = await supabase.storage
          .from("email-attachments")
          .download(att.storage_path!);
        if (!blob) { skippedNotQuote++; continue; }

        const buffer = Buffer.from(await blob.arrayBuffer());
        const base64 = buffer.toString("base64");
        const isPdf = att.mimeType?.includes("pdf");

        const documentContent = isPdf
          ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
          : { type: "image" as const, source: { type: "base64" as const, media_type: att.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

        const prompt = `You are analyzing a document attached to an email for a residential general contractor (Penney Construction, North Shore MA). It may or may not be a subcontractor quote/proposal.

Extract:
1. vendor_name — company/person who issued it
2. amount — total dollar amount (number only, no $)
3. trade — electrical, plumbing, carpentry, roofing, painting, flooring, windows, doors, hvac, insulation, drywall, masonry, landscaping, demolition, etc.
4. scope_description — brief description of work/materials
5. extracted_text — ALL text (every line item, number, name, date, total)
6. document_type — one of: quote, proposal, estimate, bid, invoice, contract, drawing, permit, insurance, other
7. date — document date (YYYY-MM-DD)

Project: ${project.name}. Email from: ${email.from_name || email.from_email || "unknown"}, subject "${email.subject || ""}".

Return ONLY valid JSON with those keys.`;

        let raw = "";
        for (const model of CLAUDE_FALLBACK_MODELS) {
          try {
            const resp = await anthropic.messages.create({
              model,
              max_tokens: 4000,
              messages: [{ role: "user", content: [documentContent, { type: "text", text: prompt }] }],
            });
            raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
            if (raw) break;
          } catch { continue; }
        }
        if (!raw) { skippedNotQuote++; continue; }

        const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
        let ex: { vendor_name?: string; amount?: number; trade?: string; scope_description?: string; extracted_text?: string; document_type?: string; date?: string } = {};
        try { ex = JSON.parse(cleaned); }
        catch {
          const s = cleaned.indexOf("{"); const e = cleaned.lastIndexOf("}");
          if (s !== -1 && e > s) { try { ex = JSON.parse(cleaned.substring(s, e + 1)); } catch { /* */ } }
        }

        // Only promote things that are actually sub pricing.
        const dt = (ex.document_type || "").toLowerCase();
        const isPricing = ["quote", "proposal", "estimate", "bid"].includes(dt) || ex.amount != null;
        if (!ex.vendor_name || !isPricing) { skippedNotQuote++; continue; }

        // Final dedup against existing quotes by vendor + amount.
        if (ex.amount != null) {
          const va = `${ex.vendor_name.trim().toLowerCase()}|${Math.round(Number(ex.amount))}`;
          if (existingVendorAmount.has(va)) { skippedNotQuote++; continue; }
          existingVendorAmount.add(va);
        }

        subDirectory ??= await loadSubDirectory(supabase);
        const { data: quote, error } = await supabase
          .from("quote_requests")
          .insert({
            project_id: projectId,
            project_name: project.name,
            subcontractor_name: ex.vendor_name,
            subcontractor_id: matchSubId(subDirectory, ex.vendor_name),
            trade: ex.trade || null,
            amount: ex.amount ?? null,
            scope_description: ex.scope_description || null,
            extracted_text: ex.extracted_text?.substring(0, 50000) || att.text_content?.substring(0, 50000) || null,
            document_type: ["quote", "proposal", "estimate", "bid"].includes(dt) ? dt : "quote",
            status: "received",
            sent_at: ex.date || email.date || new Date().toISOString(),
            received_at: new Date().toISOString(),
            gmail_message_id: email.gmail_message_id,
            attachment_storage_path: att.storage_path,
            created_by: user.id,
          })
          .select("id, subcontractor_name, trade, amount")
          .single();

        if (error) { skippedNotQuote++; continue; }
        if (quote) {
          created.push(quote);
          existingPaths.add(att.storage_path!);
        }
      } catch {
        skippedNotQuote++;
      }
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      skipped: skippedNotQuote,
      backfilled,
      remaining,
      quotes: created,
      message:
        created.length > 0
          ? `Added ${created.length} quote${created.length === 1 ? "" : "s"} from emails${backfilled ? `, fixed ${backfilled} PDF link${backfilled === 1 ? "" : "s"}` : ""}${remaining ? ` — ${remaining} more to scan, run again` : ""}.`
          : backfilled > 0
            ? `No new quotes found; fixed ${backfilled} broken PDF link${backfilled === 1 ? "" : "s"} on existing quotes.`
            : "No new sub proposals found in this project's emails.",
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
