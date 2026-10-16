"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Printer } from "lucide-react";

const btn =
  "inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50";

/** Screen-only toolbar above the printable sign. */
export function SiteQrActions({ projectId, url }: { projectId: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Link href={`/projects/${projectId}`} className={btn}>
        <ArrowLeft className="h-4 w-4" />
        Back to job
      </Link>
      <div className="ml-auto flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={btn}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-700"
        >
          <Printer className="h-4 w-4" />
          Print sign
        </button>
      </div>
    </div>
  );
}
