import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

/**
 * Generate a change order document as Excel (same format as McNamara proposal).
 * GET /api/generate-change-order?changeOrderId=xxx
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const coId = searchParams.get("changeOrderId");
  if (!coId) return NextResponse.json({ error: "changeOrderId required" }, { status: 400 });

  // Load change order + project + customer
  const { data: co } = await supabase
    .from("change_orders")
    .select("*, projects(name, address, city, state, project_number, customers(first_name, last_name))")
    .eq("id", coId)
    .single();

  if (!co) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = co.projects as any;
  const cust = proj?.customers?.[0] || proj?.customers;
  const clientName = cust ? `${cust.first_name} ${cust.last_name}` : "";
  const address = [proj?.address, proj?.city, proj?.state].filter(Boolean).join(", ");

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Penney Construction Inc.";
  const ws = wb.addWorksheet("Change Order");

  ws.columns = [
    { width: 22.57 },
    { width: 71.14 },
    { width: 16.43 },
  ];

  // ── Row 1: Header ──
  const headerText = `         Change Order #${co.change_order_number}  |  ${proj?.name || ""}  |  ${clientName}`;
  const row1 = ws.addRow([headerText]);
  ws.mergeCells("A1:C1");
  row1.height = 80;
  row1.getCell(1).font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  row1.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF434343" } };
  row1.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  // ── Row 2: Spacer ──
  ws.addRow([]).height = 6;

  // ── Row 3: Project info ──
  const infoRow = ws.addRow(["Project", `${proj?.project_number || ""} — ${proj?.name || ""}`, ""]);
  ws.mergeCells(`B${infoRow.number}:C${infoRow.number}`);
  infoRow.height = 20;
  infoRow.getCell(1).font = { name: "Calibri", bold: true, size: 11 };
  infoRow.getCell(2).font = { name: "Calibri", size: 11 };

  const addrRow = ws.addRow(["Address", address, ""]);
  ws.mergeCells(`B${addrRow.number}:C${addrRow.number}`);
  addrRow.height = 20;
  addrRow.getCell(1).font = { name: "Calibri", bold: true, size: 11 };
  addrRow.getCell(2).font = { name: "Calibri", size: 11 };

  const dateRow = ws.addRow(["Date", new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), ""]);
  ws.mergeCells(`B${dateRow.number}:C${dateRow.number}`);
  dateRow.height = 20;
  dateRow.getCell(1).font = { name: "Calibri", bold: true, size: 11 };
  dateRow.getCell(2).font = { name: "Calibri", size: 11 };

  const statusRow = ws.addRow(["Status", (co.status || "draft").toUpperCase(), ""]);
  ws.mergeCells(`B${statusRow.number}:C${statusRow.number}`);
  statusRow.height = 20;
  statusRow.getCell(1).font = { name: "Calibri", bold: true, size: 11 };
  statusRow.getCell(2).font = { name: "Calibri", bold: true, size: 11, color: { argb: co.status === "approved" ? "FF16A34A" : "FFD97706" } };

  // ── Spacer ──
  ws.addRow([]).height = 6;

  // ── Column headers ──
  const hdrRow = ws.addRow(["Item", "Description", "Amount"]);
  hdrRow.height = 22;
  for (let c = 1; c <= 3; c++) {
    const cell = hdrRow.getCell(c);
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCCCCC" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // ── Change order content ──
  const titleRow = ws.addRow([co.title, co.description || "", Number(co.price_impact)]);
  const scopeLines = (co.description || "").split("\n").length;
  titleRow.height = Math.max(45, scopeLines * 15 + 15);
  titleRow.getCell(1).font = { name: "Calibri", bold: true, size: 11 };
  titleRow.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  titleRow.getCell(1).border = thinBorder;
  titleRow.getCell(2).font = { name: "Calibri", size: 11 };
  titleRow.getCell(2).alignment = { horizontal: "left", vertical: "top", wrapText: true };
  titleRow.getCell(2).border = thinBorder;
  titleRow.getCell(3).font = { name: "Calibri", bold: true, size: 11 };
  titleRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
  titleRow.getCell(3).numFmt = '"$"#,##0';
  titleRow.getCell(3).border = thinBorder;

  // ── Total row ──
  const totalRow = ws.addRow(["", "Change Order Total", Number(co.price_impact)]);
  totalRow.height = 27;
  for (let c = 1; c <= 3; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { name: "Calibri", bold: true, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder;
  }
  totalRow.getCell(3).numFmt = '"$"#,##0';

  // ── Spacer ──
  ws.addRow([]).height = 10;

  // ── Signature lines ──
  const sigHeader = ws.addRow(["Approval"]);
  ws.mergeCells(`A${sigHeader.number}:C${sigHeader.number}`);
  sigHeader.getCell(1).font = { name: "Calibri", bold: true, size: 11 };
  sigHeader.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCCCCC" } };
  sigHeader.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  sigHeader.height = 22;

  ws.addRow([]).height = 6;
  const sigLine1 = ws.addRow(["Client Signature:", "________________________________", "Date: _______________"]);
  sigLine1.height = 30;
  for (let c = 1; c <= 3; c++) {
    sigLine1.getCell(c).font = { name: "Calibri", size: 11 };
    sigLine1.getCell(c).alignment = { vertical: "bottom" };
  }

  ws.addRow([]).height = 10;
  const sigLine2 = ws.addRow(["Contractor:", "________________________________", "Date: _______________"]);
  sigLine2.height = 30;
  for (let c = 1; c <= 3; c++) {
    sigLine2.getCell(c).font = { name: "Calibri", size: 11 };
    sigLine2.getCell(c).alignment = { vertical: "bottom" };
  }

  // ── Footer ──
  ws.addRow([]).height = 10;
  const footerRow = ws.addRow(["Penney Construction Inc.  ·  North Shore, MA  ·  penneyconstructioninc.com  ·  978-621-4387"]);
  ws.mergeCells(`A${footerRow.number}:C${footerRow.number}`);
  footerRow.getCell(1).font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF999999" } };
  footerRow.getCell(1).alignment = { horizontal: "center" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: any = await wb.xlsx.writeBuffer();
  const filename = `CO${co.change_order_number} - ${co.title} - ${proj?.name || "Project"}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
