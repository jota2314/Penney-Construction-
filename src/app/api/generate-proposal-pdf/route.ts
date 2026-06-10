import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const fmtCurrency = (v: number) => {
  const abs = Math.abs(Math.round(v));
  const str = abs.toLocaleString("en-US");
  return v < 0 ? `($${str})` : `$${str}`;
};

/**
 * jsPDF's built-in Helvetica font is Latin-1 only — it has no glyphs
 * for prime marks (′ ″), curly quotes, em/en dashes, or the
 * multiplication sign. When the font can't measure a character it
 * miscalculates line widths, which makes autoTable stretch the text
 * (each letter ends up with extra space). Map the common construction
 * docs offenders to ASCII equivalents before any text reaches the PDF.
 */
function sanitizeForPdf(input: unknown): string {
  if (input == null) return "";
  let s = String(input)
    .replace(/[′]/g, "'")       // prime -> apostrophe (feet)
    .replace(/[″]/g, '"')       // double prime -> quote (inches)
    .replace(/[‘’]/g, "'") // curly singles -> straight
    .replace(/[“”]/g, '"') // curly doubles -> straight
    .replace(/[–—]/g, "-") // en/em dash -> hyphen
    .replace(/[×]/g, "x")       // multiplication sign
    .replace(/[·•]/g, "-") // middot / bullet
    .replace(/[ ]/g, " ")       // non-breaking space
    .replace(/[…]/g, "...")     // ellipsis
    .replace(/[∼≈]/g, "~") // tilde operator / almost equal
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[→]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[©]/g, "(c)")
    .replace(/[®]/g, "(R)")
    .replace(/[™]/g, "(TM)");
  // Strip anything still outside the basic Latin-1 range jsPDF can
  // measure. Without this catch-all, one stray glyph (an obscure dash,
  // a box-drawing char) re-triggers the autoTable wide-letter-spacing
  // bug. Falls back to "?" which jsPDF renders cleanly.
  s = s.replace(/[^\x00-\xFF]/g, "?");
  return s;
}

// Penney brand colors
const CHARCOAL: [number, number, number] = [61, 61, 61];
const ORANGE: [number, number, number] = [212, 114, 42];
const PEACH: [number, number, number] = [253, 241, 234];
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

export async function GET(request: NextRequest) {
  try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  // If the caller knows which estimate they're looking at (multi-option
  // projects like Caraglia's Option A vs Option B), they pass estimateId
  // and we render that exact one. Falling back to "latest version" silently
  // mis-renders the wrong option for the user.
  const estimateIdParam = url.searchParams.get("estimateId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Load project + customer
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, scope_of_work, project_type, customers(first_name, last_name, address, city, state, phone)")
    .eq("id", projectId)
    .single();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Resolve the estimate: explicit estimateId wins; otherwise fall back to
  // the latest approved/draft version on this project.
  let estimateId: string | null = estimateIdParam;
  if (!estimateId) {
    const { data: estimates } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .in("status", ["approved", "draft"])
      .order("version", { ascending: false })
      .limit(1);
    estimateId = estimates?.[0]?.id ?? null;
  } else {
    // Guard: make sure the requested estimate actually belongs to this project.
    const { data: check } = await supabase
      .from("estimates")
      .select("id")
      .eq("id", estimateId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!check) return NextResponse.json({ error: "Estimate does not belong to this project" }, { status: 400 });
  }
  if (!estimateId) return NextResponse.json({ error: "No estimate found" }, { status: 404 });

  // Estimate-level scope notes ("Scope: ..." lines) print under Exclusions &
  // Clarifications so per-job carve-outs (ledge, ejector pumps, etc.) reach the client.
  const { data: estMeta } = await supabase
    .from("estimates")
    .select("notes")
    .eq("id", estimateId)
    .maybeSingle();

  const { data: lineItems } = await supabase
    .from("estimate_line_items")
    .select("description, trade, total_price, client_price, scope_text, proposal_description, sort_order, is_visible_on_proposal, section, is_allowance, is_section_header")
    .eq("estimate_id", estimateId)
    .order("sort_order");

  if (!lineItems?.length) return NextResponse.json({ error: "No estimate lines" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = cust ? `${cust.first_name} ${cust.last_name}` : "";
  const clientAddress = [cust?.address, cust?.city, cust?.state].filter(Boolean).join(", ");
  const projAddress = [project.address, project.city, project.state || "MA"].filter(Boolean).join(", ");

  // ── Build PDF ──
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pw - margin * 2;

  function addPageHeader() {
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.jpg");
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        const logoBase64 = logoBuffer.toString("base64");
        doc.addImage(`data:image/jpeg;base64,${logoBase64}`, "JPEG", margin, 10, 28, 18);
      }
    } catch { /* */ }

    doc.setTextColor(...CHARCOAL);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("PENNEY CONSTRUCTION, INC.", pw - margin, 14, { align: "right" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("Licensed & Insured  ·  MA Home Improvement Contractor", pw - margin, 19, { align: "right" });
    doc.text("5 Barrett Road, Peabody, MA 01960  ·  Tel: 978-621-4387  ·  HIC Reg #198443", pw - margin, 23, { align: "right" });

    doc.setFillColor(...ORANGE);
    doc.rect(margin, 30, contentW, 1, "F");
  }

  function sectionHeader(label: string, yPos: number): number {
    doc.setFillColor(...CHARCOAL);
    doc.rect(margin, yPos, contentW, 8, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(label, margin + 3, yPos + 5.5);
    doc.setFillColor(...ORANGE);
    doc.rect(margin, yPos + 8, contentW, 1.5, "F");
    return yPos + 12;
  }

  // ── PAGE 1 ──
  addPageHeader();

  // Title banner
  let y = 36;
  doc.setFillColor(...CHARCOAL);
  doc.rect(margin, y, contentW, 12, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENT PROPOSAL", pw / 2, y + 8, { align: "center" });
  doc.setFillColor(...ORANGE);
  doc.rect(margin, y + 12, contentW, 1.5, "F");
  y += 18;

  // ── Project Info ──
  y = sectionHeader("PROJECT INFORMATION", y);

  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      ["Project:", sanitizeForPdf(`${project.name}  (${project.project_number})`)],
      ["Address:", sanitizeForPdf(projAddress)],
      ["Client:", sanitizeForPdf(clientName)],
      ...(clientAddress ? [["Client Address:", sanitizeForPdf(clientAddress)]] : []),
      ["Date:", new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
    ],
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 30, textColor: CHARCOAL },
      1: { textColor: BLACK },
    },
    margin: { left: margin, right: margin },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── Scope & Pricing ──
  y = sectionHeader("SCOPE OF WORK & PRICING", y);

  const visibleItems = lineItems.filter(li => li.is_visible_on_proposal !== false);
  const linePrice = (li: { total_price: unknown; client_price: unknown }) =>
    Number(li.total_price ?? li.client_price ?? 0);

  // Group by section header rows (is_section_header=true). Each header
  // starts a new group; non-header rows below it (until the next
  // header) belong to that group. Anything before the first header
  // goes into a leading "no section" bucket.
  const SECTIONLESS_KEY = "__no_section__";
  type Item = (typeof visibleItems)[number];
  const groupOrder: string[] = [];
  const groups = new Map<string, Item[]>();
  let currentKey = SECTIONLESS_KEY;
  for (const li of visibleItems) {
    if (li.is_section_header) {
      currentKey = (li.description?.trim() || "Untitled section");
      if (!groups.has(currentKey)) {
        groups.set(currentKey, []);
        groupOrder.push(currentKey);
      }
      continue; // header rows aren't printed as line items
    }
    if (!groups.has(currentKey)) {
      groups.set(currentKey, []);
      groupOrder.push(currentKey);
    }
    groups.get(currentKey)!.push(li);
  }

  // Allowances are visually marked by the yellow row fill (didParseCell
  // below). The textual explanation lives once at the end of the
  // proposal in the Exclusions section, not next to every allowance row.
  let total = 0;
  let hasAllowances = false;

  for (const key of groupOrder) {
    const items = groups.get(key) ?? [];
    if (items.length === 0) continue;

    // Sectionless items (rows above the first section header, or all
    // rows if no sections exist) render as a plain table — no banner,
    // no subtotal. They still contribute to the grand total below.
    const sectionLabel = key === SECTIONLESS_KEY ? null : sanitizeForPdf(key).toUpperCase();

    // Section banner row (only when we actually have a label to show)
    if (sectionLabel) {
      // Make sure there's room for at least the banner + one row
      if (y > ph - 30) { doc.addPage(); addPageHeader(); y = 36; }
      doc.setFillColor(...ORANGE);
      doc.rect(margin, y, contentW, 6, "F");
      doc.setTextColor(...WHITE);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.text(sectionLabel, margin + 3, y + 4.2);
      y += 6;
    }

    const tableBody = items.map((li) => {
      if (li.is_allowance) hasAllowances = true;
      const baseCategory = sanitizeForPdf(li.description || "General");
      // Tag the line title itself with "(Allowance)" — primary
      // identifier; the amber border is the visual cue.
      const category = li.is_allowance
        ? `${baseCategory} (Allowance)`
        : baseCategory;
      const scope = sanitizeForPdf(li.proposal_description || li.scope_text || "");
      return [category, scope, fmtCurrency(linePrice(li))];
    });

    autoTable(doc, {
      startY: y,
      head: [["Category", "Scope of Work", "Price (USD)"]],
      body: tableBody,
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
      bodyStyles: { textColor: BLACK },
      alternateRowStyles: { fillColor: PEACH },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 35 },
        1: { cellWidth: contentW - 65 },
        2: { halign: "right", cellWidth: 30, fontStyle: "bold" },
      },
      margin: { left: margin, right: margin },
      // Allowance rows are identified solely by the "(Allowance)"
      // suffix on the title now — no border, no fill. Keeps the table
      // visually consistent with non-allowance rows.
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY;

    // Section subtotal — only when there's an actual section label
    // (don't print "Subtotal" for the sectionless group when it's the
    // only group, since the grand total below already covers that).
    if (sectionLabel) {
      const subtotal = items.reduce((s, li) => s + linePrice(li), 0);
      autoTable(doc, {
        startY: y,
        head: [],
        body: [[`${sectionLabel} SUBTOTAL`, "", fmtCurrency(subtotal)]],
        theme: "grid",
        styles: { fontSize: 8.5, cellPadding: 2.5, fontStyle: "bold" },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: contentW - 65 },
          2: { halign: "right", cellWidth: 30 },
        },
        margin: { left: margin, right: margin },
        didParseCell: (data) => {
          data.cell.styles.fillColor = PEACH;
          data.cell.styles.textColor = CHARCOAL;
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY;
    }

    total += items.reduce((s, li) => s + linePrice(li), 0);
    y += 2;
  }

  // Grand total row
  autoTable(doc, {
    startY: y,
    head: [],
    body: [["TOTAL PROJECT PRICE", "", fmtCurrency(total)]],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 3.5, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: contentW - 65 },
      2: { halign: "right", cellWidth: 30 },
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      data.cell.styles.fillColor = ORANGE;
      data.cell.styles.textColor = WHITE;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── Exclusions & Clarifications ──
  if (y > ph - 50) { doc.addPage(); addPageHeader(); y = 36; }
  y = sectionHeader("EXCLUSIONS & CLARIFICATIONS", y);

  // Per-estimate "Scope: ..." notes flow into this section.
  const scopeNotes = (estMeta?.notes ?? "")
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => /^scope:/i.test(l))
    .map((l: string) => l.replace(/^scope:\s*/i, ""));

  const exclusions = [
    ...(hasAllowances
      ? ["Items identified as \"(Allowance)\" represent budgets carried for owner selections (cabinetry, countertops, fixtures, lighting, and similar finish items). Final amounts are reconciled by written change order once selections are made; unused allowance balances are credited to the owner."]
      : ["Material allowances (tile, flooring, fixtures, lighting) are owner selections — final amounts are reconciled by written change order once selections are made."]),
    "Concealed or unforeseen conditions — including rot, insect damage, hazardous materials (asbestos, lead paint), or substandard prior construction discovered once work is opened — are excluded and will be addressed by written change order before related work proceeds.",
    "Code-required upgrades to existing systems or structures beyond the scope described above.",
    "Utility company charges and fees; low-voltage, audio/visual, and security systems; landscaping and irrigation, unless specifically listed in the scope of work.",
    ...scopeNotes,
    "Any work not expressly described in this proposal.",
  ];

  doc.setTextColor(...BLACK);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  for (const excl of exclusions) {
    const lines = doc.splitTextToSize(`•  ${excl}`, contentW - 6);
    if (y + lines.length * 4 > ph - 20) { doc.addPage(); addPageHeader(); y = 36; }
    doc.text(lines, margin + 3, y + 3);
    y += lines.length * 4 + 2;
  }
  y += 4;

  // ── Terms ──
  if (y > ph - 40) { doc.addPage(); addPageHeader(); y = 36; }
  y = sectionHeader("TERMS & CONDITIONS", y);

  const terms = [
    "This proposal is valid for thirty (30) days from the date above; pricing is subject to confirmation thereafter.",
    "A ten percent (10%) deposit is due upon acceptance to secure scheduling. Progress payments follow the payment schedule set forth in the construction agreement.",
    "All changes to the scope of work are documented by written change order, signed by both parties, prior to the related work being performed.",
    "Penney Construction, Inc. is a licensed and insured Massachusetts Home Improvement Contractor, HIC Reg. #198443. All work is performed in accordance with the Massachusetts State Building Code (780 CMR) and applicable local regulations, by licensed trade contractors where required.",
    "Building permits and inspections are carried as listed in the scope of work and coordinated by Penney Construction.",
  ];

  doc.setTextColor(...BLACK);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  for (const term of terms) {
    const lines = doc.splitTextToSize(`•  ${term}`, contentW - 6);
    if (y + lines.length * 4 > ph - 20) { doc.addPage(); addPageHeader(); y = 36; }
    doc.text(lines, margin + 3, y + 3);
    y += lines.length * 4 + 2;
  }

  // ── Acceptance ──
  y += 6;
  if (y > ph - 60) { doc.addPage(); addPageHeader(); y = 36; }
  y = sectionHeader("ACCEPTANCE", y);

  doc.setTextColor(...BLACK);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  const acceptText = doc.splitTextToSize(
    "The pricing, scope of work, and conditions described in this proposal are satisfactory and are hereby accepted. Penney Construction, Inc. is authorized to proceed with the work as specified. A formal construction agreement will follow upon acceptance.",
    contentW - 6
  );
  doc.text(acceptText, margin + 3, y + 4);
  y += acceptText.length * 4 + 14;

  doc.setDrawColor(120, 120, 120);
  const colW = (contentW - 20) / 2;
  // Owner signature block (left) and Penney signature block (right)
  doc.line(margin + 3, y, margin + 3 + colW, y);
  doc.line(margin + 17 + colW, y, margin + 17 + colW * 2, y);
  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  doc.text("Owner Signature", margin + 3, y + 4);
  doc.text("Date", margin + 3 + colW - 12, y + 4);
  doc.text("Penney Construction, Inc.", margin + 17 + colW, y + 4);
  doc.text("Date", margin + 17 + colW * 2 - 12, y + 4);

  // ── Footer on every page ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(...ORANGE);
    doc.rect(margin, ph - 10, contentW, 0.5, "F");
    doc.setFontSize(6);
    doc.setTextColor(130, 130, 130);
    doc.setFont("helvetica", "normal");
    doc.text("Penney Construction, Inc.  ·  5 Barrett Road, Peabody, MA 01960  ·  978-621-4387  ·  HIC #198443", pw / 2, ph - 6, { align: "center" });
    doc.text(`Page ${i} of ${totalPages}`, pw - margin, ph - 6, { align: "right" });
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `${project.name} - Proposal.pdf`;
  const asciiName = filename.replace(/[^\x20-\x7E]/g, "-").replace(/"/g, "");

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
  } catch (err) {
    console.error("[generate-proposal-pdf] crashed:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8).join("\n") : undefined,
      where: "generate-proposal-pdf",
    }, { status: 500 });
  }
}
