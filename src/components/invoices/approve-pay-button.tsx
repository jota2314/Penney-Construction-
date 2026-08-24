"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, ThumbsUp } from "lucide-react";
import { approveBillForPay } from "@/lib/actions/vendor-bills";

/**
 * One tap: this bill is good to pay. Jorge/Ryan only (the server action holds
 * the gate); approving pings Nicole that she can cut the check.
 *
 * groupIds: for a bill split across budget lines — approving any piece
 * approves every piece, because it's one check to one vendor.
 */
export function ApprovePayButton({ invoiceId, groupIds }: { invoiceId: string; groupIds?: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const ids = groupIds && groupIds.length > 0 ? groupIds : [invoiceId];
    for (const id of ids) {
      const result = await approveBillForPay(id);
      if (result.error) {
        setBusy(false);
        setError(result.error);
        return;
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={submit} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-1" />}
        {busy ? "" : "Approve for pay"}
      </Button>
      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}
