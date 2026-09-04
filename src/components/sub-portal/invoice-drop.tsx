"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Card, MONO, Notice, SectionLabel, btnPrimary, inputCls } from "./ui";

/**
 * "Send us an invoice or quote" — one file, one job. Lives on Money so the
 * Field tab stays about the work.
 */
export function InvoiceDrop({ jobs }: { jobs: { id: string; name: string }[] }) {
  const [job, setJob] = useState("");
  const [docType, setDocType] = useState<"quote" | "invoice">("invoice");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const jobId = jobs.some((j) => j.id === job) ? job : (jobs[0]?.id ?? "");
  if (jobs.length === 0) return null;

  async function send() {
    if (!jobId || !file) return;
    setBusy(true);
    setNotice(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", jobId);
    fd.append("docType", docType);
    const res = await fetch("/api/sub-portal/upload", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice({ kind: "err", text: d.error || "Couldn't send that. Try again." });
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    setNotice({ kind: "ok", text: d.message || "Received. We'll take a look." });
  }

  return (
    <Card className="p-4">
      <SectionLabel>Send us an invoice or quote</SectionLabel>
      <div className="space-y-3">
        {notice && <Notice kind={notice.kind} text={notice.text} />}
        <div className="flex gap-2">
          {(["invoice", "quote"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDocType(t)}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-[11px] uppercase tracking-[0.14em] ${
                docType === t ? "border-amber-500/60 bg-amber-500/10 text-amber-400" : "border-white/10 text-stone-500"
              }`}
              style={MONO}
            >
              {t}
            </button>
          ))}
        </div>
        <select value={jobId} onChange={(e) => setJob(e.target.value)} className={inputCls}>
          {jobs.map((j) => (
            <option key={j.id} value={j.id} className="bg-stone-900">
              {j.name}
            </option>
          ))}
        </select>
        <label
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-3.5 text-[12px] uppercase tracking-[0.14em] text-stone-400 hover:border-amber-500/40"
          style={MONO}
        >
          <FileUp className="h-4 w-4" />
          <span className="truncate">{file ? file.name : "PDF or a clear photo"}</span>
          <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
        </label>
        <button onClick={send} disabled={busy || !file} className={`${btnPrimary} w-full`}>
          {busy ? "Reading the document…" : `Send ${docType}`}
        </button>
        <p className="text-[11px] text-stone-600">Goes straight to the office on the job you picked. Invoices show here once they&apos;re reviewed.</p>
      </div>
    </Card>
  );
}
