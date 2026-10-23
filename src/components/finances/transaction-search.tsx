"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { TransactionSearchResult } from "@/lib/finance/transaction-search";

type SearchResponse = {
  results: TransactionSearchResult[];
  total: number;
  page: number;
  pageSize: number;
};

const labels = {
  expense: "Expense / bill",
  income: "Payment received",
  client_invoice: "Client invoice",
  bank: "Bank transaction",
};
const control = "min-h-11 rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dateLabel = (date: string | null) => date
  ? new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "Date needed";

function TransactionLink({ row, className, children }: { row: TransactionSearchResult; className: string; children: ReactNode }) {
  if (row.kind === "client_invoice") {
    return <a href={row.href!} target="_blank" rel="noopener noreferrer" className={className}>{children}<span className="sr-only"> (PDF, opens in a new tab)</span></a>;
  }
  return <Link href={row.href!} scroll={false} className={className}>{children}</Link>;
}

export function TransactionSearch() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => request.current?.abort(), []);

  function clear() {
    request.current?.abort();
    request.current = null;
    setQuery("");
    setSearched("");
    setData(null);
    setError(null);
    setLoading(false);
    input.current?.focus();
  }

  async function search(value: string, page = 1) {
    const term = value.trim();
    if (!term) { clear(); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSearched(term);
    setLoading(true);
    setError(null);
    setData(null);
    let failure = "Transactions couldn’t load. Please try again.";
    try {
      const params = new URLSearchParams({ q: term, page: String(page) });
      const response = await fetch(`/api/finances/search?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        failure = response.status === 401
          ? "Your session expired. Sign in again to search transactions."
          : response.status === 403
            ? "Your account does not have access to company financials."
            : failure;
        throw new Error(failure);
      }
      const result: SearchResponse = await response.json();
      if (!controller.signal.aborted) setData(result);
    } catch {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query);
  }

  return (
    <section aria-label="Transaction search" className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <form role="search" aria-label="Search financial transactions" onSubmit={submit}>
        <label htmlFor="finance-transaction-search" className="text-sm font-semibold">Search all transactions</label>
        <div className="mt-2 flex min-w-0 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <input
              ref={input}
              id="finance-transaction-search"
              name="q"
              type="search"
              autoComplete="off"
              maxLength={200}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Name, job, invoice, amount…"
              aria-describedby="finance-search-help"
              className={`${control} w-full min-w-0 pl-9 text-base sm:text-sm`}
            />
          </div>
          <button type="submit" disabled={!query.trim() || loading} className={`${control} shrink-0 border-amber-500/40 bg-amber-500/10 font-medium`}>Search</button>
        </div>
        <p id="finance-search-help" className="mt-2 text-xs leading-relaxed text-muted-foreground">
          All dates and jobs · bills, received payments, client invoices and bank transactions. Search by name, description, reference, date or amount.
        </p>
      </form>

      {(loading || error || data) && (
        <div className="mt-4 min-w-0 border-t pt-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <p role="status" className="min-w-0 break-words text-sm" aria-live="polite">
              {loading ? "Searching all dates…" : data
                ? `${data.total.toLocaleString()} ${data.total === 1 ? "match" : "matches"} for “${searched}”`
                : "Search unavailable"}
            </p>
            <button type="button" onClick={clear} className="flex min-h-9 shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label="Clear transaction search">
              <X aria-hidden="true" className="h-4 w-4" /> Clear
            </button>
          </div>
          {error && <div role="alert" className="rounded-lg border border-red-500/30 p-4 text-sm">
            <p>{error}</p>
            <button type="button" onClick={() => void search(searched)} className={`${control} mt-3`}>Try again</button>
          </div>}
          {data && <>
            {data.total === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm font-medium">No matching transactions</p>
                <p className="mt-1 text-xs text-muted-foreground">Try a vendor or customer name, job number, invoice reference, date or amount.</p>
              </div>
            ) : <>
              <p className="mb-3 text-xs text-muted-foreground">Newest first. Bank entries, invoices and payments are listed separately; they may describe the same activity.</p>
              <ul aria-label="Matching transactions" className="divide-y rounded-lg border">
                {data.results.map(row => <li key={row.id} className="min-w-0 p-3 sm:p-4">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 flex-1 basis-40">
                      {row.href
                        ? <TransactionLink row={row} className="break-words text-sm font-semibold hover:underline">{row.name}</TransactionLink>
                        : <p className="break-words text-sm font-semibold">{row.name}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">{dateLabel(row.date)} · {labels[row.kind]}</p>
                    </div>
                    <p className="max-w-full break-words text-sm font-semibold tabular-nums">{row.amount === null ? "Amount needs review" : money(row.amount)}</p>
                  </div>
                  {row.projects.length > 0 && <p className="mt-2 break-words text-xs text-muted-foreground">{row.projects.map(project => project.label).join(" · ")}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded bg-muted px-2 py-0.5">{row.status}</span>
                    {row.reference && <span className="max-w-full break-words rounded bg-muted px-2 py-0.5">Ref: {row.reference}</span>}
                    {row.review && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">Needs review</span>}
                  </div>
                  {row.description && <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{row.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 break-words text-muted-foreground">{row.source.replaceAll("_", " ")}{row.method ? ` · ${row.method.replaceAll("_", " ")}` : ""}</span>
                    {row.href && <TransactionLink row={row} className="inline-flex min-h-9 items-center font-medium text-amber-700 hover:underline dark:text-amber-400">Open {row.kind === "client_invoice" ? "invoice" : "transaction"} →</TransactionLink>}
                  </div>
                </li>)}
              </ul>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{((data.page - 1) * data.pageSize + 1).toLocaleString()}–{Math.min(data.page * data.pageSize, data.total).toLocaleString()} of {data.total.toLocaleString()}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={data.page <= 1} onClick={() => void search(searched, data.page - 1)} className={control}>Previous</button>
                  <button type="button" disabled={data.page * data.pageSize >= data.total} onClick={() => void search(searched, data.page + 1)} className={control}>Next</button>
                </div>
              </div>
            </>}
          </>}
        </div>
      )}
    </section>
  );
}
