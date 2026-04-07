import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

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
    .select("id, name, project_number, customer_id, contract_value, scope_of_work, customers(first_name, last_name)")
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

  // Build the customer name
  const customer = Array.isArray(project.customers) ? project.customers[0] : project.customers;
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : project.name.split(" ")[0];

  // Build worksheet data
  const rows: (string | number)[][] = [];

  // Row 0: Title
  rows.push([`${customerName} –  Scope & Price`, "", ""]);
  // Row 1: blank
  rows.push(["", "", ""]);
  // Row 2: Headers
  rows.push(["Category", "Scope of Work", "Price (USD)"]);

  // Line items
  let total = 0;
  for (const li of lineItems) {
    const category = li.description || li.trade || "General";
    const scope = li.proposal_description || li.scope_text || "";
    const price = Number(li.client_price || li.total_price || 0);
    total += price;
    rows.push([category, scope, price]);
  }

  // Total row
  rows.push(["Total", "", total]);

  // Blank row
  rows.push(["", "", ""]);

  // Exclusions placeholder
  rows.push(["Exclusions / Notes:", "", ""]);
  rows.push([
    "- All cabinetry to be provided by owner\n" +
    "- All electrical fixtures to be provided by owner\n" +
    "- All plumbing fixtures to be provided by owner\n" +
    "- Demo is based on visible conditions only.\n" +
    "- Any hidden issues (plumbing/electrical/HVAC conflicts, water damage, rot, mold) are not included.",
    "", "",
  ]);

  // Create workbook
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 30 },  // Category
    { wch: 80 },  // Scope
    { wch: 15 },  // Price
  ];

  // Merge title row across all columns
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, // Title
    { s: { r: rows.length - 3, c: 0 }, e: { r: rows.length - 3, c: 1 } }, // Exclusions label
    { s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 2 } }, // Exclusions text
  ];

  // Format price column as currency
  for (let r = 3; r < 3 + lineItems.length + 1; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    if (cell) cell.z = '$#,##0';
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Client Proposal");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const filename = `${project.name} - Proposal.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
