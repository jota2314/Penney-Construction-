import { ChevronDown, ExternalLink, Wallet } from "lucide-react";
import type { PublishedCollectionPlan } from "@/lib/finance/published-collection-plan";
import type { CollectionInvoiceProjects } from "@/lib/finance/collection-invoices";
import { CollectionInvoiceActions } from "./collection-invoice-actions";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function Amount({ value }: { value: number }) {
  return <span className="font-semibold tabular-nums [overflow-wrap:anywhere]">{money(value)}</span>;
}

export function CollectionPlanCard({ plan, invoiceProjects, expanded = false }: { plan: PublishedCollectionPlan; invoiceProjects?: CollectionInvoiceProjects | null; expanded?: boolean }) {
  const conditional = plan.conditional.reduce((sum, item) => sum + item.amount, 0);
  return (
    <section id="collection-plan" className="min-w-0 scroll-mt-20 overflow-hidden rounded-2xl border bg-card">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Wallet className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h2 className="text-sm font-semibold">Collection plan</h2>
          <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">Jorge’s sent plan · Oct 9, 2026</span>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="@container min-w-0">
            <p className="text-xs text-muted-foreground">Week of October 12–16 · target</p>
            <p className="mt-1 text-[clamp(1.25rem,10cqi,2rem)] leading-tight tracking-tight"><Amount value={plan.focusWeekTarget} /></p>
            <p className="mt-2 text-xs text-muted-foreground">Invoiced {money(plan.invoiced)} · Ready to bill {money(plan.readyToBill)}</p>
          </div>
          <div className="@container min-w-0">
            <p className="text-xs text-muted-foreground">{plan.month} · collected + targets</p>
            <p className="mt-1 text-[clamp(1.25rem,10cqi,2rem)] leading-tight tracking-tight"><Amount value={plan.monthPlan} /></p>
            <p className="mt-2 text-xs text-muted-foreground">Monthly goal {money(plan.goal)}+</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 rounded-xl bg-muted/40 p-3 text-xs sm:grid-cols-3">
          <div className="min-w-0"><p className="mb-1 text-muted-foreground">Reported collected through Oct 9</p><Amount value={plan.reportedCollected} /></div>
          <div className="min-w-0"><p className="mb-1 text-muted-foreground">Left to reach $500,000 goal</p><Amount value={plan.goal - plan.reportedCollected} /></div>
          <div className="min-w-0"><p className="mb-1 text-muted-foreground">Remaining October targets</p><Amount value={plan.monthPlan - plan.reportedCollected} /></div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Dated snapshot from Jorge’s email. Reported collections and billing statuses are as of October 9; targets are planned collections. This plan stays on its stated dates when the cash-flow filter changes.</p>
        <a href={plan.source.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4">View sent collection email <ExternalLink className="h-3 w-3" /></a>
      </div>
      <details open={expanded} className="group/plan border-t">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
          Weekly targets & PM assignments<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/plan:rotate-180" />
        </summary>
        <div className="space-y-5 border-t p-4 sm:p-5">
          <div className="divide-y rounded-xl border">
            {plan.weeks.map(week => <div key={week.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-xs"><div><p className="font-medium">{week.label}, 2026</p><p className="mt-1 text-muted-foreground">{week.status}</p></div><Amount value={week.amount} /></div>)}
          </div>
          <div><h3 className="text-sm font-semibold">{plan.focusWeek} · by project manager</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{plan.note}</p></div>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {plan.managers.map(manager => <div key={manager.name} className="min-w-0 rounded-xl border">
              <div className="flex flex-wrap justify-between gap-2 rounded-t-xl bg-muted/40 px-3 py-3 text-sm"><h4 className="font-semibold">{manager.name}</h4><Amount value={manager.total} /></div>
              <ul className="divide-y">{manager.items.map(item => <li key={item.project} className="px-3 py-3 text-xs">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{item.project}</span><Amount value={item.amount} /></div>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">{item.status}</p>
                <p className="mt-1 leading-relaxed text-muted-foreground">{item.action}</p>
                <CollectionInvoiceActions project={invoiceProjects?.[item.project]} />
              </li>)}</ul>
            </div>)}
          </div>
          <div className="rounded-xl bg-muted/30 p-3 text-xs leading-relaxed"><h3 className="font-semibold">Change orders waiting on signatures</h3><p className="mt-1 text-muted-foreground">{plan.unsignedChangeOrders}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">{plan.comingUp.map(week => <div key={week.label} className="min-w-0"><h3 className="text-sm font-semibold">{week.label}, 2026</h3><ul className="mt-2 space-y-3">{week.items.map(item => <li key={item.project} className="text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="text-muted-foreground">{item.project}</span><Amount value={item.amount} /></div><CollectionInvoiceActions project={invoiceProjects?.[item.project]} /></li>)}</ul></div>)}</div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Conditional · excluded from October plan</h3><Amount value={conditional} /></div>
            <ul className="mt-3 space-y-3">{plan.conditional.map(item => <li key={item.project}><div className="flex flex-wrap justify-between gap-2"><span className="text-muted-foreground">{item.project}</span><Amount value={item.amount} /></div><CollectionInvoiceActions project={invoiceProjects?.[item.project]} /></li>)}</ul>
          </div>
        </div>
      </details>
    </section>
  );
}
