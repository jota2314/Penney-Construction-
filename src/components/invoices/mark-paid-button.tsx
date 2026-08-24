"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import { markBillPaid, listPayerOptions, type PayerOption } from "@/lib/actions/vendor-bills";

/**
 * Flip an unpaid vendor bill to paid: how it was paid + who paid it (that
 * person's Capital One subaccount is what the QuickBooks expense draws on).
 *
 * groupIds: for a bill split across budget lines — one check pays every
 * piece, so marking any piece paid marks them all.
 */
export function MarkPaidButton({ invoiceId, groupIds }: { invoiceId: string; groupIds?: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"credit_card" | "check" | "cash" | "ach">("check");
  const [paidBy, setPaidBy] = useState("");
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payers, setPayers] = useState<PayerOption[]>([]);

  useEffect(() => {
    if (!open) return;
    listPayerOptions().then(setPayers).catch(() => setPayers([]));
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    const ids = groupIds && groupIds.length > 0 ? groupIds : [invoiceId];
    for (const id of ids) {
      const result = await markBillPaid({
        invoiceId: id,
        method,
        paidById: paidBy || undefined,
        paidDate,
      });
      if (result.error) {
        setBusy(false);
        setError(result.error);
        return;
      }
    }
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  const inputCls =
    "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-4 w-4 mr-1" />
        Mark paid
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark this bill paid</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Paid with</label>
              <select
                className={inputCls}
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as "credit_card" | "check" | "cash" | "ach")
                }
              >
                <option value="check">Check</option>
                <option value="credit_card">Company card</option>
                <option value="ach">Bank transfer</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Paid by</label>
              <select className={inputCls} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                <option value="">Me</option>
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Paid on</label>
              <input
                type="date"
                className={inputCls}
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
            {groupIds && groupIds.length > 1 && (
              <div className="text-[11px] text-sky-400">
                One bill split across {groupIds.length} budget lines — every piece gets marked paid together.
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              Books the payment and creates the QuickBooks expense on that person&apos;s card.
            </div>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark paid"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
