import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import type { InquirySummary } from "@/lib/inquiries/model";

export function WebsiteInquirySummary({ summary }: { summary: InquirySummary }) {
  return <Link href="/command-center/inquiries" className="flex items-center gap-4 rounded-2xl border border-amber-500/30 bg-card p-4 sm:p-5 hover:border-amber-500 focus-visible:outline-2 focus-visible:outline-amber-500">
    <Inbox className="size-6 shrink-0 text-amber-600" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <div className="font-semibold text-foreground">Website inquiries</div>
      {summary.unavailable ? <p className="mt-1 text-sm text-muted-foreground">Counts unavailable. Open the queue to retry.</p> :
        <p className="mt-1 text-sm text-muted-foreground">{summary.open} awaiting follow-up · {summary.new} new{summary.overdue > 0 ? ` · ${summary.overdue} overdue` : ""}</p>}
      <p className="mt-1 text-xs text-muted-foreground">Contact forms, ADU plans and property reviews</p>
    </div><ArrowRight className="size-5 shrink-0" aria-hidden="true" />
  </Link>;
}
