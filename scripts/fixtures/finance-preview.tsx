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
        pace={{
          today: "2026-10-28",
          thisWeek: { start: "2026-10-26", end: "2026-11-01", label: "Oct 26 – Nov 1", collected: 0, target: 11990100, payments: [] },
          lastWeek: { label: "Oct 19–25", collected: 7041500 },
          month: { key: "2026-10", label: "October", collected: 33198300, goal: 50000000 },
          weeks: [
            { start: "2026-10-19", end: "2026-10-25", label: "Oct 19–25", collected: 7041500, target: 7892600, current: false, future: false },
            { start: "2026-10-26", end: "2026-10-31", label: "Oct 26–31", collected: 0, target: 11990100, current: true, future: false },
          ],
          months: [
            { key: "2026-10", label: "October 2026", collected: 33198300, count: 22, goal: 50000000, current: true },
            { key: "2026-09", label: "September 2026", collected: 45744600, count: 27, goal: null, current: false },
          ],
        }}
        rows={[
          {
            id: "i1",
            projectId: base.id,
            projectName: "Sample basement finish",
            number: 1,
            title: "Remaining balance",
            amount: 751650,
            balance: 751650,
            due: null,
            daysLate: 0,
            sent: "2026-09-09",
            daysWaiting: 49,
            loggedPayment: null,
            issue: null,
          },
          {
            id: "i2",
            projectId: base.id,
            projectName: base.name,
            number: 3,
            title: "Progress payment, foundation and framing (3 of 6 per contract schedule)",
            amount: 13487600,
            balance: 13487600,
            due: null,
            daysLate: 0,
            sent: "2026-10-21",
            daysWaiting: 7,
            loggedPayment: null,
            issue: null,
          },
          {
            id: "i3",
            projectId: base.id,
            projectName: "Sample addition",
            number: 5,
            title: "Drywall, interior trim and flooring complete",
            amount: 7500000,
            balance: 7500000,
            due: null,
            daysLate: 0,
            sent: "2026-10-27",
            daysWaiting: 1,
            loggedPayment: null,
            issue: null,
          },
          {
            id: "i4",
            projectId: base.id,
            projectName: "Sample kitchen renovation",
            number: 4,
            title: "Final invoice",
            amount: 1033733,
            balance: 1033733,
            due: "2026-10-19",
            daysLate: 9,
            sent: "2026-10-14",
            daysWaiting: 14,
            loggedPayment: { amount: 1033733, date: "2026-10-19", reference: "1275" },
            issue: null,
          },
          {
            id: "i5",
            projectId: base.id,
            projectName: "Sample deck addition",
            number: 2,
            title: "Balance",
            amount: 1800000,
            balance: 1800000,
            due: null,
            daysLate: 0,
            sent: "2026-10-02",
            daysWaiting: 26,
            loggedPayment: null,
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
