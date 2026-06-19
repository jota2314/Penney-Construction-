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

// jsPDF's built-in Helvetica is Latin-1 only — strip anything outside it so an
// em dash / curly quote in user text can't blow up autoTable (see CO route).
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
    .replace(/[©]/g, "(c)")
    .replace(/[®]/g, "(R)")
    .replace(/[™]/g, "(TM)");
  s = s.replace(/[^\x00-\xFF]/g, "?");
  return s;
}

// Penney brand colors (match generate-change-order)
const CHARCOAL: [number, number, number] = [61, 61, 61];
const ORANGE: [number, number, number] = [212, 114, 42];
const PEACH: [number, number, number] = [253, 241, 234];
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

interface LineItem { description: string; amount: number }

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const invId = new URL(request.url).searchParams.get("invoiceId");
    if (!invId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

    const { data: inv } = await supabase
      .from("client_invoices")
      .select("*, projects(name, address, city, state, project_number, customers(first_name, last_name, address, city, state, zip, phone))")
      .eq("id", invId)
      .single();

    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proj = inv.projects as any;
    const custArr = proj?.customers;
    const cust = Array.isArray(custArr) ? custArr[0] : custArr;
    const clientName = sanitizeForPdf(cust ? `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim() : "");
    const clientAddr = sanitizeForPdf([cust?.address, [cust?.city, cust?.state, cust?.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n"));
    const projAddress = sanitizeForPdf([proj?.address, proj?.city, proj?.state].filter(Boolean).join(", "));
    const projName = sanitizeForPdf(proj?.name || "Project");
    const custPhone = sanitizeForPdf(cust?.phone || "");

    const lineItems: LineItem[] = Array.isArray(inv.line_items) && inv.line_items.length > 0
      ? (inv.line_items as LineItem[])
      : [{ description: inv.title, amount: Number(inv.amount) || 0 }];
    const total = lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0) || Number(inv.amount) || 0;

    const invDate = inv.created_at
      ? new Date(inv.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const dueText = inv.due_date
      ? new Date(inv.due_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : sanitizeForPdf(inv.terms || "Due on receipt");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentW = pw - margin * 2;

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

    // ── Header ──
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.jpg");
      if (fs.existsSync(logoPath)) {
        const logoBase64 = fs.readFileSync(logoPath).toString("base64");
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

    // ── Title bar ──
    let y = 36;
    doc.setFillColor(...CHARCOAL);
    doc.rect(margin, y, contentW, 12, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`INVOICE #${inv.invoice_number}`, pw / 2, y + 8, { align: "center" });
    doc.setFillColor(...ORANGE);
    doc.rect(margin, y + 12, contentW, 1.5, "F");
    y += 18;

    // ── Bill To / Details ──
    y = sectionHeader("BILL TO", y);
    autoTable(doc, {
      startY: y,
      body: [
        ["BILL TO", "INVOICE DETAILS"],
        [
          [clientName, clientAddr, custPhone].filter(Boolean).join("\n"),
          [`Invoice #: ${inv.invoice_number}`, `Date: ${invDate}`, `Due: ${dueText}`, `Project: ${projName}`, projAddress].filter(Boolean).join("\n"),
        ],
      ],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2.5 },
      bodyStyles: { textColor: BLACK },
      columnStyles: { 0: { cellWidth: contentW / 2 }, 1: { cellWidth: contentW / 2 } },
      didParseCell: (data) => {
        if (data.row.index === 0) {
          data.cell.styles.fillColor = CHARCOAL;
          data.cell.styles.textColor = WHITE;
          data.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: margin, right: margin },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;

    // ── Line items ──
    y = sectionHeader("INVOICE DETAIL", y);
    autoTable(doc, {
      startY: y,
      head: [["Description", "Amount (USD)"]],
      body: lineItems.map((li) => [sanitizeForPdf(li.description), fmtCurrency(Number(li.amount) || 0)]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
      bodyStyles: { textColor: BLACK },
      alternateRowStyles: { fillColor: PEACH },
      columnStyles: {
        0: { cellWidth: contentW - 40 },
        1: { halign: "right", cellWidth: 40, fontStyle: "bold" },
      },
      margin: { left: margin, right: margin },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY;

    // Total row
    autoTable(doc, {
      startY: y,
      body: [["TOTAL DUE", fmtCurrency(total)]],
      theme: "grid",
      styles: { fontSize: 11, cellPadding: 3.5, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: contentW - 40 },
        1: { halign: "right", cellWidth: 40 },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        data.cell.styles.fillColor = PEACH;
        data.cell.styles.textColor = CHARCOAL;
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;

    // ── Payment terms ──
    if (inv.description) {
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      const descLines = doc.splitTextToSize(sanitizeForPdf(inv.description), contentW);
      doc.text(descLines, margin, y + 2);
      y += descLines.length * 4 + 4;
    }
    doc.setTextColor(...CHARCOAL);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(`Payment Terms: ${sanitizeForPdf(inv.terms || "Due on receipt")}`, margin, y + 2);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("Please make checks payable to Penney Construction, Inc. Thank you for your business.", margin, y + 7);

    // ── Footer ──
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
    const safeFilename = `Invoice ${inv.invoice_number} - ${projName}.pdf`.replace(/[^\x20-\x7E]/g, "_");

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (e) {
    console.error("generate-client-invoice failed:", e);
    return NextResponse.json(
      { error: "PDF generation failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
