"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Mail, Phone, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteWebsiteInquiry, updateWebsiteInquiry } from "@/lib/actions/website-inquiries";
import { getWebsiteInquiryEmailSender, listWebsiteInquiryEmails, sendWebsiteInquiryEmail } from "@/lib/actions/website-inquiry-email";
import { buildInquiryEmailDraft, INQUIRY_EMAIL_TEMPLATES, type InquiryEmailTemplateId } from "@/lib/inquiries/email-templates";
import { INTAKE_LABELS, INTAKE_STATUSES, inquiryDueDay, inquiryText, intakeStatus, type Inquiry, type IntakeStatus } from "@/lib/inquiries/model";

type Action = "email" | "follow-up" | "delete";
const fieldClass = "mt-1.5 min-h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60";

export function inquiryPhoneLink(phone: string): string | null {
  const number = phone.trim().replace(/[^\d+]/g, "");
  return /^\+?\d{7,15}$/.test(number) ? `tel:${number}` : null;
}

export function InquiryActions({ inquiry, assignees, senderName, readOnly, onMessage, detail = false, emailBlocked = false }: {
  inquiry: Inquiry;
  assignees: string[];
  senderName: string;
  readOnly: boolean;
  onMessage: (message: string) => void;
  detail?: boolean;
  emailBlocked?: boolean;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const router = useRouter();
  const email = inquiryText(inquiry, "email");
  const phoneLink = inquiryPhoneLink(inquiryText(inquiry, "phone"));
  function complete(message: string) {
    setAction(null);
    onMessage(message);
    router.refresh();
  }
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" className="min-h-10" disabled={readOnly || !email || emailBlocked} title={emailBlocked ? "Check the pending email in history before sending another." : !email ? "No email address was provided." : undefined} onClick={() => setAction("email")}><Mail aria-hidden="true" />Email client</Button>
      {phoneLink && <Button className="min-h-10" variant="outline" asChild><a href={phoneLink}><Phone aria-hidden="true" />Call</a></Button>}
      {!detail && <Button type="button" className="min-h-10" variant="outline" disabled={readOnly} onClick={() => setAction("follow-up")}><CalendarClock aria-hidden="true" />Follow-up</Button>}
      <Button type="button" className="min-h-10 text-muted-foreground hover:text-destructive" variant="ghost" disabled={readOnly || emailBlocked} onClick={() => setAction("delete")}><Trash2 aria-hidden="true" />Delete</Button>
    </div>
    {action === "email" && <InquiryEmailDialog inquiry={inquiry} senderName={senderName} onClose={() => setAction(null)} onComplete={complete} />}
    {action === "follow-up" && <InquiryFollowUpDialog inquiry={inquiry} assignees={assignees} onClose={() => setAction(null)} onComplete={complete} />}
    {action === "delete" && <InquiryDeleteDialog inquiry={inquiry} onClose={() => setAction(null)} onComplete={() => {
      setAction(null);
      onMessage("Inquiry deleted.");
      if (detail) router.replace("/command-center/inquiries");
      router.refresh();
    }} />}
  </>;
}

function InquiryEmailDialog({ inquiry, senderName, onClose, onComplete }: { inquiry: Inquiry; senderName: string; onClose: () => void; onComplete: (message: string) => void }) {
  const initialTemplate = intakeStatus(inquiry) === "new" ? "initial" : "follow_up";
  const [template, setTemplate] = useState<InquiryEmailTemplateId>(initialTemplate);
  const [draft, setDraft] = useState(() => buildInquiryEmailDraft(inquiry, initialTemplate, senderName));
  const [sender, setSender] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [sentMessage, setSentMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null);
  const sending = useRef(false);
  const recipient = inquiryText(inquiry, "email");
  useEffect(() => {
    let active = true;
    Promise.all([getWebsiteInquiryEmailSender(), listWebsiteInquiryEmails(inquiry.id)]).then(([connection, history]) => {
      if (!active) return;
      setSender(connection.email);
      const unresolved = history.some((item) => item.status === "sending" || item.status === "uncertain");
      setBlocked(unresolved);
      if (unresolved) setError("An earlier email is still sending or its delivery could not be confirmed. Check your Sent folder and the inquiry’s email history before sending another.");
      else if (connection.error || !connection.email) setError(connection.error || "Connect your Google account in Settings before sending.");
    }).catch(() => {
      if (active) { setBlocked(true); setError("The email connection and recent history could not be checked. Close this draft and try again."); }
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [inquiry.id]);
  async function send() {
    if (sending.current || !sender || blocked || sentMessage) return;
    sending.current = true;
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await sendWebsiteInquiryEmail({ id: inquiry.id, expectedUpdatedAt: inquiry.updated_at, expectedRecipient: recipient, expectedSender: sender, requestId: requestId.current, subject: draft.subject, body: draft.body });
      if (!result.success) {
        setError(result.error);
        if (result.deliveryUncertain) setBlocked(true);
        else if (result.retrySafe) requestId.current = null;
        return;
      }
      const confirmation = result.alreadySent ? "This email was already sent. No duplicate was sent." : "Email sent.";
      if (result.warning) setSentMessage(`${confirmation} ${result.warning}`);
      else onComplete(confirmation);
    } catch {
      setBlocked(true);
      setError("The send result could not be confirmed. Check your Sent folder and email history before trying again; do not resend this message yet.");
    } finally { sending.current = false; }
  }
  const locked = checking || pending || blocked || !!sentMessage;
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending}>
      <DialogHeader><DialogTitle>Email {inquiryText(inquiry, "name")}</DialogTitle><DialogDescription>Review the recipient and message below. Nothing sends until you choose Send email.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); startTransition(send); }}>
        <dl className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm"><div className="flex min-w-0 gap-3"><dt className="w-10 shrink-0 text-muted-foreground">From</dt><dd className="min-w-0 break-all">{checking ? "Checking your connected email…" : sender || "No connected email"}</dd></div><div className="flex min-w-0 gap-3"><dt className="w-10 shrink-0 text-muted-foreground">To</dt><dd className="min-w-0 break-all">{recipient}</dd></div></dl>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><label className="flex-1 text-sm">Start with a reply<select className={fieldClass} value={template} disabled={locked} onChange={(event) => setTemplate(event.target.value as InquiryEmailTemplateId)}>{INQUIRY_EMAIL_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><Button type="button" variant="outline" className="min-h-10" disabled={locked} onClick={() => setDraft(buildInquiryEmailDraft(inquiry, template, senderName))}>Use template</Button></div>
        <label className="block text-sm">Subject<input required maxLength={200} disabled={locked} className={fieldClass} value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
        <label className="block text-sm">Message<textarea required maxLength={12000} rows={11} disabled={locked} className={`${fieldClass} min-h-56 resize-y py-3 leading-relaxed`} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
        <p className="text-xs text-muted-foreground">Penney’s standard email signature is added when sent. A new inquiry is marked Contacted only after sending succeeds.</p>
        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {sentMessage && <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">{sentMessage}</p>}
        <DialogFooter><Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onClose}>{sentMessage ? "Close" : "Cancel"}</Button>{!sentMessage && <Button type="submit" className="min-h-10" disabled={locked || !sender || !draft.subject.trim() || !draft.body.trim()}>{pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}{pending ? "Sending…" : "Send email"}</Button>}</DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function InquiryFollowUpDialog({ inquiry, assignees, onClose, onComplete }: { inquiry: Inquiry; assignees: string[]; onClose: () => void; onComplete: (message: string) => void }) {
  const [status, setStatus] = useState<IntakeStatus>(intakeStatus(inquiry));
  const [assignee, setAssignee] = useState(inquiry.assignee || "");
  const [dueDay, setDueDay] = useState(inquiryDueDay(inquiry.due_date));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  async function save() {
    setError("");
    try {
      const result = await updateWebsiteInquiry({ id: inquiry.id, expectedUpdatedAt: inquiry.updated_at, status, assignee, dueDay });
      if (result.error) setError(result.error); else onComplete("Follow-up saved.");
    } catch { setError("The follow-up could not be saved. Please try again."); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!pending}>
    <DialogHeader><DialogTitle>Follow-up for {inquiryText(inquiry, "name")}</DialogTitle><DialogDescription>Choose who follows up and the next step.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); startTransition(save); }}>
      <label className="block text-sm">Status<select className={fieldClass} disabled={pending} value={status} onChange={(event) => setStatus(event.target.value as IntakeStatus)}>{INTAKE_STATUSES.map((item) => <option key={item} value={item}>{INTAKE_LABELS[item]}</option>)}</select></label>
      <label className="block text-sm">Owner<select className={fieldClass} required disabled={pending} value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">Choose owner</option>{assignees.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="block text-sm">Next follow-up<input className={fieldClass} type="date" required={!["qualified", "closed", "spam"].includes(status)} disabled={pending} value={dueDay} onChange={(event) => setDueDay(event.target.value)} /><span className="mt-1 block text-xs text-muted-foreground">Due by 5 p.m. Eastern time.</span></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" className="min-h-10" disabled={pending}>{pending && <Loader2 aria-hidden="true" className="animate-spin" />}{pending ? "Saving…" : "Save follow-up"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function InquiryDeleteDialog({ inquiry, onClose, onComplete }: { inquiry: Inquiry; onClose: () => void; onComplete: () => void }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  async function remove() {
    setError("");
    try {
      const result = await deleteWebsiteInquiry({ id: inquiry.id, expectedUpdatedAt: inquiry.updated_at });
      if (result.error) setError(result.error); else onComplete();
    } catch { setError("The inquiry could not be deleted. Please refresh and try again."); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent showCloseButton={!pending}>
    <DialogHeader><DialogTitle>Delete this inquiry?</DialogTitle><DialogDescription>This permanently removes the inquiry from {inquiryText(inquiry, "name")} and its reminders. Sent email history and any linked lead are kept.</DialogDescription></DialogHeader>
    <div className="rounded-md border bg-muted/30 p-3 text-sm"><p className="font-medium">{inquiryText(inquiry, "name")}</p><p className="mt-1 break-all text-muted-foreground">{inquiryText(inquiry, "email")}</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onClose}>Keep inquiry</Button><Button type="button" variant="destructive" className="min-h-10" disabled={pending} onClick={() => startTransition(remove)}>{pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Trash2 aria-hidden="true" />}{pending ? "Deleting…" : "Delete inquiry"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
