"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Send, X } from "lucide-react";

/**
 * Review-then-send for a client invoice: loads the prefilled email from
 * /api/send-client-invoice (preview), lets the user edit To/Cc/Subject/Body,
 * then sends with the invoice PDF attached. `reminder` asks the same route for
 * the follow-up email instead; a reminder leaves the invoice's sent date alone
 * so the Collections list keeps counting days from the first send.
 */
export function SendInvoiceButton({
  invoiceId,
  invoiceNumber,
  reminder = false,
}: {
  invoiceId: string;
  invoiceNumber: number;
  reminder?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [ccLine, setCcLine] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const router = useRouter();

  async function handleOpen() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/send-client-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, preview: true, reminder }),
      });
      const data = await res.json();
      if (data.success) {
        setTo(data.to || "");
        setCcLine(data.cc || "");
        setSubject(data.subject || "");
        setBody(data.body || "");
        setAttachmentName(data.attachmentName || "");
        setOpen(true);
      } else {
        setError(data.error || "Could not load email preview");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    setLoading(false);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    const res = await fetch("/api/send-client-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId, reminder, clientEmail: to.trim(), cc: ccLine.trim(), subject, body }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      setSent(true);
      setOpen(false);
      router.refresh();
    } else {
      setError(data.error || "Failed");
    }
  }

  if (sent) return (
    <span className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-emerald-400">
      {reminder ? "Reminder sent" : "Sent"}
    </span>
  );

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={loading}
        className={`shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium border transition-colors disabled:opacity-50 ${
          reminder
            ? "border-amber-500/30 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
            : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
        }`}
        title={
          reminder
            ? "Review the reminder before it goes to the client. The invoice PDF is attached again; CCs Ryan"
            : "Review and edit the email before it goes to the client, CCs Ryan"
        }
      >
        {reminder ? <BellRing className="h-3 w-3" /> : <Send className="h-3 w-3" />}
        {loading ? "Loading..." : reminder ? "Remind" : "Send to Client"}
      </button>
      {error && !open && <span className="text-[9px] text-red-400 shrink-0" title={`Invoice #${invoiceNumber}`}>{error}</span>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !sending && setOpen(false)}>
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-100">
                {reminder ? `Reminder for Invoice #${invoiceNumber}` : `Send Invoice #${invoiceNumber}`}
              </h3>
              <button onClick={() => !sending && setOpen(false)} className="text-zinc-400 hover:text-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto px-4 py-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">To</label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">Cc</label>
                <input
                  value={ccLine}
                  onChange={(e) => setCcLine(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div className="text-[10px] text-zinc-500">Attached: {attachmentName}</div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              {error && <p className="text-[10px] text-red-400">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
              <button
                onClick={() => setOpen(false)}
                disabled={sending}
                className="h-8 rounded-lg border border-zinc-700 px-3 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !to.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
