"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CalendarArrowDown, Loader2 } from "lucide-react";
import { pushBillToNextWeek } from "@/lib/actions/bill-week";

/**
 * One tap: this bill pays next week, not this one. Moves every row of the
 * bill (all pieces of a split) forward seven days so it drops out of this
 * week's batch and lands in the next. Jorge/Ryan only — the action holds the gate.
 */
export function NextWeekButton({ invoiceIds }: { invoiceIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await pushBillToNextWeek(invoiceIds);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" onClick={submit} disabled={busy} title="Move this bill to next week's pay batch">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarArrowDown className="h-4 w-4 mr-1" />}
        {busy ? "" : "Next week"}
      </Button>
      {error && <div className="text-[11px] text-destructive text-right">{error}</div>}
    </div>
  );
}
