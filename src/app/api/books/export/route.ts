import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { loadLedger, buildPnl, buildTrialBalance, build1099, toCsv } from "@/lib/finance/ledger";

export const runtime = "nodejs";

/**
 * CSV exports for the CPA:
 *   ?report=pnl&year=2026            P&L by month, cash basis
 *   ?report=trial-balance&year=2026  debits/credits per account (optionally &from=YYYY-MM-DD&to=YYYY-MM-DD)
 *   ?report=1099&year=2026           check/ACH payments per sub
 *   ?report=ledger&year=2026         every statement line with its account
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!canSeeBoardMoney(profile?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const report = url.searchParams.get("report") ?? "pnl";
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const from = url.searchParams.get("from") ?? `${year}-01-01`;
  const to = url.searchParams.get("to") ?? `${year}-12-31`;

  const money = (n: number) => Math.round(n * 100) / 100;
  const rows: (string | number | null)[][] = [];
  let filename = `${report}-${year}.csv`;

  if (report === "pnl") {
    const { lines, accounts } = await loadLedger(supabase, `${year}-01-01`, `${year}-12-31`);
    const pnl = buildPnl(lines, year, accounts);
    const header = ["Section", "Code", "Account", "QuickBooks account", ...pnl.months, "Total"];
    rows.push(header);
    const push = (section: string, rs: typeof pnl.income) => {
      for (const r of rs) rows.push([section, r.account.code, r.account.name, r.account.qbo_name, ...r.byMonth.map(money), money(r.total)]);
    };
    push("Income", pnl.income);
    rows.push(["Total income", "", "", "", ...pnl.totals.income.map(money), money(pnl.totals.income.reduce((a, b) => a + b, 0))]);
    push("Job costs", pnl.cogs);
    rows.push(["Total job costs", "", "", "", ...pnl.totals.cogs.map(money), money(pnl.totals.cogs.reduce((a, b) => a + b, 0))]);
    rows.push(["Gross profit", "", "", "", ...pnl.totals.grossProfit.map(money), money(pnl.totals.grossProfit.reduce((a, b) => a + b, 0))]);
    push("Overhead", pnl.expense);
    rows.push(["Total overhead", "", "", "", ...pnl.totals.expense.map(money), money(pnl.totals.expense.reduce((a, b) => a + b, 0))]);
    rows.push(["Net profit", "", "", "", ...pnl.totals.netProfit.map(money), money(pnl.totals.netProfit.reduce((a, b) => a + b, 0))]);
    rows.push([]);
    push("Not P&L (transfers, assets, loans, owner)", pnl.nonPnl);
  } else if (report === "trial-balance") {
    const { lines } = await loadLedger(supabase, from, to);
    const tb = buildTrialBalance(lines);
    rows.push(["Code", "Account", "Type", "QuickBooks account", "Debits", "Credits", "Net", "Lines"]);
    for (const r of tb) rows.push([r.code, r.name, r.type, r.qbo_name, money(r.debits), money(r.credits), money(r.debits - r.credits), r.count]);
    rows.push(["Total", "", "", "", money(tb.reduce((s, r) => s + r.debits, 0)), money(tb.reduce((s, r) => s + r.credits, 0)), "", tb.reduce((s, r) => s + r.count, 0)]);
    filename = `trial-balance-${from}-to-${to}.csv`;
  } else if (report === "1099") {
    const { rows: r1099, threshold } = await build1099(supabase, year);
    rows.push(["Vendor", "Legal name", "W-9 on file", "TIN last 4", "1099 eligible", `Paid by check/ACH ${year}`, "Payments", `Needs 1099 (>= $${threshold})`, "Paid by card (1099-K, not ours)"]);
    for (const r of r1099) {
      rows.push([
        r.vendor,
        r.legal_name,
        r.w9_on_file ? "yes" : "no",
        r.tax_id_last4,
        r.is_1099_eligible ? "yes" : "no",
        money(r.paid),
        r.payments,
        r.is_1099_eligible && r.paid >= threshold ? "YES" : "",
        money(r.paid_by_card),
      ]);
    }
  } else if (report === "ledger") {
    const { lines } = await loadLedger(supabase, from, to);
    rows.push(["Date", "Source", "Description", "Vendor", "Check #", "Direction", "Amount", "Code", "Account", "Type", "QuickBooks account", "Account inferred"]);
    for (const l of lines) {
      rows.push([l.date, l.source, l.description, l.vendor_name, l.check_number, l.direction, money(l.amount), l.account.code, l.account.name, l.account.type, l.account.qbo_name, l.inferred ? "yes" : ""]);
    }
    filename = `ledger-${from}-to-${to}.csv`;
  } else {
    return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="penney-${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
