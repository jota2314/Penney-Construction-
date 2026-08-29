"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddressLink } from "@/components/ui/address-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Send,
  Trophy,
  RotateCw,
  Clock,
  CheckCircle2,
  XCircle,
  DollarSign,
  Loader2,
  Trash2,
} from "lucide-react";
import { updateSubBidStatus, deleteBidPackage } from "@/lib/actions/bids";
import { cn } from "@/lib/utils";

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  invited: { label: "Awaiting", color: "bg-amber-500/20 text-amber-400" },
  submitted: { label: "Bid Received", color: "bg-blue-500/20 text-blue-400" },
  accepted: { label: "Awarded", color: "bg-green-500/20 text-green-400" },
  rejected: { label: "Not Selected", color: "bg-muted text-muted-foreground" },
  declined: { label: "Declined", color: "bg-red-500/20 text-red-400" },
  no_response: { label: "No Response", color: "bg-muted text-muted-foreground" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BidPackageDetail({ pkg }: { pkg: any }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [markReceivedId, setMarkReceivedId] = useState<string | null>(null);
  const [receivedAmount, setReceivedAmount] = useState("");

  const bids = pkg.subcontractor_bids || [];
  const project = pkg.projects;

  async function handleSendAll() {
    setSending(true);
    await fetch("/api/send-bid-package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidPackageId: pkg.id }),
    });
    setSending(false);
    router.refresh();
  }

  async function handleResend(bidId: string) {
    await fetch("/api/send-bid-package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidPackageId: pkg.id }),
    });
    router.refresh();
  }

  async function handleAward(bidId: string) {
    setAwarding(true);
    await fetch("/api/award-bid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId, bidPackageId: pkg.id }),
    });
    setAwarding(false);
    router.refresh();
  }

  async function handleMarkReceived() {
    if (!markReceivedId) return;
    await updateSubBidStatus(markReceivedId, "submitted", parseFloat(receivedAmount) || undefined);
    setMarkReceivedId(null);
    setReceivedAmount("");
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("Delete this bid package?")) return;
    await deleteBidPackage(pkg.id);
    router.push("/bids");
  }

  // Sort: awarded first, then submitted (by amount), then invited
  const sortedBids = [...bids].sort((a: { is_selected: boolean; status: string; amount: number }, b: { is_selected: boolean; status: string; amount: number }) => {
    if (a.is_selected && !b.is_selected) return -1;
    if (!a.is_selected && b.is_selected) return 1;
    if (a.status === "submitted" && b.status !== "submitted") return -1;
    if (a.status !== "submitted" && b.status === "submitted") return 1;
    if (a.amount && b.amount) return a.amount - b.amount;
    return 0;
  });

  const lowestAmount = sortedBids
    .filter((b: { amount: number | null; status: string }) => b.amount && b.status === "submitted")
    .map((b: { amount: number }) => b.amount)
    .sort((a: number, b: number) => a - b)[0];

  return (
    <>
      {/* Header info */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge className={cn("text-xs",
              pkg.status === "awarded" ? "bg-green-500/20 text-green-400" :
              pkg.status === "sent" ? "bg-blue-500/20 text-blue-400" :
              "bg-muted text-muted-foreground"
            )}>
              {pkg.status.charAt(0).toUpperCase() + pkg.status.slice(1)}
            </Badge>
            {pkg.due_date && (
              <span className="text-xs text-muted-foreground">
                Due: {new Date(pkg.due_date).toLocaleDateString()}
              </span>
            )}
          </div>
          {project && (
            <p className="text-sm text-muted-foreground mt-1">
              {project.project_number} —{" "}
              <AddressLink
                address={project.address}
                city={project.city}
                className="hover:text-amber-500"
              />
            </p>
          )}
          {pkg.scope_of_work && (
            <p className="text-sm mt-2 max-w-2xl">{pkg.scope_of_work}</p>
          )}
        </div>
        <div className="flex gap-2">
          {pkg.status === "draft" && (
            <Button onClick={handleSendAll} disabled={sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send to All
            </Button>
          )}
          <Button variant="ghost" size="icon" className="text-destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Bid comparison table */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subcontractor</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Sent</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedBids.map((bid: {
              id: string;
              amount: number | null;
              status: string;
              is_selected: boolean;
              sent_at: string | null;
              resent_count: number;
              notes: string | null;
              subcontractors: { company_name: string; contact_name: string; email: string; phone: string };
            }) => {
              const sub = bid.subcontractors;
              const statusConfig = STATUS_BADGE[bid.status] || STATUS_BADGE.invited;
              const isLowest = bid.amount && bid.amount === lowestAmount && !bid.is_selected;

              return (
                <TableRow key={bid.id} className={cn(bid.is_selected && "bg-green-500/5")}>
                  <TableCell>
                    <div className="font-medium text-sm">{sub?.company_name}</div>
                    {bid.is_selected && (
                      <div className="text-[11px] text-green-400 flex items-center gap-1 mt-0.5">
                        <Trophy className="h-3 w-3" /> Awarded
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>{sub?.contact_name}</div>
                    <div>{sub?.email}</div>
                    <div>{sub?.phone}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    {bid.amount ? (
                      <span className={cn("font-semibold tabular-nums", isLowest && "text-green-400")}>
                        {fmt(bid.amount)}
                        {isLowest && <span className="text-[10px] ml-1">LOW</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-[10px]", statusConfig.color)}>
                      {statusConfig.label}
                    </Badge>
                    {bid.resent_count > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-1">
                        (resent ×{bid.resent_count})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {bid.sent_at ? new Date(bid.sent_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      {bid.status === "invited" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setMarkReceivedId(bid.id);
                              setReceivedAmount("");
                            }}
                          >
                            <DollarSign className="h-3 w-3 mr-1" />
                            Mark Received
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleResend(bid.id)}
                            title="Resend"
                          >
                            <RotateCw className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      {bid.status === "submitted" && !bid.is_selected && pkg.status !== "awarded" && (
                        <Button
                          variant="default"
                          size="sm"
                          className="h-7 text-xs bg-green-600 hover:bg-green-700"
                          onClick={() => handleAward(bid.id)}
                          disabled={awarding}
                        >
                          <Trophy className="h-3 w-3 mr-1" />
                          Award
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mark Received Dialog */}
      <Dialog open={!!markReceivedId} onOpenChange={(open) => !open && setMarkReceivedId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark Bid Received</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Bid Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={receivedAmount}
                onChange={(e) => setReceivedAmount(e.target.value)}
                placeholder="Enter bid amount"
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
