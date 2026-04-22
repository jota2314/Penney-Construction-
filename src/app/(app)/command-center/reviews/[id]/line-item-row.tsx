"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Image as ImageIcon, Loader2, MessageSquare, Check, Pencil } from "lucide-react";
import { patchLineItemPrice, patchLineItemScope } from "./actions";

interface StaticLineItem {
  id: string;
  description: string | null;
  proposal_description: string | null;
  trade: string | null;
  quantity: number | string | null;
  unit: string | null;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  total_price: number | string | null;
}

interface Screenshot { path: string; url: string; name: string }
interface Quote { id: string; subcontractor_name: string; amount: number | null; status: string; document_type: string | null; scope_description: string | null }

interface Details {
  screenshots: Screenshot[];
  quotes: Quote[];
  conversationId: string | null;
  conversationTitle: string | null;
}

function n(v: number | string | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v) || 0;
}
function fmt(v: number | string | null | undefined): string {
  return "$" + n(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function LineItemRow({
  item,
  estimateId,
  editable,
}: {
  item: StaticLineItem;
  estimateId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(false);

  const [priceEditing, setPriceEditing] = useState(false);
  const [priceDraft, setPriceDraft] = useState(String(n(item.total_price)));
  const [scopeEditing, setScopeEditing] = useState(false);
  const [scopeDraft, setScopeDraft] = useState(item.proposal_description || "");
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !details && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/estimate-line-items/${item.id}`);
        if (res.ok) {
          const data = await res.json();
          setDetails({
            screenshots: data.screenshots || [],
            quotes: data.quotes || [],
            conversationId: data.conversationId || null,
            conversationTitle: data.conversationTitle || null,
          });
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const savePrice = () => {
    const num = Number(priceDraft.replace(/[$,\s]/g, ""));
    if (!isFinite(num) || num < 0) {
      setSaveError("Enter a valid number");
      return;
    }
    setSaveError(null);
    startSaving(async () => {
      const res = await patchLineItemPrice(estimateId, item.id, num);
      if (res.error) {
        setSaveError(res.error);
      } else {
        setPriceEditing(false);
        router.refresh();
      }
    });
  };

  const saveScope = () => {
    setSaveError(null);
    startSaving(async () => {
      const res = await patchLineItemScope(estimateId, item.id, scopeDraft);
      if (res.error) {
        setSaveError(res.error);
      } else {
        setScopeEditing(false);
        router.refresh();
      }
    });
  };

  return (
    <div>
      <div className="w-full px-5 py-3 flex items-start justify-between gap-4 hover:bg-muted/40 transition-colors">
        <button
          onClick={toggle}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline gap-2 flex-wrap">
            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
            <span className="text-[14px] font-semibold">{item.description || item.trade || "Untitled"}</span>
            {item.trade && item.trade !== item.description && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium capitalize">
                {item.trade}
              </span>
            )}
          </div>
          {item.proposal_description && !open && (
            <div className="text-[12px] text-muted-foreground mt-1 line-clamp-2 ml-6">
              {item.proposal_description}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums ml-6">
            {n(item.quantity)} {item.unit || "LS"} × {fmt(item.unit_cost)}/{item.unit || "LS"} cost
          </div>
        </button>
        <div className="text-right shrink-0">
          {priceEditing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-sm">$</span>
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePrice();
                  if (e.key === "Escape") { setPriceEditing(false); setPriceDraft(String(n(item.total_price))); }
                }}
                className="w-24 text-right text-[14px] font-semibold tabular-nums bg-background border border-amber-500/50 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                disabled={saving}
              />
              <button
                onClick={savePrice}
                disabled={saving}
                className="h-6 w-6 flex items-center justify-center rounded bg-amber-500 hover:bg-amber-600 text-white"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              </button>
            </div>
          ) : (
            <button
              onClick={() => editable && setPriceEditing(true)}
              disabled={!editable}
              className={`text-[14px] font-semibold tabular-nums ${editable ? "hover:bg-amber-500/10 rounded px-1.5 -mx-1.5 cursor-pointer" : ""}`}
              title={editable ? "Click to edit price" : undefined}
            >
              {fmt(item.total_price)}
              {editable && <Pencil className="inline-block h-2.5 w-2.5 ml-1 opacity-40" />}
            </button>
          )}
          <div className="text-[11px] text-muted-foreground tabular-nums">cost {fmt(item.total_cost)}</div>
        </div>
      </div>

      {open && (
        <div className="px-5 pb-4 ml-6 space-y-3">
          <div className="bg-muted/30 rounded-md p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Full scope</div>
              {editable && !scopeEditing && (
                <button
                  onClick={() => { setScopeEditing(true); setScopeDraft(item.proposal_description || ""); }}
                  className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                >
                  <Pencil className="h-2.5 w-2.5" /> Edit
                </button>
              )}
            </div>
            {scopeEditing ? (
              <>
                <textarea
                  value={scopeDraft}
                  onChange={(e) => setScopeDraft(e.target.value)}
                  className="w-full min-h-[120px] text-[12.5px] leading-relaxed bg-background border border-amber-500/50 rounded p-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  disabled={saving}
                  placeholder="Scope that will appear on the proposal for this line…"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={saveScope}
                    disabled={saving}
                    className="text-[11px] px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => { setScopeEditing(false); setScopeDraft(item.proposal_description || ""); }}
                    disabled={saving}
                    className="text-[11px] px-2.5 py-1 rounded bg-muted hover:bg-muted/70 font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="text-[12.5px] whitespace-pre-wrap leading-relaxed">
                {item.proposal_description || <span className="italic text-muted-foreground">No scope text yet.</span>}
              </div>
            )}
          </div>

          {saveError && <div className="text-[11px] text-red-500">{saveError}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading screenshots and quotes...
            </div>
          )}

          {!loading && details && (
            <>
              {details.screenshots.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    Screenshots ({details.screenshots.length})
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {details.screenshots.map(s => (
                      <a
                        key={s.path}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        title={s.name}
                        className="shrink-0 block"
                      >
                        <img
                          src={s.url}
                          alt={s.name}
                          className="h-24 w-24 object-cover rounded-md border border-border hover:border-amber-500/50 transition-colors"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {details.quotes.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                    Sub quotes ({details.quotes.length})
                  </div>
                  <div className="space-y-1">
                    {details.quotes.map(q => (
                      <div key={q.id} className="flex items-center justify-between gap-3 bg-muted/40 rounded-md px-3 py-2 text-[12px]">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{q.subcontractor_name}</div>
                          {q.scope_description && (
                            <div className="text-muted-foreground text-[11px] line-clamp-1">{q.scope_description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="tabular-nums font-semibold">
                            {q.amount != null ? fmt(q.amount) : "—"}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                            q.status === "approved" || q.status === "accepted"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : q.status === "declined"
                                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                                : "bg-muted text-muted-foreground"
                          }`}>
                            {q.status.replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {details.conversationId && (
                <Link
                  href={`/projects?chat=${details.conversationId}`}
                  className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400"
                >
                  <MessageSquare className="h-3 w-3" />
                  Open the {details.conversationTitle || "trade"} chat
                </Link>
              )}

              {details.screenshots.length === 0 && details.quotes.length === 0 && (
                <div className="text-[12px] text-muted-foreground italic">
                  No screenshots or sub quotes yet for this line.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
