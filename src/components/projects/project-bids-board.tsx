"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Send, Trophy, DollarSign, AlertCircle, CheckCircle2, Upload, Clock, FileText, ChevronRight,
} from "lucide-react";
import { CreateBidDialog } from "@/components/bids/create-bid-dialog";
import { updateSubBidStatus } from "@/lib/actions/bids";
import { cn } from "@/lib/utils";

const fmt = (val: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    .format(Number(val) || 0);

const daysAgo = (iso?: string | null) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
};

interface Sub { id: string; company_name: string; contact_name: string | null; email: string | null; phone: string | null }
interface LineItem {
  id: string;
  description: string;
  scope_text: string | null;
  trade: string | null;
  quantity: number | null;
  unit: string | null;
  total_cost: number | null;
  total_price: number | null;
  needs_sub_quote: boolean | null;
  awarded_bid_id: string | null;
  awarded_subcontractor_id: string | null;
  awarded_cost: number | null;
  awarded_at: string | null;
  awarded_sub?: { id: string; company_name: string } | null;
}
interface Bid {
  id: string;
  bid_package_id: string;
  estimate_line_item_id: string | null;
  subcontractor_id: string;
  amount: number | null;
  status: string;
  is_selected: boolean;
  sent_at: string | null;
  submitted_at: string | null;
  resent_count: number | null;
  gmail_message_id: string | null;
  subcontractors: Sub | null;
  bid_packages: { id: string; project_id: string; trade: string; due_date: string | null; status: string } | null;
}
interface Quote {
  id: string;
  estimate_line_item_id: string | null;
  subcontractor_id: string | null;
  subcontractor_name: string | null;
  trade: string | null;
  amount: number | null;
  status: string;
  scope_description: string | null;
  document_type: string | null;
  attachment_storage_path: string | null;
  sent_at: string | null;
  received_at: string | null;
}

export function ProjectBidsBoard({
  project, estimate, lineItems, bids, quotes,
}: {
  project: { id: string; name: string; address: string | null; city: string | null; state: string | null; scope_of_work: string | null };
  estimate: { id: string; name: string | null; version: number } | null;
  lineItems: LineItem[];
  bids: Bid[];
  quotes: Quote[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForLine, setCreateForLine] = useState<LineItem | null>(null);
  const [recordQuote, setRecordQuote] = useState<{ bidId: string; amount: string } | null>(null);

  // Group line items by trade
  const tradeGroups = useMemo(() => {
    const groups = new Map<string, LineItem[]>();
    for (const li of lineItems) {
      const key = li.trade || "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(li);
    }
    // Sort groups by name; needs-quote trades surface at top
    return Array.from(groups.entries()).sort((a, b) => {
      const aNeeds = a[1].some((l) => l.needs_sub_quote && !l.awarded_bid_id);
      const bNeeds = b[1].some((l) => l.needs_sub_quote && !l.awarded_bid_id);
      if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
      return a[0].localeCompare(b[0]);
    });
  }, [lineItems]);

  // Bids and quotes indexed by line item
  const bidsByLine = useMemo(() => {
    const m = new Map<string, Bid[]>();
    for (const b of bids) {
      if (!b.estimate_line_item_id) continue;
      if (!m.has(b.estimate_line_item_id)) m.set(b.estimate_line_item_id, []);
      m.get(b.estimate_line_item_id)!.push(b);
    }
    return m;
  }, [bids]);

  const quotesByLine = useMemo(() => {
    const m = new Map<string, Quote[]>();
    for (const q of quotes) {
      if (!q.estimate_line_item_id) continue;
      if (!m.has(q.estimate_line_item_id)) m.set(q.estimate_line_item_id, []);
      m.get(q.estimate_line_item_id)!.push(q);
    }
    return m;
  }, [quotes]);

  // Orphans: bids/quotes without a line item — these existed before the spine was wired
  const orphanBids = bids.filter((b) => !b.estimate_line_item_id);
  const orphanQuotes = quotes.filter((q) => !q.estimate_line_item_id);

  // Top-line stats
  const totals = useMemo(() => {
    let estimated = 0, awarded = 0, awardedCount = 0, waiting = 0;
    for (const li of lineItems) {
      estimated += Number(li.total_cost) || 0;
      if (li.awarded_cost) { awarded += Number(li.awarded_cost) || 0; awardedCount++; }
    }
    for (const b of bids) {
      if (b.status === "invited") waiting++;
    }
    return { estimated, awarded, awardedCount, waiting };
  }, [lineItems, bids]);

  async function handleAward(bidId: string, bidPackageId: string) {
    await fetch("/api/award-bid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId, bidPackageId }),
    });
    router.refresh();
  }

  async function handleRecordQuote() {
    if (!recordQuote) return;
    await updateSubBidStatus(recordQuote.bidId, "submitted", parseFloat(recordQuote.amount) || undefined);
    setRecordQuote(null);
    router.refresh();
  }

  if (!estimate) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <FileText className="h-8 w-8 mx-auto mb-2 text-amber-500" />
        <p className="text-sm font-medium">No estimate yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Bids hang off estimate line items. Create an estimate first.
        </p>
        <Button asChild className="mt-3 bg-amber-600 hover:bg-amber-700" size="sm">
          <a href={`/projects/${project.id}/estimates`}>Create Estimate</a>
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Estimated" value={fmt(totals.estimated)} />
        <Stat label="Awarded" value={fmt(totals.awarded)} sub={`${totals.awardedCount} of ${lineItems.length}`} color="text-green-400" />
        <Stat label="Variance" value={fmt(totals.awarded - lineItems.filter((l) => l.awarded_cost).reduce((s, l) => s + (Number(l.total_cost) || 0), 0))} color={totals.awarded > 0 && totals.awarded < lineItems.filter((l) => l.awarded_cost).reduce((s, l) => s + (Number(l.total_cost) || 0), 0) ? "text-green-400" : "text-amber-400"} />
        <Stat label="Awaiting" value={String(totals.waiting)} sub="bids out" color={totals.waiting > 0 ? "text-amber-400" : "text-muted-foreground"} />
      </div>

      {/* Trade groups */}
      {tradeGroups.length === 0 && (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No line items in this estimate yet.
        </div>
      )}

      {tradeGroups.map(([trade, lines]) => (
        <div key={trade} className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider">{trade}</h3>
            <span className="text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="space-y-2">
            {lines.map((li) => {
              const lineBids = bidsByLine.get(li.id) || [];
              const lineQuotes = quotesByLine.get(li.id) || [];
              const awarded = li.awarded_bid_id != null;
              const variance = awarded ? (Number(li.awarded_cost) || 0) - (Number(li.total_cost) || 0) : null;

              return (
                <div key={li.id} className={cn(
                  "rounded-lg border bg-card p-3",
                  awarded && "border-green-500/30 bg-green-500/5",
                  li.needs_sub_quote && !awarded && lineBids.length === 0 && "border-amber-500/30",
                )}>
                  {/* Line item header */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{li.description}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Estimated <span className="font-medium tabular-nums">{fmt(li.total_cost)}</span>
                        {awarded && (
                          <>
                            {" · "}Awarded <span className="font-medium tabular-nums text-green-400">{fmt(li.awarded_cost)}</span>
                            {" to "}<span className="font-medium">{li.awarded_sub?.company_name}</span>
                            {variance !== null && variance !== 0 && (
                              <span className={cn("ml-1", variance < 0 ? "text-green-400" : "text-amber-400")}>
                                ({variance < 0 ? "" : "+"}{fmt(variance)})
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {!awarded && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] shrink-0"
                        onClick={() => { setCreateForLine(li); setCreateOpen(true); }}
                      >
                        <Send className="h-3 w-3 mr-1" />
                        Send RFQ
                      </Button>
                    )}
                  </div>

                  {/* Bids and quotes for this line */}
                  {(lineBids.length > 0 || lineQuotes.length > 0) && (
                    <div className="space-y-1 mt-2 border-t pt-2">
                      {lineBids.map((bid) => (
                        <BidRow
                          key={bid.id}
                          bid={bid}
                          awarded={awarded}
                          onGotQuote={() => setRecordQuote({ bidId: bid.id, amount: "" })}
                          onAward={() => handleAward(bid.id, bid.bid_package_id)}
                        />
                      ))}
                      {lineQuotes.map((q) => (
                        <QuoteRow key={q.id} quote={q} />
                      ))}
                    </div>
                  )}

                  {!awarded && lineBids.length === 0 && lineQuotes.length === 0 && (
                    <div className="text-[11px] text-muted-foreground italic">
                      No bids out yet
                      {li.needs_sub_quote && <span className="text-amber-400"> · needs sub quote</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Orphans — bids/quotes from before the spine was wired */}
      {(orphanBids.length > 0 || orphanQuotes.length > 0) && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold">Unlinked bids & quotes</h3>
            <span className="text-xs text-muted-foreground">
              ({orphanBids.length + orphanQuotes.length} not tied to an estimate line)
            </span>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
            {orphanBids.map((b) => (
              <div key={b.id} className="text-xs flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{b.subcontractors?.company_name}</span>
                <span className="text-muted-foreground">— {b.bid_packages?.trade}</span>
                {b.amount && <span className="ml-auto tabular-nums font-medium">{fmt(b.amount)}</span>}
              </div>
            ))}
            {orphanQuotes.map((q) => (
              <div key={q.id} className="text-xs flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{q.subcontractor_name}</span>
                <span className="text-muted-foreground">— {q.trade || "no trade"}</span>
                {q.amount && <span className="ml-auto tabular-nums font-medium">{fmt(q.amount)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Send Bid dialog */}
      <CreateBidDialog
        open={createOpen}
        onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateForLine(null); }}
        defaultProjectId={project.id}
        defaultTrade={createForLine?.trade || undefined}
        defaultScope={createForLine?.scope_text || createForLine?.description || project.scope_of_work || undefined}
        defaultLineItemId={createForLine?.id}
        onSuccess={() => { setCreateOpen(false); setCreateForLine(null); router.refresh(); }}
      />

      {/* Got Quote dialog — record an inbound bid amount */}
      <Dialog open={!!recordQuote} onOpenChange={(open) => !open && setRecordQuote(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record quote amount</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={recordQuote?.amount ?? ""}
                onChange={(e) => setRecordQuote((rq) => rq ? { ...rq, amount: e.target.value } : rq)}
                placeholder="e.g. 9200"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordQuote(null)}>Cancel</Button>
            <Button onClick={handleRecordQuote}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold tabular-nums", color)}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function BidRow({ bid, awarded, onGotQuote, onAward }: {
  bid: Bid;
  awarded: boolean;
  onGotQuote: () => void;
  onAward: () => void;
}) {
  const sub = bid.subcontractors;
  const days = daysAgo(bid.sent_at);
  const isOverdue = bid.status === "invited" && days !== null && days >= 5;

  return (
    <div className={cn(
      "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs",
      bid.is_selected && "bg-green-500/10",
      isOverdue && "bg-amber-500/5"
    )}>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {sub?.company_name}
          {bid.is_selected && <Trophy className="inline h-3 w-3 ml-1 text-green-400" />}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {bid.status === "invited" && (
            <span>Waiting{days !== null && ` ${days}d`}{isOverdue && " · overdue"}</span>
          )}
          {bid.status === "submitted" && <span className="text-blue-400">Quote received</span>}
          {bid.status === "rejected" && <span>Not selected</span>}
          {bid.status === "declined" && <span className="text-red-400">Declined</span>}
        </div>
      </div>
      <div className="text-right shrink-0 min-w-[60px]">
        {bid.amount ? (
          <span className="font-semibold tabular-nums">{fmt(bid.amount)}</span>
        ) : (
          <Clock className="h-3 w-3 text-muted-foreground inline" />
        )}
      </div>
      <div className="flex gap-1 shrink-0">
        {bid.status === "invited" && (
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={onGotQuote}>
            <DollarSign className="h-3 w-3 mr-1" />
            Got it
          </Button>
        )}
        {bid.status === "submitted" && !bid.is_selected && !awarded && (
          <Button size="sm" className="h-6 text-[10px] px-2 bg-green-600 hover:bg-green-700" onClick={onAward}>
            <Trophy className="h-3 w-3 mr-1" />
            Award
          </Button>
        )}
      </div>
    </div>
  );
}

function QuoteRow({ quote }: { quote: Quote }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-blue-500/5">
      <Upload className="h-3 w-3 text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{quote.subcontractor_name}</div>
        <div className="text-[10px] text-muted-foreground capitalize">{quote.document_type || "quote"}</div>
      </div>
      {quote.amount && <span className="font-semibold tabular-nums shrink-0">{fmt(quote.amount)}</span>}
      <Badge variant="outline" className="text-[9px] shrink-0 capitalize">{quote.status}</Badge>
    </div>
  );
}
