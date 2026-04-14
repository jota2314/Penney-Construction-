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
  return v < 0 ? `-$${str}` : `$${str}`;
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const coId = new URL(request.url).searchParams.get("changeOrderId");
  if (!coId) return NextResponse.json({ error: "changeOrderId required" }, { status: 400 });

  const { data: co } = await supabase
    .from("change_orders")
    .select("*, projects(name, address, city, state, project_number, contract_value, customers(first_name, last_name))")
    .eq("id", coId)
    .single();

  if (!co) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = co.projects as any;
  const custArr = proj?.customers;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = cust ? `${cust.first_name} ${cust.last_name}` : "";
  const address = [proj?.address, proj?.city, proj?.state].filter(Boolean).join(", ");
  const contractValue = Number(proj?.contract_value || 0);

  // Get all approved COs up to this one for running total
  const { data: allCOs } = await supabase
    .from("change_orders")
    .select("change_order_number, title, price_impact, status")
    .eq("project_id", co.project_id)
    .order("change_order_number");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const darkGray: [number, number, number] = [67, 67, 67];
  const lightGray: [number, number, number] = [204, 204, 204];
  const lightGreen: [number, number, number] = [217, 234, 211];
  const amber: [number, number, number] = [217, 119, 6];

  // ── Header with logo ──
  doc.setFillColor(...darkGray);
  doc.rect(0, 0, pw, 32, "F");

  // Add logo
  try {
    const logoPath = path.join(process.cwd(), "public", "logo.jpg");
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      const logoBase64 = logoBuffer.toString("base64");
      doc.addImage(`data:image/jpeg;base64,${logoBase64}`, "JPEG", 10, 4, 24, 24);
    }
  } catch { /* logo not critical */ }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(`CHANGE ORDER #${co.change_order_number}`, pw / 2, 13, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${proj?.name || ""}  |  ${clientName}`, pw / 2, 21, { align: "center" });
  doc.text(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), pw / 2, 28, { align: "center" });

  let y = 40;

  // ── Project Info ──
  doc.setTextColor(0, 0, 0);
  const infoData = [
    ["Project:", `${proj?.project_number || ""} — ${proj?.name || ""}`],
    ["Address:", address],
    ["Client:", clientName],
    ["CO Number:", `#${co.change_order_number}`],
    ["Date:", co.created_at ? new Date(co.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : ""],
    ["Status:", (co.status || "draft").toUpperCase()],
  ];

  autoTable(doc, {
    startY: y,
    head: [],
    body: infoData,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 30 },
      1: { cellWidth: 100 },
    },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      if (data.row.index === 5 && data.column.index === 1) {
        data.cell.styles.textColor = co.status === "approved" ? [22, 163, 74] : amber;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Description of Change ──
  doc.setFillColor(...darkGray);
  doc.rect(15, y, pw - 30, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Description of Change", pw / 2, y + 5, { align: "center" });
  y += 10;

  // Title + description
  autoTable(doc, {
    startY: y,
    head: [["Item", "Description", "Amount"]],
    body: [[co.title, co.description || "", fmtCurrency(Number(co.price_impact))]],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: lightGray, textColor: [0, 0, 0], fontStyle: "bold" },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 45 },
      1: { cellWidth: 80 },
      2: { halign: "right", cellWidth: 30, fontStyle: "bold" },
    },
    margin: { left: 15, right: 15 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY;

  // Total row
  autoTable(doc, {
    startY: y,
    head: [],
    body: [["Change Order Total", "", fmtCurrency(Number(co.price_impact))]],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 80 },
      2: { halign: "right", cellWidth: 30 },
    },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      data.cell.styles.fillColor = lightGreen;
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Contract Summary ──
  doc.setFillColor(...darkGray);
  doc.rect(15, y, pw - 30, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Contract Summary", pw / 2, y + 5, { align: "center" });
  y += 10;

  const approvedTotal = (allCOs || [])
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + Number(c.price_impact), 0);

  // Include this CO if not yet approved (preview)
  const thisCoAmount = co.status !== "approved" ? Number(co.price_impact) : 0;
  const newContract = contractValue + approvedTotal + thisCoAmount;

  const contractData = [
    ["Original Contract", fmtCurrency(contractValue)],
    ["Approved Change Orders", fmtCurrency(approvedTotal)],
  ];

  if (co.status !== "approved") {
    contractData.push([`This Change Order (#${co.change_order_number})`, fmtCurrency(Number(co.price_impact))]);
  }

  contractData.push(["New Contract Total", fmtCurrency(newContract)]);

  autoTable(doc, {
    startY: y,
    head: [],
    body: contractData,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 80 },
      1: { halign: "right", cellWidth: 50, fontStyle: "bold" },
    },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      if (data.row.index === contractData.length - 1) {
        data.cell.styles.fillColor = lightGreen;
        data.cell.styles.fontSize = 10;
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Change Order History (if multiple) ──
  if ((allCOs || []).length > 1) {
    doc.setFillColor(...darkGray);
    doc.rect(15, y, pw - 30, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Change Order History", pw / 2, y + 5, { align: "center" });
    y += 10;

    const historyBody = (allCOs || []).map((c) => [
      `CO #${c.change_order_number}`,
      c.title,
      fmtCurrency(Number(c.price_impact)),
      (c.status || "").charAt(0).toUpperCase() + (c.status || "").slice(1),
    ]);

    autoTable(doc, {
      startY: y,
      head: [["CO #", "Title", "Amount", "Status"]],
      body: historyBody,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: lightGray, textColor: [0, 0, 0], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 75 },
        2: { halign: "right", cellWidth: 28 },
        3: { halign: "center", cellWidth: 25 },
      },
      margin: { left: 15, right: 15 },
      didParseCell: (data) => {
        if (data.column.index === 3 && data.section === "body") {
          const status = (allCOs || [])[data.row.index]?.status;
          if (status === "approved") data.cell.styles.textColor = [22, 163, 74];
          else if (status === "rejected") data.cell.styles.textColor = [220, 38, 38];
          else data.cell.styles.textColor = amber;
        }
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // ── Signature Block ──
  // Check if we need a new page
  if (y > ph - 60) {
    doc.addPage();
    y = 20;
  }

  doc.setFillColor(...darkGray);
  doc.rect(15, y, pw - 30, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Authorization", pw / 2, y + 5, { align: "center" });
  y += 12;

  doc.setTextColor(100, 100, 100);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("By signing below, the client authorizes the work described above and agrees to the adjusted contract amount.", 15, y);
  y += 10;

  // Signature lines — fill in if signed, blank if not
  doc.setDrawColor(0, 0, 0);
  const isSigned = !!co.client_signature;
  const signedDate = co.client_signed_at ? new Date(co.client_signed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Client:", 15, y);
  if (isSigned) {
    // Filled signature
    doc.setFont("times", "italic");
    doc.setFontSize(14);
    doc.text(co.client_signature!, 38, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(signedDate, 138, y);
  }
  doc.line(35, y + 1, 110, y + 1);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Date:", 120, y);
  doc.line(135, y + 1, 190, y + 1);
  y += 12;

  doc.text("Contractor:", 15, y);
  doc.line(40, y + 1, 110, y + 1);
  doc.text("Date:", 120, y);
  doc.line(135, y + 1, 190, y + 1);

  // Signed stamp
  if (isSigned) {
    y += 15;
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(15, y, pw - 30, 14, 2, 2, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 163, 74);
    doc.text(`APPROVED — Signed by ${co.client_signature} on ${signedDate}`, pw / 2, y + 9, { align: "center" });
    if (co.client_ip) {
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text(`IP: ${co.client_ip}`, pw / 2, y + 13, { align: "center" });
    }
  }

  // ── Footer ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "italic");
    doc.text("Penney Construction Inc.  ·  North Shore, MA  ·  penneyconstructioninc.com  ·  978-621-4387", pw / 2, ph - 8, { align: "center" });
    doc.text(`Page ${i} of ${totalPages}`, pw - 15, ph - 8, { align: "right" });
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `CO${co.change_order_number} - ${co.title} - ${proj?.name || "Project"}.pdf`;

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
