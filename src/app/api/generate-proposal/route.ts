import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  // Caller can pin a specific estimate (multi-option projects) by passing
  // estimateId. Without it we still fall back to "latest version" which is
  // wrong for any project with 2+ options.
  const estimateIdParam = searchParams.get("estimateId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Load project + customer
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, scope_of_work, project_type, customers(first_name, last_name)")
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
    const { data: check } = await supabase
      .from("estimates")
      .select("id")
      .eq("id", estimateId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!check) return NextResponse.json({ error: "Estimate does not belong to this project" }, { status: 400 });
  }
  if (!estimateId) return NextResponse.json({ error: "No estimate found" }, { status: 404 });

  const { data: lineItems } = await supabase
    .from("estimate_line_items")
    .select("description, trade, total_cost, total_price, client_price, proposal_description, scope_text, sort_order, is_visible_on_proposal")
    .eq("estimate_id", estimateId)
    .order("sort_order");

  if (!lineItems?.length) return NextResponse.json({ error: "No estimate lines" }, { status: 404 });

  // Build client name
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = cust ? `${cust.first_name} ${cust.last_name}` : "";
  const state = project.state || "MA";

  // ── Create workbook matching McNamara format exactly ──
  const wb = new ExcelJS.Workbook();
  wb.creator = "Penney Construction Inc.";
  const ws = wb.addWorksheet("Client Proposal");

  // Column widths (match McNamara)
  ws.columns = [
    { width: 22.57 },  // A: Category
    { width: 71.14 },  // B: Scope of Work
    { width: 16.43 },  // C: Price (USD)
  ];

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };

  // ── Row 1: Header banner (merged A1:C1) ──
  const headerText = `         ${project.name}  |  ${clientName}  |  ${state}`;
  const row1 = ws.addRow([headerText]);
  ws.mergeCells("A1:C1");
  row1.height = 97.5;
  row1.getCell(1).font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  row1.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF434343" } };
  row1.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  // ── Row 2: Spacer ──
  const row2 = ws.addRow([]);
  row2.height = 6;

  // ── Row 3: Column headers ──
  const row3 = ws.addRow(["Category", "Scope of Work", "Price (USD)"]);
  row3.height = 19.5;
  for (let c = 1; c <= 3; c++) {
    const cell = row3.getCell(c);
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCCCCC" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  // ── Data rows ──
  let total = 0;
  for (const li of lineItems) {
    if (li.is_visible_on_proposal === false) continue;

    const category = li.description || "General";
    // Use scope_text (detailed) for proposal, fall back to proposal_description
    const scope = li.scope_text || li.proposal_description || "";
    const price = Number(li.total_price ?? li.client_price ?? 0);
    total += price;

    const row = ws.addRow([category, scope, price]);

    // Row height based on content
    const lineCount = scope ? scope.split("\n").length : 1;
    row.height = Math.max(45, lineCount * 15 + 15);

    // Col A: Category — bold, left, vertically centered
    row.getCell(1).font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF000000" } };
    row.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    row.getCell(1).border = thinBorder;

    // Col B: Scope — normal, left, top aligned
    row.getCell(2).font = { name: "Calibri", size: 11, color: { argb: "FF000000" } };
    row.getCell(2).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    row.getCell(2).border = thinBorder;

    // Col C: Price — bold, centered, currency format
    row.getCell(3).font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF000000" } };
    row.getCell(3).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.getCell(3).numFmt = '"$"#,##0';
    row.getCell(3).border = thinBorder;
  }

  // ── Total row — sum of the rows we just rendered so the spreadsheet is
  // self-consistent (PDF and Excel use the same precedence on price). ──
  const totalRow = ws.addRow(["TOTAL PROJECT PRICE", "", total]);
  totalRow.height = 27;
  for (let c = 1; c <= 3; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
  }
  totalRow.getCell(3).numFmt = '"$"#,##0';

  // ── Exclusions header (merged) ──
  const exclHeaderRow = ws.addRow(["Exclusions"]);
  ws.mergeCells(`A${exclHeaderRow.number}:C${exclHeaderRow.number}`);
  exclHeaderRow.height = 33;
  exclHeaderRow.getCell(1).font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF000000" } };
  exclHeaderRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCCCCC" } };
  exclHeaderRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  exclHeaderRow.getCell(1).border = thinBorder;
  exclHeaderRow.getCell(2).border = { top: thinBorder.top, bottom: thinBorder.bottom };
  exclHeaderRow.getCell(3).border = { top: thinBorder.top, bottom: thinBorder.bottom, right: thinBorder.right };

  // ── Exclusions content (merged) ──
  const exclusionText = [
    "- Material allowances (tile, flooring, fixtures, lighting) are owner selections — final amounts adjusted at close based on selections",
    "- Structural repairs or hidden conditions discovered during demolition subject to separate change order",
    "- Any work beyond the scope described above",
  ].join("\n");

  const exclRow = ws.addRow(["\n" + exclusionText]);
  ws.mergeCells(`A${exclRow.number}:C${exclRow.number}`);
  exclRow.height = 109.5;
  exclRow.getCell(1).font = { name: "Calibri", size: 11, color: { argb: "FF000000" } };
  exclRow.getCell(1).alignment = { horizontal: "center", vertical: "top", wrapText: true };
  exclRow.getCell(1).border = thinBorder;
  exclRow.getCell(2).border = { top: thinBorder.top, bottom: thinBorder.bottom };
  exclRow.getCell(3).border = { top: thinBorder.top, bottom: thinBorder.bottom, right: thinBorder.right };

  // Generate buffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: any = await wb.xlsx.writeBuffer();
  const filename = `${project.name} - Proposal.xlsx`;
  const asciiName = filename.replace(/[^\x20-\x7E]/g, "-").replace(/"/g, "");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
  } catch (err) {
    console.error("[generate-proposal] crashed:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8).join("\n") : undefined,
      where: "generate-proposal",
    }, { status: 500 });
  }
}
