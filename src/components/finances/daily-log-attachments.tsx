"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImageIcon, Maximize2 } from "lucide-react";
import { ImageViewer } from "@/components/ui/image-viewer";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { isPdfAttachment } from "@/lib/attachments";
import type { LogAttachment, LogTransaction } from "@/lib/finance/daily-log";

/** The original document stays one tap away even while transaction details are closed. */
export function DailyLogAttachments({ transaction }: { transaction: LogTransaction }) {
  const router = useRouter();
  const [selected, setSelected] = useState<LogAttachment | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const trigger = useRef<HTMLButtonElement | null>(null);
  const documentName = transaction.kind === "expense" ? "invoice" : "payment";
  const attachments = transaction.attachments ?? [];
  const close = () => {
    setSelected(null);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const unavailable = attachments.some(file => !file.url || failedImages.has(file.url));

  return <div className="px-3 pb-4 sm:px-4 sm:pl-[60px]">
    {attachments.length === 0 ? <p className="text-[11px] text-muted-foreground">No {documentName} attached</p> : <div className="grid gap-2 sm:grid-cols-2">
      {attachments.map((file, index) => {
        const pdf = isPdfAttachment(file.path);
        const available = !!file.url && !failedImages.has(file.url);
        const suffix = attachments.length > 1 ? ` (${index + 1} of ${attachments.length})` : "";
        return <button
          key={`${file.bucket}:${file.path}`}
          type="button"
          disabled={!available}
          aria-label={`View ${documentName} ${pdf ? "PDF" : "photo"} for ${transaction.name}${suffix}`}
          onClick={event => { trigger.current = event.currentTarget; setSelected(file); }}
          className="flex min-h-16 min-w-0 items-center gap-3 rounded-lg border bg-muted/20 p-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-default disabled:opacity-60"
        >
          <span className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded border bg-background text-amber-700 dark:text-amber-400">
            {pdf ? <FileText aria-hidden="true" className="h-6 w-6" /> : available ?
              // Original private image: signed on the server with the user's access.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.url!} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailedImages(previous => new Set(previous).add(file.url!))} /> :
              <ImageIcon aria-hidden="true" className="h-6 w-6" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold">{available ? `View ${documentName} ${pdf ? "PDF" : "photo"}` : `${transaction.kind === "expense" ? "Invoice" : "Payment"} preview unavailable`}{suffix}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">{available ? "Tap to open full size" : "The original file couldn’t load"}</span>
          </span>
          {available && <Maximize2 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
        </button>;
      })}
    </div>}
    {unavailable && <button type="button" onClick={() => { setFailedImages(new Set()); router.refresh(); }} className="mt-1 min-h-11 text-xs font-medium text-amber-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-400">Refresh preview</button>}
    {selected?.url && (isPdfAttachment(selected.path)
      ? <PdfViewer url={selected.url} filename={`${transaction.name} ${documentName}.pdf`} onClose={close} />
      : <ImageViewer url={selected.url} filename={`${transaction.name} ${documentName}`} onClose={close} />)}
  </div>;
}
