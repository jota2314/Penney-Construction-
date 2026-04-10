"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Send, Plus, Clock, CheckCircle2, Trophy, DollarSign,
  AlertCircle, RotateCw, Users, FileText,
} from "lucide-react";
import { CreateBidDialog } from "@/components/bids/create-bid-dialog";
import { updateSubBidStatus } from "@/lib/actions/bids";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const BID_STATUS: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: "Draft", color: "bg-muted text-muted-foreground", icon: FileText },
  sent: { label: "Sent", color: "bg-blue-500/20 text-blue-400", icon: Send },
  receiving: { label: "Receiving", color: "bg-amber-500/20 text-amber-400", icon: AlertCircle },
  awarded: { label: "Awarded", color: "bg-green-500/20 text-green-400", icon: Trophy },
};

const SUB_BID_STATUS: Record<string, { label: string; color: string }> = {
  invited: { label: "Awaiting", color: "text-amber-400" },
  submitted: { label: "Received", color: "text-blue-400" },
  accepted: { label: "Awarded", color: "text-green-400" },
  rejected: { label: "Not Selected", color: "text-muted-foreground" },
  declined: { label: "Declined", color: "text-red-400" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ProjectBidsAndQuotes({ project, quotes, bidPackages, tradesNeedingQuotes }: {
  project: { id: string; name: string; address: string | null; city: string | null; state: string | null; scope_of_work: string | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quotes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bidPackages: any[];
  tradesNeedingQuotes: { trade: string; description: string; estimatedPrice: number }[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [markReceivedId, setMarkReceivedId] = useState<string | null>(null);
  const [receivedAmount, setReceivedAmount] = useState("");

  async function handleMarkReceived() {
    if (!markReceivedId) return;
    await updateSubBidStatus(markReceivedId, "submitted", parseFloat(receivedAmount) || undefined);
    setMarkReceivedId(null);
    setReceivedAmount("");
    router.refresh();
  }

  async function handleAward(bidId: string, bidPackageId: string) {
    await fetch("/api/award-bid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId, bidPackageId }),
    });
    router.refresh();
  }

  // Stats
  const totalQuoted = quotes.reduce((s, q) => s + (Number(q.amount) || 0), 0);
  const activeBids = bidPackages.filter((p) => ["sent", "receiving"].includes(p.status));

  return (
    <>
      {/* Header with Send Bids button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Bids & Quotes</h2>
          <p className="text-sm text-muted-foreground">
            {bidPackages.length} bid package{bidPackages.length !== 1 ? "s" : ""} · {quotes.length} quote{quotes.length !== 1 ? "s" : ""} received
            {totalQuoted > 0 && ` · ${fmt(totalQuoted)} total`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="min-h-[44px] bg-amber-600 hover:bg-amber-700">
          <Send className="mr-2 h-4 w-4" />
          Send Bid Package
        </Button>
      </div>

      {/* Trades needing quotes (from estimate) */}
      {tradesNeedingQuotes.length > 0 && bidPackages.length === 0 && (
        <div className="rounded-lg border-2 border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Trades needing sub quotes (from estimate)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {tradesNeedingQuotes.map((t, i) => (
              <Badge key={i} className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                {t.trade} — est. {fmt(t.estimatedPrice)}
              </Badge>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setCreateOpen(true)}
          >
            <Send className="mr-2 h-3.5 w-3.5" />
            Send bids for these trades
          </Button>
        </div>
      )}

      {/* Bid Packages */}
      {bidPackages.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Bid Packages</h3>
          {bidPackages.map((pkg) => {
            const config = BID_STATUS[pkg.status] || BID_STATUS.draft;
            const Icon = config.icon;
            const bids = pkg.subcontractor_bids || [];
            const invited = bids.filter((b: { status: string }) => b.status === "invited").length;
            const submitted = bids.filter((b: { status: string }) => b.status === "submitted").length;

            return (
              <div key={pkg.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{pkg.trade}</span>
                      <Badge className={cn("text-[10px]", config.color)}>
                        <Icon className="h-3 w-3 mr-1" />
                        {config.label}
                      </Badge>
                    </div>
                    {pkg.due_date && (
                      <span className="text-xs text-muted-foreground">Due: {new Date(pkg.due_date).toLocaleDateString()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {bids.length} subs
                    {invited > 0 && <span className="text-amber-400">· {invited} awaiting</span>}
                    {submitted > 0 && <span className="text-blue-400">· {submitted} received</span>}
                  </div>
                </div>

                {/* Sub bids table */}
                <div className="space-y-1">
                  {bids.map((bid: {
                    id: string; amount: number | null; status: string; is_selected: boolean;
                    resent_count: number; bid_package_id: string;
                    subcontractors: { company_name: string; contact_name: string; email: string; phone: string };
                  }) => {
                    const sub = bid.subcontractors;
                    const statusConfig = SUB_BID_STATUS[bid.status] || SUB_BID_STATUS.invited;

                    return (
                      <div key={bid.id} className={cn(
                        "flex items-center gap-3 p-2 rounded-md",
                        bid.is_selected && "bg-green-500/5 border border-green-500/20"
                      )}>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {sub?.company_name}
                            {bid.is_selected && <Trophy className="inline h-3.5 w-3.5 ml-1 text-green-400" />}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {sub?.contact_name} · {sub?.email}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {bid.amount ? (
                            <span className="font-semibold tabular-nums text-sm">{fmt(bid.amount)}</span>
                          ) : (
                            <span className={cn("text-xs font-medium", statusConfig.color)}>{statusConfig.label}</span>
                          )}
                        </div>

                        <div className="flex gap-1 shrink-0">
                          {bid.status === "invited" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() => { setMarkReceivedId(bid.id); setReceivedAmount(""); }}
                              >
                                <DollarSign className="h-3 w-3 mr-1" />
                                Got Quote
                              </Button>
                            </>
                          )}
                          {bid.status === "submitted" && !bid.is_selected && pkg.status !== "awarded" && (
                            <Button
                              size="sm"
                              className="h-7 text-[11px] bg-green-600 hover:bg-green-700"
                              onClick={() => handleAward(bid.id, bid.bid_package_id)}
                            >
                              <Trophy className="h-3 w-3 mr-1" />
                              Award
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Received Quotes (from email triage) */}
      {quotes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Received Quotes</h3>
          <div className="space-y-2">
            {quotes.map((q) => (
              <div key={q.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{q.subcontractor_name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {q.trade}{q.scope_description ? ` — ${q.scope_description.substring(0, 60)}` : ""}
                  </div>
                </div>
                {q.amount && (
                  <span className="font-semibold tabular-nums text-sm shrink-0">{fmt(q.amount)}</span>
                )}
                <Badge className={cn("text-[10px] shrink-0",
                  q.status === "accepted" || q.status === "approved" ? "bg-green-500/20 text-green-400" :
                  q.status === "received" ? "bg-blue-500/20 text-blue-400" :
                  "bg-muted text-muted-foreground"
                )}>
                  {q.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {bidPackages.length === 0 && quotes.length === 0 && tradesNeedingQuotes.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Send className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">No bids or quotes yet</p>
          <p className="text-sm mt-1">Send a bid package to get sub pricing for this project</p>
          <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-amber-600 hover:bg-amber-700">
            <Send className="mr-2 h-4 w-4" /> Send First Bid Package
          </Button>
        </div>
      )}

      {/* Create Bid Dialog */}
      <CreateBidDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultProjectId={project.id}
        defaultScope={project.scope_of_work || undefined}
        onSuccess={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />

      {/* Mark Received Dialog */}
      <Dialog open={!!markReceivedId} onOpenChange={(open) => !open && setMarkReceivedId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter Bid Amount</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={receivedAmount}
                onChange={(e) => setReceivedAmount(e.target.value)}
                placeholder="Enter their quote amount"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkReceivedId(null)}>Cancel</Button>
            <Button onClick={handleMarkReceived}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
