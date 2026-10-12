"use client";
import { useState } from "react";
import Link from "next/link";
import { total, type CollectionRow } from "@/lib/finance/workspace-model";
const money = (n: number) =>
  (n / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
export function CollectionsWorkspace({ rows }: { rows: CollectionRow[] }) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const filtered = rows.filter(
    (r) =>
      `${r.projectName} ${r.title} ${r.number}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "overdue" && !r.issue && r.daysLate > 0) ||
        (filter === "review" && r.issue) ||
        (filter === "undated" && !r.due)),
  );
  const buckets = [
    {
      label: "Current / not due",
      check: (r: CollectionRow) => !!r.due && r.daysLate === 0,
    },
    {
      label: "1–30 days late",
      check: (r: CollectionRow) => r.daysLate > 0 && r.daysLate <= 30,
    },
    {
      label: "31–60 days late",
      check: (r: CollectionRow) => r.daysLate > 30 && r.daysLate <= 60,
    },
    { label: "61+ days late", check: (r: CollectionRow) => r.daysLate > 60 },
    { label: "Due date missing", check: (r: CollectionRow) => !r.due },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {buckets.map((b) => (
          <div key={b.label} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{b.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {money(
                total(
                  rows.filter((r) => !r.issue && b.check(r)),
                  (r) => r.balance,
                ),
              )}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Issued native invoices less recorded payments. Drafts are excluded.
        Conflicting receipts and payment statuses remain in review, outside
        these collection totals.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="grow">
          <span className="sr-only">Search collections</span>
          <input
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            placeholder="Search collections by project or invoice"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Collection status</span>
          <select
            className="rounded-lg border bg-background px-3 py-2 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All open &amp; unresolved</option>
            <option value="overdue">Overdue</option>
            <option value="review">Needs reconciliation</option>
            <option value="undated">Missing due date</option>
          </select>
        </label>
      </div>
      <div className="space-y-3 md:hidden">
        {[...filtered]
          .sort((a, b) => b.daysLate - a.daysLate)
          .map((r) => (
            <article key={r.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{r.projectName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #{r.number} · {r.title}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  {money(r.balance)}
                </span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {r.due ? `Due ${r.due}` : "Due date missing"}
                {r.daysLate > 0 ? ` · ${r.daysLate} days late` : ""}
              </p>
              {r.issue && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {r.issue}
                </p>
              )}
              <Link
                scroll={false}
                href={`/finances?section=collections&collection=${r.projectId}`}
                className="mt-3 block rounded-lg border px-3 py-2 text-center text-sm"
              >
                Review existing invoice
              </Link>
            </article>
          ))}
      </div>
      <div className="hidden max-h-[32rem] overflow-auto rounded-xl border md:block">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {["Project / invoice", "Due", "Balance", "Next step"].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...filtered]
              .sort(
                (a, b) =>
                  b.daysLate - a.daysLate ||
                  a.projectName.localeCompare(b.projectName),
              )
              .map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.projectName}</p>
                    <p className="text-xs text-muted-foreground">
                      #{r.number} · {r.title}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {r.due ?? "Date needed"}
                    {r.daysLate > 0 && (
                      <p className="text-red-600">{r.daysLate} days late</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">
                    {money(r.balance)}
                    {r.issue && (
                      <p className="text-xs font-normal text-amber-700">
                        Unverified
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      scroll={false}
                      href={`/finances?section=collections&collection=${r.projectId}`}
                      className="text-sm underline underline-offset-4"
                    >
                      Review existing invoice
                    </Link>
                    {r.issue && (
                      <p className="mt-1 max-w-60 text-xs text-amber-700 dark:text-amber-400">
                        {r.issue}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            {!filtered.length && (
              <tr>
                <td
                  colSpan={4}
                  className="p-6 text-center text-muted-foreground"
                >
                  No collections match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
