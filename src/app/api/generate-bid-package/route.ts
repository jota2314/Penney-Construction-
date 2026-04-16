import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 30;

const CHARCOAL: [number, number, number] = [61, 61, 61];
const ORANGE: [number, number, number] = [212, 114, 42];
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const bidId = new URL(request.url).searchParams.get("bidId");
  if (!bidId) return NextResponse.json({ error: "bidId required" }, { status: 400 });

  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", bidId)
    .single();

  if (!setting?.value) return NextResponse.json({ error: "Bid package not found" }, { status: 404 });

  const params = JSON.parse(setting.value);
  return generatePdf(supabase, params);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const params = await request.json();
  return generatePdf(supabase, params);
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function generatePdf(supabase: SupabaseClient, params: Record<string, unknown>) {
  const projectId = String(params.projectId || "");
  const trade = String(params.trade || "");
  const scopeText = String(params.scopeText || "");
  const measurements = String(params.measurements || "");
  const screenshotPaths = (params.screenshotPaths as string[]) || [];
  const subName = String(params.subName || "");
  const notes = String(params.notes || "");

  if (!projectId || !trade) return NextResponse.json({ error: "projectId and trade required" }, { status: 400 });

  // Load project
  const { data: project } = await supabase
    .from("projects")
    .select("name, project_number, address, city, state")
    .eq("id", projectId)
    .single();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const projAddress = [project.address, project.city, project.state || "MA"].filter(Boolean).join(", ");

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
    if (yPos > ph - 30) { doc.addPage(); yPos = 20; }
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

  // ── PAGE 1: Header + Info ──
  addPageHeader();

  // Title
  let y = 36;
  doc.setFillColor(...CHARCOAL);
  doc.rect(margin, y, contentW, 12, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("REQUEST FOR PRICING", pw / 2, y + 8, { align: "center" });
  doc.setFillColor(...ORANGE);
  doc.rect(margin, y + 12, contentW, 1.5, "F");
  y += 18;

  // Project info
  y = sectionHeader("PROJECT INFORMATION", y);
  const infoLines = [
    ["Project:", `${project.name}  (${project.project_number})`],
    ["Address:", projAddress],
    ["Trade:", trade],
    ...(subName ? [["To:", subName]] : []),
    ["Date:", new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
  ];
  doc.setFontSize(8);
  for (const [label, value] of infoLines) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...CHARCOAL);
    doc.text(label, margin + 3, y + 3);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BLACK);
    doc.text(value, margin + 28, y + 3);
    y += 5;
  }
  y += 4;

  // Scope of work
  if (scopeText) {
    y = sectionHeader("SCOPE OF WORK", y);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BLACK);
    const scopeLines = doc.splitTextToSize(scopeText, contentW - 6);
    for (const line of scopeLines) {
      if (y > ph - 15) { doc.addPage(); y = 20; }
      doc.text(line, margin + 3, y + 3);
      y += 4;
    }
    y += 4;
  }

  // Measurements
  if (measurements) {
    y = sectionHeader("MEASUREMENTS & QUANTITIES", y);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BLACK);
    const measLines = doc.splitTextToSize(measurements, contentW - 6);
    for (const line of measLines) {
      if (y > ph - 15) { doc.addPage(); y = 20; }
      doc.text(line, margin + 3, y + 3);
      y += 4;
    }
    y += 4;
  }

  // Notes
  if (notes) {
    y = sectionHeader("NOTES", y);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BLACK);
    const noteLines = doc.splitTextToSize(notes, contentW - 6);
    for (const line of noteLines) {
      if (y > ph - 15) { doc.addPage(); y = 20; }
      doc.text(line, margin + 3, y + 3);
      y += 4;
    }
    y += 4;
  }

  // ── DRAWING SCREENSHOTS ──
  if (screenshotPaths && screenshotPaths.length > 0) {
    doc.addPage();
    y = 20;
    y = sectionHeader("DRAWING DETAILS", y);

    for (const imgPath of screenshotPaths as string[]) {
      try {
        const { data: blob } = await supabase.storage
          .from("email-attachments")
          .download(imgPath);
        if (!blob) continue;

        const buffer = Buffer.from(await blob.arrayBuffer());
        const base64 = buffer.toString("base64");
        const ext = imgPath.split(".").pop()?.toLowerCase() || "png";
        const mimeType = ext === "jpg" || ext === "jpeg" ? "JPEG" : "PNG";
        const dataUrl = `data:image/${ext};base64,${base64}`;

        // Calculate image dimensions to fit page width
        const maxW = contentW;
        const maxH = ph - y - 20;
        // Default to page-width, let jsPDF handle aspect ratio
        const imgW = Math.min(maxW, 170);
        const imgH = Math.min(maxH, 120);

        if (y + imgH > ph - 15) {
          doc.addPage();
          y = 20;
        }

        doc.addImage(dataUrl, mimeType, margin, y, imgW, imgH);
        y += imgH + 8;
      } catch {
        // Skip failed images
      }
    }
  }

  // Footer
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
  const filename = `${project.name} - ${trade} - Bid Package.pdf`;

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
