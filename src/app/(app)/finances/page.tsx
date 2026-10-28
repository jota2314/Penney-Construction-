import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { getFinanceWorkspace } from "@/lib/finance/workspace-data";
import { total, healthFor } from "@/lib/finance/workspace-model";
import { ProjectHealthWorkspace } from "@/components/finances/project-health-workspace";
import { CollectionsWorkspace } from "@/components/finances/collections-workspace";
import { OpenBillsCard } from "@/components/ceo/open-bills-card";
import { CollectionPlanCard } from "@/components/ceo/collection-plan-card";
import { CollectionInvoiceActions } from "@/components/ceo/collection-invoice-actions";
import { getCollectionInvoices } from "@/lib/finance/collection-invoices";
import { publishedCollectionPlan } from "@/lib/finance/published-collection-plan";
import { WorkspacePanel } from "@/components/finances/workspace-panel";
import { getCollectionPace } from "@/lib/finance/collection-pace";
import { CollectionPaceHistory, CollectionPaceSummary } from "@/components/finances/collection-pace";
import Cash from "@/components/finances/sections/cash";
import Activity from "@/components/finances/sections/activity";
import Expenses from "@/components/finances/sections/expenses";
import Income from "@/components/finances/sections/income";
import Overhead from "@/components/finances/sections/overhead";
import Weekly from "@/components/finances/sections/weekly";

export const metadata: Metadata = {
  title: "Finance workspace | Penney Construction",
};
type Params = {
  section?: string;
  range?: string;
  offset?: string;
  type?: string;
  cat?: string;
  unallocated?: string;
  month?: string;
  m?: string;
  panel?: string;
  id?: string;
  collection?: string;
  auditProject?: string;
};
const money = (n: number) =>
  (n / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
async function SafeSection({ load }: { load: () => Promise<ReactNode> }) {
  try {
    return await load();
  } catch {
    return (
      <p
        role="alert"
        className="rounded-lg border border-amber-500/30 p-4 text-sm"
      >
        This section could not load completely. Refresh to retry; missing data
        is not a zero balance.
      </p>
    );
  }
}

// One section at a time. Every finance screen used to be stacked on this one
// page (Jorge 10/12: "everything in one page is super bad"), which also made
// every visit load every section's data. The old routes (/spent, /payments,
// /week, /money, /overhead, /finances/daily-log) already redirect here with
// ?section=, so their filter and period links land on the right tab.
const TABS = [
  { key: "overview", label: "Overview", aliases: [], subtitle: "The headline numbers. Open a card for the detail." },
  { key: "collections", label: "Collections", aliases: [], subtitle: "Who owes us, oldest first. Open an invoice or send a reminder." },
  { key: "projects", label: "Projects", aliases: ["final-audits"], subtitle: "Job health, forecasts and final P&Ls." },
  { key: "bills", label: "Bills", aliases: [], subtitle: "Open balances, approval status and unresolved receipts." },
  { key: "cash", label: "Cash flow", aliases: [], subtitle: "Recorded cash activity, imported bank statements and coverage dates." },
  { key: "expenses", label: "Expenses", aliases: [], subtitle: "Spending by period, category and job." },
  { key: "income", label: "Income", aliases: [], subtitle: "Recorded receipts and their project allocations." },
  { key: "overhead", label: "Overhead", aliases: [], subtitle: "Operating costs kept separate from job profit." },
  { key: "weekly", label: "Weekly Close", aliases: [], subtitle: "Resolve exceptions, review crew time and check the week's money movements." },
  { key: "activity", label: "Daily", aliases: [], subtitle: "Manage income and expenses, inspect receipts, or add a bill through the existing Command Center workflow." },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function tabFor(section: string | undefined) {
  return (
    TABS.find((t) => t.key === section || (t.aliases as readonly string[]).includes(section ?? "")) ?? TABS[0]
  );
}

function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="animate-pulse rounded-xl bg-muted/30 p-6 text-sm">
      Loading {label.toLowerCase()}…
    </p>
  );
}

async function OverviewTab() {
  const [data, pace] = await Promise.all([getFinanceWorkspace(), getCollectionPace()]);
  // Same basis as the Collections tab: an invoice with a matching check logged
  // is not counted as owed.
  const eligible = data.collections.filter((r) => !r.issue && !r.loggedPayment);
  const attention = data.jobs.filter((j) =>
    ["bad", "warn"].includes(healthFor(j).tone),
  ).length;
  const cards: [string, string, string, string][] = [
    ["Open collections", money(total(eligible, (r) => r.balance)), "Issued invoices · recorded balance", "?section=collections"],
    [
      "Overdue collections",
      money(total(eligible.filter((r) => r.daysLate > 0), (r) => r.balance)),
      `${data.collections.filter((r) => r.issue).length} invoices need reconciliation`,
      "?section=collections",
    ],
    ["Reviewed open bills", money(Math.round(data.bills.total * 100)), `${data.bills.review.length} bill groups still need review`, "?section=bills"],
    ["Projects needing attention", String(attention), "Cost, evidence and collection flags", "?section=projects"],
  ];
  return (
    <>
      <Link href="?section=collections" className="block rounded-xl transition-opacity hover:opacity-90">
        <CollectionPaceSummary pace={pace} />
      </Link>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(([label, value, detail, href]) => (
          <Link key={label} href={href} className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

async function CollectionsTab() {
  const [data, pace] = await Promise.all([getFinanceWorkspace(), getCollectionPace()]);
  return (
    <section id="collections" className="scroll-mt-28 space-y-4">
      <CollectionsWorkspace rows={data.collections} pace={pace} />
      <details className="rounded-xl border">
        <summary className="cursor-pointer p-4 text-sm font-medium">
          History: week by week, month by month, who paid
        </summary>
        <div className="border-t p-4">
          <CollectionPaceHistory pace={pace} />
        </div>
      </details>
      <details className="rounded-xl border">
        <summary className="cursor-pointer p-4 text-sm font-medium">
          Saved collection plan &amp; weekly priorities
        </summary>
        <SafeSection
          load={async () => (
            <CollectionPlanCard plan={publishedCollectionPlan} invoiceProjects={await getCollectionInvoices()} />
          )}
        />
      </details>
    </section>
  );
}

async function ProjectsTab(auditProject?: string) {
  const data = await getFinanceWorkspace();
  return (
    <ProjectHealthWorkspace
      key={auditProject || "projects"}
      initialAuditProject={auditProject}
      jobs={data.jobs}
      records={data.records}
      canFinalize={data.canFinalize}
      today={data.today}
      auditError={data.auditError}
    />
  );
}

async function BillsTab() {
  const data = await getFinanceWorkspace();
  return <OpenBillsCard summary={data.bills} />;
}

function renderTab(key: TabKey, shared: Promise<Params>) {
  switch (key) {
    case "overview":
      return <SafeSection load={OverviewTab} />;
    case "collections":
      return <SafeSection load={CollectionsTab} />;
    case "projects":
      return <SafeSection load={async () => ProjectsTab((await shared).auditProject)} />;
    case "bills":
      return <SafeSection load={BillsTab} />;
    case "cash":
      return <SafeSection load={() => Cash({ searchParams: shared })} />;
    case "expenses":
      return <SafeSection load={() => Expenses({ searchParams: shared })} />;
    case "income":
      return <SafeSection load={() => Income({ searchParams: shared })} />;
    case "overhead":
      return <SafeSection load={Overhead} />;
    case "weekly":
      return <SafeSection load={() => Weekly({ searchParams: shared })} />;
    case "activity":
      return <SafeSection load={() => Activity({ searchParams: shared })} />;
  }
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireAuth();
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");
  const params = await searchParams,
    shared = Promise.resolve(params);
  const tab = tabFor(params.auditProject ? "projects" : params.section);
  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <nav
        aria-label="Finance sections"
        className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-2 [scrollbar-width:none] sm:px-4 lg:px-6">
          {TABS.map((t) => {
            const active = t.key === tab.key;
            return (
              <Link
                key={t.key}
                href={t.key === "overview" ? "/finances" : `/finances?section=${t.key}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-amber-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 pb-24 sm:p-6 lg:p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tab.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tab.subtitle}</p>
        </div>
        <Suspense key={tab.key} fallback={<Loading label={tab.label} />}>
          {renderTab(tab.key, shared)}
        </Suspense>
        {params.collection && /^[0-9a-f-]{36}$/i.test(params.collection) && (
          <WorkspacePanel>
            <SafeSection
              load={async () => {
                const invoices = await getCollectionInvoices([params.collection!]);
                return <CollectionInvoiceActions embedded project={invoices?.[params.collection!]} />;
              }}
            />
          </WorkspacePanel>
        )}
      </main>
    </>
  );
}
