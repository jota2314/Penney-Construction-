import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";

const fmtCurrency = (v: number) => {
  const abs = Math.abs(Math.round(v));
  const str = abs.toLocaleString("en-US");
  return v < 0 ? `($${str})` : `$${str}`;
};

// jsPDF's built-in Helvetica is Latin-1 only. An em dash or curly quote in
// user-entered text (CO titles, descriptions, customer names) makes the font
// fail to measure the glyph, which throws inside autoTable and returns a
// blank 500. Strip everything outside Latin-1 before it reaches the PDF.
function sanitizeForPdf(input: unknown): string {
  if (input == null) return "";
  let s = String(input)
    .replace(/[′]/g, "'")
    .replace(/[″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[×]/g, "x")
    .replace(/[·•]/g, "-")
    .replace(/[ ]/g, " ")
    .replace(/[…]/g, "...")
    .replace(/[∼≈]/g, "~")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[→]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[©]/g, "(c)")
    .replace(/[®]/g, "(R)")
    .replace(/[™]/g, "(TM)");
  s = s.replace(/[^\x00-\xFF]/g, "?");
  return s;
}

// Penney brand colors (from Haley contract)
const CHARCOAL: [number, number, number] = [61, 61, 61];       // #3D3D3D
const ORANGE: [number, number, number] = [212, 114, 42];       // #D4722A
const PEACH: [number, number, number] = [253, 241, 234];       // #FDF1EA
const LIGHT_GRAY: [number, number, number] = [242, 242, 242];  // #F2F2F2
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];
const GREEN: [number, number, number] = [22, 163, 74];

function hasValidServiceCredential(request: NextRequest): boolean {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: NextRequest) {
  try {
  const serviceRequest = hasValidServiceCredential(request);
  const supabase = serviceRequest ? createAdminClient() : await createClient();
  if (!serviceRequest) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const coId = new URL(request.url).searchParams.get("changeOrderId");
  if (!coId) return NextResponse.json({ error: "changeOrderId required" }, { status: 400 });

  const { data: co } = await supabase
    .from("change_orders")
    .select("*, projects(name, address, city, state, project_number, contract_value, customers(first_name, last_name, address, city, phone))")
    .eq("id", coId)
    .single();

  if (!co) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = co.projects as any;
  const custArr = proj?.customers;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = sanitizeForPdf(cust ? `${cust.first_name} ${cust.last_name}` : "");
  const projAddress = sanitizeForPdf([proj?.address, proj?.city, proj?.state].filter(Boolean).join(", "));
  const contractValue = Number(proj?.contract_value || 0);
  const coTitle = sanitizeForPdf(co.title);
  const coDescription = sanitizeForPdf(co.description || "");
  const projName = sanitizeForPdf(proj?.name || "Project");
  const custPhone = sanitizeForPdf(cust?.phone || "");
  const clientSig = sanitizeForPdf(co.client_signature || "");

  const { data: allCOs } = await supabase
    .from("change_orders")
    .select("change_order_number, title, price_impact, status")
    .eq("project_id", co.project_id)
    .order("change_order_number");

  const approvedTotal = (allCOs || []).filter((c) => c.status === "approved").reduce((s, c) => s + Number(c.price_impact), 0);
  const thisCoAmount = co.status !== "approved" ? Number(co.price_impact) : 0;
  const newContract = contractValue + approvedTotal + thisCoAmount;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pw - margin * 2;

  // ── Helper: Section header (charcoal bar with white text + orange underline) ──
  function sectionHeader(label: string, yPos: number): number {
    doc.setFillColor(...CHARCOAL);
    doc.rect(margin, yPos, contentW, 8, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(label, margin + 3, yPos + 5.5);
    // Orange accent line
    doc.setFillColor(...ORANGE);
    doc.rect(margin, yPos + 8, contentW, 1.5, "F");
    return yPos + 12;
  }

  // ── Helper: Add company header to a page ──
  function addPageHeader() {
    // Logo
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.jpg");
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        const logoBase64 = logoBuffer.toString("base64");
        doc.addImage(`data:image/jpeg;base64,${logoBase64}`, "JPEG", margin, 10, 28, 18);
      }
    } catch { /* */ }

    // Company info (right-aligned)
    doc.setTextColor(...CHARCOAL);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("PENNEY CONSTRUCTION, INC.", pw - margin, 14, { align: "right" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("Licensed & Insured  ·  MA Home Improvement Contractor", pw - margin, 19, { align: "right" });
    doc.text("5 Barrett Road, Peabody, MA 01960  ·  Tel: 978-621-4387  ·  HIC Reg #198443", pw - margin, 23, { align: "right" });

    // Orange divider below header
    doc.setFillColor(...ORANGE);
    doc.rect(margin, 30, contentW, 1, "F");
  }

  // ── PAGE 1 ──
  addPageHeader();

  // Title
  let y = 36;
  doc.setFillColor(...CHARCOAL);
  doc.rect(margin, y, contentW, 12, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(`CHANGE ORDER #${co.change_order_number}`, pw / 2, y + 8, { align: "center" });
  doc.setFillColor(...ORANGE);
  doc.rect(margin, y + 12, contentW, 1.5, "F");
  y += 18;

  // ── Parties ──
  y = sectionHeader("PARTIES", y);

  autoTable(doc, {
    startY: y,
    head: [["HOMEOWNER", "CONTRACTOR"]],
    body: [
      [clientName, "Penney Construction, Inc."],
      [projAddress, "5 Barrett Rd, Peabody, MA 01960"],
      [custPhone, "978-621-4387"],
    ],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { textColor: BLACK },
    alternateRowStyles: { fillColor: PEACH },
    columnStyles: { 0: { cellWidth: contentW / 2 }, 1: { cellWidth: contentW / 2 } },
    margin: { left: margin, right: margin },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── Description of Change ──
  y = sectionHeader("DESCRIPTION OF CHANGE", y);

  autoTable(doc, {
    startY: y,
    head: [["Item", "Scope of Work", "Price (USD)"]],
    body: [[coTitle, coDescription, fmtCurrency(Number(co.price_impact))]],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { textColor: BLACK },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 40 },
      1: { cellWidth: contentW - 70 },
      2: { halign: "right", cellWidth: 30, fontStyle: "bold" },
    },
    margin: { left: margin, right: margin },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY;

  // Total row
  autoTable(doc, {
    startY: y,
    head: [],
    body: [["CHANGE ORDER TOTAL", "", fmtCurrency(Number(co.price_impact))]],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: contentW - 70 },
      2: { halign: "right", cellWidth: 30 },
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      data.cell.styles.fillColor = PEACH;
      data.cell.styles.textColor = CHARCOAL;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── Contract Summary ──
  y = sectionHeader("CONTRACT SUMMARY", y);

  const contractRows: string[][] = [
    ["Original Contract", fmtCurrency(contractValue)],
    ["Approved Change Orders", fmtCurrency(approvedTotal)],
  ];
  if (co.status !== "approved") {
    const impact = Number(co.price_impact);
    contractRows.push([`This Change Order (#${co.change_order_number})`, `${impact >= 0 ? "+" : ""}${fmtCurrency(impact)}`]);
  }
  contractRows.push(["NEW CONTRACT TOTAL", fmtCurrency(newContract)]);

  autoTable(doc, {
    startY: y,
    head: [],
    body: contractRows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: contentW - 40 },
      1: { halign: "right", cellWidth: 40, fontStyle: "bold" },
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.row.index === contractRows.length - 1) {
        data.cell.styles.fillColor = PEACH;
        data.cell.styles.fontSize = 10;
        data.cell.styles.textColor = CHARCOAL;
      }
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Signatures ──
  const sigSpaceNeeded = co.client_signature ? 70 : 55;
  if (y > ph - sigSpaceNeeded - 20) { doc.addPage(); addPageHeader(); y = 36; }
  y = sectionHeader("SIGNATURES", y);

  const isSigned = !!co.client_signature;
  const signedDate = co.client_signed_at ? new Date(co.client_signed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

  doc.setTextColor(100, 100, 100);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text("By signing below, both parties agree to the scope of work and adjusted contract amount described in this Change Order.", margin, y + 3);
  y += 8;

  // Two-column signature layout
  const halfW = contentW / 2 - 3;

  // Homeowner side
  doc.setFillColor(...LIGHT_GRAY);
  doc.rect(margin, y, halfW, 30, "F");
  doc.setTextColor(...CHARCOAL);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("HOMEOWNER SIGNATURE", margin + 3, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("X", margin + 3, y + 16);
  doc.setDrawColor(...CHARCOAL);
  doc.line(margin + 8, y + 16, margin + halfW - 5, y + 16);
  if (isSigned) {
    doc.setFont("times", "italic");
    doc.setFontSize(13);
    doc.setTextColor(...BLACK);
    doc.text(clientSig, margin + 12, y + 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...CHARCOAL);
  }
  doc.text(`Printed Name:  ${clientName}`, margin + 3, y + 22);
  doc.text(`Date:  ${isSigned ? signedDate : "_______________"}`, margin + 3, y + 27);

  // Contractor side
  const cx = margin + halfW + 6;
  doc.setFillColor(...LIGHT_GRAY);
  doc.rect(cx, y, halfW, 30, "F");
  doc.setTextColor(...CHARCOAL);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("CONTRACTOR SIGNATURE", cx + 3, y + 5);
  doc.setFont("helvetica", "normal");
  doc.text("Penney Construction, Inc.", cx + 3, y + 10);
  doc.setFontSize(7);
  doc.text("X", cx + 3, y + 16);
  doc.line(cx + 8, y + 16, cx + halfW - 5, y + 16);
  doc.text("Printed Name:  Ryan Penney", cx + 3, y + 22);
  doc.text("Title:  Owner", cx + 3, y + 27);

  y += 34;

  // Signed stamp
  if (isSigned) {
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(margin, y, contentW, 10, 2, 2, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GREEN);
    doc.text(sanitizeForPdf(`APPROVED - Signed electronically by ${clientSig} on ${signedDate}`), pw / 2, y + 5, { align: "center" });
    doc.setFontSize(5);
    doc.setTextColor(150, 150, 150);
    if (co.client_ip) doc.text(`IP: ${co.client_ip}`, pw / 2, y + 8.5, { align: "center" });
  }

  // ── Footer on every page ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // Orange line above footer
    doc.setFillColor(...ORANGE);
    doc.rect(margin, ph - 10, contentW, 0.5, "F");
    doc.setFontSize(6);
    doc.setTextColor(130, 130, 130);
    doc.setFont("helvetica", "normal");
    doc.text("Penney Construction, Inc.  ·  5 Barrett Road, Peabody, MA 01960  ·  978-621-4387  ·  HIC #198443", pw / 2, ph - 6, { align: "center" });
    doc.text(`Page ${i} of ${totalPages}`, pw - margin, ph - 6, { align: "right" });
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  // Filename header values must be Latin-1 safe — the underlying Node http
  // layer rejects non-ASCII bytes with ERR_INVALID_CHAR.
  const safeFilename = `CO${co.change_order_number} - ${coTitle} - ${projName}.pdf`
    .replace(/[^\x20-\x7E]/g, "_");

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
    },
  });
  } catch (e) {
    console.error("generate-change-order failed:", e);
    return NextResponse.json(
      { error: "PDF generation failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
