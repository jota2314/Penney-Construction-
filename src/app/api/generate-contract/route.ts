import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";

export const runtime = "nodejs";

const fmtMoney = (v: number) => {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Same Latin-1 sanitation as generate-proposal-pdf — jsPDF's Helvetica
// mis-measures glyphs outside WinAnsi and autoTable stretches the text.
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
    .replace(/[∼≈]/g, "~")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[→]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[©]/g, "(c)")
    .replace(/[®]/g, "(R)")
    .replace(/[™]/g, "(TM)");
  s = s.replace(/[^\x00-\xFF]/g, "?");
  return s;
}

// "33834" -> "Thirty-Three Thousand Eight Hundred Thirty-Four" (whole dollars)
function dollarsInWords(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const under1000 = (x: number): string => {
    const parts: string[] = [];
    if (x >= 100) {
      parts.push(`${ones[Math.floor(x / 100)]} Hundred`);
      x %= 100;
    }
    if (x >= 20) {
      parts.push(x % 10 ? `${tens[Math.floor(x / 10)]}-${ones[x % 10]}` : tens[Math.floor(x / 10)]);
    } else if (x > 0) {
      parts.push(ones[x]);
    }
    return parts.join(" ");
  };
  const whole = Math.floor(Math.abs(n));
  if (whole === 0) return "Zero";
  const chunks: string[] = [];
  const millions = Math.floor(whole / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1000);
  const rest = whole % 1000;
  if (millions) chunks.push(`${under1000(millions)} Million`);
  if (thousands) chunks.push(`${under1000(thousands)} Thousand`);
  if (rest) chunks.push(under1000(rest));
  return chunks.join(" ");
}

// Penney brand colors (same values as generate-proposal-pdf)
const CHARCOAL: [number, number, number] = [61, 61, 61];
const ORANGE: [number, number, number] = [212, 114, 42];
const PEACH: [number, number, number] = [253, 241, 234];
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

const HIC_LINE = "Licensed & Insured  ·  MA Home Improvement Contractor";
const ADDRESS_LINE = "5 Barrett Road, Peabody, MA 01960  ·  Tel: 978-621-4387  ·  HIC Reg #198443";
const CSL_LINE = "CS-099765 (Unrestricted)  ·  Expires 09/26/2027";

const CONTRACT_TERMS: [string, string][] = [
  ["Scope of Work", "The Contractor shall perform the Work described in Exhibit A. Work not expressly included is excluded. Owner-supplied items and work noted as excluded or by others in Exhibit A are outside the Contractor's scope; all materials for the contracted Work are furnished by the Contractor."],
  ["Change Orders", "Any change in the Work, including additions, deletions, or substitutions, must be authorized in a written change order signed by both parties before the changed work proceeds, stating the price adjustment and any schedule impact. Credits to the Owner are documented the same way."],
  ["Allowances", "Allowance amounts, where noted, cover the items listed and are reconciled to actual cost. The Owner receives a credit where actual cost is less than the allowance, and is billed the difference where it is greater, by written change order."],
  ["Permits & Inspections", "The Contractor will secure the building permit and required inspections. Permit fees are carried as listed in Exhibit A. Work begins after permit issuance. It is the Contractor's obligation, not the Owner's, to obtain any permit required for the Work."],
  ["Payments", "Payments are due per the Payment Schedule and are payable within five (5) days of invoice. The Contractor may suspend work for non-payment after written notice. Final payment is due upon substantial completion and passing of final inspection. In accordance with M.G.L. c.142A, the deposit does not exceed one-third (1/3) of the total contract price except for special-order materials."],
  ["Warranty", "The Contractor warrants all labor and workmanship for one (1) year from substantial completion. Manufacturer warranties on materials and equipment pass through to the Owner. The warranty excludes Owner-supplied work and materials and normal wear, misuse, or damage by others."],
  ["Insurance", "The Contractor carries general liability and workers' compensation insurance. Certificates available on request."],
  ["Concealed Conditions", "If concealed or unforeseen conditions (e.g., rot, structural, code, or utility issues) are discovered, the Contractor will notify the Owner and the parties will execute a change order for any resulting work."],
  ["Dispute Resolution", "The Owner may submit any controversy or claim to private arbitration as provided under M.G.L. c.142A. The Contractor agrees to be bound by arbitration if the Owner elects it."],
  ["Right to Cancel", "The Owner may cancel this Contract without penalty within three (3) business days after signing by delivering written notice to the Contractor."],
  ["Entire Agreement", "This Contract, including Exhibit A, is the entire agreement between the parties and supersedes prior discussions and proposals. It may be amended only in writing signed by both parties."],
];

export async function GET(request: NextRequest) {
  try {
    // Two auth paths, same as generate-proposal-pdf: a signed-in user (the
    // Contract PDF button) or the shared service key (Penney MCP fetching the
    // contract headlessly to email it).
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

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const estimateIdParam = url.searchParams.get("estimateId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_number, address, city, state, zip, contract_locked_amount, contract_locked_at, contract_client_signature, contract_client_signed_at, contract_countersigned_signature, contract_countersigned_at, customers(first_name, last_name, address, city, state, zip, phone)")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Resolve the estimate exactly like the proposal PDF does.
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

    const { data: estMeta } = await supabase
      .from("estimates")
      .select("notes")
      .eq("id", estimateId)
      .maybeSingle();

    const { data: lineItems } = await supabase
      .from("estimate_line_items")
      .select("description, total_price, client_price, scope_text, proposal_description, sort_order, is_visible_on_proposal, is_allowance, is_section_header")
      .eq("estimate_id", estimateId)
      .order("sort_order");
    if (!lineItems?.length) return NextResponse.json({ error: "No estimate lines" }, { status: 404 });

    const { data: milestoneRows } = await supabase
      .from("project_payment_milestones")
      .select("label, stage_key, percent, amount, sort_order")
      .eq("project_id", projectId)
      .order("sort_order");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const custArr = project.customers as any;
    const cust = Array.isArray(custArr) ? custArr[0] : custArr;
    const clientName = cust ? `${cust.first_name} ${cust.last_name}` : "";
    const clientAddress = [cust?.address, cust?.city, cust?.state, cust?.zip].filter(Boolean).join(", ");
    const projAddress = [project.address, project.city, project.state || "MA", project.zip].filter(Boolean).join(", ");

    const visibleItems = lineItems.filter((li) => li.is_visible_on_proposal !== false);
    const linePrice = (li: { total_price: unknown; client_price: unknown }) =>
      Number(li.client_price ?? li.total_price ?? 0);
    const liveTotal = visibleItems.filter((li) => !li.is_section_header).reduce((s, li) => s + linePrice(li), 0);

    // Once both parties have signed, the PDF prints the price they signed —
    // never a live re-sum of estimate lines that may have been edited since.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contractRow = project as any;
    const total =
      contractRow.contract_locked_at && contractRow.contract_locked_amount != null
        ? Number(contractRow.contract_locked_amount)
        : liveTotal;

    // ── Payment schedule rows: stored milestones, or a thirds default ──
    type PayRow = { label: string; amount: number; pctText: string };
    let payRows: PayRow[];
    if (milestoneRows?.length) {
      const cents = (v: number) => Math.round(v * 100) / 100;
      payRows = milestoneRows.map((m) => ({
        label: m.label,
        amount: m.amount != null ? Number(m.amount) : cents((total * Number(m.percent ?? 0)) / 100),
        pctText: m.percent != null
          ? `${Number(m.percent).toFixed(1)}%`
          : total > 0
            ? `${((Number(m.amount) / total) * 100).toFixed(1)}%`
            : "-",
      }));
      // When every milestone is percent-driven and the shares cover the whole
      // contract, absorb rounding cents into the last row so the schedule
      // sums to the contract price exactly.
      const allPercent = milestoneRows.every((m) => m.amount == null);
      const pctSum = milestoneRows.reduce((s, m) => s + Number(m.percent ?? 0), 0);
      if (allPercent && Math.abs(pctSum - 100) < 0.05 && payRows.length > 0) {
        const sum = payRows.reduce((s, r) => s + r.amount, 0);
        payRows[payRows.length - 1].amount = cents(payRows[payRows.length - 1].amount + (total - sum));
      }
    } else {
      // Fallback only — sending a contract now saves this schedule first, so
      // an unsaved split should no longer reach a client. Mirrors the
      // "thirds" preset, holdback included.
      const pct = (p: number) => Math.round(total * p) / 100;
      const d = pct(33.3), m = pct(30), s = pct(26.7);
      payRows = [
        { label: "Deposit - upon signing (initiates permitting, scheduling, and material orders)", amount: d, pctText: "33.3%" },
        { label: "Mid-project - structure framed and weathertight", amount: m, pctText: "30.0%" },
        { label: "Substantial completion - work complete and site cleaned", amount: s, pctText: "26.7%" },
        {
          label: "Final payment (10% holdback) - released after final inspection and punch list are complete",
          amount: Math.round((total - d - m - s) * 100) / 100,
          pctText: "10.0%",
        },
      ];
    }
    const payTotal = payRows.reduce((s, r) => s + r.amount, 0);
    // Never assert 100%. Fixed-dollar milestones can legitimately not cover
    // the whole contract, and a total that claims otherwise is a false number
    // on a signed document.
    const payTotalPctText = total > 0 ? `${((payTotal / total) * 100).toFixed(1)}%` : "-";
    const depositRowAmount = payRows[0]?.amount ?? 0;
    const depositWithinCap = total > 0 && depositRowAmount / total <= 1 / 3 + 0.0001;

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

    // ── PAGE 1 ──
    addPageHeader();
    let y = 36;
    doc.setFillColor(...CHARCOAL);
    doc.rect(margin, y, contentW, 12, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("CONSTRUCTION CONTRACT", pw / 2, y + 8, { align: "center" });
    doc.setFillColor(...ORANGE);
    doc.rect(margin, y + 12, contentW, 1.5, "F");
    y += 18;

    // ── Parties & project ──
    y = sectionHeader("PARTIES & PROJECT", y);
    const contractDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    autoTable(doc, {
      startY: y,
      head: [],
      body: [
        ["Contractor:", "Penney Construction, Inc.  -  Ryan Penney, Owner  -  Tel: 978-621-4387"],
        ["Contractor Address:", "5 Barrett Road, Peabody, MA 01960"],
        ["MA HIC Reg #:", "198443"],
        ["MA CSL #:", sanitizeForPdf(CSL_LINE)],
        ["Owner / Client:", sanitizeForPdf(clientName)],
        ...(clientAddress ? [["Client Address:", sanitizeForPdf(clientAddress)]] : []),
        ["Project Address:", sanitizeForPdf(projAddress)],
        ["Contract No.:", sanitizeForPdf(project.project_number ?? "")],
        ["Date:", contractDate],
        ["Project Description:", sanitizeForPdf(project.name)],
      ],
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 38, textColor: CHARCOAL },
        1: { textColor: BLACK },
      },
      margin: { left: margin, right: margin },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 4;

    // ── Contract price ──
    y = sectionHeader("CONTRACT PRICE", y);
    autoTable(doc, {
      startY: y,
      head: [],
      body: [["TOTAL CONTRACT PRICE", fmtMoney(total)]],
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 3.5, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: contentW - 40 },
        1: { halign: "right", cellWidth: 40 },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        data.cell.styles.fillColor = ORANGE;
        data.cell.styles.textColor = WHITE;
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 3;
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.text(`(${dollarsInWords(total)} and ${String(Math.round((total % 1) * 100)).padStart(2, "0")}/100 Dollars)`, margin + 1, y + 2);
    y += 8;

    // ── Payment schedule ──
    y = sectionHeader("PAYMENT SCHEDULE", y);
    autoTable(doc, {
      startY: y,
      head: [["Milestone", "Amount Due", "% of Contract"]],
      body: payRows.map((r) => [sanitizeForPdf(r.label), fmtMoney(r.amount), r.pctText]),
      foot: [["TOTAL", fmtMoney(payTotal), payTotalPctText]],
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: ORANGE, textColor: WHITE, fontStyle: "bold", fontSize: 8.5 },
      bodyStyles: { textColor: BLACK },
      alternateRowStyles: { fillColor: PEACH },
      columnStyles: {
        0: { cellWidth: contentW - 65 },
        1: { halign: "right", cellWidth: 35, fontStyle: "bold" },
        2: { halign: "right", cellWidth: 30 },
      },
      margin: { left: margin, right: margin },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 3;
    doc.setTextColor(...BLACK);
    doc.setFontSize(7.5);
    // The c.142A sentence is a compliance claim — only make it when it is
    // actually true of this schedule.
    const payTermsLines = doc.splitTextToSize(
      "Payment Terms: Progress payments are due upon completion of each milestone and are payable within five (5) days of invoice. The final payment is a holdback released only after the final inspection has passed and the punch list is complete." +
        (depositWithinCap
          ? " In accordance with M.G.L. c.142A, the deposit does not exceed one-third (1/3) of the total contract price."
          : ""),
      contentW - 6
    );
    if (y + payTermsLines.length * 4 > ph - 20) { doc.addPage(); addPageHeader(); y = 36; }
    doc.text(payTermsLines, margin + 3, y + 3);
    y += payTermsLines.length * 4 + 6;

    // ── Start / completion (no detailed schedule in the contract) ──
    autoTable(doc, {
      startY: y,
      head: [],
      body: [
        ["Start Date:", "Targeting within 2-3 weeks of signing and permit issuance; confirmed at signing"],
        ["Substantial Completion:", "To be confirmed at signing: ____________________"],
      ],
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 42, textColor: CHARCOAL },
        1: { textColor: BLACK },
      },
      margin: { left: margin, right: margin },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;

    // ── Terms & conditions ──
    y = sectionHeader("TERMS & CONDITIONS", y);
    doc.setTextColor(...BLACK);
    doc.setFontSize(7.5);
    CONTRACT_TERMS.forEach(([title, body], i) => {
      // Bold numbered lead, then the body flows after it on the first line
      // and wraps full-width below — never draw text on top of text.
      const lead = `${i + 1}. ${title}: `;
      doc.setFont("helvetica", "bold");
      const leadW = doc.getTextWidth(lead);
      doc.setFont("helvetica", "normal");
      const firstLine = (doc.splitTextToSize(body, contentW - 6 - leadW) as string[])[0] ?? "";
      const restText = body.slice(firstLine.length).trim();
      const restLines = restText ? (doc.splitTextToSize(restText, contentW - 6) as string[]) : [];
      const totalLines = 1 + restLines.length;
      if (y + totalLines * 4 > ph - 20) { doc.addPage(); addPageHeader(); y = 36; }
      doc.setFont("helvetica", "bold");
      doc.text(lead, margin + 3, y + 3);
      doc.setFont("helvetica", "normal");
      doc.text(firstLine, margin + 3 + leadW, y + 3);
      if (restLines.length) doc.text(restLines, margin + 3, y + 7);
      y += totalLines * 4 + 2.5;
    });
    y += 4;

    // ── Exhibit A: scope of work ──
    y = sectionHeader("EXHIBIT A - SCOPE OF WORK", y);

    const SECTIONLESS_KEY = "__no_section__";
    type Item = (typeof visibleItems)[number];
    const groupOrder: string[] = [];
    const groups = new Map<string, Item[]>();
    let currentKey = SECTIONLESS_KEY;
    for (const li of visibleItems) {
      if (li.is_section_header) {
        currentKey = li.description?.trim() || "Untitled section";
        if (!groups.has(currentKey)) {
          groups.set(currentKey, []);
          groupOrder.push(currentKey);
        }
        continue;
      }
      if (!groups.has(currentKey)) {
        groups.set(currentKey, []);
        groupOrder.push(currentKey);
      }
      groups.get(currentKey)!.push(li);
    }

    let hasAllowances = false;
    for (const key of groupOrder) {
      const items = groups.get(key) ?? [];
      if (items.length === 0) continue;
      const sectionLabel = key === SECTIONLESS_KEY ? null : sanitizeForPdf(key).toUpperCase();

      if (sectionLabel) {
        if (y > ph - 30) { doc.addPage(); addPageHeader(); y = 36; }
        doc.setFillColor(...ORANGE);
        doc.rect(margin, y, contentW, 6, "F");
        doc.setTextColor(...WHITE);
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.text(sectionLabel, margin + 3, y + 4.2);
        y += 6;
      }

      const tableBody = items.map((li) => {
        if (li.is_allowance) hasAllowances = true;
        const category = li.is_allowance
          ? `${sanitizeForPdf(li.description || "General")} (Allowance)`
          : sanitizeForPdf(li.description || "General");
        const scope = sanitizeForPdf(li.proposal_description || li.scope_text || "");
        return [category, scope, fmtMoney(linePrice(li))];
      });

      autoTable(doc, {
        startY: y,
        head: [["Item", "Scope of Work", "Price (USD)"]],
        body: tableBody,
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
        headStyles: { fillColor: CHARCOAL, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
        bodyStyles: { textColor: BLACK },
        alternateRowStyles: { fillColor: PEACH },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 40 },
          1: { cellWidth: contentW - 75 },
          2: { halign: "right", cellWidth: 35, fontStyle: "bold" },
        },
        margin: { left: margin, right: margin },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 2;
    }

    autoTable(doc, {
      startY: y,
      head: [],
      body: [["TOTAL CONTRACT PRICE", "", fmtMoney(total)]],
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 3.5, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: contentW - 90 },
        2: { halign: "right", cellWidth: 35 },
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        data.cell.styles.fillColor = ORANGE;
        data.cell.styles.textColor = WHITE;
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 5;

    // ── Exclusions & clarifications ──
    y = sectionHeader("EXCLUSIONS & CLARIFICATIONS", y);
    const scopeNotes = (estMeta?.notes ?? "")
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => /^scope:/i.test(l))
      .map((l: string) => l.replace(/^scope:\s*/i, ""));
    const exclusions = [
      ...(hasAllowances
        ? ["Items identified as \"(Allowance)\" represent budgets carried for owner selections. Final amounts are reconciled by written change order once selections are made; unused allowance balances are credited to the owner."]
        : []),
      "Concealed or unforeseen conditions - including rot, insect damage, hazardous materials (asbestos, lead paint), or substandard prior construction discovered once work is opened - are excluded and will be addressed by written change order before related work proceeds.",
      "Code-required upgrades to existing systems or structures beyond the scope described above.",
      "Utility company charges and fees; low-voltage, audio/visual, and security systems; landscaping and irrigation, unless specifically listed in the scope of work.",
      ...scopeNotes,
      "Any work not expressly described in Exhibit A.",
    ];
    doc.setTextColor(...BLACK);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    for (const excl of exclusions) {
      const lines = doc.splitTextToSize(`-  ${sanitizeForPdf(excl)}`, contentW - 6);
      if (y + lines.length * 4 > ph - 20) { doc.addPage(); addPageHeader(); y = 36; }
      doc.text(lines, margin + 3, y + 3);
      y += lines.length * 4 + 2;
    }
    y += 4;

    // ── Acceptance & signatures ──
    if (y > ph - 70) { doc.addPage(); addPageHeader(); y = 36; }
    y = sectionHeader("ACCEPTANCE & SIGNATURES", y);
    doc.setTextColor(...BLACK);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    const acceptText = doc.splitTextToSize(
      "Each party has read and agrees to this Contract, including the Terms & Conditions and Exhibit A. The Owner acknowledges receipt of a completed copy of this Contract and notice of the three (3) business day right to cancel. Do not sign this Contract if there are any blank spaces.",
      contentW - 6
    );
    doc.text(acceptText, margin + 3, y + 4);
    y += acceptText.length * 4 + 16;

    // Signed online? Print the signature above the rule, in the same script
    // face change orders use, plus the date it was executed.
    const ownerSig = contractRow.contract_client_signature as string | null;
    const ownerSigAt = contractRow.contract_client_signed_at as string | null;
    const gcSig = contractRow.contract_countersigned_signature as string | null;
    const gcSigAt = contractRow.contract_countersigned_at as string | null;
    const shortDate = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

    doc.setDrawColor(120, 120, 120);
    const colW = (contentW - 20) / 2;

    if (ownerSig || gcSig) {
      doc.setFont("times", "italic");
      doc.setFontSize(13);
      doc.setTextColor(...BLACK);
      if (ownerSig) doc.text(sanitizeForPdf(ownerSig), margin + 3, y - 2);
      if (gcSig) doc.text(sanitizeForPdf(gcSig), margin + 17 + colW, y - 2);
      doc.setFont("helvetica", "normal");
    }

    doc.line(margin + 3, y, margin + 3 + colW, y);
    doc.line(margin + 17 + colW, y, margin + 17 + colW * 2, y);
    doc.setFontSize(6.5);
    doc.setTextColor(90, 90, 90);
    doc.text(sanitizeForPdf(`Owner - ${clientName || "Client"}`), margin + 3, y + 4);
    doc.text(shortDate(ownerSigAt) || "Date", margin + 3 + colW - 12, y + 4);
    doc.text("Penney Construction, Inc. - Ryan Penney, Owner", margin + 17 + colW, y + 4);
    doc.text(shortDate(gcSigAt) || "Date", margin + 17 + colW * 2 - 12, y + 4);

    if (contractRow.contract_locked_at) {
      doc.setFontSize(6);
      doc.setTextColor(130, 130, 130);
      doc.text(
        sanitizeForPdf("Executed electronically. Contract price is fixed; changes require a written change order."),
        margin + 3,
        y + 9,
      );
    }

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
    const filename = `Penney Construction Contract - ${project.name} - ${project.project_number}.pdf`;
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "-").replace(/"/g, "");

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("[generate-contract] crashed:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      where: "generate-contract",
    }, { status: 500 });
  }
}
