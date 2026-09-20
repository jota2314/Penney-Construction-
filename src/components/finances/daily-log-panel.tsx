"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DailyLogPanel({ title, month, children }: { title: string; month: string; children: ReactNode }) {
  const router = useRouter();
  function close() { router.replace(`/finances/daily-log?month=${month}`, { scroll: false }); }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden p-0 sm:max-w-6xl" onInteractOutside={e => e.preventDefault()}>
      <DialogHeader className="shrink-0 border-b p-4 pr-12">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Work here, then close to return to your daily log.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto p-4">{children}</div>
    </DialogContent>
  </Dialog>;
}
