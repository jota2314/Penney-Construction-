"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Search, ShieldCheck, TrendingUp, TriangleAlert } from "lucide-react";
import {
  type ProjectHealth,
  type FinanceRecord,
  type Wip,
  NOT_A_JOB,
  isOpenJob,
  wipFor,
  healthFor,
  underbilledBy,
  closedPeriod,
  total,
} from "@/lib/finance/workspace-model";
import { AuditWorkspace } from "./audit-workspace";

/** Cents → whole dollars. Null means the number can't be known yet. */
const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** Accounting style for signed columns: (1,234) is negative. */
const acct = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n / 100) === 0 ? "$0" : n < 0 ? `(${money(-n)})` : money(n);
const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);

const control = "min-h-10 rounded-lg border bg-background px-3 py-2 text-sm";
const tones = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  bad: "bg-red-500/10 text-red-700 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
};
const STATUS: Record<string, string> = {
  in_progress: "In progress",
  contracted: "Contracted",
  scheduled: "Scheduled",
  on_hold: "On hold",
  audit: "Closing out",
  completed: "Completed",
};
const statusLabel = (s: string) => STATUS[s] ?? s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const CLOSING = ["audit", "completed"];

type View = "active" | "closing" | "closed" | "all";
type Sort = "contract" | "margin" | "underbilled" | "owed" | "name";
const VIEWS: { key: View; label: string; short: string }[] = [
  { key: "active", label: "Active", short: "Active" },
  { key: "closing", label: "Closing out", short: "Closing" },
  { key: "closed", label: "Closed", short: "Closed" },
  { key: "all", label: "All jobs", short: "All" },
];
const inView = (j: ProjectHealth, view: View) => {
  const final = j.audit?.kind === "final" && !j.finalNeedsReview;
  if (view === "closed") return final;
  if (view === "all") return !NOT_A_JOB.includes(j.status) || final;
  if (!isOpenJob(j)) return false;
  return view === "closing" ? CLOSING.includes(j.status) : !CLOSING.includes(j.status);
};

type Row = { job: ProjectHealth; wip: Wip; health: ReturnType<typeof healthFor> };

function sortRows(rows: Row[], sort: Sort) {
  const by: Record<Sort, (a: Row, b: Row) => number> = {
    contract: (a, b) => (b.job.contract ?? -1) - (a.job.contract ?? -1),
    margin: (a, b) => (a.wip.margin ?? Infinity) - (b.wip.margin ?? Infinity),
    underbilled: (a, b) => (a.wip.overUnder ?? Infinity) - (b.wip.overUnder ?? Infinity),
    owed: (a, b) => b.job.outstanding - a.job.outstanding,
    name: (a, b) => a.job.name.localeCompare(b.job.name),
  };
  return [...rows].sort((a, b) => by[sort](a, b) || a.job.name.localeCompare(b.job.name));
}

function Progress({ wip, over }: { wip: Wip; over: boolean }) {
  if (wip.pct === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-24">
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span>{pct(wip.pct)}</span>
        {wip.basis === "forecast" && <span className="text-[10px] text-muted-foreground">forecast</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={`h-full rounded-full ${over ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${Math.max(2, wip.pct * 100)}%` }} />
      </div>
    </div>
  );
}

function OverUnder({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const under = value < 0;
  return (
    <span className={under && Math.abs(value) >= 100_00 ? "text-amber-700 dark:text-amber-400" : ""}>
      {acct(value)}
      <span className="block text-[10px] text-muted-foreground">{under ? "underbilled" : value > 0 ? "overbilled" : "even"}</span>
    </span>
  );
}

function Details({ row, onAudit, auditDisabled }: { row: Row; onAudit: () => void; auditDisabled: boolean }) {
  const { job, wip } = row;
  const final = job.audit?.kind === "final";
  const lines: [string, string][] = [
    ["Original contract", money(job.baseContract ?? null)],
    [
      `Approved change orders${job.changeOrderCount ? ` (${job.changeOrderCount})` : ""}`,
      acct(job.changeOrderPrice ?? 0),
    ],
    ["Estimated total cost", wip.estimatedCost === null ? "No budget" : `${money(wip.estimatedCost)}${wip.basis === "forecast" ? " · forecast" : job.budget !== null && job.cost > job.budget ? " · over budget, update forecast" : " · estimate"}`],
    ["Cost to finish", money(wip.toFinish)],
    ["Subs, materials & bills", money(job.vendorCost)],
    ["Crew wages", `${money(job.laborCost)} · ${job.hours.toFixed(1)} hrs`],
    ["Earned to date", money(wip.earned)],
    ["Invoiced in the app", money(job.invoiced ?? 0)],
    ["Payments received", money(job.received)],
  ];
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-[1fr_1fr_auto]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 sm:col-span-1">
        {lines.slice(0, 5).map(([k, v]) => (
          <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums lg:text-left">{v}</dd></Fragment>
        ))}
      </dl>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {lines.slice(5).map(([k, v]) => (
          <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums lg:text-left">{v}</dd></Fragment>
        ))}
        {job.overdue > 0 && (
          <><dt className="text-red-600 dark:text-red-400">Overdue</dt><dd className="text-right tabular-nums text-red-600 dark:text-red-400 lg:text-left">{money(job.overdue)}</dd></>
        )}
      </dl>
      <div className="flex flex-col gap-2 lg:min-w-48">
        <Link href={`/projects/${job.id}?tab=finances`} className={`${control} text-center hover:bg-muted`}>Open job finances</Link>
        <button type="button" className={`${control} hover:bg-muted disabled:opacity-50`} disabled={auditDisabled} onClick={onAudit}>
          {final ? "View / reopen final audit" : "Review & finalize"}
        </button>
      </div>
      {job.warnings.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 text-xs lg:col-span-3">
          <p className="font-medium">Data checks ({job.warnings.length})</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {job.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

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
    [view, setView] = useState<View>("active"),
    [sort, setSort] = useState<Sort>("contract"),
    [open, setOpen] = useState<string | null>(null),
    [focus, setFocus] = useState<ProjectHealth | null>(() => jobs.find((j) => j.id === initialAuditProject) ?? null);
  const [year, setYear] = useState("all"),
    [month, setMonth] = useState("all");

  const all = useMemo(() => jobs.map((job) => ({ job, wip: wipFor(job), health: healthFor(job) })), [jobs]);
  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.key, all.filter((r) => inView(r.job, v.key)).length])) as Record<View, number>,
    [all],
  );
  const q = query.trim().toLowerCase();
  const visible = all.filter((r) => inView(r.job, view) && `${r.job.name} ${r.job.number}`.toLowerCase().includes(q));
  const priced = sortRows(visible.filter((r) => r.job.contract !== null), sort);
  const unpriced = sortRows(visible.filter((r) => r.job.contract === null), sort === "contract" ? "name" : sort);

  // Portfolio totals: contract jobs only — a T&M job has no price to earn against.
  const sum = (get: (r: Row) => number | null) => total(priced, (r) => get(r) ?? 0);
  const withPlan = priced.filter((r) => r.wip.profit !== null);
  const contractValue = sum((r) => r.job.contract);
  const changeOrders = sum((r) => r.job.changeOrderPrice ?? 0);
  const costToDate = sum((r) => r.job.cost);
  const estimated = total(withPlan, (r) => r.wip.estimatedCost ?? 0);
  const projected = total(withPlan, (r) => r.wip.profit ?? 0);
  const plannedContract = total(withPlan, (r) => r.job.contract ?? 0);
  const underbilledJobs = priced.filter((r) => underbilledBy(r.job, r.wip) > 0);
  const unbilled = total(priced, (r) => Math.max(0, -(r.wip.overUnder ?? 0)));
  const overbilled = total(priced, (r) => Math.max(0, r.wip.overUnder ?? 0));
  const owed = total(visible, (r) => r.job.outstanding);
  const overdue = total(visible, (r) => r.job.overdue);
  const losing = priced.filter((r) => r.health.tone === "bad").length;

  const finals = jobs.flatMap((j) => (j.audit?.kind === "final" && !j.finalNeedsReview ? [j.audit] : []));
  const selected = closedPeriod(finals, year, month);
  const revenue = total(selected, (r) => r.payload.contract ?? 0),
    profit = total(selected, (r) => r.payload.profit ?? 0);
  const years = [...new Set(finals.map((r) => r.closed_on!.slice(0, 4)))].sort().reverse();
  const periods = [...new Set(selected.map((r) => r.closed_on!.slice(0, 7)))].sort().reverse();

  const kpis: { label: string; value: string; detail: string; tone?: string }[] = [
    {
      label: "Contract value",
      value: money(contractValue),
      detail: `${priced.length} ${priced.length === 1 ? "job" : "jobs"}${changeOrders ? ` · ${acct(changeOrders)} in change orders` : ""}`,
    },
    {
      label: "Cost to date",
      value: money(costToDate),
      detail: estimated ? `${pct(costToDate / estimated)} of ${money(estimated)} estimated` : "No budgets to compare",
    },
    {
      label: "Projected profit",
      value: money(projected),
      tone: projected < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-500",
      detail: plannedContract
        ? `${pct(projected / plannedContract, 1)} margin${losing ? ` · ${losing} ${losing === 1 ? "job" : "jobs"} over budget or losing money` : ""}`
        : "Needs budgets",
    },
    {
      label: "Underbilled work",
      value: money(unbilled),
      tone: underbilledJobs.length ? "text-amber-700 dark:text-amber-400" : "",
      detail: `${underbilledJobs.length ? `${underbilledJobs.length} ${underbilledJobs.length === 1 ? "job" : "jobs"} to bill · ` : ""}${money(overbilled)} overbilled on others`,
    },
    {
      label: "Owed by clients",
      value: money(owed),
      tone: overdue ? "text-red-500" : "",
      detail: overdue ? `${money(overdue)} overdue` : "Nothing overdue",
    },
  ];

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const cell = "whitespace-nowrap px-3 py-3 text-right tabular-nums";

  return (
    <>
      <section id="projects" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Job cost &amp; work in progress</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Percent complete is cost to date ÷ estimated cost. Earned revenue follows it; billing is compared against it.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">As of {today}</span>
        </div>
        {auditError && (
          <p role="alert" className="rounded-lg border border-amber-500/30 p-3 text-sm">{auditError}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="grid w-full grid-cols-4 gap-1 rounded-lg border bg-muted/30 p-1 sm:flex sm:w-auto" role="tablist" aria-label="Job view">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                onClick={() => { setView(v.key); setOpen(null); }}
                className={`min-w-0 whitespace-nowrap rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
                  view === v.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="sm:hidden">{v.short}</span>
                <span className="hidden sm:inline">{v.label}</span>{" "}
                <span className="text-[11px] text-muted-foreground tabular-nums sm:text-xs">{counts[v.key]}</span>
              </button>
            ))}
          </div>
          <label className="relative min-w-44 flex-1">
            <span className="sr-only">Search jobs</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input placeholder="Search job or PC number" className={`${control} w-full pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort</span>
            <select className={control} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="contract">Biggest contract</option>
              <option value="margin">Lowest margin first</option>
              <option value="underbilled">Most underbilled</option>
              <option value="owed">Most owed</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {kpis.map((k, i) => (
            <div key={k.label} className={`@container min-w-0 rounded-xl border bg-card p-4 ${i === kpis.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{k.label}</p>
              <p className={`mt-1.5 text-[clamp(1.05rem,11cqi,1.625rem)] font-semibold tabular-nums tracking-tight ${k.tone ?? ""}`}>{k.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{k.detail}</p>
            </div>
          ))}
        </div>

        {/* Phones: one card per job */}
        <div className="space-y-3 md:hidden">
          {priced.map((row) => {
            const { job, wip, health } = row;
            const over = job.budget !== null && job.cost > job.budget;
            return (
              <article key={job.id} className="rounded-xl border bg-card">
                <button type="button" onClick={() => toggle(job.id)} aria-expanded={open === job.id} className="block w-full p-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{job.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{job.number} · {statusLabel(job.status)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[health.tone]}`}>{health.label}</span>
                  </div>
                  <div className="mt-3">
                    <Progress wip={wip} over={over} />
                    <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                      {money(job.cost)} spent{wip.estimatedCost !== null ? ` of ${money(wip.estimatedCost)}` : ""}
                    </p>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                    <div><dt className="text-[11px] text-muted-foreground">Contract</dt><dd className="font-medium tabular-nums">{money(job.contract)}</dd></div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Projected profit</dt>
                      <dd className={`font-medium tabular-nums ${wip.profit !== null && wip.profit < 0 ? "text-red-500" : ""}`}>
                        {acct(wip.profit)} <span className="text-xs font-normal text-muted-foreground">{pct(wip.margin)}</span>
                      </dd>
                    </div>
                    <div><dt className="text-[11px] text-muted-foreground">Billed vs earned</dt><dd className="font-medium tabular-nums"><OverUnder value={wip.overUnder} /></dd></div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Owed</dt>
                      <dd className={`font-medium tabular-nums ${job.overdue ? "text-red-500" : ""}`}>{money(job.outstanding)}</dd>
                    </div>
                  </dl>
                  <span className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                    {open === job.id ? "Hide details" : "Details"}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === job.id ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {open === job.id && (
                  <div className="border-t p-4">
                    <Details row={row} onAudit={() => setFocus(job)} auditDisabled={!!auditError} />
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {/* Tablet and up: the WIP schedule */}
        <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Job</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Contract</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Est. cost</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Cost to date</th>
                <th scope="col" className="px-3 py-3 font-medium">Complete</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Projected profit</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Billed</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Over / (under)</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Owed</th>
                <th scope="col" className="w-10 px-2 py-3"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {priced.map((row) => {
                const { job, wip, health } = row;
                const over = job.budget !== null && job.cost > job.budget;
                const expanded = open === job.id;
                return (
                  <Fragment key={job.id}>
                    <tr className={`cursor-pointer border-b align-top transition-colors hover:bg-muted/30 ${expanded ? "bg-muted/30" : ""}`} onClick={() => toggle(job.id)}>
                      <td className="min-w-56 px-4 py-3">
                        <p className="font-semibold">{job.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{job.number} · {statusLabel(job.status)}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[health.tone]}`}>{health.label}</span>
                        </p>
                      </td>
                      <td className={cell}>{money(job.contract)}</td>
                      <td className={`${cell} ${wip.estimatedCost === null ? "text-muted-foreground" : ""}`}>{money(wip.estimatedCost)}</td>
                      <td className={`${cell} ${over ? "text-red-600 dark:text-red-400" : ""}`}>{money(job.cost)}</td>
                      <td className="px-3 py-3"><Progress wip={wip} over={over} /></td>
                      <td className={`${cell} ${wip.profit !== null && wip.profit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                        {acct(wip.profit)}
                        <span className="block text-[10px] text-muted-foreground">{wip.margin === null ? "" : `${pct(wip.margin, 1)} margin`}</span>
                      </td>
                      <td className={cell}>{money(wip.billed)}</td>
                      <td className={cell}><OverUnder value={wip.overUnder} /></td>
                      <td className={`${cell} ${job.overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                        {money(job.outstanding)}
                        {job.overdue > 0 && <span className="block text-[10px]">{money(job.overdue)} late</span>}
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for ${job.name}`}
                          onClick={(e) => { e.stopPropagation(); toggle(job.id); }} className="rounded p-1 hover:bg-muted">
                          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b bg-muted/20">
                        <td colSpan={10} className="px-4 py-4">
                          <Details row={row} onAudit={() => setFocus(job)} auditDisabled={!!auditError} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!priced.length && (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">No priced jobs match this view.</td></tr>
              )}
            </tbody>
            {priced.length > 1 && (
              <tfoot className="border-t-2 border-foreground/15 bg-muted/30 text-sm font-semibold">
                <tr>
                  <th scope="row" className="px-4 py-3 text-left">Total · {priced.length} jobs</th>
                  <td className={cell}>{money(contractValue)}</td>
                  <td className={cell}>{money(estimated)}</td>
                  <td className={cell}>{money(costToDate)}</td>
                  <td className="px-3 py-3 text-xs tabular-nums">{estimated ? pct(costToDate / estimated) : "—"}</td>
                  <td className={cell}>
                    {acct(projected)}
                    <span className="block text-[10px] font-normal text-muted-foreground">{plannedContract ? `${pct(projected / plannedContract, 1)} margin` : ""}</span>
                  </td>
                  <td className={cell}>{money(sum((r) => r.wip.billed))}</td>
                  <td className={cell}>{acct(overbilled - unbilled)}</td>
                  <td className={cell}>{money(total(priced, (r) => r.job.outstanding))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!priced.length && (
          <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground md:hidden">No priced jobs match this view.</p>
        )}

        {unpriced.length > 0 && (
          <details className="rounded-xl border bg-card">
            <summary className="cursor-pointer p-4 text-sm font-medium">
              Time &amp; materials and internal jobs ({unpriced.length})
              <span className="ml-2 font-normal text-muted-foreground">No contract price, so no percent complete or profit</span>
            </summary>
            <div className="overflow-x-auto border-t">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="px-4 py-2 text-left font-medium">Job</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Cost to date</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Billed</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Billed − cost</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {unpriced.map(({ job, wip }) => (
                    <tr key={job.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${job.id}?tab=finances`} className="font-medium hover:underline">{job.name}</Link>
                        <span className="block text-xs text-muted-foreground">{job.number} · {statusLabel(job.status)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(job.cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(wip.billed)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${wip.billed - job.cost < 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{acct(wip.billed - job.cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(job.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Estimated cost is the job’s estimate (plus approved change orders) unless a newer forecast was saved; once costs pass the estimate,
          the job is assumed to be at its final cost until a forecast says otherwise. Profit is before company overhead.
        </p>
      </section>

      <section id="final-audits" className="scroll-mt-24 space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-semibold">Final job P&amp;L</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Closed-out jobs with an approved final audit, grouped by closing month.
            </p>
          </div>
          {finals.length > 0 && (
            <div className="flex gap-2">
              <label className="text-xs">
                Year
                <select className={`${control} mt-1 block`} value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="all">All years</option>
                  {years.map((y) => <option key={y}>{y}</option>)}
                </select>
              </label>
              <label className="text-xs">
                Month
                <select className={`${control} mt-1 block`} value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="all">All months</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={String(i + 1).padStart(2, "0")}>
                      {new Date(2026, i, 1).toLocaleDateString("en-US", { month: "long" })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        {auditError ? (
          <p role="alert" className="rounded-lg border border-amber-500/30 p-4 text-sm">
            Final audit history is unavailable. No closing-period totals can be shown until it loads.
          </p>
        ) : !finals.length ? (
          <div className="flex items-start gap-3 rounded-xl border border-dashed p-5">
            <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">No jobs have been finalized yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {counts.closing
                  ? `${counts.closing} jobs are closing out. Open one under “Closing out” and choose Review & finalize to lock its final P&L.`
                  : "When a job is done, open it above and choose Review & finalize to lock its final P&L."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["Finalized jobs", String(selected.length)],
                ["Final revenue", money(revenue)],
                ["Final profit", money(profit)],
                ["Profit margin", revenue ? `${((profit / revenue) * 100).toFixed(1)}%` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-muted/40 p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            {!selected.length ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No final audits in this period.</p>
            ) : (
              periods.map((period) => {
                const rows = selected.filter((r) => r.closed_on!.startsWith(period));
                return (
                  <div key={period} className="rounded-lg border">
                    <div className="flex justify-between gap-3 bg-muted/40 px-4 py-3 text-sm font-semibold">
                      <span>
                        {new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })} · {rows.length} jobs
                      </span>
                      <span>{money(total(rows, (r) => r.payload.profit ?? 0))} profit</span>
                    </div>
                    {rows.map((r) => (
                      <FinalRow key={r.id} record={r} job={jobs.find((j) => j.id === r.project_id)} />
                    ))}
                  </div>
                );
              })
            )}
            <p className="text-xs text-muted-foreground">
              These are job results by closing month, not a company income statement — company overhead outside each job’s allocation is excluded.
            </p>
          </>
        )}
        {records.some((r) => r.kind !== "forecast") && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Audit revision history ({records.filter((r) => r.kind !== "forecast").length})
            </summary>
            <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">
              {records
                .filter((r) => r.kind !== "forecast")
                .map((r) => (
                  <div key={r.id} className="rounded-lg border p-3 text-xs">
                    <p className="font-medium">
                      {jobs.find((j) => j.id === r.project_id)?.name} · {r.kind === "final" ? "Final audit" : "Reopened"} · {r.created_at.slice(0, 10)}
                    </p>
                    <p>{r.actor_name} · {r.payload.note}</p>
                    {r.kind === "final" && (
                      <p>
                        Closed {r.closed_on} · Revenue {money(r.payload.contract)} · Profit {money(r.payload.profit)} ·{" "}
                        <a className="underline" href={`/api/finance-audit/${r.id}/report`} target="_blank" rel="noreferrer">Open saved P&amp;L</a>
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </details>
        )}
      </section>
      {focus && (
        <AuditWorkspace key={focus.id} job={focus} onClose={() => setFocus(null)} canFinalize={canFinalize} today={today} />
      )}
    </>
  );
}

function FinalRow({ record: r, job }: { record: FinanceRecord; job?: ProjectHealth }) {
  return (
    <details className="border-t px-4 py-3">
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">{job?.name ?? "Project"}</span>
        <span className="ml-3 text-muted-foreground">Closed {r.closed_on} · {money(r.payload.profit)} profit</span>
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <p>Approved by {r.actor_name} · {r.created_at.slice(0, 10)}</p>
        <p>{r.payload.note}</p>
        <p>
          Final revenue {money(r.payload.contract)} · Recorded costs {money(r.payload.cost)} · Additional payroll burden{" "}
          {money(r.payload.payroll_burden)} · Allocated actual overhead {money(r.payload.allocated_overhead)} · Total final cost{" "}
          {money(r.payload.final_cost)} · Net receipts {money(r.payload.received)} · Crew hours {r.payload.hours?.toFixed(1) ?? "—"}
        </p>
        <a className="underline" href={`/api/finance-audit/${r.id}/report`} target="_blank" rel="noreferrer">
          Open frozen P&amp;L and audit evidence
        </a>
        {job?.finalNeedsReview && (
          <p className="text-amber-700">Current financial totals changed since this final audit. Review and reopen if needed.</p>
        )}
      </div>
    </details>
  );
}
