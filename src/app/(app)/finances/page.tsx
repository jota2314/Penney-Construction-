import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
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
function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4 border-t pt-8">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <Suspense
        fallback={
          <p
            role="status"
            className="animate-pulse rounded-xl bg-muted/30 p-6 text-sm"
          >
            Loading {title.toLowerCase()}…
          </p>
        }
      >
        {children}
      </Suspense>
    </section>
  );
}
async function Portfolio() {
  const data = await getFinanceWorkspace();
  const eligible = data.collections.filter((r) => !r.issue);
  const attention = data.jobs.filter((j) =>
    ["bad", "warn"].includes(healthFor(j).tone),
  ).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          [
            "Open collections",
            money(total(eligible, (r) => r.balance)),
            "Issued invoices · recorded balance",
            "collections",
          ],
          [
            "Overdue collections",
            money(
              total(
                eligible.filter((r) => r.daysLate > 0),
                (r) => r.balance,
              ),
            ),
            `${data.collections.filter((r) => r.issue).length} invoices need reconciliation`,
            "collections",
          ],
          [
            "Reviewed open bills",
            money(Math.round(data.bills.total * 100)),
            `${data.bills.review.length} bill groups still need review`,
            "bills",
          ],
          [
            "Projects needing attention",
            String(attention),
            "Cost, evidence and collection flags",
            "projects",
          ],
        ].map(([label, value, detail, anchor]) => (
          <a
            key={label}
            href={`#${anchor}`}
            className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
              {value}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
          </a>
        ))}
      </div>
      <Section
        id="collections"
        title="Collections"
        subtitle="What is owed, what is late, and which invoice needs action."
      >
        <CollectionsWorkspace rows={data.collections} />
        <details className="rounded-xl border">
          <summary className="cursor-pointer p-4 text-sm font-medium">
            Saved collection plan &amp; weekly priorities
          </summary>
          <SafeSection
            load={async () => (
              <CollectionPlanCard
                plan={publishedCollectionPlan}
                invoiceProjects={await getCollectionInvoices()}
              />
            )}
          />
        </details>
      </Section>
      <ProjectHealthWorkspace
        jobs={data.jobs}
        records={data.records}
        canFinalize={data.canFinalize}
        today={data.today}
        auditError={data.auditError}
      />
      <Section
        id="bills"
        title="Bills & payment readiness"
        subtitle="Open balances, approval status and unresolved receipts."
      >
        <OpenBillsCard summary={data.bills} />
      </Section>
    </>
  );
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
  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 p-4 pb-24 sm:p-6 lg:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700 dark:text-amber-400">
            Penney Construction / Finance
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            The whole financial picture.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Collections, project health, final P&amp;Ls and your day-to-day
            books in one workspace.
          </p>
        </div>
        <nav
          aria-label="Jump to finance section"
          className="flex flex-wrap gap-x-5 gap-y-3 border-y py-3 text-xs font-medium"
        >
          {[
            ["collections", "Collections"],
            ["projects", "Project health"],
            ["final-audits", "Final P&L"],
            ["bills", "Bills"],
            ["cash", "Cash flow"],
            ["activity", "Daily activity"],
            ["expenses", "Expenses"],
            ["income", "Income"],
            ["overhead", "Overhead"],
            ["weekly", "Weekly Close"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="text-muted-foreground hover:text-foreground focus-visible:underline"
            >
              {label} ↓
            </a>
          ))}
        </nav>
        <Suspense
          fallback={
            <p role="status" className="rounded-xl bg-muted/30 p-8">
              Loading current Penney records…
            </p>
          }
        >
          <SafeSection load={Portfolio} />
        </Suspense>
        <Section
          id="cash"
          title="Cash flow & bank reconciliation"
          subtitle="Recorded cash activity, imported bank statements and coverage dates."
        >
          <SafeSection load={() => Cash({ searchParams: shared })} />
        </Section>
        <Section
          id="activity"
          title="Daily activity"
          subtitle="Manage income and expenses, inspect receipts, or add a bill through the existing Command Center workflow."
        >
          <SafeSection load={() => Activity({ searchParams: shared })} />
        </Section>
        <Section
          id="expenses"
          title="Expenses"
          subtitle="Spending by period, category and job."
        >
          <SafeSection load={() => Expenses({ searchParams: shared })} />
        </Section>
        <Section
          id="income"
          title="Income"
          subtitle="Recorded receipts and their project allocations."
        >
          <SafeSection load={() => Income({ searchParams: shared })} />
        </Section>
        <Section
          id="overhead"
          title="Company overhead"
          subtitle="Operating costs kept separate from job profit."
        >
          <SafeSection load={Overhead} />
        </Section>
        <Section
          id="weekly"
          title="Weekly Close"
          subtitle="Resolve exceptions, review crew time and check the week’s money movements."
        >
          <SafeSection load={() => Weekly({ searchParams: shared })} />
        </Section>
        {params.collection && /^[0-9a-f-]{36}$/i.test(params.collection) && (
          <WorkspacePanel>
            <SafeSection
              load={async () => {
                const invoices = await getCollectionInvoices([
                  params.collection!,
                ]);
                return (
                  <CollectionInvoiceActions
                    embedded
                    project={invoices?.[params.collection!]}
                  />
                );
              }}
            />
          </WorkspacePanel>
        )}
      </main>
    </>
  );
}
