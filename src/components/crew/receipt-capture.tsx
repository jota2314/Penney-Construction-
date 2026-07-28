"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v } from "@/components/field-feed/tokens";
import { compressImage } from "@/lib/image/compress";
import { searchActiveJobs, type ClockInJob } from "@/lib/actions/daily-logs";

/**
 * "Snap a receipt" — the crew-facing front door to /api/crew/field-capture.
 *
 * One tap opens the camera. The photo is shrunk in the browser first (a raw
 * phone photo is multi-MB and stalls on jobsite signal), posted to our own
 * origin, and Claude files it against the right job and budget line.
 *
 * When the AI can't tell which job it is, the photo is already parked in
 * storage — the picker re-posts just the storagePath, so a weak connection
 * never has to carry the image twice.
 */

type Filed = {
  status: "filed";
  vendor: string;
  amount: number | null;
  project: string;
  needsReview: boolean;
  reviewReason: string | null;
};
type Documented = { status: "document"; vendor: string; project: string };
type NeedsJob = {
  status: "needs_job";
  storagePath: string;
  extracted: {
    vendor_name: string | null;
    amount: number | null;
    summary: string | null;
    document_type: string | null;
    job_hint: string | null;
  };
};
type Outcome = Filed | Documented | NeedsJob;

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "no total";

export function ReceiptCapture() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ClockInJob[]>([]);
  const [jobQuery, setJobQuery] = useState("");

  const open = outcome !== null || busy || error !== null;

  // Load the job list only once we actually need the picker.
  useEffect(() => {
    if (outcome?.status !== "needs_job") return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchActiveJobs(jobQuery)
        .then((rows) => {
          if (!cancelled) setJobs(rows);
        })
        .catch(() => {
          if (!cancelled) setJobs([]);
        });
    }, jobQuery ? 220 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [outcome?.status, jobQuery]);

  async function post(body: FormData) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/crew/field-capture", {
        method: "POST",
        body,
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error || "That didn't go through. Try again.");
        setOutcome(null);
        return;
      }
      setOutcome(json as Outcome);
      if (json.status !== "needs_job") router.refresh();
    } catch {
      setError("No connection. The photo didn't send — try again in better signal.");
      setOutcome(null);
    } finally {
      setBusy(false);
    }
  }

  async function onPick(file: File) {
    // Always hand the server a JPEG: HEIC off an iPhone can't be read by the
    // vision model, and a full-size photo stalls the upload.
    let blob: Blob = file;
    try {
      blob = await compressImage(file);
    } catch {
      // Undecodable (some HEIC) — send the original and let the route explain.
    }
    const body = new FormData();
    body.append("file", new File([blob], "receipt.jpg", { type: blob.type || "image/jpeg" }));
    await post(body);
  }

  function chooseJob(projectId: string) {
    if (outcome?.status !== "needs_job") return;
    const body = new FormData();
    body.append("storagePath", outcome.storagePath);
    body.append("projectId", projectId);
    void post(body);
  }

  function close() {
    setOutcome(null);
    setError(null);
    setJobQuery("");
    setJobs([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPick(file);
        }}
      />

      <button
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.99]"
        style={{
          background: "linear-gradient(180deg, rgba(217,119,6,0.07), rgba(0,0,0,0))",
          border: "1px solid rgba(217,119,6,0.28)",
        }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "rgba(217,119,6,0.16)" }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-[18px] h-[18px]"
            style={{ color: v("accent") }}
          >
            <path d="M5 2.5h10a.5.5 0 0 1 .5.5v14l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-1 .6V3a.5.5 0 0 1 .5-.5z" />
            <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[14px] font-medium" style={{ color: v("ink") }}>
            Snap a receipt
          </span>
          <span className="text-[11px] truncate" style={{ color: v("quiet") }}>
            Materials you bought — it files itself to the job
          </span>
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.72)" }}
          onClick={busy ? undefined : close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92dvh] overflow-hidden"
            style={{
              background: v("card"),
              border: `1px solid ${v("line")}`,
              color: v("ink"),
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: `1px solid ${v("line")}` }}
            >
              <div
                className="text-[11px] font-medium uppercase"
                style={{ color: v("quiet"), letterSpacing: "0.18em" }}
              >
                Receipt
              </div>
              {!busy && (
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="text-[13px] px-2 py-1 rounded-lg"
                  style={{ color: v("muted") }}
                >
                  Close
                </button>
              )}
            </div>

            <div className="px-5 py-5 overflow-y-auto">
              {busy && (
                <div className="flex items-center gap-3">
                  <span
                    className="h-4 w-4 rounded-full animate-spin"
                    style={{
                      border: `2px solid ${v("line")}`,
                      borderTopColor: v("accent"),
                    }}
                  />
                  <span className="text-[14px]" style={{ color: v("muted") }}>
                    Reading the receipt…
                  </span>
                </div>
              )}

              {!busy && error && (
                <div className="flex flex-col gap-3">
                  <div className="text-[14px]" style={{ color: "#F87171" }}>
                    {error}
                  </div>
                  <button
                    onClick={() => {
                      close();
                      setTimeout(() => inputRef.current?.click(), 60);
                    }}
                    className="w-full rounded-xl py-2.5 text-[14px] font-semibold"
                    style={{ background: v("accent"), color: "#1a0f00" }}
                  >
                    Take it again
                  </button>
                </div>
              )}

              {!busy && outcome?.status === "filed" && (
                <div className="flex flex-col gap-2">
                  <div className="text-[22px] font-semibold tracking-tight">
                    {money(outcome.amount)}
                  </div>
                  <div className="text-[14px]" style={{ color: v("muted") }}>
                    {outcome.vendor} → {outcome.project}
                  </div>
                  <div
                    className="mt-2 rounded-xl px-3 py-2.5 text-[12px]"
                    style={{
                      background: outcome.needsReview
                        ? "rgba(217,119,6,0.12)"
                        : "rgba(34,197,94,0.10)",
                      border: `1px solid ${outcome.needsReview ? "rgba(217,119,6,0.3)" : "rgba(34,197,94,0.25)"}`,
                      color: outcome.needsReview ? "#FBBF24" : "#4ADE80",
                    }}
                  >
                    {outcome.needsReview
                      ? `Filed, and flagged for the office to check — ${outcome.reviewReason}`
                      : "Filed to the job's budget. Nothing else needed."}
                  </div>
                </div>
              )}

              {!busy && outcome?.status === "document" && (
                <div className="flex flex-col gap-2">
                  <div className="text-[16px] font-semibold">Delivery ticket saved</div>
                  <div className="text-[14px]" style={{ color: v("muted") }}>
                    {outcome.vendor} → {outcome.project}
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: v("quiet") }}>
                    No dollar total on it, so it's filed with the job's paperwork
                    instead of the budget.
                  </div>
                </div>
              )}

              {!busy && outcome?.status === "needs_job" && (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">
                      {outcome.extracted.vendor_name} · {money(outcome.extracted.amount)}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: v("quiet") }}>
                      {outcome.extracted.summary || "Which job is this for?"}
                    </div>
                  </div>

                  <input
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                    placeholder="Search jobs"
                    className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none"
                    style={{
                      background: v("bg-2"),
                      border: `1px solid ${v("line")}`,
                      color: v("ink"),
                    }}
                  />

                  <div className="flex flex-col gap-1.5">
                    {jobs.map((job) => (
                      <button
                        key={job.id}
                        onClick={() => chooseJob(job.id)}
                        className="w-full text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99]"
                        style={{
                          background: v("bg-2"),
                          border: `1px solid ${v("line")}`,
                        }}
                      >
                        <div className="text-[14px] font-medium truncate">{job.name}</div>
                        <div className="text-[11px] truncate" style={{ color: v("quiet") }}>
                          {[job.project_number, job.address, job.city]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </button>
                    ))}
                    {jobs.length === 0 && (
                      <div className="text-[13px] py-2" style={{ color: v("quiet") }}>
                        No jobs match that.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
