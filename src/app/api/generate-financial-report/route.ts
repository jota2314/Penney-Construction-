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

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Load everything
  const [
    { data: project },
    { data: currentEstimateId },
    { data: invoices },
    { data: payments },
    { data: changeOrders },
  ] = await Promise.all([
    supabase.from("projects").select("*, customers(first_name, last_name)").eq("id", projectId).single(),
    // Canonical current estimate — a status filter here returned nothing for
    // signed jobs, so financial reports lost their budget baseline.
    supabase.rpc("current_estimate_id", { p_project_id: projectId }),
    supabase.from("invoices").select("*, estimate_line_items:estimate_line_item_id(description, trade)").eq("project_id", projectId).order("invoice_date"),
    supabase.from("payments_received").select("*").eq("project_id", projectId).order("received_date"),
    supabase.from("change_orders").select("*").eq("project_id", projectId).order("change_order_number"),
  ]);

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: currentEstimate } = currentEstimateId
    ? await supabase
        .from("estimates")
        .select("id, total_cost, total_price")
        .eq("id", currentEstimateId as string)
        .maybeSingle()
    : { data: null };
  const estimates = currentEstimate ? [currentEstimate] : [];

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
  const adjustedContract = contractValue + coRevenue;
  const totalInvoiced = (invoices || []).reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = (invoices || []).reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalReceived = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const profit = totalReceived - totalPaid;
  const margin = totalReceived > 0 ? (profit / totalReceived) * 100 : 0;

  const spendByLine = new Map<string, number>();
  for (const inv of invoices || []) {
    if (inv.estimate_line_item_id) {
      spendByLine.set(inv.estimate_line_item_id, (spendByLine.get(inv.estimate_line_item_id) || 0) + Number(inv.amount));
    }
  }

  // ── Build PDF ──
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const darkGray = [67, 67, 67] as [number, number, number];
  const green = [22, 163, 74] as [number, number, number];
  const red = [220, 38, 38] as [number, number, number];
  const lightGray = [204, 204, 204] as [number, number, number];
  const lightGreen = [217, 234, 211] as [number, number, number];

  // ── Header with logo ──
  doc.setFillColor(...darkGray);
  doc.rect(0, 0, pageWidth, 30, "F");

  try {
    const logoPath = path.join(process.cwd(), "public", "logo.jpg");
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      const logoBase64 = logoBuffer.toString("base64");
      doc.addImage(`data:image/jpeg;base64,${logoBase64}`, "JPEG", 10, 4, 22, 22);
    }
  } catch { /* logo not critical */ }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Financial Report", pageWidth / 2, 12, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${project.project_number} — ${project.name}  |  ${clientName}`, pageWidth / 2, 20, { align: "center" });
  doc.text(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), pageWidth / 2, 27, { align: "center" });

  let y = 37;

  // ── Project Info ──
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Address: ${address}`, 15, y);
  doc.text(`Status: ${(project.status || "").replace(/_/g, " ")}`, pageWidth - 15, y, { align: "right" });
  y += 8;

  // ── Financial Summary Table ──
  doc.setFillColor(...darkGray);
  doc.rect(15, y, pageWidth - 30, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Financial Summary", pageWidth / 2, y + 5, { align: "center" });
  y += 10;

  const summaryData = [
    ["Contract Value", fmtCurrency(contractValue)],
    ["Approved Change Orders", fmtCurrency(coRevenue)],
    ["Adjusted Contract", fmtCurrency(adjustedContract)],
    ["", ""],
    ["Total Invoiced (cost to us)", fmtCurrency(totalInvoiced)],
    ["Paid to Vendors", fmtCurrency(totalPaid)],
    ["Outstanding Payables", fmtCurrency(totalInvoiced - totalPaid)],
    ["", ""],
    ["Payments Received from Client", fmtCurrency(totalReceived)],
    ["Profit to Date", fmtCurrency(profit)],
    ["Margin", `${margin.toFixed(1)}%`],
    ["Remaining Receivable", fmtCurrency(adjustedContract - totalReceived)],
  ];

  autoTable(doc, {
    startY: y,
    head: [],
    body: summaryData.filter(([l]) => l !== ""),
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 80 },
      1: { halign: "right", cellWidth: 50 },
    },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      const label = String(summaryData.filter(([l]) => l !== "")[data.row.index]?.[0] || "");
      if (label === "Adjusted Contract") {
        data.cell.styles.fillColor = lightGreen;
      }
      if (label === "Profit to Date" && data.column.index === 1) {
        data.cell.styles.textColor = profit >= 0 ? green : red;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Budget vs Actual Table ──
  doc.setFillColor(...darkGray);
  doc.rect(15, y, pageWidth - 30, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Budget vs Actual", pageWidth / 2, y + 5, { align: "center" });
  y += 10;

  let totalBudget = 0, totalSpent = 0;
  const bvaBody = budgetLines.map((line) => {
    const budget = line.client_price || line.total_cost;
    const spent = spendByLine.get(line.id) || 0;
    const remaining = budget - spent;
    const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
    totalBudget += budget;
    totalSpent += spent;
    return [line.description, fmtCurrency(budget), fmtCurrency(spent), fmtCurrency(remaining), `${pct}%`];
  });

  bvaBody.push(["TOTAL", fmtCurrency(totalBudget), fmtCurrency(totalSpent), fmtCurrency(totalBudget - totalSpent), `${totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}%`]);

  autoTable(doc, {
    startY: y,
    head: [["Line Item", "Budget", "Spent", "Remaining", "%"]],
    body: bvaBody,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: lightGray, textColor: [0, 0, 0], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 65 },
      1: { halign: "right", cellWidth: 25 },
      2: { halign: "right", cellWidth: 25 },
      3: { halign: "right", cellWidth: 25 },
      4: { halign: "center", cellWidth: 15 },
    },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      // Last row = total
      if (data.row.index === bvaBody.length - 1) {
        data.cell.styles.fillColor = lightGreen;
        data.cell.styles.fontStyle = "bold";
      }
      // Red remaining if over budget
      if (data.column.index === 3 && data.row.index < bvaBody.length - 1) {
        const line = budgetLines[data.row.index];
        if (line) {
          const budget = line.client_price || line.total_cost;
          const spent = spendByLine.get(line.id) || 0;
          if (spent > budget) data.cell.styles.textColor = red;
        }
      }
    },
  });

  // ── Page 2: Invoice Detail ──
  doc.addPage();

  doc.setFillColor(...darkGray);
  doc.rect(0, 0, pageWidth, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Invoice Detail", pageWidth / 2, 12, { align: "center" });

  const invBody = (invoices || []).map((inv) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineInfo = inv.estimate_line_items as any;
    return [
      inv.vendor_name,
      fmtCurrency(Number(inv.amount)),
      inv.invoice_date || "",
      inv.payment_status === "paid" ? "Paid" : "Unpaid",
      lineInfo?.description || "Unlinked",
    ];
  });

  autoTable(doc, {
    startY: 25,
    head: [["Vendor", "Amount", "Date", "Status", "Budget Line"]],
    body: invBody,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: lightGray, textColor: [0, 0, 0], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { halign: "right", cellWidth: 22 },
      2: { cellWidth: 22 },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 55 },
    },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      if (data.column.index === 3 && data.section === "body") {
        const status = (invoices || [])[data.row.index]?.payment_status;
        data.cell.styles.textColor = status === "paid" ? green : red;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // ── Footer on each page ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "italic");
    doc.text("Penney Construction Inc.  ·  North Shore, MA  ·  penneyconstructioninc.com  ·  978-621-4387", pageWidth / 2, pageH - 8, { align: "center" });
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 15, pageH - 8, { align: "right" });
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `${project.name} - Financial Report.pdf`;

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
