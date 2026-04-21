"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Image as ImageIcon, Loader2, MessageSquare } from "lucide-react";

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

export function LineItemRow({ item }: { item: StaticLineItem }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full px-5 py-3 flex items-start justify-between gap-4 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="min-w-0 flex-1">
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
        </div>
        <div className="text-right shrink-0">
          <div className="text-[14px] font-semibold tabular-nums">{fmt(item.total_price)}</div>
          <div className="text-[11px] text-muted-foreground tabular-nums">cost {fmt(item.total_cost)}</div>
        </div>
      </button>

      {open && (
        <div className="px-5 pb-4 ml-6 space-y-3">
          {item.proposal_description && (
            <div className="bg-muted/30 rounded-md p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Full scope</div>
              <div className="text-[12.5px] whitespace-pre-wrap leading-relaxed">{item.proposal_description}</div>
            </div>
          )}

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
