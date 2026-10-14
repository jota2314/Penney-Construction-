"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, ShieldCheck, TrendingUp, TriangleAlert } from "lucide-react";
import {
  type ProjectHealth,
  type FinanceRecord,
  forecastFor,
  healthFor,
  closedPeriod,
  total,
} from "@/lib/finance/workspace-model";
import { AuditWorkspace } from "./audit-workspace";

const money = (n: number | null | undefined) =>
  n == null
    ? "Not verified"
    : (n / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
const control = "min-h-10 rounded-lg border bg-background px-3 py-2 text-sm";
const tones = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  bad: "bg-red-500/10 text-red-700 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
};
export function ProjectHealthWorkspace({
  jobs,
  records,
  canFinalize,
  today,
  auditError,
  initialAuditProject,
}: {
  jobs: ProjectHealth[];
  records: FinanceRecord[];
  canFinalize: boolean;
  today: string;
  auditError: string | null;
  initialAuditProject?: string;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("active"),
    [focus, setFocus] = useState<ProjectHealth | null>(() => jobs.find((j) => j.id === initialAuditProject) ?? null);
  const [year, setYear] = useState("all"),
    [month, setMonth] = useState("all");
  const active = (j: ProjectHealth) => !j.audit || j.audit.kind !== "final" || j.finalNeedsReview;
  const filtered = jobs.filter(
    (j) =>
      `${j.name} ${j.number}`.toLowerCase().includes(query.toLowerCase()) &&
      (status === "all" ||
        (status === "final" && j.audit?.kind === "final" && !j.finalNeedsReview) ||
        (status === "attention" &&
          ["warn", "bad"].includes(healthFor(j).tone)) ||
        (status === "active" &&
          active(j) &&
          ![
            "lead",
            "estimating",
            "proposal_sent",
            "cancelled",
            "lost",
          ].includes(j.status))),
  );
  const finals = jobs.flatMap((j) =>
    j.audit?.kind === "final" && !j.finalNeedsReview ? [j.audit] : [],
  );
  const selected = closedPeriod(finals, year, month);
  const revenue = total(selected, (r) => r.payload.contract ?? 0),
    profit = total(selected, (r) => r.payload.profit ?? 0);
  const years = [...new Set(finals.map((r) => r.closed_on!.slice(0, 4)))]
    .sort()
    .reverse();
  const periods = [...new Set(selected.map((r) => r.closed_on!.slice(0, 7)))]
    .sort()
    .reverse();
  return (
    <>
      <section id="projects" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
              Project performance
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Know where every job stands.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Current recorded costs, remaining-cost forecasts and evidence
              status.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">As of {today}</span>
        </div>
        {auditError && (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/30 p-3 text-sm"
          >
            {auditError}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <label className="relative flex-1 min-w-48">
            <span className="sr-only">Search projects</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search project or job number"
              className={`${control} w-full pl-9`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Project view</span>
            <select
              className={control}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Active &amp; awaiting audit</option>
              <option value="attention">Needs attention</option>
              <option value="final">Financially closed</option>
              <option value="all">All projects</option>
            </select>
          </label>
        </div>
        <div className="space-y-3 md:hidden">
          {filtered.map((j) => {
            const health = healthFor(j),
              forecast = forecastFor(j),
              final = j.audit?.kind === "final";
            return (
              <article key={j.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/projects/${j.id}?tab=finances`}
                      className="font-semibold"
                    >
                      {j.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {j.number}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] ${tones[health.tone]}`}
                  >
                    {health.label}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 text-sm">
                  {[
                    ["Contract + changes", money(j.contract)],
                    ["Recorded job cost", money(j.cost)],
                    [
                      "Cost to finish",
                      final
                        ? "Finalized"
                        : forecast
                          ? money(forecast.remaining)
                          : "Needs estimate",
                    ],
                    [
                      final ? "Final profit" : "Expected profit",
                      final
                        ? money(j.audit!.payload.profit)
                        : forecast && !forecast.stale
                          ? money(forecast.profit)
                          : "Not verified",
                    ],
                    ["Issued balance", money(j.outstanding)],
                    ["Crew hours", j.hours.toFixed(1)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-1 font-medium tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                {forecast?.stale && !final && (
                  <p className="mt-3 text-xs text-amber-700">
                    Costs changed · update the forecast.
                  </p>
                )}
                {j.warnings.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer">
                      {j.warnings.length} checks need attention
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {j.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  className={`${control} mt-4 w-full`}
                  disabled={!!auditError}
                  onClick={() => setFocus(j)}
                >
                  {final ? "View / reopen" : "Review & finalize"}
                </button>
              </article>
            );
          })}
          {!filtered.length && (
            <p className="p-4 text-sm text-muted-foreground">
              No projects match this view.
            </p>
          )}
        </div>
        <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {[
                  "Project / health",
                  "Contract + changes",
                  "Recorded cost",
                  "Cost to finish",
                  "Expected profit",
                  "Collections",
                  "Audit",
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-3 font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => {
                const health = healthFor(j),
                  forecast = forecastFor(j),
                  final = j.audit?.kind === "final";
                return (
                  <tr key={j.id} className="border-t align-top">
                    <td className="min-w-56 px-4 py-4">
                      <Link
                        href={`/projects/${j.id}?tab=finances`}
                        className="font-semibold hover:underline"
                      >
                        {j.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {j.number} · {j.status.replaceAll("_", " ")}
                      </p>
                      <span
                        className={`mt-2 inline-block rounded-full px-2 py-1 text-[11px] font-medium ${tones[health.tone]}`}
                      >
                        {health.label}
                      </span>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Cost details &amp; evidence
                        </summary>
                        <div className="mt-2 space-y-1">
                          <p>Budget: {money(j.budget)}</p>
                          <p>Vendor costs: {money(j.vendorCost)}</p>
                          <p>
                            Modeled wages: {money(j.laborCost)} ·{" "}
                            {j.hours.toFixed(1)} crew hours
                          </p>
                          {j.warnings.map((w) => (
                            <p
                              key={w}
                              className="text-amber-700 dark:text-amber-400"
                            >
                              {w}
                            </p>
                          ))}
                          <p>
                            Last saved review:{" "}
                            {j.reviewDate
                              ? j.reviewDate.slice(0, 10)
                              : "Not reviewed"}
                          </p>
                          <p>
                            Source checks and remaining costs must be verified
                            before final profit.
                          </p>
                        </div>
                      </details>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 tabular-nums">
                      {money(j.contract)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 tabular-nums">
                      {money(j.cost)}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Including modeled wages
                      </p>
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {final
                        ? "Finalized"
                        : forecast
                          ? money(forecast.remaining)
                          : "Needs estimate"}
                      {forecast?.stale && !final && (
                        <p className="text-xs text-amber-700">
                          Costs changed · recheck
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {final
                        ? money(j.audit!.payload.profit)
                        : forecast && !forecast.stale
                          ? money(forecast.profit)
                          : "Not verified"}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {final
                          ? "Saved final P&L"
                          : "Before unallocated overhead / burden"}
                      </p>
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {money(j.outstanding)}
                      <p
                        className={`mt-1 text-[11px] ${j.overdue ? "text-red-600" : "text-muted-foreground"}`}
                      >
                        {j.overdue
                          ? `${money(j.overdue)} overdue`
                          : "Issued invoice balance"}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        className={`${control} whitespace-nowrap hover:bg-muted`}
                        disabled={!!auditError}
                        onClick={() => setFocus(j)}
                      >
                        {final ? "View / reopen" : "Review & finalize"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-8 text-center text-muted-foreground"
                  >
                    No projects match this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section
        id="final-audits"
        className="scroll-mt-24 space-y-4 rounded-2xl border bg-card p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="text-xl font-semibold">Final project P&amp;L</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Current approved closeouts grouped by closing date. Reopened audits and closeouts needing re-review stay in history.
            </p>
          </div>
          <div className="flex gap-2">
            <label className="text-xs">
              Closing year
              <select
                className={`${control} mt-1 block`}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              >
                <option value="all">All years</option>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Closing month
              <select
                className={`${control} mt-1 block`}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                <option value="all">All months</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={String(i + 1).padStart(2, "0")}>
                    {new Date(2026, i, 1).toLocaleDateString("en-US", {
                      month: "long",
                    })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {auditError ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/30 p-4 text-sm"
          >
            Final audit history is unavailable. No closing-period totals can be
            shown until it loads.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["Finalized projects", selected.length],
                ["Final revenue", money(revenue)],
                ["Final profit", money(profit)],
                [
                  "Weighted profit margin",
                  revenue ? `${((profit / revenue) * 100).toFixed(1)}%` : "—",
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-muted/40 p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            {!selected.length ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <TrendingUp className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                <p className="font-medium">No final audits in this period.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Complete a project’s evidence review, then approve its final
                  audit above.
                </p>
              </div>
            ) : (
              periods.map((period) => {
                const rows = selected.filter((r) =>
                  r.closed_on!.startsWith(period),
                );
                return (
                  <div key={period} className="rounded-lg border">
                    <div className="flex justify-between gap-3 bg-muted/40 px-4 py-3 text-sm font-semibold">
                      <span>
                        {new Date(`${period}-01T12:00:00`).toLocaleDateString(
                          "en-US",
                          { month: "long", year: "numeric" },
                        )}{" "}
                        · {rows.length} projects
                      </span>
                      <span>
                        {money(total(rows, (r) => r.payload.profit ?? 0))}{" "}
                        profit
                      </span>
                    </div>
                    {rows.map((r) => (
                      <FinalRow
                        key={r.id}
                        record={r}
                        job={jobs.find((j) => j.id === r.project_id)}
                      />
                    ))}
                  </div>
                );
              })
            )}
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              These are project closing-period results, not a cash-basis company
              income statement. Company profit still depends on overhead outside
              the stated project allocations.
            </p>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Audit revision history (
                {records.filter((r) => r.kind !== "forecast").length})
              </summary>
              <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">
                {records
                  .filter((r) => r.kind !== "forecast")
                  .map((r) => (
                    <div key={r.id} className="rounded-lg border p-3 text-xs">
                      <p className="font-medium">
                        {jobs.find((j) => j.id === r.project_id)?.name} ·{" "}
                        {r.kind === "final" ? "Final audit" : "Reopened"} ·{" "}
                        {r.created_at.slice(0, 10)}
                      </p>
                      <p>
                        {r.actor_name} · {r.payload.note}
                      </p>
                      {r.kind === "final" && (
                        <p>
                          Closed {r.closed_on} · Revenue{" "}
                          {money(r.payload.contract)} · Profit{" "}
                          {money(r.payload.profit)} ·{" "}
                          <a
                            className="underline"
                            href={`/api/finance-audit/${r.id}/report`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open saved P&amp;L
                          </a>
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </details>
          </>
        )}
      </section>
      {focus && (
        <AuditWorkspace
          key={focus.id}
          job={focus}
          onClose={() => setFocus(null)}
          canFinalize={canFinalize}
          today={today}
        />
      )}
    </>
  );
}
function FinalRow({
  record: r,
  job,
}: {
  record: FinanceRecord;
  job?: ProjectHealth;
}) {
  return (
    <details className="border-t px-4 py-3">
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">{job?.name ?? "Project"}</span>
        <span className="ml-3 text-muted-foreground">
          Closed {r.closed_on} · {money(r.payload.profit)} profit
        </span>
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <p>
          Approved by {r.actor_name} · {r.created_at.slice(0, 10)}
        </p>
        <p>{r.payload.note}</p>
        <p>
          Final revenue {money(r.payload.contract)} · Recorded costs{" "}
          {money(r.payload.cost)} · Additional payroll burden {money(r.payload.payroll_burden)} · Allocated actual overhead {money(r.payload.allocated_overhead)} · Total final cost {money(r.payload.final_cost)} · Net receipts {money(r.payload.received)} · Crew hours{" "}
          {r.payload.hours?.toFixed(1) ?? "—"}
        </p>
        <a
          className="underline"
          href={`/api/finance-audit/${r.id}/report`}
          target="_blank"
          rel="noreferrer"
        >
          Open frozen P&amp;L and audit evidence
        </a>
        {job?.finalNeedsReview && (
          <p className="text-amber-700">
            Current financial totals changed since this final audit. Review and
            reopen if needed.
          </p>
        )}
      </div>
    </details>
  );
}
