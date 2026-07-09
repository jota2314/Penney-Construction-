"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Trash2, CheckCircle2, FileText, Mail, AlertCircle } from "lucide-react";
import { sendDraftEmail, discardDraftEmail } from "@/lib/actions/email-draft-actions";

export interface DraftReviewData {
  id: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  status: string;
  projectName: string | null;
  attachmentNames: string[];
  origin: string | null;
}

export function EmailDraftReview({ draft }: { draft: DraftReviewData }) {
  const router = useRouter();
  const [to, setTo] = useState(draft.to.join(", "));
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [bcc, setBcc] = useState(draft.bcc.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [sending, setSending] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [sent, setSent] = useState(draft.status === "sent");
  const [error, setError] = useState<string | null>(null);

  const splitEmails = (s: string) =>
    s
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter(Boolean);

  async function handleSend() {
    setError(null);
    setSending(true);
    const res = await sendDraftEmail(draft.id, {
      to: splitEmails(to),
      cc: splitEmails(cc),
      bcc: splitEmails(bcc),
      subject,
      body,
    });
    setSending(false);
    if (res.success) {
      setSent(true);
    } else {
      setError(res.error || "Failed to send");
    }
  }

  async function handleDiscard() {
    setDiscarding(true);
    const res = await discardDraftEmail(draft.id);
    setDiscarding(false);
    if (res.success) {
      router.push("/command-center/emails");
    } else {
      setError(res.error || "Failed to discard");
      setDiscarding(false);
    }
  }

  if (sent) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2">Email sent</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your reply to {to} is on its way.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => router.push("/command-center/emails")}>
            Back to Inbox
          </Button>
          <Button onClick={() => router.push("/command-center")}>Command Center</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4">
        <Mail className="h-5 w-5 text-amber-500" />
        <h1 className="text-lg font-semibold">Review &amp; Send</h1>
        {draft.origin === "auto_triage" && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
            Auto-drafted
          </span>
        )}
      </div>

      {draft.projectName && (
        <p className="text-xs text-muted-foreground mb-4">
          Project: <span className="text-foreground font-medium">{draft.projectName}</span>
        </p>
      )}

      <div className="rounded-lg border bg-card divide-y">
        <Field label="To">
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            disabled={sending}
            className="text-sm h-9"
          />
        </Field>
        <Field label="CC">
          <Input
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="Optional"
            disabled={sending}
            className="text-sm h-9"
          />
        </Field>
        <Field label="BCC">
          <Input
            value={bcc}
            onChange={(e) => setBcc(e.target.value)}
            placeholder="Optional"
            disabled={sending}
            className="text-sm h-9"
          />
        </Field>
        <Field label="Subject">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            className="text-sm h-9"
          />
        </Field>
      </div>

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={sending}
        className="mt-3 text-sm min-h-[280px]"
        placeholder="Write your email..."
      />

      {draft.attachmentNames.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.attachmentNames.map((name, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-xs"
            >
              <FileText className="h-3 w-3 text-amber-500" />
              <span className="truncate max-w-[180px]">{name}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          className="w-full sm:w-auto text-muted-foreground hover:text-red-400"
          onClick={handleDiscard}
          disabled={sending || discarding}
        >
          {discarding ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          Discard
        </Button>
        <Button
          size="lg"
          className="w-full sm:w-auto h-12 sm:h-11 text-base bg-blue-600 hover:bg-blue-700 text-white"
          onClick={handleSend}
          disabled={sending || discarding}
        >
          {sending ? (
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
          ) : (
            <Send className="h-5 w-5 mr-2" />
          )}
          Send Email
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <label className="text-xs text-muted-foreground w-12 shrink-0 font-medium">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
