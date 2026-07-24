import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";

export const runtime = "nodejs";

// Same Latin-1 sanitation as generate-contract / generate-proposal-pdf —
// jsPDF's Helvetica mis-measures glyphs outside WinAnsi.
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
    .replace(/[→]/g, "->")
    .replace(/[©]/g, "(c)")
    .replace(/[®]/g, "(R)")
    .replace(/[™]/g, "(TM)");
  s = s.replace(/[^\x00-\xFF]/g, "?");
  return s;
}

// Penney brand colors (same values as generate-contract)
const CHARCOAL: [number, number, number] = [61, 61, 61];
const ORANGE: [number, number, number] = [212, 114, 42];
const WHITE: [number, number, number] = [255, 255, 255];

const HIC_LINE = "Licensed & Insured  ·  MA Home Improvement Contractor";
const ADDRESS_LINE = "5 Barrett Road, Peabody, MA 01960  ·  Tel: 978-621-4387  ·  HIC Reg #198443";

interface PermitScopeFields {
  summary?: string;
  narrative?: string;
  structural?: string;
  plumbing?: string;
  electrical?: string;
  mechanical?: string;
  site_demo?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Two auth paths, same as generate-contract: a signed-in user (the
    // Download PDF button) or the shared service key (headless/agent use).
    let supabase;
    const serviceKey = request.headers.get("x-service-key");
    if (serviceKey) {
      const admin = createAdminClient();
      const { data: keyRow } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", "proposal_pdf_service_key")
        .maybeSingle();
      const expected = String(keyRow?.value ?? "");
      const a = Buffer.from(serviceKey);
      const b = Buffer.from(expected);
      if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
      }
      supabase = admin;
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const town: string = body?.town ? String(body.town) : "";
    const fields: PermitScopeFields = body?.fields ?? {};
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const { data: project } = await supabase
      .from("projects")
      .select("name, project_number, address, city, state, zip, customers(first_name, last_name)")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const custArr = project.customers as any;
    const cust = Array.isArray(custArr) ? custArr[0] : custArr;
    const ownerName = cust ? `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim() : "";
    const projAddress = [project.address, project.city, project.state || "MA", project.zip]
      .filter(Boolean)
      .join(", ");

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
      doc.text(HIC_LINE, pw - margin, 19, { align: "right" });
      doc.text(ADDRESS_LINE, pw - margin, 23, { align: "right" });
      doc.setFillColor(...ORANGE);
      doc.rect(margin, 30, contentW, 1, "F");
    }

    function sectionHeader(label: string, yPos: number): number {
      if (yPos > ph - 40) { doc.addPage(); addPageHeader(); yPos = 36; }
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

    addPageHeader();
    let y = 36;
    doc.setFillColor(...CHARCOAL);
    doc.rect(margin, y, contentW, 12, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("SCOPE OF WORK  -  BUILDING PERMIT", pw / 2, y + 8, { align: "center" });
    doc.setFillColor(...ORANGE);
    doc.rect(margin, y + 12, contentW, 1.5, "F");
    y += 18;

    // ── Project block ──
    y = sectionHeader("PROJECT", y);
    const permitDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    autoTable(doc, {
      startY: y,
      head: [],
      body: [
        ["Contractor:", "Penney Construction, Inc.  -  HIC Reg #198443  -  CSL CS-099765"],
        ...(ownerName ? [["Property Owner:", sanitizeForPdf(ownerName)]] : []),
        ["Project Address:", sanitizeForPdf(projAddress || "-")],
        ...(town ? [["Permitting Town:", sanitizeForPdf(town)]] : []),
        ["Project #:", sanitizeForPdf(project.project_number ?? "-")],
        ["Date:", permitDate],
      ],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 1.2, textColor: CHARCOAL },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 38 }, 1: { cellWidth: contentW - 38 } },
      margin: { left: margin, right: margin },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;

    // ── Description of work ──
    y = sectionHeader("DESCRIPTION OF WORK", y);
    if (fields.summary) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...CHARCOAL);
      const sumLines = doc.splitTextToSize(sanitizeForPdf(fields.summary), contentW);
      doc.text(sumLines, margin, y);
      y += sumLines.length * 5 + 2;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...CHARCOAL);
    const narrative = sanitizeForPdf(fields.narrative || "-");
    const narrLines = doc.splitTextToSize(narrative, contentW);
    doc.text(narrLines, margin, y);
    y += narrLines.length * 5 + 6;

    // ── Trade breakdown (what inspections asks for) ──
    y = sectionHeader("TRADES INVOLVED", y);
    autoTable(doc, {
      startY: y,
      head: [["Trade", "Scope"]],
      body: [
        ["Structural", sanitizeForPdf(fields.structural || "None")],
        ["Plumbing", sanitizeForPdf(fields.plumbing || "None")],
        ["Electrical", sanitizeForPdf(fields.electrical || "None")],
        ["Mechanical (HVAC/Gas)", sanitizeForPdf(fields.mechanical || "None")],
        ["Site / Demolition", sanitizeForPdf(fields.site_demo || "None")],
      ],
      theme: "grid",
      headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontSize: 9, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 2.2, textColor: CHARCOAL, lineColor: [220, 220, 220] },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 45 }, 1: { cellWidth: contentW - 45 } },
      margin: { left: margin, right: margin },
    });

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
    const filename = `Permit Scope - ${project.name} - ${project.project_number}.pdf`;
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "-").replace(/"/g, "");

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("[generate-permit-description/pdf] crashed:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      where: "generate-permit-description/pdf",
    }, { status: 500 });
  }
}
