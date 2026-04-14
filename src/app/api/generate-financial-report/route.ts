import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

const fmt = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Load everything in parallel
  const [
    { data: project },
    { data: estimates },
    { data: invoices },
    { data: payments },
    { data: changeOrders },
  ] = await Promise.all([
    supabase.from("projects").select("*, customers(first_name, last_name)").eq("id", projectId).single(),
    supabase.from("estimates").select("id, total_cost, total_price").eq("project_id", projectId).in("status", ["approved", "draft"]).order("version", { ascending: false }).limit(1),
    supabase.from("invoices").select("*, estimate_line_items:estimate_line_item_id(description, trade)").eq("project_id", projectId).order("invoice_date"),
    supabase.from("payments_received").select("*").eq("project_id", projectId).order("received_date"),
    supabase.from("change_orders").select("*").eq("project_id", projectId).order("change_order_number"),
  ]);

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Load budget lines if estimate exists
  let budgetLines: { id: string; description: string; trade: string | null; total_cost: number; client_price: number }[] = [];
  if (estimates?.[0]) {
    const { data } = await supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, client_price, total_price")
      .eq("estimate_id", estimates[0].id)
      .order("sort_order");
    budgetLines = (data || []).map((li) => ({
      ...li,
      total_cost: Number(li.total_cost || 0),
      client_price: Number(li.client_price || li.total_price || 0),
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = cust ? `${cust.first_name} ${cust.last_name}` : "";
  const address = [project.address, project.city, project.state].filter(Boolean).join(", ");

  // Calculations
  const contractValue = Number(project.contract_value || estimates?.[0]?.total_price || 0);
  const approvedCOs = (changeOrders || []).filter((co) => co.status === "approved");
  const coRevenue = approvedCOs.reduce((s, co) => s + Number(co.price_impact), 0);
  const coCost = approvedCOs.reduce((s, co) => s + Number(co.cost_impact), 0);
  const adjustedContract = contractValue + coRevenue;

  const totalInvoiced = (invoices || []).reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = (invoices || []).reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalReceived = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const profit = totalReceived - totalPaid;
  const margin = totalReceived > 0 ? (profit / totalReceived) * 100 : 0;

  // Spend by budget line
  const spendByLine = new Map<string, number>();
  for (const inv of invoices || []) {
    if (inv.estimate_line_item_id) {
      spendByLine.set(inv.estimate_line_item_id, (spendByLine.get(inv.estimate_line_item_id) || 0) + Number(inv.amount));
    }
  }

  // ── Build Excel ──
  const wb = new ExcelJS.Workbook();
  wb.creator = "Penney Construction Inc.";

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };

  const grayFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCCCCC" } };
  const greenFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
  const redFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4EC" } };
  const darkFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF434343" } };
  const boldWhite: Partial<ExcelJS.Font> = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  const bold11: Partial<ExcelJS.Font> = { name: "Calibri", bold: true, size: 11 };
  const normal11: Partial<ExcelJS.Font> = { name: "Calibri", size: 11 };
  const currency = '"$"#,##0';

  // ── SHEET 1: Summary ──
  const ws1 = wb.addWorksheet("Financial Summary");
  ws1.columns = [{ width: 30 }, { width: 20 }, { width: 20 }, { width: 20 }];

  // Header
  const h1 = ws1.addRow([`         ${project.name}  |  ${clientName}  |  Financial Report`]);
  ws1.mergeCells("A1:D1");
  h1.height = 80;
  h1.getCell(1).font = boldWhite;
  h1.getCell(1).fill = darkFill;
  h1.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  ws1.addRow([]).height = 6;

  // Project info
  const infoData = [
    ["Project", `${project.project_number} — ${project.name}`],
    ["Address", address],
    ["Client", clientName],
    ["Status", (project.status || "").replace(/_/g, " ").toUpperCase()],
    ["Report Date", new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
  ];
  for (const [label, value] of infoData) {
    const r = ws1.addRow([label, value]);
    ws1.mergeCells(`B${r.number}:D${r.number}`);
    r.getCell(1).font = bold11;
    r.getCell(2).font = normal11;
    r.height = 20;
  }

  ws1.addRow([]).height = 10;

  // Financial summary section
  const sumHdr = ws1.addRow(["Financial Summary", "", "", ""]);
  ws1.mergeCells(`A${sumHdr.number}:D${sumHdr.number}`);
  sumHdr.getCell(1).font = bold11;
  sumHdr.getCell(1).fill = grayFill;
  sumHdr.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  sumHdr.height = 22;

  const summaryRows = [
    ["Contract Value", contractValue],
    ["Change Orders (approved)", coRevenue],
    ["Adjusted Contract", adjustedContract],
    ["", ""],
    ["Total Invoiced (cost)", totalInvoiced],
    ["Total Paid to Vendors", totalPaid],
    ["Outstanding Payables", totalInvoiced - totalPaid],
    ["", ""],
    ["Payments Received", totalReceived],
    ["Profit to Date", profit],
    ["Margin", `${margin.toFixed(1)}%`],
    ["Remaining Receivable", adjustedContract - totalReceived],
  ];

  for (const [label, value] of summaryRows) {
    if (!label) { ws1.addRow([]).height = 6; continue; }
    const r = ws1.addRow([label, "", value]);
    ws1.mergeCells(`A${r.number}:B${r.number}`);
    r.getCell(1).font = bold11;
    r.getCell(3).font = bold11;
    if (typeof value === "number") {
      r.getCell(3).numFmt = currency;
      // Color code
      if (label === "Profit to Date") {
        r.getCell(3).font = { ...bold11, color: { argb: value >= 0 ? "FF16A34A" : "FFDC2626" } };
      }
      if (label === "Adjusted Contract") {
        r.getCell(1).fill = greenFill;
        r.getCell(2).fill = greenFill;
        r.getCell(3).fill = greenFill;
      }
    }
    r.getCell(1).border = thinBorder;
    r.getCell(2).border = thinBorder;
    r.getCell(3).border = thinBorder;
    r.height = 22;
  }

  // ── SHEET 2: Budget vs Actual ──
  const ws2 = wb.addWorksheet("Budget vs Actual");
  ws2.columns = [{ width: 35 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];

  const h2 = ws2.addRow(["Budget vs Actual  |  " + project.name]);
  ws2.mergeCells("A1:E1");
  h2.height = 50;
  h2.getCell(1).font = boldWhite;
  h2.getCell(1).fill = darkFill;
  h2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

  ws2.addRow([]).height = 6;

  const bvaHdr = ws2.addRow(["Line Item", "Budget", "Spent", "Remaining", "% Spent"]);
  bvaHdr.height = 22;
  for (let c = 1; c <= 5; c++) {
    bvaHdr.getCell(c).font = bold11;
    bvaHdr.getCell(c).fill = grayFill;
    bvaHdr.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
  }

  let totalBudget = 0;
  let totalSpent = 0;
  for (const line of budgetLines) {
    const budget = line.client_price || line.total_cost;
    const spent = spendByLine.get(line.id) || 0;
    const remaining = budget - spent;
    const pct = budget > 0 ? (spent / budget) * 100 : 0;
    totalBudget += budget;
    totalSpent += spent;

    const r = ws2.addRow([line.description, budget, spent, remaining, pct / 100]);
    r.getCell(1).font = normal11;
    r.getCell(1).alignment = { wrapText: true };
    for (let c = 2; c <= 4; c++) {
      r.getCell(c).font = bold11;
      r.getCell(c).numFmt = currency;
      r.getCell(c).alignment = { horizontal: "center" };
    }
    r.getCell(5).font = bold11;
    r.getCell(5).numFmt = "0%";
    r.getCell(5).alignment = { horizontal: "center" };

    // Red if over budget
    if (remaining < 0) {
      r.getCell(4).font = { ...bold11, color: { argb: "FFDC2626" } };
    }

    for (let c = 1; c <= 5; c++) r.getCell(c).border = thinBorder;
    r.height = 22;
  }

  // Total row
  const bvaTotal = ws2.addRow(["TOTAL", totalBudget, totalSpent, totalBudget - totalSpent, totalBudget > 0 ? totalSpent / totalBudget : 0]);
  bvaTotal.height = 25;
  for (let c = 1; c <= 5; c++) {
    bvaTotal.getCell(c).font = bold11;
    bvaTotal.getCell(c).fill = greenFill;
    bvaTotal.getCell(c).border = thinBorder;
    bvaTotal.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
  }
  bvaTotal.getCell(2).numFmt = currency;
  bvaTotal.getCell(3).numFmt = currency;
  bvaTotal.getCell(4).numFmt = currency;
  bvaTotal.getCell(5).numFmt = "0%";

  // ── SHEET 3: Invoice Detail ──
  const ws3 = wb.addWorksheet("Invoice Detail");
  ws3.columns = [{ width: 25 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 30 }];

  const h3 = ws3.addRow(["Invoice Detail  |  " + project.name]);
  ws3.mergeCells("A1:F1");
  h3.height = 50;
  h3.getCell(1).font = boldWhite;
  h3.getCell(1).fill = darkFill;
  h3.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

  ws3.addRow([]).height = 6;

  const invHdr = ws3.addRow(["Vendor", "Amount", "Paid", "Date", "Status", "Budget Line"]);
  invHdr.height = 22;
  for (let c = 1; c <= 6; c++) {
    invHdr.getCell(c).font = bold11;
    invHdr.getCell(c).fill = grayFill;
    invHdr.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
  }

  for (const inv of invoices || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineInfo = inv.estimate_line_items as any;
    const lineName = lineInfo?.description || "Unlinked";
    const r = ws3.addRow([
      inv.vendor_name,
      Number(inv.amount),
      Number(inv.paid_amount || 0),
      inv.invoice_date || "",
      inv.payment_status,
      lineName,
    ]);
    r.getCell(1).font = normal11;
    r.getCell(2).font = bold11;
    r.getCell(2).numFmt = currency;
    r.getCell(3).numFmt = currency;
    r.getCell(5).font = {
      ...normal11,
      color: { argb: inv.payment_status === "paid" ? "FF16A34A" : "FFDC2626" },
    };
    r.getCell(6).font = { ...normal11, color: { argb: "FF666666" } };
    for (let c = 1; c <= 6; c++) {
      r.getCell(c).border = thinBorder;
      r.getCell(c).alignment = { horizontal: c === 1 || c === 6 ? "left" : "center", vertical: "middle" };
    }
    r.height = 20;
  }

  // ── SHEET 4: Payments ──
  const ws4 = wb.addWorksheet("Payments Received");
  ws4.columns = [{ width: 20 }, { width: 18 }, { width: 15 }, { width: 15 }, { width: 30 }];

  const h4 = ws4.addRow(["Payments Received  |  " + project.name]);
  ws4.mergeCells("A1:E1");
  h4.height = 50;
  h4.getCell(1).font = boldWhite;
  h4.getCell(1).fill = darkFill;
  h4.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

  ws4.addRow([]).height = 6;

  const payHdr = ws4.addRow(["Type", "Amount", "Date", "Method", "Description"]);
  payHdr.height = 22;
  for (let c = 1; c <= 5; c++) {
    payHdr.getCell(c).font = bold11;
    payHdr.getCell(c).fill = grayFill;
    payHdr.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
  }

  for (const p of payments || []) {
    const r = ws4.addRow([p.payment_type, Number(p.amount), p.received_date, p.method || "", p.description || ""]);
    r.getCell(1).font = bold11;
    r.getCell(2).font = bold11;
    r.getCell(2).numFmt = currency;
    for (let c = 1; c <= 5; c++) {
      r.getCell(c).border = thinBorder;
      r.getCell(c).alignment = { horizontal: c <= 2 ? "center" : "left", vertical: "middle" };
    }
    r.height = 20;
  }

  const payTotal = ws4.addRow(["TOTAL", totalReceived, "", "", ""]);
  payTotal.height = 25;
  for (let c = 1; c <= 5; c++) {
    payTotal.getCell(c).font = bold11;
    payTotal.getCell(c).fill = greenFill;
    payTotal.getCell(c).border = thinBorder;
  }
  payTotal.getCell(2).numFmt = currency;

  // Footer on each sheet
  for (const ws of [ws1, ws2, ws3, ws4]) {
    ws.addRow([]);
    const fr = ws.addRow(["Penney Construction Inc.  ·  North Shore, MA  ·  penneyconstructioninc.com  ·  978-621-4387"]);
    ws.mergeCells(`A${fr.number}:${String.fromCharCode(64 + ws.columnCount)}${fr.number}`);
    fr.getCell(1).font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF999999" } };
    fr.getCell(1).alignment = { horizontal: "center" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: any = await wb.xlsx.writeBuffer();
  const filename = `${project.name} - Financial Report.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
