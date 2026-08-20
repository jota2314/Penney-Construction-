"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, ThumbsUp } from "lucide-react";
import { approveBillForPay } from "@/lib/actions/vendor-bills";

/**
 * One tap: this bill is good to pay. Jorge/Ryan only (the server action holds
 * the gate); approving pings Nicole that she can cut the check.
 */
export function ApprovePayButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await approveBillForPay(invoiceId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
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
