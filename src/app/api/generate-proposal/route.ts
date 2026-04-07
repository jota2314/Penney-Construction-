import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Load project
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, address, customer_id, contract_value, scope_of_work, customers(first_name, last_name)")
    .eq("id", projectId)
    .single();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Load latest estimate with line items
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, name, status")
    .eq("project_id", projectId)
    .in("status", ["approved", "draft"])
    .order("version", { ascending: false })
    .limit(1);

  const estimateId = estimates?.[0]?.id;
  if (!estimateId) return NextResponse.json({ error: "No estimate found for this project" }, { status: 404 });

  const { data: lineItems } = await supabase
    .from("estimate_line_items")
    .select("description, trade, total_price, client_price, proposal_description, scope_text, sort_order")
    .eq("estimate_id", estimateId)
    .order("sort_order");

  if (!lineItems?.length) return NextResponse.json({ error: "No estimate lines" }, { status: 404 });

  // Build customer name
  const customer = Array.isArray(project.customers) ? project.customers[0] : project.customers;
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : project.name.split(" ")[0];

  // Create workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "Penney Construction Inc.";
  const ws = wb.addWorksheet("Client Proposal", {
    properties: { defaultColWidth: 20 },
  });

  // Column widths
  ws.columns = [
    { width: 28 },  // A: Category
    { width: 75 },  // B: Scope of Work
    { width: 16 },  // C: Price
  ];

  // Colors
  const amber = "D97706";
  const darkBg = "1C1917";
  const cardBg = "292524";
  const white = "FFFFFF";
  const lightGray = "A8A29E";
  const headerBg = "44403C";

  // ── Row 1: Logo + Company info ──
  // Try to load logo
  try {
    const logoPath = path.join(process.cwd(), "public", "logo.jpg");
    if (fs.existsSync(logoPath)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logoBuffer: any = fs.readFileSync(logoPath);
      const logoId = wb.addImage({
        buffer: logoBuffer,
        extension: "jpeg",
      });
      ws.addImage(logoId, {
        tl: { col: 0, row: 0 },
        ext: { width: 80, height: 80 },
      });
    }
  } catch { /* logo not critical */ }

  // Row 1: Company name
  const companyRow = ws.addRow(["     Penney Construction Inc.", "", ""]);
  companyRow.height = 30;
  companyRow.getCell(1).font = { bold: true, size: 16, color: { argb: amber } };
  companyRow.getCell(1).alignment = { vertical: "middle" };

  // Row 2: Contact info
  const contactRow = ws.addRow(["     www.penneyconstructioninc.com  ·  978-621-4387", "", ""]);
  contactRow.getCell(1).font = { size: 9, color: { argb: lightGray } };
  ws.mergeCells("A2:C2");

  // Row 3: blank spacer
  ws.addRow([]);

  // Row 4: Proposal title
  const titleRow = ws.addRow([`${customerName} –  Scope & Price`]);
  ws.mergeCells(`A4:C4`);
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: white } };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: darkBg } };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  titleRow.height = 32;

  // Row 5: Project address
  if (project.address) {
    const addrRow = ws.addRow([project.address]);
    ws.mergeCells(`A5:C5`);
    addrRow.getCell(1).font = { size: 10, italic: true, color: { argb: lightGray } };
    addrRow.getCell(1).alignment = { horizontal: "center" };
  } else {
    ws.addRow([]);
  }

  // Row 6: blank
  ws.addRow([]);

  // Row 7: Headers
  const headerRow = ws.addRow(["Category", "Scope of Work", "Price (USD)"]);
  headerRow.height = 24;
  for (let c = 1; c <= 3; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { bold: true, size: 10, color: { argb: white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
    cell.alignment = { vertical: "middle", horizontal: c === 3 ? "right" : "left" };
    cell.border = {
      bottom: { style: "medium", color: { argb: amber } },
    };
  }

  // Line items
  let total = 0;
  let rowIdx = 0;
  for (const li of lineItems) {
    const category = li.description || li.trade || "General";
    const scope = li.proposal_description || li.scope_text || "";
    const price = Number(li.client_price || li.total_price || 0);
    total += price;

    const row = ws.addRow([category, scope, price]);
    row.height = scope.includes("\n") ? Math.min(80, 20 + (scope.split("\n").length - 1) * 12) : 20;

    // Category
    row.getCell(1).font = { bold: true, size: 10, color: { argb: white } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 0 ? darkBg : cardBg } };
    row.getCell(1).alignment = { vertical: "top", wrapText: true };

    // Scope
    row.getCell(2).font = { size: 9, color: { argb: lightGray } };
    row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 0 ? darkBg : cardBg } };
    row.getCell(2).alignment = { vertical: "top", wrapText: true };

    // Price
    row.getCell(3).font = { bold: true, size: 10, color: { argb: amber } };
    row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 0 ? darkBg : cardBg } };
    row.getCell(3).numFmt = "$#,##0";
    row.getCell(3).alignment = { vertical: "top", horizontal: "right" };

    // Borders
    for (let c = 1; c <= 3; c++) {
      row.getCell(c).border = {
        bottom: { style: "thin", color: { argb: "3F3F46" } },
      };
    }

    rowIdx++;
  }

  // Total row
  const totalRow = ws.addRow(["Total", "", total]);
  totalRow.height = 28;
  for (let c = 1; c <= 3; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true, size: 12, color: { argb: white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
    cell.border = { top: { style: "medium", color: { argb: amber } } };
  }
  totalRow.getCell(3).numFmt = "$#,##0";
  totalRow.getCell(3).alignment = { horizontal: "right" };
  ws.mergeCells(`A${totalRow.number}:B${totalRow.number}`);

  // Blank row
  ws.addRow([]);

  // Exclusions header
  const exclHeaderRow = ws.addRow(["Exclusions / Notes"]);
  ws.mergeCells(`A${exclHeaderRow.number}:C${exclHeaderRow.number}`);
  exclHeaderRow.getCell(1).font = { bold: true, size: 10, color: { argb: amber } };
  exclHeaderRow.getCell(1).border = { bottom: { style: "thin", color: { argb: amber } } };

  // Exclusions content
  const exclusions = [
    "All cabinetry to be provided by owner",
    "All electrical fixtures to be provided by owner",
    "All plumbing fixtures to be provided by owner",
    "Tile material to be provided by owner",
    "Demo is based on visible conditions only",
    "Any hidden issues (plumbing/electrical/HVAC conflicts, water damage, rot, mold) are not included",
  ];
  const exclRow = ws.addRow(["- " + exclusions.join("\n- ")]);
  ws.mergeCells(`A${exclRow.number}:C${exclRow.number}`);
  exclRow.getCell(1).font = { size: 9, color: { argb: lightGray } };
  exclRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  exclRow.height = 90;

  // Footer
  ws.addRow([]);
  const footerRow = ws.addRow(["Penney Construction Inc.  ·  North Shore, MA  ·  penneyconstructioninc.com"]);
  ws.mergeCells(`A${footerRow.number}:C${footerRow.number}`);
  footerRow.getCell(1).font = { size: 8, italic: true, color: { argb: lightGray } };
  footerRow.getCell(1).alignment = { horizontal: "center" };

  // Generate buffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: any = await wb.xlsx.writeBuffer();
  const filename = `${project.name} - Proposal.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
