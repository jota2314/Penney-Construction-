"use client";

import { useRef, useState } from "react";
import { v } from "@/components/field-feed/tokens";

/**
 * The zero-touch intake, sized for the Command Center Receipts sheet.
 * Drop a photo OR a PDF — the AI reads it and FILES it. No form, no confirm.
 * Receipts file paid on your card; invoices file unpaid with their due date;
 * anything the AI can't place lands flagged in Needs check.
 *
 * Same pipeline as /invoices "Add a bill" (/api/bills/scan + /api/bills/commit).
 */

type ScanResult = {
  status: "scanned" | "needs_job";
  scan: {
    storagePath: string;
    documentType: string;
    vendor: string;
    amount: number | null;
    invoiceNumber: string | null;
    date: string | null;
    dueDate: string | null;
    trade: string | null;
    summary: string | null;
    extractedText: string | null;
  };
  job: { id: string; label: string } | null;
  allocations: Array<{ lineItemId: string; amount: number; note: string | null }>;
};

const money = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function BillDrop({ onFiled }: { onFiled?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "filing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    vendor: string;
    amount: number;
    paid: boolean;
    project: string | null;
    needsReview: boolean;
    invoiceId: string;
  } | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setPhase("reading");
    try {
      const body = new FormData();
      body.append("file", file);
      const scanRes = await fetch("/api/bills/scan", { method: "POST", body });
      const scanJson = await scanRes.json();
      if (!scanRes.ok) {
        setError(scanJson?.error || "Could not read that file.");
        setPhase("idle");
        return;
      }
      const result = scanJson as ScanResult;
      if (result.scan.amount == null) {
        setError(
          "Couldn't read a dollar total off that one — file it from Invoices → Add a bill instead.",
        );
        setPhase("idle");
        return;
      }

      setPhase("filing");
      const commitRes = await fetch("/api/bills/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: result.scan.storagePath,
          projectId: result.job?.id ?? "",
          vendor: result.scan.vendor,
          amount: result.scan.amount,
          invoiceNumber: result.scan.invoiceNumber,
          date: result.scan.date,
          dueDate: result.scan.dueDate,
          summary: result.scan.summary,
          trade: result.scan.trade,
          extractedText: result.scan.extractedText,
          vendorType: result.scan.documentType === "invoice" ? "subcontractor" : "supplier",
          paid: result.scan.documentType === "receipt",
          paymentMethod: "credit_card",
          allocations: result.allocations.map((a) => ({
            lineItemId: a.lineItemId,
            amount: a.amount,
            note: a.note,
          })),
        }),
      });
      const commitJson = await commitRes.json();
      if (!commitRes.ok) {
        setError(commitJson?.error || "Could not file that bill.");
        setPhase("idle");
        return;
      }
      setDone({
        vendor: commitJson.vendor,
        amount: commitJson.amount,
        paid: commitJson.paid,
        project: commitJson.project ?? null,
        needsReview: Boolean(commitJson.needsReview),
        invoiceId: commitJson.invoiceId,
      });
      setPhase("idle");
      onFiled?.();
    } catch {
      setError("Upload failed — check the connection and try again.");
      setPhase("idle");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const busy = phase !== "idle";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-2xl px-4 py-4 text-left transition active:scale-[0.99] disabled:opacity-80"
        style={{
          background: "rgba(217,119,6,0.10)",
          border: `1.5px dashed ${busy ? "rgba(217,119,6,0.7)" : "rgba(217,119,6,0.45)"}`,
        }}
      >
        <span className="flex items-center gap-3">
          <span
            className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(217,119,6,0.18)", color: v("accent") }}
          >
            {busy ? (
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 animate-spin">
                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth={2} strokeOpacity={0.25} />
                <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.5 13.5v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold" style={{ color: v("ink") }}>
              {phase === "reading"
                ? "Reading it…"
                : phase === "filing"
                  ? "Filing it…"
                  : "Drop a receipt or a bill"}
            </span>
            <span className="block text-[11.5px] mt-0.5" style={{ color: v("quiet") }}>
              {busy
                ? "The AI is doing everything — hang on"
                : "Photo or PDF — the AI reads it and files it. That's it."}
            </span>
          </span>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {done && (
        <div
          className="rounded-xl px-3 py-2.5 text-[12.5px]"
          style={{
            background: done.needsReview ? "rgba(217,119,6,0.12)" : "rgba(16,185,129,0.12)",
            border: `1px solid ${done.needsReview ? "rgba(217,119,6,0.35)" : "rgba(16,185,129,0.35)"}`,
            color: v("ink"),
          }}
        >
          <span className="font-semibold">
            {done.vendor} — {money(done.amount)}
          </span>{" "}
          {done.paid ? "booked and sent to QuickBooks" : "filed as unpaid"}
          {done.project ? ` on ${done.project}` : ""}.
          {done.needsReview && (
            <a
              href={`/spent/${done.invoiceId}`}
              className="block mt-1 font-medium"
              style={{ color: "#FBBF24" }}
            >
              Couldn&apos;t tell the job — it&apos;s in Needs check, tap to fix →
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="text-[12px] px-1" style={{ color: "#F87171" }}>
          {error}
        </div>
      )}
    </div>
  );
}
