import { notFound } from "next/navigation";
import { ProjectHealthWorkspace } from "@/components/finances/project-health-workspace";
import { CollectionsWorkspace } from "@/components/finances/collections-workspace";
export default function Preview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const base = {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Sample bathroom renovation",
    number: "TEST-001",
    status: "in_progress",
    closedOn: null,
    contract: 8000000,
    budget: 5500000,
    vendorCost: 2100000,
    laborCost: 900000,
    cost: 3000000,
    hours: 225,
    received: 4000000,
    outstanding: 2000000,
    overdue: 1000000,
    warnings: [],
    reviewDate: "2026-10-09",
    audit: null,
    forecast: null,
    finalNeedsReview: false,
    financialBasis: "a",
  };
  const audit = {
    id: "00000000-0000-4000-8000-000000000022",
    project_id: "job2",
    kind: "final" as const,
    created_at: "2026-10-09",
    actor_name: "Sample reviewer",
    closed_on: "2026-09-30",
    payload: {
      contract: 8000000,
      cost: 5500000,
      profit: 2500000,
      note: "Sample evidence-backed final report",
      hours: 400,
    },
  };
  return (
    <main className="mx-auto max-w-[1600px] space-y-8 p-6">
      <p className="text-xs uppercase tracking-widest">
        Penney Construction · Synthetic preview data
      </p>
      <h1 className="text-4xl font-semibold">The whole financial picture.</h1>
      <h2 className="text-2xl">Collections</h2>
      <CollectionsWorkspace
        rows={[
          {
            id: "i",
            projectId: base.id,
            projectName: base.name,
            number: 3,
            title: "Progress payment",
            amount: 3000000,
            balance: 2000000,
            due: "2026-09-30",
            daysLate: 9,
            issue: null,
          },
          {
            id: "i2",
            projectId: base.id,
            projectName: "Sample deck addition",
            number: 2,
            title: "Balance",
            amount: 1800000,
            balance: 1800000,
            due: null,
            daysLate: 0,
            issue: "Linked receipts and invoice paid amount differ",
          },
        ]}
      />
      <ProjectHealthWorkspace
        jobs={[
          base,
          {
            ...base,
            id: "job2",
            name: "Sample completed kitchen",
            status: "completed",
            closedOn: "2026-09-30",
            audit,
          },
        ]}
        records={[audit]}
        canFinalize
        today="2026-10-09"
        auditError={null}
      />
    </main>
  );
}
