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

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Load project + customer
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, scope_of_work, project_type, customers(first_name, last_name, address, city, state, phone)")
    .eq("id", projectId)
    .single();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Load latest estimate with line items
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["approved", "draft"])
    .order("version", { ascending: false })
    .limit(1);

  const estimateId = estimates?.[0]?.id;
  if (!estimateId) return NextResponse.json({ error: "No estimate found" }, { status: 404 });

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
      ["Project:", `${project.name}  (${project.project_number})`],
      ["Address:", projAddress],
      ["Client:", clientName],
      ...(clientAddress ? [["Client Address:", clientAddress]] : []),
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

  // Allowance note goes under the Category cell — the Price column is
  // too narrow (30mm) and putting the note there forced the price text
  // to wrap one character per line.
  const ALLOWANCE_NOTE = "(allowance — subject to actual cost)";

  let total = 0;

  for (const key of groupOrder) {
    const items = groups.get(key) ?? [];
    if (items.length === 0) continue;

    // Sectionless items (rows above the first section header, or all
    // rows if no sections exist) render as a plain table — no banner,
    // no subtotal. They still contribute to the grand total below.
    const sectionLabel = key === SECTIONLESS_KEY ? null : key.toUpperCase();

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
      const baseCategory = li.description || "General";
      // Allowance note goes under the category — the price column is
      // too narrow to hold "(subject to actual cost)" without the
      // currency string getting chopped letter-by-letter.
      const category = li.is_allowance
        ? `${baseCategory}\n${ALLOWANCE_NOTE}`
        : baseCategory;
      const scope = li.proposal_description || li.scope_text || "";
      return [category, scope, fmtCurrency(linePrice(li))];
    });

    // Track which body row indexes are allowances so didParseCell can
    // paint them yellow. Keep this in lock-step with tableBody.
    const allowanceRowIdx = new Set(
      items.map((li, i) => (li.is_allowance ? i : -1)).filter((i) => i >= 0)
    );

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
      didParseCell: (data) => {
        // Allowance rows get a soft yellow fill across all columns.
        if (data.section === "body" && allowanceRowIdx.has(data.row.index)) {
          data.cell.styles.fillColor = [255, 248, 200]; // light yellow
        }
      },
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

  // ── Exclusions ──
  if (y > ph - 50) { doc.addPage(); addPageHeader(); y = 36; }
  y = sectionHeader("EXCLUSIONS", y);

  const exclusions = [
    "Material allowances (tile, flooring, fixtures, lighting) are owner selections — final amounts adjusted at close based on selections",
    "Structural repairs or hidden conditions discovered during demolition subject to separate change order",
    "Any work beyond the scope described above",
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
    "This proposal is valid for 30 days from the date above.",
    "A 10% deposit is required upon acceptance to secure scheduling.",
    "Progress payments due as work is completed per agreed schedule.",
    "All work performed in accordance with applicable building codes and regulations.",
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
