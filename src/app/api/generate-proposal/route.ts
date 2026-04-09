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
    .select("id, name, project_number, address, city, customer_id, contract_value, scope_of_work, project_type, customers(first_name, last_name)")
    .eq("id", projectId)
    .single();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Load latest estimate with line items
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, name, status, total_price, total_cost, description")
    .eq("project_id", projectId)
    .in("status", ["approved", "draft"])
    .order("version", { ascending: false })
    .limit(1);

  const estimate = estimates?.[0];
  if (!estimate) return NextResponse.json({ error: "No estimate found for this project" }, { status: 404 });

  const { data: lineItems } = await supabase
    .from("estimate_line_items")
    .select("description, trade, total_cost, total_price, markup_percentage, proposal_description, sort_order, is_visible_on_proposal")
    .eq("estimate_id", estimate.id)
    .order("sort_order");

  if (!lineItems?.length) return NextResponse.json({ error: "No estimate lines" }, { status: 404 });

  // Build address string
  const address = [project.address, project.city].filter(Boolean).join(", ");

  // Build project type label
  const typeLabels: Record<string, string> = {
    full_renovation: "Full Renovation Estimate",
    kitchen_remodel: "Kitchen Remodel Estimate",
    bathroom_remodel: "Bathroom Remodel Estimate",
    addition: "Addition Estimate",
    new_construction: "New Construction Estimate",
    deck_porch: "Deck / Porch Estimate",
    roofing_siding: "Roofing & Siding Estimate",
    other: "Scope & Price",
  };
  const projectTypeLabel = typeLabels[project.project_type || "other"] || "Scope & Price";

  // Create workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "Penney Construction Inc.";
  const ws = wb.addWorksheet("Client Proposal", {
    properties: { defaultColWidth: 20 },
  });

  // Column widths
  ws.columns = [
    { width: 26 },  // A: Category
    { width: 72 },  // B: Scope of Work
    { width: 16 },  // C: Price
  ];

  // Colors
  const amber = "D97706";
  const darkBg = "1C1917";
  const cardBg = "292524";
  const white = "FFFFFF";
  const lightGray = "A8A29E";
  const headerBg = "44403C";
  const sectionBg = "3A3733";
  const subtotalBg = "2D2926";

  // ── Row 1: Logo + project title ──
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
        ext: { width: 70, height: 70 },
      });
    }
  } catch { /* logo not critical */ }

  // Row 1: Address + project type title
  const titleText = address
    ? `${address}  |  ${projectTypeLabel}`
    : `${project.name}  |  ${projectTypeLabel}`;
  const titleRow = ws.addRow(["", titleText]);
  ws.mergeCells("B1:C1");
  titleRow.height = 36;
  titleRow.getCell(2).font = { bold: true, size: 12, color: { argb: white } };
  titleRow.getCell(2).alignment = { vertical: "middle" };

  // Row 2: Column headers
  const headerRow = ws.addRow(["Category", "Scope of Work", "Price (USD)"]);
  headerRow.height = 22;
  for (let c = 1; c <= 3; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
    cell.alignment = { vertical: "middle", horizontal: c === 3 ? "right" : "left" };
    cell.border = {
      bottom: { style: "medium", color: { argb: amber } },
    };
  }

  // ── Group line items by trade/section ──
  // Use trade field for section grouping. Items without trade go under "GENERAL"
  const sections = new Map<string, typeof lineItems>();
  for (const li of lineItems) {
    // Skip items marked as not visible on proposal
    if (li.is_visible_on_proposal === false) continue;
    const section = (li.trade || "GENERAL").toUpperCase();
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(li);
  }

  let grandTotal = 0;
  let rowIdx = 0;

  // If there's only one section (or all items are ungrouped), skip section headers
  const showSections = sections.size > 1;

  for (const [sectionName, items] of sections) {
    // ── Section header row ──
    if (showSections) {
      const sectionRow = ws.addRow([sectionName, "", ""]);
      ws.mergeCells(`A${sectionRow.number}:C${sectionRow.number}`);
      sectionRow.height = 22;
      sectionRow.getCell(1).font = { bold: true, size: 10, color: { argb: white } };
      sectionRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectionBg } };
      sectionRow.getCell(1).alignment = { vertical: "middle" };
    }

    let sectionTotal = 0;

    // ── Line items in this section ──
    for (const li of items) {
      const category = li.description || "General";
      const scope = li.proposal_description || "";
      const price = Number(li.total_price || 0);
      sectionTotal += price;

      // Format scope with dash prefixes if not already formatted
      let formattedScope = scope;
      if (scope && !scope.startsWith("-") && !scope.startsWith("•")) {
        // Split by newline and add dash prefix
        formattedScope = scope
          .split("\n")
          .map((line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return "";
            if (trimmed.startsWith("-") || trimmed.startsWith("•")) return trimmed;
            return `- ${trimmed}`;
          })
          .filter(Boolean)
          .join("\n");
      }

      const row = ws.addRow([category, formattedScope, price]);

      // Auto-height based on scope lines
      const lineCount = formattedScope ? formattedScope.split("\n").length : 1;
      row.height = Math.max(20, Math.min(100, lineCount * 14 + 6));

      const bgColor = rowIdx % 2 === 0 ? darkBg : cardBg;

      // Category cell
      row.getCell(1).font = { bold: true, size: 10, color: { argb: white } };
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      row.getCell(1).alignment = { vertical: "top", wrapText: true };

      // Scope cell
      row.getCell(2).font = { size: 9, color: { argb: lightGray } };
      row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      row.getCell(2).alignment = { vertical: "top", wrapText: true };

      // Price cell
      row.getCell(3).font = { bold: true, size: 10, color: { argb: amber } };
      row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      row.getCell(3).numFmt = "$#,##0";
      row.getCell(3).alignment = { vertical: "top", horizontal: "right" };

      // Bottom border
      for (let c = 1; c <= 3; c++) {
        row.getCell(c).border = {
          bottom: { style: "thin", color: { argb: "3F3F46" } },
        };
      }

      rowIdx++;
    }

    grandTotal += sectionTotal;

    // ── Section subtotal row ──
    if (showSections) {
      const subtotalRow = ws.addRow([`${sectionName}  –  Subtotal`, "", sectionTotal]);
      ws.mergeCells(`A${subtotalRow.number}:B${subtotalRow.number}`);
      subtotalRow.height = 22;
      subtotalRow.getCell(1).font = { bold: true, size: 9, color: { argb: amber } };
      subtotalRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: subtotalBg } };
      subtotalRow.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
      subtotalRow.getCell(3).font = { bold: true, size: 10, color: { argb: amber } };
      subtotalRow.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: subtotalBg } };
      subtotalRow.getCell(3).numFmt = "$#,##0";
      subtotalRow.getCell(3).alignment = { horizontal: "right", vertical: "middle" };
      subtotalRow.getCell(3).border = {
        top: { style: "thin", color: { argb: amber } },
      };
    }
  }

  // ── Grand Total row ──
  const totalRow = ws.addRow(["TOTAL", "", grandTotal]);
  ws.mergeCells(`A${totalRow.number}:B${totalRow.number}`);
  totalRow.height = 28;
  totalRow.getCell(1).font = { bold: true, size: 12, color: { argb: white } };
  totalRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
  totalRow.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
  totalRow.getCell(3).font = { bold: true, size: 12, color: { argb: white } };
  totalRow.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
  totalRow.getCell(3).numFmt = "$#,##0";
  totalRow.getCell(3).alignment = { horizontal: "right", vertical: "middle" };
  totalRow.getCell(3).border = {
    top: { style: "medium", color: { argb: amber } },
  };

  // ── Blank row ──
  ws.addRow([]);

  // ── Exclusions / Notes ──
  const exclHeaderRow = ws.addRow(["Exclusions / Notes"]);
  ws.mergeCells(`A${exclHeaderRow.number}:C${exclHeaderRow.number}`);
  exclHeaderRow.getCell(1).font = { bold: true, size: 10, color: { argb: amber } };
  exclHeaderRow.getCell(1).border = { bottom: { style: "thin", color: { argb: amber } } };

  const exclusions = [
    "All cabinetry to be provided by owner unless noted",
    "All electrical fixtures to be provided by owner unless noted",
    "All plumbing fixtures to be provided by owner unless noted",
    "Tile material to be provided by owner unless noted",
    "Demo is based on visible conditions only",
    "Any hidden issues (plumbing/electrical/HVAC conflicts, water damage, rot, mold) are not included",
    "Price is valid for 30 days from date of proposal",
  ];
  const exclRow = ws.addRow(["- " + exclusions.join("\n- ")]);
  ws.mergeCells(`A${exclRow.number}:C${exclRow.number}`);
  exclRow.getCell(1).font = { size: 9, color: { argb: lightGray } };
  exclRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  exclRow.height = 100;

  // ── Footer ──
  ws.addRow([]);
  const footerRow = ws.addRow(["Penney Construction Inc.  ·  North Shore, MA  ·  penneyconstructioninc.com  ·  978-621-4387"]);
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
