"use client";

import { useState, useTransition } from "react";
import { clockOutWithLog } from "@/lib/actions/daily-logs";
import { BottomSheet, BottomSheetContent, BottomSheetHeader, BottomSheetTitle, BottomSheetDescription, BottomSheetBody, BottomSheetFooter } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";

export function ShiftWrapUp({ logId, onClose, onSaved }: { logId: string; onClose: () => void; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState("");
  const [remaining, setRemaining] = useState("");
  const [blocked, setBlocked] = useState("");
  const save = (includeUpdate: boolean) => {
    setError(null);
    start(async () => {
      const result = await clockOutWithLog(logId, undefined, undefined, includeUpdate ? { finished, remaining, blocked } : undefined);
      if (result.error) { setError(result.error); return; }
      onSaved(); onClose();
    });
  };
  return <BottomSheet open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <BottomSheetContent onOpenAutoFocus={e => e.preventDefault()}>
      <BottomSheetHeader><BottomSheetTitle>Wrap up this shift</BottomSheetTitle><BottomSheetDescription>Help the office plan the next visit. Clocking out ends your time; it does not mark the whole job finished.</BottomSheetDescription></BottomSheetHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={e => { e.preventDefault(); save(true); }}>
      <BottomSheetBody className="space-y-4 overscroll-contain">
          {([
            ["What did you finish?", finished, setFinished],
            ["What is left? How much more time?", remaining, setRemaining],
            ["Anything blocking the next visit?", blocked, setBlocked],
          ] as const).map(([label, value, setValue]) => <label key={label} className="block text-sm font-medium">{label}<textarea className="mt-1 w-full scroll-m-3 rounded-lg border bg-background p-3 text-base font-normal" rows={2} maxLength={1500} disabled={pending} value={value} onChange={e => setValue(e.target.value)} /></label>)}
      </BottomSheetBody>
      <BottomSheetFooter>
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Saving…" : "Save update & clock out"}</Button>
          <Button type="button" variant="ghost" disabled={pending} className="w-full" onClick={() => save(false)}>Clock out without an update</Button>
      </BottomSheetFooter>
      </form>
    </BottomSheetContent>
  </BottomSheet>;
}
