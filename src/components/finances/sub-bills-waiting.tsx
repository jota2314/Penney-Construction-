"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BillDrop } from "@/components/invoices/bill-drop";
import { PCC_TOKENS } from "@/components/field-feed/tokens";
import { formatMoney } from "@/lib/money";
import {
  listSubBillsWaiting,
  returnSubBill,
  takeSubBill,
  type SubBillWaitingRow,
} from "@/lib/actions/sub-bills";

/**
 * Weekly Close "Sub bills waiting": invoices subs sent from the portal that
 * aren't filed yet (plan §4.7).
 *
 * Filing is the existing Command Center bill workflow, reused as is
 * (AGENTS.md): File it mounts <BillDrop resumePath={path}> on the file in
 * the reviewer's Saved uploads, and BillDrop does the scan, job, line, split,
 * duplicate review and commit. A bill in someone else's folder needs Take it
 * first (it moves the file into yours), because the bill flow only opens your
 * own uploads. Send back returns it to the sub with a reason.
 *
 * Renders nothing when nothing is waiting.
 */

const money = (n: number | null | undefined) => formatMoney(n, { cents: "always", empty: "no total" });
const weekLabel = (day: string) =>
  `Week of ${new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
const control = "rounded-lg border bg-background px-3 py-1.5 text-[12.5px] font-medium min-h-9 disabled:opacity-50";

/** "INV0325 · $600.00", from his own numbers when he fixed the read. */
function readLine(r: SubBillWaitingRow): string {
  const number = r.statedNumber ?? r.aiRead?.invoice_number ?? null;
  const amount = r.statedAmount ?? r.aiRead?.amount ?? null;
  const fixed = r.statedNumber != null || r.statedAmount != null;
  const parts = [number ? `Inv ${number}` : "No invoice #", money(amount)];
  return `${parts.join(" · ")}${fixed ? " (sub's numbers)" : r.aiRead ? "" : " (not read)"}`;
}

const fetchWaiting = () =>
  listSubBillsWaiting().catch(() => ({ error: "Could not load sub bills. Please retry." }) as const);

export function SubBillsWaiting() {
  const router = useRouter();
  const [rows, setRows] = useState<SubBillWaitingRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // One BillDrop at a time, always in the same place under the list, so it keeps
  // its "filed" summary after the row it came from drops off the list.
  const [filing, setFiling] = useState<{ id: string; path: string; label: string } | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  const apply = useCallback((res: Awaited<ReturnType<typeof fetchWaiting>>) => {
    if ("error" in res) {
      setLoadError(res.error);
      setRows((prev) => prev ?? []);
      return;
    }
    setLoadError(null);
    setRows(res.rows);
  }, []);
  const load = () => fetchWaiting().then(apply);

  useEffect(() => {
    let live = true;
    fetchWaiting().then((res) => {
      if (live) apply(res);
    });
    return () => {
      live = false;
    };
  }, [apply]);

  async function take(r: SubBillWaitingRow) {
    setBusy(r.id);
    setRowError(null);
    const res = await takeSubBill(r.id).catch(() => ({ error: "Could not take it. Please retry." }));
    setBusy(null);
    if ("error" in res) {
      setRowError({ id: r.id, text: res.error });
      return;
    }
    setFiling({ id: r.id, path: res.path, label: `${r.subName} · ${r.projectName ?? "no job"}` });
    void load();
  }

  async function sendBack(r: SubBillWaitingRow) {
    setBusy(r.id);
    setRowError(null);
    const res = await returnSubBill(r.id, reason).catch(() => ({ error: "Could not send it back. Please retry." }));
    setBusy(null);
    if ("error" in res) {
      setRowError({ id: r.id, text: res.error });
      return;
    }
    setReturning(null);
    setReason("");
    void load();
  }

  if (rows === null) return null;
  if (!rows.length && !loadError && !filing) return null;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Sub bills waiting</h2>
        <span className="text-[12px] text-muted-foreground">
          {rows.length} sent from the sub portal, not filed yet
        </span>
      </div>
      {loadError && (
        <div role="alert" className="px-4 py-3 text-[12.5px] text-amber-600 dark:text-amber-400 flex items-center gap-3">
          {loadError}
          <button className={control} onClick={() => void load()}>Retry</button>
        </div>
      )}
      <div className="divide-y">
        {rows.map((r) => {
          const isFiling = filing?.id === r.id;
          const isReturning = returning === r.id;
          return (
            <div key={r.id} className="px-4 py-3 space-y-2">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="text-[13.5px] font-semibold truncate">{r.subName}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {r.projectName ?? "No job picked"} · {readLine(r)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {weekLabel(r.receivedWeek)}
                    {r.aiRead?.project_hint && r.aiRead.project_hint !== r.projectName
                      ? ` · invoice mentions ${r.aiRead.project_hint}`
                      : ""}
                    {" · "}
                    {r.mine ? "In your Saved uploads" : `With ${r.reviewerName?.split(" ")[0] ?? "another reviewer"}`}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.fileUrl && (
                    <a href={r.fileUrl} target="_blank" rel="noreferrer" className={control}>
                      View file
                    </a>
                  )}
                  {r.mine ? (
                    <button
                      className={`${control} border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400`}
                      onClick={() =>
                        setFiling(isFiling ? null : { id: r.id, path: r.storagePath, label: `${r.subName} · ${r.projectName ?? "no job"}` })
                      }
                      disabled={busy === r.id}
                    >
                      {isFiling ? "Close" : "File it"}
                    </button>
                  ) : (
                    <button
                      className={`${control} border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400`}
                      onClick={() => void take(r)}
                      disabled={busy === r.id}
                    >
                      {busy === r.id ? "Taking…" : "Take it"}
                    </button>
                  )}
                  <button
                    className={control}
                    onClick={() => {
                      setReturning(isReturning ? null : r.id);
                      setReason("");
                      setRowError(null);
                    }}
                    disabled={busy === r.id}
                  >
                    {isReturning ? "Cancel" : "Send back"}
                  </button>
                </div>
              </div>

              {isReturning && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="flex-1 min-w-[220px] rounded-lg border bg-background px-3 py-2 text-sm"
                    placeholder="Why, e.g. no job address on the invoice"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button className={control} onClick={() => void sendBack(r)} disabled={busy === r.id || reason.trim().length < 3}>
                    {busy === r.id ? "Sending…" : "Send back to the sub"}
                  </button>
                </div>
              )}

              {rowError?.id === r.id && (
                <p role="alert" className="text-[12px] text-amber-600 dark:text-amber-400">{rowError.text}</p>
              )}
            </div>
          );
        })}
      </div>
      {filing && (
        <section style={PCC_TOKENS} className="m-3 rounded-xl border bg-[#16140F] p-4 text-[#F5F1EA]" aria-label="File this sub bill">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="min-w-0 truncate text-sm font-medium">Filing {filing.label}</h3>
            <button className="text-sm text-[#B5AC9C] min-h-9 px-2" onClick={() => setFiling(null)}>Close</button>
          </div>
          <BillDrop
            key={filing.path}
            resumePath={filing.path}
            onFiled={() => {
              void load();
              router.refresh();
            }}
          />
        </section>
      )}
    </div>
  );
}
