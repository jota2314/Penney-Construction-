"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, ExternalLink, Search, Target, Users } from "lucide-react";
import type { PublishedCollectionPlan } from "@/lib/finance/published-collection-plan";
import type { CollectionInvoiceProjects } from "@/lib/finance/collection-invoices";
import { CollectionInvoiceActions } from "./collection-invoice-actions";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
type PlanRow = { project: string; amount: number; manager?: string; status?: string; action?: string };

function Amount({ value }: { value: number }) {
  return <span className="font-semibold tabular-nums [overflow-wrap:anywhere]">{money(value)}</span>;
}

export function CollectionPlanCard({ plan, invoiceProjects }: { plan: PublishedCollectionPlan; invoiceProjects?: CollectionInvoiceProjects | null }) {
  const [period, setPeriod] = useState(0);
  const [manager, setManager] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const mobileBackRef = useRef<HTMLButtonElement>(null);
  const selectedButtonRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailId = useId();
  const conditional = plan.conditional.reduce((sum, item) => sum + item.amount, 0);
  const progress = Math.min(100, Math.max(0, plan.reportedCollected / plan.goal * 100));
  const periods = [
    { label: "October 12–16", caption: "Focus week", amount: plan.focusWeekTarget },
    ...plan.comingUp.map(week => ({ label: week.label, caption: "Upcoming", amount: week.items.reduce((sum, item) => sum + item.amount, 0) })),
    { label: "Conditional", caption: "Outside base plan", amount: conditional },
  ];
  const rows: PlanRow[] = period === 0
    ? plan.managers.flatMap(pm => pm.items.map(item => ({ ...item, manager: pm.name })))
    : period === 3 ? [...plan.conditional] : [...plan.comingUp[period - 1].items];
  const filtered = rows.filter(row => (manager === "all" || row.manager === manager)
    && (status === "all" || row.status === status)
    && `${row.project} ${row.manager ?? ""} ${invoiceProjects?.[row.project]?.name ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.amount - a.amount);
  const selected = filtered.find(row => row.project === selectedProject) ?? filtered[0];
  const filteredTotal = filtered.reduce((sum, row) => sum + row.amount, 0);
  const hasFilters = query !== "" || manager !== "all" || status !== "all";
  const resetFilters = () => { setQuery(""); setManager("all"); setStatus("all"); setMobileDetail(false); };
  useEffect(() => { detailRef.current?.scrollTo({ top: 0 }); }, [selected?.project, period]);
  useEffect(() => {
    if (mobileDetail && mobileBackRef.current?.getClientRects().length) {
      mobileBackRef.current.focus({ preventScroll: true });
      mobileBackRef.current.scrollIntoView({ block: "start" });
    }
  }, [mobileDetail, selectedProject]);

  return (
    <section id="collection-plan" className="min-w-0">
      <div className="space-y-3 p-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Jorge’s sent plan · Oct 9, 2026</span>
          <a href={plan.source.url} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 rounded text-foreground underline-offset-4 hover:underline ${focusRing}`}>Read source email <ExternalLink className="h-3 w-3" /></a>
        </div>
        <button type="button" aria-expanded={showOverview} aria-controls={`${detailId}-overview`} onClick={() => setShowOverview(!showOverview)} className={`flex w-full items-center justify-between rounded-lg border bg-card p-3 text-xs md:hidden ${focusRing}`}>{showOverview ? "Hide monthly overview" : "View monthly overview"}<ChevronDown className={`h-4 w-4 ${showOverview ? "rotate-180" : ""}`} /></button>
        <div id={`${detailId}-overview`} className={`gap-3 md:grid md:grid-cols-[1.4fr_1fr] ${showOverview ? "grid" : "hidden"}`}>
          <div className="min-w-0 rounded-2xl border border-emerald-600/20 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="inline-flex items-center gap-2 font-medium"><Target className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />{plan.month} goal</span><span className="text-muted-foreground">{money(plan.goal)}+</span></div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="text-2xl tracking-tight sm:text-3xl"><Amount value={plan.reportedCollected} /></p><span className="text-xs text-muted-foreground">Reported collected</span></div>
            <div role="progressbar" aria-label="Reported collections toward October goal" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${money(plan.reportedCollected)} of ${money(plan.goal)}, reported through October 9`} className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-950/10 dark:bg-black/25"><div className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${progress}%` }} /></div>
            <div className="mt-2 flex flex-wrap justify-between gap-1 text-[11px] text-muted-foreground"><span>{Math.round(progress)}% of goal · through Oct 9</span><span><Amount value={plan.goal - plan.reportedCollected} /> to goal</span></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="@container min-w-0 rounded-2xl border bg-card p-4 sm:p-5"><p className="text-xs text-muted-foreground">October plan</p><p className="mt-3 text-[clamp(.9rem,10cqi,1.5rem)] tracking-tight"><Amount value={plan.monthPlan} /></p><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Collected + planned targets</p></div>
            <div className="@container min-w-0 rounded-2xl border bg-card p-4 sm:p-5"><p className="text-xs text-muted-foreground">Still planned</p><p className="mt-3 text-[clamp(.9rem,10cqi,1.5rem)] tracking-tight text-amber-700 dark:text-amber-400"><Amount value={plan.monthPlan - plan.reportedCollected} /></p><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Remaining October targets</p></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-500/10 p-3 md:hidden">
          <div className="min-w-0"><label htmlFor={`${detailId}-period`} className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Collection period</label><select id={`${detailId}-period`} value={period} onChange={event => { setPeriod(Number(event.target.value)); resetFilters(); setSelectedProject(null); }} className={`max-w-full rounded bg-transparent py-1 text-xs font-medium ${focusRing}`}>{periods.map((week, index) => <option key={week.label} value={index}>{week.label}</option>)}</select></div>
          <div className="text-right"><p className="text-[10px] text-muted-foreground">{period === 3 ? "Outside base plan" : "Planned target"}</p><p className="mt-1 text-base"><Amount value={periods[period].amount} /></p></div>
        </div>
        <div className="hidden gap-2 md:grid md:grid-cols-4" role="group" aria-label="Collection period">
          {periods.map((week, index) => <button type="button" key={week.label} aria-pressed={period === index} onClick={() => { setPeriod(index); resetFilters(); setSelectedProject(null); }} className={`@container min-w-0 rounded-xl border p-3 text-left transition-colors ${focusRing} ${period === index ? "border-amber-600/60 bg-amber-500/10 ring-1 ring-amber-600/30" : "border-border bg-card hover:bg-muted/60"}`}>
            <span className="flex items-center justify-between gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{week.caption}{period === index && <Check className="h-3 w-3 shrink-0 text-amber-700 dark:text-amber-400" />}</span>
            <span className="mt-1 block text-xs font-medium">{week.label}</span>
            <span className="mt-2 block text-[clamp(.9rem,9cqi,1.125rem)]"><Amount value={week.amount} /></span>
          </button>)}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">Targets and plan statuses are the October 9 email snapshot. Invoice records below reflect the app. Conditional collections are excluded from October plan totals.</p>
      </div>
      <div className="border-y bg-muted/20 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold">{period === 3 ? "Conditional opportunities" : "Collection priorities"}</h2><p className="mt-1 text-xs text-muted-foreground">{periods[period].label}{period !== 3 && ", 2026"} · {rows.length} targets · largest first</p></div>
          <label className="relative w-full sm:w-60"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><span className="sr-only">Search projects in selected period</span><input value={query} onChange={event => { setQuery(event.target.value); setMobileDetail(false); }} placeholder="Find a project…" className={`h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm ${focusRing}`} /></label>
        </div>
        {period === 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`${detailId}-manager`}>Project manager</label>
          <select id={`${detailId}-manager`} value={manager} onChange={event => { setManager(event.target.value); setMobileDetail(false); }} className={`h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs sm:flex-none ${focusRing}`}><option value="all">All PMs</option>{plan.managers.map(pm => <option key={pm.name} value={pm.name}>{pm.name} · {money(pm.total)}</option>)}</select>
          <label className="sr-only" htmlFor={`${detailId}-status`}>Status in sent plan</label>
          <select id={`${detailId}-status`} value={status} onChange={event => { setStatus(event.target.value); setMobileDetail(false); }} className={`h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs sm:flex-none ${focusRing}`}><option value="all">All plan statuses</option><option value="Invoiced">Invoiced · {money(plan.invoiced)}</option><option value="Ready to bill">Ready to bill · {money(plan.readyToBill)}</option></select>
        </div>}
      </div>
      <div className="grid min-w-0 md:grid-cols-[1fr_1.1fr]">
        <div className={`min-w-0 md:border-r ${mobileDetail && selected ? "hidden md:block" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-[11px] text-muted-foreground sm:px-6"><span aria-live="polite">{filtered.length} of {rows.length} targets · <Amount value={filteredTotal} /></span>{hasFilters ? <button type="button" onClick={resetFilters} className={`rounded underline underline-offset-4 ${focusRing}`}>Clear filters</button> : <span>Select a project <ArrowUpRight className="inline h-3 w-3" /></span>}</div>
          <ul className="divide-y md:max-h-[560px] md:overflow-y-auto" aria-label="Collection targets">
            {filtered.map(row => <li key={row.project}><button ref={selected?.project === row.project ? selectedButtonRef : undefined} type="button" aria-pressed={selected?.project === row.project} aria-controls={detailId} onClick={() => { setSelectedProject(row.project); setMobileDetail(true); }} className={`group w-full border-l-2 px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 ${selected?.project === row.project ? "border-l-amber-500 bg-amber-500/[.07]" : "border-l-transparent hover:bg-muted/40"}`}>
              <span className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm font-semibold">{row.project}</span><span className="shrink-0 text-sm"><Amount value={row.amount} /></span></span>
              <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{row.manager && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{row.manager}</span>}<span className={`rounded-md px-1.5 py-0.5 ${row.status === "Invoiced" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{row.status ?? (period === 3 ? "Conditional" : "Planned draw")}</span><ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 group-hover:text-foreground" /></span>
              {row.action && <span className="mt-2 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">{row.action}</span>}
            </button></li>)}
          </ul>
          {filtered.length === 0 && <div className="px-6 py-14 text-center"><Search className="mx-auto mb-3 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">No matching projects</p><p className="mt-1 text-xs text-muted-foreground">Try another name or clear your filters.</p><button type="button" onClick={resetFilters} className={`mt-4 rounded text-xs font-medium underline underline-offset-4 ${focusRing}`}>Show all targets</button></div>}
        </div>
        <div ref={detailRef} id={detailId} role="region" aria-label="Selected project collection details" className={`min-w-0 bg-card/50 p-4 sm:p-6 md:max-h-[605px] md:overflow-y-auto ${mobileDetail && selected ? "" : "hidden md:block"}`}>
          {selected ? <div key={`${period}-${selected.project}`}>
            <button ref={mobileBackRef} type="button" onClick={() => { setMobileDetail(false); requestAnimationFrame(() => selectedButtonRef.current?.focus()); }} className={`mb-4 inline-flex min-h-9 items-center gap-2 rounded text-xs font-medium md:hidden ${focusRing}`}><ArrowLeft className="h-4 w-4" />Back to projects</button>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{selected.manager ?? (period === 3 ? "Conditional collection" : "Upcoming collection")}</p><span className="rounded-full border bg-background px-2 py-1 text-[10px] text-muted-foreground">Plan · Oct 9</span></div>
            <h3 className="mt-2 break-words text-xl font-semibold tracking-tight">{selected.project}</h3>
            <div className="mt-3 flex flex-wrap items-baseline gap-2"><p className="text-2xl tracking-tight"><Amount value={selected.amount} /></p><span className="text-xs text-muted-foreground">collection target</span></div>
            <div className="my-5 rounded-xl border bg-muted/30 p-3"><h4 className="text-[11px] font-semibold">{selected.status ? `${selected.status} · next step in sent plan` : "Plan note"}</h4><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{selected.action ?? (period === 3 ? "Conditional opportunity. Excluded from the October base plan; confirm the milestone before billing." : "Planned for this week in the sent email. Confirm the milestone and review the existing invoice before sending.")}</p></div>
            <CollectionInvoiceActions project={invoiceProjects?.[selected.project]} embedded />
          </div> : <p className="py-14 text-center text-sm text-muted-foreground">Project details appear here when a target matches your filters.</p>}
        </div>
      </div>
      <details className="group/notes border-t bg-muted/20">
        <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-xs font-medium sm:px-6 [&::-webkit-details-marker]:hidden ${focusRing}`}>Plan notes & reported collections<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/notes:rotate-180" /></summary>
        <div className="grid gap-5 px-4 pb-5 text-xs sm:px-6 md:grid-cols-2">
          <div><h3 className="font-semibold">Team coordination</h3><p className="mt-2 leading-relaxed text-muted-foreground">{plan.note}</p><h3 className="mt-4 font-semibold">Change orders waiting on signatures</h3><p className="mt-2 leading-relaxed text-muted-foreground">{plan.unsignedChangeOrders}</p></div>
          <div><h3 className="font-semibold">October timeline · email snapshot</h3><dl className="mt-2 divide-y">{plan.weeks.map(week => <div key={week.label} className="flex flex-wrap justify-between gap-2 py-2"><dt>{week.label}<span className="mt-0.5 block text-[10px] text-muted-foreground">{week.status}</span></dt><dd><Amount value={week.amount} /></dd></div>)}</dl></div>
        </div>
      </details>
    </section>
  );
}

