"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardList, FilePlus2, History, Loader2 } from "lucide-react";
import { PRICE_SOURCE_LABEL, STAGE_LABEL, type PriceSource, type Stage } from "@/lib/selections/ladder";
import type { AllowanceLine, SelectionItem } from "@/lib/selections/service";
import type { PendingSelectionSuggestion } from "@/lib/selections/suggestions";
import { SelectionSuggestions } from "./selection-suggestions";

// The job's selections log, as the team sees it: every product with its step
// on the ladder, its price and where that price came from, and the allowance
// check. Updates come from Claude sessions through the Penney MCP (the
// /selections skill) and from the job's email as suggestions a person
// approves here; this panel reads, reviews those, and drafts sheet revisions
// for the portal (drafts stay hidden until someone publishes them below).

interface LogData {
  items: SelectionItem[];
  counts: Record<string, number>;
  allowances: { estimate_id: string | null; lines: AllowanceLine[] };
  recent_changes: { item_id: string; at: string; actor: string; action: string; changes: Record<string, [unknown, unknown]>; source: string | null; note: string | null }[];
  suggestions: PendingSelectionSuggestion[];
}

const STAGE_COLOR: Record<Stage, string> = {
  proposed: "bg-zinc-500/15 text-zinc-400",
  selected: "bg-emerald-500/15 text-emerald-500",
  priced: "bg-sky-500/15 text-sky-500",
  ordered: "bg-amber-500/15 text-amber-500",
  delivered: "bg-violet-500/15 text-violet-400",
  installed: "bg-emerald-600/20 text-emerald-400",
  reused: "bg-blue-500/15 text-blue-400",
  owner_supplied: "bg-teal-500/15 text-teal-400",
  removed: "bg-red-500/10 text-red-400",
};
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

export function SelectionsLogPanel({ projectId, onDrafted }: { projectId: string; onDrafted?: () => void }) {
  const [data, setData] = useState<LogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchLog = useCallback(async (): Promise<LogData> => {
    const res = await fetch("/api/selections", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", project_id: projectId }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Could not load the selections log.");
    return d as LogData;
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    fetchLog().then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(String(e.message || e)); });
    return () => { alive = false; };
  }, [fetchLog]);

  const reload = useCallback(() => {
    fetchLog().then(setData).catch((e) => setError(String(e.message || e)));
  }, [fetchLog]);

  async function draftSheet() {
    setDrafting(true);
    setMessage(null);
    const res = await fetch("/api/selections", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "draft_sheet", project_id: projectId }),
    });
    const d = await res.json();
    setDrafting(false);
    setConfirming(false);
    if (!res.ok) { setMessage(d.error || "Could not draft the sheet."); return; }
    setMessage(`Drafted ${d.revision} with ${d.items} items. It is hidden until you publish it below.`);
    onDrafted?.();
  }

  if (error) return <section className="rounded-lg border p-3 text-sm text-red-400">{error}</section>;
  if (!data) return <section className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading selections log…</section>;

  const names = new Map(data.items.map((i) => [i.id, i.name]));

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-semibold">Selections log ({data.items.length})</h4>
        </div>
        {data.items.length > 0 && (
          confirming ? (
            <span className="flex gap-1.5">
              <Button size="sm" disabled={drafting} onClick={draftSheet} className="gap-1.5">
                {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />} Yes, draft it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            </span>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfirming(true)}><FilePlus2 className="h-3.5 w-3.5" /> Draft sheet revision</Button>
          )
        )}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        One record per product. Updated through Claude (the /selections skill and Penney MCP) and approved email suggestions; every change keeps who, when and the source.
      </p>
      {message && <p className="mb-2 rounded bg-muted/50 p-2 text-xs">{message}</p>}
      <SelectionSuggestions suggestions={data.suggestions ?? []} onChanged={reload} />

      {data.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No items yet. Ask Claude to load this job&apos;s selections.</p>
      ) : (
        <ul className="divide-y">
          {data.items.map((i) => (
            <li key={i.id} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[i.brand_model, i.quantity_note || (i.quantity != null ? `${i.quantity} ${i.unit ?? ""}` : null)].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_COLOR[i.stage]}`}>{STAGE_LABEL[i.stage]}</span>
                  {i.price_pending && <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-400">Price pending</span>}
                </span>
              </div>
              <p className="mt-0.5 text-xs">
                {i.ext_price != null ? (
                  <><span className="font-semibold">{usd(i.ext_price)}</span>{" "}
                    <span className="text-muted-foreground">· {i.price_source ? PRICE_SOURCE_LABEL[i.price_source as PriceSource] : ""} {i.price_ref} {day(i.price_date)}</span></>
                ) : <span className="text-muted-foreground">No price yet</span>}
                {i.allowance_group && <span className="text-muted-foreground"> · {i.allowance_group}</span>}
              </p>
              {i.selected_source && <p className="text-[11px] text-muted-foreground">Picked: {i.selected_source}</p>}
              {i.order_ref && <p className="text-[11px] text-muted-foreground">Order: {i.vendor ? `${i.vendor} ` : ""}{i.order_ref}</p>}
            </li>
          ))}
        </ul>
      )}

      {data.allowances.lines.length > 0 && (
        <div className="mt-3 rounded-md bg-muted/40 p-2.5">
          <p className="mb-1 text-xs font-semibold">Allowance check (product + 6.25% tax + the line&apos;s markup)</p>
          <ul className="space-y-1">
            {data.allowances.lines.filter((l) => l.items > 0).map((l) => (
              <li key={l.line_id} className="text-xs">
                <span className="font-medium">{l.name}</span>: {usd(l.used)} of {usd(l.allowance)}
                <span className={l.remaining < 0 ? " text-red-400" : " text-muted-foreground"}> · {l.remaining < 0 ? `${usd(-l.remaining)} over` : `${usd(l.remaining)} left`}</span>
                {l.pending_items.length > 0 && <span className="text-orange-400"> · pending: {l.pending_items.join(", ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.recent_changes.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <History className="h-3.5 w-3.5" /> {showHistory ? "Hide" : "Show"} recent changes
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-1">
              {data.recent_changes.map((e, idx) => (
                <li key={idx} className="text-[11px] text-muted-foreground">
                  {day(e.at)} · <span className="text-foreground">{e.actor}</span> · {names.get(e.item_id) ?? "item"}: {Object.keys(e.changes).join(", ") || e.action}
                  {e.source ? ` · source: ${e.source}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
