"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Printer, QrCode as QrIcon } from "lucide-react";
import { QrCode } from "@/components/site-qr/qr-code";

/** The same stable job link as the printed door sign, visible on every project tab. */
export function ProjectQrCard({
  projectId,
  projectName,
  url,
  open,
}: {
  projectId: string;
  projectName: string;
  url: string | null;
  open: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <section aria-label="Project QR" className="rounded-2xl border border-amber-500/25 bg-card p-3 shadow-sm md:p-4">
      <div className="flex items-center gap-3 md:gap-4">
        <Link
          href={`/job-qr/${projectId}`}
          aria-label={`Open printable QR sign for ${projectName}`}
          className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white p-1 md:h-32 md:w-32"
        >
          {url ? (
            <QrCode value={url} title={`Scan to open ${projectName}`} className="h-full w-full" />
          ) : (
            <QrIcon className="h-12 w-12 text-stone-500" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold md:text-base">Project QR</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground md:text-sm">
            Anyone on site can scan, add photos and post straight to this job.
          </p>
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
            No account or PIN needed to post photos.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/job-qr/${projectId}`}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 px-3 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
            >
              <Printer className="h-3.5 w-3.5" />
              Print site sign
            </Link>
            {url && (
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-muted"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            )}
          </div>
        </div>
      </div>
      {!open && (
        <p className="mt-2 text-xs text-muted-foreground">
          Photo posting opens when this is a live job. The printed code stays the same.
        </p>
      )}
      {!url && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          The QR couldn&apos;t load. Open the site sign to try again.
        </p>
      )}
      {copyFailed && url && (
        <label className="mt-2 block text-xs text-muted-foreground">
          Select and copy this link:
          <input
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3 text-xs text-foreground"
          />
        </label>
      )}
      <span role="status" className="sr-only">{copied ? "Project link copied" : ""}</span>
    </section>
  );
}
