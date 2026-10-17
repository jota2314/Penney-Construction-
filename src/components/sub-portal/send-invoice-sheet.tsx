"use client";

import { useRef, useState, type ReactNode } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PortalNotice, PortalSheet, type PortalNoticeValue } from "@/components/portal-kit";
import { DecimalInput } from "@/components/ui/decimal-input";
import { compressImage } from "@/lib/image/compress";
import { fmtMoney, fmtSize } from "@/lib/portal-kit/format";
// Types only: they compile away, so nothing server-side reaches the phone.
import type {
  SubBillFinishResponse,
  SubBillPrepareResponse,
  SubBillRequest,
} from "@/lib/sub-portal/bill-handoff";

/**
 * "Send an invoice" from the Money tab (plan §4.7). One job, one file.
 *
 * The file goes straight to storage through a signed URL the server hands
 * out (so a big PDF never hits the app's request cap), into the bill
 * reviewer's Saved uploads. Then the server reads it and he confirms:
 * "We read: INV0325 · $600.00 · Pedersen. Right?" Yes, or Fix (type the
 * number and total). Penney files it through the office bill workflow; the
 * portal never books anything itself.
 *
 * Weak signal: once the file is up, a failed finish only retries the finish,
 * never the upload. onSent fires once, when he's done with a sent invoice
 * (Yes, Fix saved, or Close after sending), so the parent can close the
 * sheet, say "Sent", and reload the Money tab. Before that, onClose only.
 */

/** The field-captures bucket cap (SUB_BILL_MAX_BYTES on the server). */
const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = "field-captures";
const ENDPOINT = "/api/sub-portal/bills";
const TOO_BIG = "That file is over 10 MB. Take a photo of the invoice instead, or send a smaller PDF.";
const NOT_A_DOC = "Send a PDF or a photo of the invoice.";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"];

// Only uploadToSignedUrl is used; the signed token is the permission. No
// session is kept, so a staff login in the same browser is never touched.
let storageClient: SupabaseClient | null = null;
function bucket() {
  storageClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return storageClient.storage.from(BUCKET);
}

function typeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "";
}

/** PDFs go as they are; photos are shrunk to a JPEG first (and HEIC converted where the phone can). */
async function readyFile(file: File): Promise<File | string> {
  let type = (file.type || typeFromName(file.name)).toLowerCase();
  if (type === "application/pdf") return file.size > MAX_BYTES ? TOO_BIG : new File([file], file.name, { type });
  if (!type.startsWith("image/")) return NOT_A_DOC;
  try {
    const blob = await compressImage(file);
    const base = (file.name || "invoice").replace(/\.\w+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    // The phone couldn't decode it: send the original. HEIF is stored as HEIC.
    if (type === "image/heif" || type === "image/heif-sequence") type = "image/heic";
    if (!IMAGE_TYPES.includes(type)) return NOT_A_DOC;
    if (file.size > MAX_BYTES) return TOO_BIG;
    return new File([file], file.name || "invoice", { type });
  }
}

async function post<T>(body: SubBillRequest): Promise<T | string> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) return String(data?.error || "Something went wrong. Try again.");
    return data as T;
  } catch {
    return "No signal. Try again when you have a connection.";
  }
}

type Step =
  | { kind: "pick" }
  | { kind: "sending"; label: string }
  | { kind: "confirm" }
  | { kind: "fix" };

/** A file that is already up, so a retry only repeats the finish. */
type Uploaded = { file: File; projectId: string; path: string; nonce: string };

const inputCls =
  "block min-h-[52px] w-full rounded-xl border border-[var(--line)] bg-white px-3.5 text-[16px] text-[var(--ink)] outline-none focus:border-[var(--accent-dark)]";

export function SendInvoiceSheet({
  jobs,
  defaultProjectId,
  onClose,
  onSent,
}: {
  jobs: { project_id: string; name: string }[];
  defaultProjectId?: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Never a jobs[0] fallback on a money path: the asked-for job when it's in
  // the list, his only job when none was asked for, else he picks.
  const [projectId, setProjectId] = useState<string>(() =>
    defaultProjectId && jobs.some((j) => j.project_id === defaultProjectId)
      ? defaultProjectId
      : !defaultProjectId && jobs.length === 1
        ? jobs[0].project_id
        : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [notice, setNotice] = useState<PortalNoticeValue | null>(null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [result, setResult] = useState<SubBillFinishResponse | null>(null);
  const [fixNumber, setFixNumber] = useState("");
  const [fixAmount, setFixAmount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const ended = useRef(false);

  const jobName = jobs.find((j) => j.project_id === projectId)?.name ?? "";
  const sending = step.kind === "sending";
  // Once the file is up for a job, a retry finishes that same upload, so the job stays put.
  const upForThisFile = !!uploaded && uploaded.file === file;

  /** He's done with a sent invoice: tell the parent once, then close. */
  function end() {
    if (!ended.current) {
      ended.current = true;
      onSent();
    }
    onClose();
  }
  const close = () => (result ? end() : onClose());

  function pickFile(next: File | null) {
    setNotice(null);
    setFile(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    if (!file || !projectId || sending) return;
    setNotice(null);
    let up = uploaded && uploaded.file === file && uploaded.projectId === projectId ? uploaded : null;

    if (!up) {
      setStep({ kind: "sending", label: "Getting it ready…" });
      const ready = await readyFile(file);
      if (typeof ready === "string") {
        setStep({ kind: "pick" });
        setNotice({ tone: "error", text: ready });
        return;
      }
      if (ready.size > MAX_BYTES) {
        setStep({ kind: "pick" });
        setNotice({ tone: "error", text: TOO_BIG });
        return;
      }
      setStep({ kind: "sending", label: "Sending your invoice…" });
      const prepared = await post<SubBillPrepareResponse>({
        action: "prepare",
        projectId,
        name: file.name || ready.name,
        mime: ready.type,
        size: ready.size,
      });
      if (typeof prepared === "string") {
        setStep({ kind: "pick" });
        setNotice({ tone: "error", text: prepared });
        return;
      }
      try {
        const { error } = await bucket().uploadToSignedUrl(prepared.path, prepared.token, ready, {
          contentType: ready.type,
        });
        if (error) throw error;
      } catch {
        setStep({ kind: "pick" });
        setNotice({ tone: "error", text: "Your invoice didn't send. Check your signal and tap Send again." });
        return;
      }
      up = { file, projectId, path: prepared.path, nonce: prepared.nonce };
      setUploaded(up);
    }

    setStep({ kind: "sending", label: "Reading it…" });
    const finished = await post<SubBillFinishResponse>({
      action: "finish",
      projectId: up.projectId,
      path: up.path,
      nonce: up.nonce,
      name: file.name,
    });
    if (typeof finished === "string") {
      setStep({ kind: "pick" });
      setNotice({ tone: "error", text: `Your file is with Penney, but it didn't finish: ${finished} Tap Send again.` });
      return;
    }
    setResult(finished);
    setFixNumber(finished.read?.invoice_number ?? "");
    setFixAmount(finished.read?.amount ?? null);
    // Nothing read: go straight to typing the numbers.
    setStep(finished.read && (finished.read.invoice_number || finished.read.amount != null) ? { kind: "confirm" } : { kind: "fix" });
  }

  async function saveFix() {
    if (!result || saving) return;
    const number = fixNumber.trim();
    if (!number && fixAmount == null) {
      setNotice({ tone: "error", text: "Type the invoice number or the total." });
      return;
    }
    setSaving(true);
    setNotice(null);
    const saved = await post<{ ok: true }>({
      action: "fix",
      submissionId: result.submissionId,
      number: number || null,
      amount: fixAmount,
    });
    setSaving(false);
    if (typeof saved === "string") {
      setNotice({ tone: "error", text: saved });
      return;
    }
    end();
  }

  const readLine = (() => {
    const read = result?.read;
    if (!read) return null;
    const number = read.invoice_number || "No invoice #";
    const amount = read.amount == null ? "no total read" : fmtMoney(read.amount);
    return `We read: ${number} · ${amount} · ${result?.jobName ?? jobName}. Right?`;
  })();

  let footer: ReactNode = null;
  if (step.kind === "pick" || step.kind === "sending") {
    footer = (
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        onClick={send}
        disabled={!file || !projectId || sending}
      >
        {step.kind === "sending" ? step.label : upForThisFile ? "Send again" : "Send invoice"}
      </button>
    );
  } else if (step.kind === "confirm") {
    footer = (
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-ghost btn-lg btn-block" onClick={() => { setNotice(null); setStep({ kind: "fix" }); }}>
          Fix
        </button>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={end}
        >
          ✓ Yes
        </button>
      </div>
    );
  } else {
    footer = (
      <button type="button" className="btn btn-primary btn-lg btn-block" onClick={saveFix} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    );
  }

  return (
    <PortalSheet
      title="Send an invoice"
      onClose={close}
      locked={sending || saving}
      footer={footer}
    >
      <div className="space-y-4">
        {jobs.length === 0 ? (
          <p className="text-[16px] text-[var(--muted)]">
            There are no jobs to bill on your list yet. Call the office.
          </p>
        ) : step.kind === "pick" || step.kind === "sending" ? (
          <>
            <div className="space-y-1.5">
              {jobs.length === 1 && projectId === jobs[0].project_id ? (
                <>
                  <span className="label block">Job</span>
                  <p className="text-[17px] font-bold">{jobs[0].name}</p>
                </>
              ) : (
                <>
                  <label htmlFor="sub-invoice-job" className="label block">Job</label>
                  <select
                    id="sub-invoice-job"
                    className={inputCls}
                    value={projectId}
                    disabled={sending || upForThisFile}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="" disabled>
                      Pick the job
                    </option>
                    {jobs.map((j) => (
                      <option key={j.project_id} value={j.project_id}>{j.name}</option>
                    ))}
                  </select>
                </>
              )}
              <p className="text-[13px] text-[var(--muted)]">Put the job address on your invoice.</p>
            </div>

            <div className="space-y-1.5">
              <span className="label block">Invoice</span>
              {file ? (
                <div className="card flex min-h-[60px] items-center gap-3 px-3.5 py-2">
                  <span aria-hidden className="shrink-0 rounded-md bg-[var(--paper)] px-2 py-1 text-[13px] font-extrabold">
                    {file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "PDF" : "IMG"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-bold">{file.name || "Invoice"}</p>
                    <p className="text-[13px] text-[var(--muted)]">{fmtSize(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] shrink-0 items-center px-2 text-[15px] font-bold underline disabled:opacity-50"
                    onClick={() => pickFile(null)}
                    disabled={sending}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="flex min-h-[64px] w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--paper)] px-4 text-[17px] font-bold">
                  Add your invoice (PDF or photo)
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="sr-only"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </div>
          </>
        ) : step.kind === "confirm" ? (
          <div className="space-y-3">
            <p className="text-[18px] font-extrabold leading-snug">{readLine}</p>
            {result?.jobMismatch && (
              <PortalNotice
                notice={{ tone: "info", text: `The invoice looks like it's for ${result.jobMismatch}. Penney will check the job.` }}
              />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[16px]">
              {result?.read
                ? `Type what your invoice says for ${result.jobName}.`
                : `We got your invoice for ${result?.jobName ?? jobName}, but couldn't read the numbers. Type them so Penney has them.`}
            </p>
            <div className="space-y-1.5">
              <label htmlFor="sub-invoice-number" className="label block">Invoice number</label>
              <input
                id="sub-invoice-number"
                className={inputCls}
                value={fixNumber}
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={60}
                onChange={(e) => setFixNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sub-invoice-amount" className="label block">Total</label>
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--muted)]">$</span>
                <DecimalInput
                  id="sub-invoice-amount"
                  className={`${inputCls} pl-7`}
                  value={fixAmount}
                  onValueChange={setFixAmount}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        )}

        <PortalNotice notice={notice} onDismiss={() => setNotice(null)} />
      </div>
    </PortalSheet>
  );
}
