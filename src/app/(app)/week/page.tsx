import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computePeriod, type TimeRange } from "@/lib/time-range";
import { spendCategoryFor, type SpendCategory } from "@/lib/finance/spend-category";
import { canApproveBillPay } from "@/lib/auth/role-access";
import { ApprovePayButton } from "@/components/invoices/approve-pay-button";
import { NextWeekButton } from "@/components/invoices/next-week-button";
import { MarkPaidButton } from "@/components/invoices/mark-paid-button";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { FinanceTabs } from "@/components/finances/finance-tabs";

export const metadata: Metadata = { title: "Finances — Weekly Close | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmt2 = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);

const VALID_RANGES: ReadonlyArray<TimeRange> = ["week", "month", "quarter", "year"];

/** Jobs read by name here, not PC number — the number is the subtitle. */
const jobName = (p: { name?: string | null; project_number?: string | null } | null | undefined) =>
  p?.name || p?.project_number || "Unassigned";

export default async function WeekPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; offset?: string }>;
}) {
  const user = await requireRole(["owner", "precon_manager", "office_admin"]);
  // Jorge / Ryan can approve a sub bill straight off this list. The server
  // action re-checks the real (non-impersonated) account, so this only
  // decides whether the button renders.
  const canApprove = canApproveBillPay(user.realProfile?.email ?? user.email);
  const params = (await searchParams) || {};
  const range: TimeRange = (VALID_RANGES as ReadonlyArray<string>).includes(params.range || "")
    ? (params.range as TimeRange)
    : "week"; // this page is about the week — /spent and /payments default to year
  const offset = Number.parseInt(params.offset || "0", 10) || 0;

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const period = computePeriod(range, offset, nowET);
  const startDate = period.start.slice(0, 10);
  const endDate = period.end.slice(0, 10);

  const supabase = await createClient();

  const [{ data: invoiceRows }, { data: paymentRows }, { data: shiftRows }, { data: employeeRows }, { data: billedRows }, { data: breakAdjRows }] =
    await Promise.all([
      // Paged, not .limit(500) — the same silent-truncation bug /spent already
      // had: a busy month/quarter view quietly dropped rows past the cap and
      // under-reported "Money out" with no error.
      fetchAllRows((from, to) =>
        supabase
          .from("invoices")
          .select("id, vendor_name, vendor_type, trade, invoice_number, invoice_date, amount, paid_amount, description, review_status, split_group_id, estimate_line_item_id, project_id, subcontractor_id, payment_status, pay_approval_status, pay_approved_by, pay_approved_at, approved_for_pay_by, approved_for_pay_at, projects(name, project_number, is_overhead), estimate_line_items:estimate_line_item_id(description, cost)")
          .gte("invoice_date", startDate)
          .lte("invoice_date", endDate)
          .order("amount", { ascending: false })
          .order("id")
          .range(from, to)
      ).then((rows) => ({ data: rows })),
      supabase
        .from("payments_received")
        .select("id, amount, received_date, payment_type, description, method, reference_number, project_id, projects(name, project_number)")
        .gte("received_date", startDate)
        .lte("received_date", endDate)
        .order("received_date", { ascending: false })
        .limit(200),
      supabase
        .from("daily_logs")
        .select("id, project_id, author_id, started_at, ended_at, projects(name, project_number, is_overhead, labor_cost_source)")
        .gte("started_at", period.start)
        .lte("started_at", period.end)
        .not("ended_at", "is", null)
        .limit(1000),
      supabase.from("employees").select("profile_id, hourly_rate").not("profile_id", "is", null),
      supabase
        .from("client_invoices")
        // sent_to_client_at, NOT sent_at — the wrong name returned no rows at
        // all and the page quietly reported "nothing billed" on a $168k week.
        .select("id, amount, status, sent_to_client_at, project_id, projects(name, project_number)")
        .gte("sent_to_client_at", period.start)
        .lte("sent_to_client_at", period.end)
        .limit(200),
      // Break overrides — so Crew time deducts the exact same lunches Payroll does.
      supabase
        .from("payroll_adjustments")
        .select("profile_id, work_date, break_minutes")
        .gte("work_date", startDate)
        .lte("work_date", endDate),
    ]);

  const invoices = invoiceRows ?? [];
  const payments = paymentRows ?? [];
  const shifts = shiftRows ?? [];
  const billed = billedRows ?? [];

  const rateByProfile = new Map<string, number>();
  for (const e of employeeRows ?? []) {
    if (e.profile_id) rateByProfile.set(e.profile_id, Number(e.hourly_rate || 0));
  }

  const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] as T) ?? null : (v as T) ?? null);
  const projOf = (r: { projects?: unknown }) =>
    one<{ name?: string; project_number?: string; is_overhead?: boolean }>(r.projects);
  const lineOf = (r: { estimate_line_items?: unknown }) =>
    one<{ description?: string }>(r.estimate_line_items);
  const isOverhead = (r: { project_id?: string | null; projects?: unknown }) =>
    !r.project_id || projOf(r)?.is_overhead === true;
  const amt = (r: { amount?: number | string | null }) => Number(r.amount || 0);
  const sum = (rows: Array<{ amount?: number | string | null }>) => rows.reduce((s, r) => s + amt(r), 0);

  // Same rulebook the Spent page and the QuickBooks push use — one place decides.
  const categoryOf = (r: (typeof invoices)[number]): SpendCategory =>
    spendCategoryFor({
      vendorName: r.vendor_name,
      vendorType: r.vendor_type,
      trade: r.trade,
      description: r.description,
      lineItemText: lineOf(r)?.description ?? null,
      isOverhead: isOverhead(r),
    });

  const moneyIn = payments.reduce((s, r) => s + Number(r.amount || 0), 0);
  const moneyOut = sum(invoices);
  const billedOut = billed.reduce((s, r) => s + Number(r.amount || 0), 0);
  const net = moneyIn - moneyOut;

  // ---- spend by category ----
  const catTotals = new Map<string, { cat: SpendCategory; total: number; count: number }>();
  for (const r of invoices) {
    const c = categoryOf(r);
    const g = catTotals.get(c.key) || { cat: c, total: 0, count: 0 };
    g.total += amt(r);
    g.count += 1;
    catTotals.set(c.key, g);
  }
  const categories = [...catTotals.values()].sort((a, b) => b.total - a.total);

  const subsRows = invoices.filter((r) => categoryOf(r).key === "subs");
  const laborRowsInv = invoices.filter((r) => categoryOf(r).key === "labor");
  const overheadRows = invoices.filter(isOverhead);
  const jobSpendRows = invoices.filter((r) => !isOverhead(r) && categoryOf(r).key !== "subs" && categoryOf(r).key !== "labor");

  // ---- pay approval + "good to approve" on every sub bill (Jorge 9/2) ----
  // Two approval stamps exist and both mean Nicole was told it's good to pay:
  // pay_approval_status/pay_approved_by (Jorge/Ryan via approveBillForPay) and
  // approved_for_pay_at/by (the project Invoices tab). Read either.
  // "Good to approve" is the same check a person would do before signing off:
  // it's on a budget line, the line covers it, nobody flagged it, it isn't the
  // same bill booked twice, and the sub's insurance hasn't lapsed. The contract
  // running total is shown for context but doesn't block — draws often run
  // ahead of the awarded number when a CO is still being written.
  const NIL_ID = "00000000-0000-0000-0000-000000000000";
  const orNil = (ids: string[]) => (ids.length ? ids : [NIL_ID]);
  const uniq = (vals: Array<string | null | undefined>) => [...new Set(vals.filter((v): v is string => !!v))];
  const subLineIds = uniq(subsRows.map((r) => r.estimate_line_item_id));
  const subProjectIds = uniq(subsRows.map((r) => r.project_id));
  const subVendorNames = uniq(subsRows.map((r) => r.vendor_name));
  const subInvoiceNumbers = uniq(subsRows.map((r) => r.invoice_number));
  const subContractorIds = uniq(subsRows.map((r) => r.subcontractor_id));
  const approverIds = uniq(subsRows.flatMap((r) => [r.pay_approved_by, r.approved_for_pay_by]));

  const [{ data: lineBillRows }, { data: sameNumberRows }, { data: contractRows }, { data: vendorBillRows }, { data: subRecordRows }, { data: approverRows }] =
    subsRows.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]
      : await Promise.all([
          // Everything ever billed to the same budget lines — the line's remaining budget.
          supabase.from("invoices").select("id, estimate_line_item_id, amount").in("estimate_line_item_id", orNil(subLineIds)),
          // Same vendor + same invoice number anywhere in the books — the double-entry check.
          supabase.from("invoices").select("id, vendor_name, invoice_number, amount, split_group_id").in("vendor_name", subVendorNames.length ? subVendorNames : ["—"]).in("invoice_number", subInvoiceNumbers.length ? subInvoiceNumbers : ["—"]),
          // Awarded contract per sub per job.
          supabase.from("project_subcontractors").select("project_id, subcontractor_id, contract_amount").in("project_id", orNil(subProjectIds)),
          // Everything this vendor has billed on the job so far — contract running total.
          supabase.from("invoices").select("id, project_id, vendor_name, amount").in("project_id", orNil(subProjectIds)).in("vendor_name", subVendorNames.length ? subVendorNames : ["—"]),
          supabase.from("subcontractors").select("id, insurance_expiry").in("id", orNil(subContractorIds)),
          supabase.from("profiles").select("id, full_name").in("id", orNil(approverIds)),
        ]);
  const lineBills = lineBillRows ?? [];
  const sameNumber = sameNumberRows ?? [];
  const contracts = contractRows ?? [];
  const vendorBills = vendorBillRows ?? [];
  const subRecords = subRecordRows ?? [];
  const approverName = new Map((approverRows ?? []).map((p) => [p.id, p.full_name as string | null]));

  type PayCheck = {
    state: "paid" | "approved" | "open";
    approvedBy: string | null;
    approvedOn: string | null;
    good: boolean;
    blockers: string[];
    notes: string[];
    /** Budget-line remaining, kept apart from notes: a split bill shows it per piece. */
    lineNote: string | null;
    /** Rows that are one check with this one — a split bill approves together. */
    groupIds: string[];
  };
  const shortDate = (iso: string | null | undefined): string | null =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : null;
  const firstName = (full: string | null | undefined): string | null => (full ? full.split(" ")[0] : null);
  const todayISO = nowET.toISOString().slice(0, 10);

  const payCheckOf = (r: (typeof subsRows)[number]): PayCheck => {
    const approvedVia = r.pay_approval_status === "approved" ? "pay" : r.approved_for_pay_at ? "tab" : null;
    const state: PayCheck["state"] = r.payment_status === "paid" ? "paid" : approvedVia ? "approved" : "open";
    const approvedBy = approvedVia === "pay"
      ? firstName(approverName.get(r.pay_approved_by ?? "") ?? null)
      : approvedVia === "tab"
        ? firstName(approverName.get(r.approved_for_pay_by ?? "") ?? null)
        : null;
    const approvedOn = approvedVia === "pay" ? shortDate(r.pay_approved_at) : approvedVia === "tab" ? shortDate(r.approved_for_pay_at) : null;

    const blockers: string[] = [];
    const notes: string[] = [];
    let lineNote: string | null = null;
    const line = one<{ description?: string | null; cost?: number | string | null }>(r.estimate_line_items);
    if (!r.estimate_line_item_id) {
      blockers.push("No budget line");
    } else {
      const lineCost = Number(line?.cost ?? 0);
      const billedOnLine = lineBills
        .filter((b) => b.estimate_line_item_id === r.estimate_line_item_id)
        .reduce((s, b) => s + Number(b.amount || 0), 0);
      if (lineCost > 0 && billedOnLine > lineCost + 0.005) {
        blockers.push(`Over the budget line by ${fmt(billedOnLine - lineCost)} (line ${fmt(lineCost)}, ${fmt(billedOnLine)} billed)`);
      } else if (lineCost > 0) {
        lineNote = `${fmt(lineCost - billedOnLine)} left on the line`;
      }
    }
    if (r.review_status === "needs_review") blockers.push("Flagged for review");
    const twin = r.invoice_number
      ? sameNumber.find(
          (d) =>
            d.id !== r.id &&
            d.vendor_name === r.vendor_name &&
            d.invoice_number === r.invoice_number &&
            Math.abs(Number(d.amount || 0) - amt(r)) < 0.005 &&
            !(r.split_group_id && d.split_group_id === r.split_group_id),
        )
      : null;
    if (twin) blockers.push(`Same invoice # and amount booked twice`);
    const sub = subRecords.find((s) => s.id === r.subcontractor_id);
    if (sub?.insurance_expiry && String(sub.insurance_expiry).slice(0, 10) < todayISO) {
      blockers.push(`Insurance expired ${shortDate(String(sub.insurance_expiry))}`);
    }
    const contract = contracts.find((c) => c.project_id === r.project_id && c.subcontractor_id === r.subcontractor_id);
    const contractAmt = Number(contract?.contract_amount ?? 0);
    if (contractAmt > 0) {
      const billedToSub = vendorBills
        .filter((b) => b.project_id === r.project_id && b.vendor_name === r.vendor_name)
        .reduce((s, b) => s + Number(b.amount || 0), 0);
      notes.push(
        billedToSub > contractAmt + 0.005
          ? `Over contract: ${fmt(billedToSub)} billed of ${fmt(contractAmt)}`
          : `${fmt(billedToSub)} of ${fmt(contractAmt)} contract billed`,
      );
    } else if (r.subcontractor_id) {
      notes.push("No awarded contract on file");
    }

    // One check: the split pieces of one bill, or the same invoice number
    // entered as several rows on the same job.
    const groupIds = subsRows
      .filter(
        (o) =>
          o.vendor_name === r.vendor_name &&
          o.project_id === r.project_id &&
          ((r.split_group_id && o.split_group_id === r.split_group_id) || (r.invoice_number && o.invoice_number === r.invoice_number)),
      )
      .map((o) => o.id);

    return { state, approvedBy, approvedOn, good: blockers.length === 0, blockers, notes, lineNote, groupIds: groupIds.length ? groupIds : [r.id] };
  };

  // ---- one row per BILL, bills rolled into one CHECK per sub per job ----
  // A bill split across budget lines is stored as one invoice row per line
  // (split_vendor_invoice), all sharing a split_group_id — Cosentino Inv 2002
  // on Frechette is three rows but ONE bill and one check. The 9/2 approval
  // pass listed the raw rows, so it read as three bills. Roll the pieces back
  // up here; approval already travels with the whole group (groupIds), so the
  // one button on the bill approves every piece. Same invoice number entered
  // as several rows on one job is also one bill (a hand split, or a double
  // entry — the "booked twice" blocker still shows on it). Several bills from
  // the same sub on the same job are one check, as Nicole cuts them. Jorge 9/2.
  type SubRow = (typeof subsRows)[number];
  type SubBill = {
    key: string;
    href: string;
    label: string;
    rows: SubRow[];
    pieces: Array<{ row: SubRow; pc: PayCheck }>;
    total: number;
    pc: PayCheck;
  };
  type SubCheck = { key: string; vendor: string; job: string; bills: SubBill[]; total: number };
  const billKeyOf = (r: SubRow): string =>
    r.split_group_id
      ? `split:${r.split_group_id}`
      : r.invoice_number
        ? `inv:${(r.vendor_name || "").trim().toLowerCase()}|${r.project_id || ""}|${r.invoice_number}`
        : `row:${r.id}`;
  const mergePayChecks = (pieces: Array<{ row: SubRow; pc: PayCheck }>): PayCheck => {
    const pcs = pieces.map((p) => p.pc);
    const state: PayCheck["state"] = pcs.every((p) => p.state === "paid")
      ? "paid"
      : pcs.every((p) => p.state !== "open")
        ? "approved"
        : "open";
    const stamped = pcs.find((p) => p.state === "approved") ?? null;
    const open = pcs.filter((p) => p.state === "open");
    const notes = uniq(pcs.flatMap((p) => p.notes));
    if (state === "open" && open.length < pcs.length) notes.unshift("Partly approved");
    return {
      state,
      approvedBy: stamped?.approvedBy ?? null,
      approvedOn: stamped?.approvedOn ?? null,
      good: open.every((p) => p.good),
      blockers: uniq(pcs.flatMap((p) => p.blockers)),
      notes,
      lineNote: pieces.length === 1 ? pcs[0].lineNote : null,
      groupIds: pieces.filter((p) => p.pc.state === "open").map((p) => p.row.id),
    };
  };
  const billMap = new Map<string, SubBill>();
  for (const r of subsRows) {
    const key = billKeyOf(r);
    let b = billMap.get(key);
    if (!b) {
      b = { key, href: "", label: r.invoice_number ? `Inv ${r.invoice_number}` : "", rows: [], pieces: [], total: 0, pc: payCheckOf(r) };
      billMap.set(key, b);
    }
    b.rows.push(r);
    b.total += amt(r);
  }
  for (const b of billMap.values()) {
    // Largest piece first; the row deep-links to it and /spent/[id] lists its siblings.
    b.rows.sort((x, y) => amt(y) - amt(x));
    b.href = `/spent/${b.rows[0].id}`;
    b.pieces = b.rows.map((row) => ({ row, pc: payCheckOf(row) }));
    b.pc = mergePayChecks(b.pieces);
  }
  const checkMap = new Map<string, SubCheck>();
  for (const b of billMap.values()) {
    const r = b.rows[0];
    const vendor = (r.vendor_name || "Unknown vendor").trim();
    const key = `${vendor.toLowerCase()}|${r.project_id || "unassigned"}`;
    let c = checkMap.get(key);
    if (!c) {
      c = { key, vendor, job: jobName(projOf(r)), bills: [], total: 0 };
      checkMap.set(key, c);
    }
    c.bills.push(b);
    c.total += b.total;
  }
  const subChecks = [...checkMap.values()].sort((a, b) => b.total - a.total);
  for (const c of subChecks) c.bills.sort((a, b) => b.total - a.total);

  // ---- job spend grouped by job ----
  const byJob = new Map<string, { label: string; number: string | null; total: number; rows: typeof invoices }>();
  for (const r of jobSpendRows) {
    const key = r.project_id || "unassigned";
    const p = projOf(r);
    const g = byJob.get(key) || { label: jobName(p), number: p?.project_number ?? null, total: 0, rows: [] };
    g.total += amt(r);
    g.rows.push(r);
    byJob.set(key, g);
  }
  const jobGroups = [...byJob.values()].sort((a, b) => b.total - a.total);

  // ---- labor: clock hours vs posted cost ----
  // PAID hours, exactly like Payroll: each worker-day loses its unpaid break
  // (30 min, or that day's payroll_adjustments override), prorated across the
  // day's shifts so per-job splits stay fair. Crew time and the Payroll tab
  // must read the SAME number — Jorge 8/23.
  const DEFAULT_BREAK_MINUTES = 30;
  const dayOf = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const breakOverride = new Map<string, number>();
  for (const a of breakAdjRows ?? []) {
    breakOverride.set(`${a.profile_id}|${a.work_date}`, Number(a.break_minutes ?? 0));
  }
  const timedShift = (s: { started_at: unknown; ended_at: unknown }) => {
    const hrs = (new Date(s.ended_at as string).getTime() - new Date(s.started_at as string).getTime()) / 3_600_000;
    // Zero-length rows are daily-log posts (the crew's "Post update" — they
    // carry the text and photos); the timed rows are the actual punches.
    return hrs > 0.017 ? hrs : 0;
  };
  const rawByWorkerDay = new Map<string, number>();
  for (const s of shifts) {
    const hrs = timedShift(s);
    if (!hrs) continue;
    const key = `${s.author_id}|${dayOf(s.started_at as string)}`;
    rawByWorkerDay.set(key, (rawByWorkerDay.get(key) || 0) + hrs);
  }
  const paidFactor = (workerDayKey: string): number => {
    const raw = rawByWorkerDay.get(workerDayKey) || 0;
    if (raw <= 0) return 0;
    const breakHrs = Math.min((breakOverride.get(workerDayKey) ?? DEFAULT_BREAK_MINUTES) / 60, raw);
    return Math.max(0, raw - breakHrs) / raw;
  };
  const hoursByJob = new Map<string, { label: string; hours: number; wages: number; overhead: boolean; source: string }>();
  for (const s of shifts) {
    const rawHrs = timedShift(s);
    if (!rawHrs) continue;
    const hrs = rawHrs * paidFactor(`${s.author_id}|${dayOf(s.started_at as string)}`);
    const key = s.project_id || "unassigned";
    const p = projOf(s) as { name?: string; project_number?: string; is_overhead?: boolean; labor_cost_source?: string } | null;
    const g = hoursByJob.get(key) || { label: jobName(p), hours: 0, wages: 0, overhead: isOverhead(s), source: p?.labor_cost_source ?? "clock" };
    g.hours += hrs;
    g.wages += hrs * (rateByProfile.get(s.author_id as string) ?? 0);
    hoursByJob.set(key, g);
  }
  const postedByJob = new Map<string, number>();
  for (const r of laborRowsInv) {
    const key = r.project_id || "unassigned";
    postedByJob.set(key, (postedByJob.get(key) || 0) + amt(r));
  }
  const laborRows = [...hoursByJob.entries()]
    .map(([id, g]) => ({ id, ...g, posted: postedByJob.get(id) || 0 }))
    .sort((a, b) => b.wages - a.wages);
  const totalHours = laborRows.reduce((s, r) => s + r.hours, 0);
  const totalClockWages = laborRows.reduce((s, r) => s + r.wages, 0);

  // ---- exceptions ----
  const unallocated = invoices.filter((r) => !r.estimate_line_item_id && !isOverhead(r));
  const needsReview = invoices.filter((r) => r.review_status === "needs_review");
  // Ledger-source jobs get their labor dollars from posted rows; clock-source
  // jobs are costed live from the punches. Only a ledger job with hours and no
  // row anywhere is a real gap — and note those rows are dated when payroll was
  // POSTED, not the week worked, so they can't be matched week-to-week here.
  const noLaborPosted = laborRows.filter((r) => r.source === "ledger" && r.posted === 0 && r.hours > 1);
  const hasExceptions = unallocated.length > 0 || needsReview.length > 0 || noLaborPosted.length > 0;

  const RANGE_BUTTONS: { label: string; value: TimeRange }[] = [
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
    { label: "Quarter", value: "quarter" },
    { label: "Year", value: "year" },
  ];

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="weekly" />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Period</div>
            <div className="text-[15px] font-semibold">{period.label}</div>
          </div>
          <div className="flex bg-muted rounded-lg p-0.5 flex-wrap">
            {RANGE_BUTTONS.map(b => (
              <Link
                key={b.value}
                href={`/week?range=${b.value}&offset=0`}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  range === b.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label}
              </Link>
            ))}
            <Link href={`/week?range=${range}&offset=${offset - 1}`} className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground">←</Link>
            <Link href={`/week?range=${range}&offset=${offset + 1}`} className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground">→</Link>
          </div>
        </div>

        {/* the week in three numbers */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Money in</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-500">{fmt(moneyIn)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{payments.length} payment{payments.length === 1 ? "" : "s"} received</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Money out</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-amber-500">{fmt(moneyOut)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{invoices.length} invoices &amp; receipts</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Net</div>
            <div className={`text-2xl font-bold tabular-nums mt-1 ${net < 0 ? "text-orange-500" : "text-emerald-500"}`}>{fmt(net)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {billedOut > 0 ? `${fmt(billedOut)} billed, not yet collected` : "nothing billed this period"}
            </div>
          </div>
        </div>

        {/* spend by category — same rulebook as /spent and the QBO push */}
        {categories.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Where it went</div>
            <div className="flex h-2 rounded-full overflow-hidden bg-muted mb-3">
              {categories.map(g => (
                <div key={g.cat.key} className={g.cat.dot} style={{ width: `${(g.total / moneyOut) * 100}%` }} title={`${g.cat.label} ${fmt(g.total)}`} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {categories.map(g => (
                <div key={g.cat.key} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${g.cat.dot}`} />
                  <span className="text-[12px] text-muted-foreground">{g.cat.label}</span>
                  <span className="text-[12.5px] font-semibold tabular-nums">{fmt(g.total)}</span>
                  <span className="text-[11px] text-muted-foreground">{Math.round((g.total / moneyOut) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* exceptions */}
        {hasExceptions && (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/[0.04] overflow-hidden">
            <div className="px-4 py-3 border-b border-orange-500/20 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-semibold">Before this week can be closed</h2>
            </div>
            <div className="divide-y divide-orange-500/15">
              {noLaborPosted.length > 0 && (
                <div className="px-4 py-3">
                  <div className="text-[13.5px] font-semibold">
                    {noLaborPosted.length} job{noLaborPosted.length === 1 ? "" : "s"} worked with no labor cost posted
                    <span className="ml-2 text-orange-500 tabular-nums">{fmt(noLaborPosted.reduce((s, r) => s + r.wages, 0))}</span>
                  </div>
                  <div className="text-[11.5px] text-muted-foreground mt-0.5">
                    {noLaborPosted.map(r => `${r.label} (${r.hours.toFixed(1)} h)`).join(" · ")}
                  </div>
                </div>
              )}
              {unallocated.length > 0 && (
                <Link href={`/spent?range=${range}&offset=${offset}&unallocated=1#transactions`} className="px-4 py-3 flex items-start gap-3 hover:bg-orange-500/[0.05] transition-colors">
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold">
                      {unallocated.length} invoice{unallocated.length === 1 ? "" : "s"} on no budget line
                      <span className="ml-2 text-orange-500 tabular-nums">{fmt(sum(unallocated))}</span>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">
                      Invisible to job margin until allocated — {unallocated.slice(0, 3).map(r => r.vendor_name).join(", ")}
                      {unallocated.length > 3 ? ` +${unallocated.length - 3} more` : ""}
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                </Link>
              )}
              {needsReview.length > 0 && (
                <Link href="/spent/review" className="px-4 py-3 flex items-start gap-3 hover:bg-orange-500/[0.05] transition-colors">
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold">
                      {needsReview.length} receipt{needsReview.length === 1 ? "" : "s"} flagged for review
                      <span className="ml-2 text-orange-500 tabular-nums">{fmt(sum(needsReview))}</span>
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                </Link>
              )}
            </div>
          </div>
        )}

        {/* money in */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Money in</h2>
            <span className="text-[13px] font-semibold tabular-nums text-emerald-500">{fmt2(moneyIn)}</span>
          </div>
          <div className="divide-y">
            {payments.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No payments received in this period.</div>
            ) : payments.map(r => {
              const p = projOf(r);
              return (
                <Link key={r.id} href={r.project_id ? `/projects/${r.project_id}` : "/payments"} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">{jobName(p)}</div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {p?.project_number ? `${p.project_number} · ` : ""}
                      {r.received_date ? new Date(r.received_date).toLocaleDateString() : "no date"}
                      {r.method ? ` · ${r.method}` : ""}
                      {r.reference_number ? ` · ${r.reference_number}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 w-[110px] text-right text-[14px] font-semibold tabular-nums text-emerald-500">{fmt2(Number(r.amount || 0))}</div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* subs */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Payments to subs</h2>
            <span className="text-[13px] font-semibold tabular-nums">{fmt2(sum(subsRows))}</span>
          </div>
          <div className="divide-y">
            {subsRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No subcontractor payments in this period.</div>
            ) : subChecks.map(c => (
              <div key={c.key} className="divide-y">
                {c.bills.length > 1 && (
                  <div className="px-4 py-2 bg-muted/40 flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold truncate">
                      {c.vendor}
                      <span className="ml-2 text-muted-foreground font-normal">{c.job}</span>
                    </span>
                    <span className="text-[12px] font-semibold tabular-nums shrink-0">
                      <span className="mr-2 text-[10px] text-muted-foreground font-normal">one check · {c.bills.length} invoices</span>
                      {fmt2(c.total)}
                    </span>
                  </div>
                )}
                {c.bills.map(b => {
              const r = b.rows[0];
              const pc = b.pc;
              const split = b.pieces.length > 1;
              const pill = "inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full";
              return (
              <div key={b.key} className={`px-4 py-3 flex items-start gap-4 hover:bg-muted/40 transition-colors${c.bills.length > 1 ? " pl-6" : ""}`}>
                <Link href={b.href} className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold truncate">{c.vendor}</div>
                  <div className="text-[11.5px] text-muted-foreground truncate">
                    {c.job}
                    {b.label ? ` · ${b.label}` : ""}
                    {!split && r.description ? ` · ${r.description}` : ""}
                    {split ? ` · one bill, ${b.pieces.length} budget lines` : ""}
                  </div>
                  {split && (
                    <ul className="mt-1 space-y-0.5">
                      {b.pieces.map(({ row, pc: ppc }) => (
                        <li key={row.id} className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {row.description || lineOf(row)?.description || "no description"}
                            {ppc.lineNote ? <span className="ml-1.5 opacity-70">· {ppc.lineNote}</span> : null}
                          </span>
                          <span className="ml-auto shrink-0 tabular-nums">{fmt2(amt(row))}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {pc.state === "paid" ? (
                      <span className={`${pill} bg-emerald-500/15 text-emerald-500`}>Paid</span>
                    ) : pc.state === "approved" ? (
                      <span className={`${pill} bg-sky-500/15 text-sky-500`}>
                        Approved{pc.approvedBy ? ` · ${pc.approvedBy}` : ""}{pc.approvedOn ? ` · ${pc.approvedOn}` : ""}
                      </span>
                    ) : (
                      <>
                        <span className={`${pill} bg-red-500/15 text-red-500`}>Not approved</span>
                        {pc.good ? (
                          <span className={`${pill} bg-emerald-500/15 text-emerald-500`}>Good to approve</span>
                        ) : (
                          <span className={`${pill} bg-amber-500/15 text-amber-500`}>Hold</span>
                        )}
                      </>
                    )}
                    {pc.blockers.length > 0 && (
                      <span className="text-[11px] text-amber-500">{pc.blockers.join(" · ")}</span>
                    )}
                    {(pc.lineNote || pc.notes.length > 0) && (
                      <span className="text-[11px] text-muted-foreground">{[pc.lineNote, ...pc.notes].filter(Boolean).join(" · ")}</span>
                    )}
                  </div>
                </Link>
                <div className="shrink-0 w-[150px] flex flex-col items-end gap-1.5">
                  <div className="text-[14px] font-semibold tabular-nums">{fmt2(b.total)}</div>
                  {canApprove && pc.state === "open" && (
                    <ApprovePayButton invoiceId={r.id} groupIds={pc.groupIds} />
                  )}
                  {/* Nicole closes the loop here: the check went out, mark it
                      paid on the same list that said it was good to pay. A
                      split bill is one check, so every unpaid piece flips. */}
                  {pc.state !== "paid" && (
                    <MarkPaidButton
                      invoiceId={r.id}
                      groupIds={b.rows.filter((row) => row.payment_status !== "paid").map((row) => row.id)}
                    />
                  )}
                  {canApprove && pc.state !== "paid" && (
                    <NextWeekButton invoiceIds={b.rows.map((row) => row.id)} />
                  )}
                </div>
              </div>
              );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* material and everything else, by job */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Job spend by job</h2>
            <span className="text-[13px] font-semibold tabular-nums">{fmt2(sum(jobSpendRows))}</span>
          </div>
          <div className="divide-y">
            {jobGroups.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No job spend in this period.</div>
            ) : jobGroups.map(g => (
              <div key={g.label}>
                <div className="px-4 py-2 bg-muted/40 flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold truncate">
                    {g.label}
                    {g.number && <span className="ml-2 text-muted-foreground font-normal">{g.number}</span>}
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums shrink-0">{fmt2(g.total)}</span>
                </div>
                {g.rows.map(r => {
                  const c = categoryOf(r);
                  return (
                    <Link key={r.id} href={`/spent/${r.id}`} className="px-4 py-2.5 pl-6 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.chip}`}>{c.label}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] truncate">{r.vendor_name}{r.invoice_number ? ` · ${r.invoice_number}` : ""}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {lineOf(r)?.description || <span className="text-orange-500">no budget line</span>}
                          {r.description ? ` · ${r.description}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 w-[100px] text-right text-[13px] tabular-nums">{fmt2(amt(r))}</div>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* labor */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold">Crew time</h2>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {totalHours.toFixed(1)} hours · {fmt2(totalClockWages)} in wages
            </span>
          </div>
          <div className="divide-y">
            {laborRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No shifts clocked in this period.</div>
            ) : laborRows.map(r => {
              return (
                <div key={r.id} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">
                      {r.label}
                      {r.overhead && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-500 text-[10px] font-semibold uppercase tracking-wider">Overhead</span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">{r.hours.toFixed(1)} hours</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[14px] font-semibold tabular-nums">{fmt2(r.wages)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2.5 border-t text-[11.5px] text-muted-foreground">
            Paid hours this week (breaks deducted, same as the Payroll tab) × each person’s rate. Wages only — payroll tax is company overhead, never job cost. Payroll <em>paid</em> this week shows under Money out, and covers the week before.
          </div>
        </div>

        {/* overhead */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Overhead by category</h2>
            <span className="text-[13px] font-semibold tabular-nums text-orange-500">{fmt2(sum(overheadRows))}</span>
          </div>
          <div className="divide-y">
            {overheadRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No overhead recorded in this period.</div>
            ) : overheadRows.map(r => {
              const c = categoryOf(r);
              return (
                <Link key={r.id} href={`/spent/${r.id}`} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.chip}`}>{c.label}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">
                      {lineOf(r)?.description || <span className="text-orange-500">uncategorised</span>}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {r.vendor_name}
                      {r.description ? ` · ${r.description}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 w-[110px] text-right text-[14px] font-semibold tabular-nums">{fmt2(amt(r))}</div>
                </Link>
              );
            })}
          </div>
        </div>

      </div>
    </>
  );
}
