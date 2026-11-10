"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateWebsiteInquiry, convertWebsiteInquiry } from "@/lib/actions/website-inquiries";
import type { WebsiteInquiryEmail } from "@/lib/actions/website-inquiry-email";
import { InquiryActions } from "@/components/inquiries/inquiry-actions";
import { InquiryBooking } from "@/components/inquiries/inquiry-booking";
import { INTAKE_LABELS, INTAKE_STATUSES, isHandedOffStatus, intakeStatus, inquiryProject, inquiryText, inquiryDateLabel, inquiryDueDay, type Inquiry, type IntakeStatus, type MatchingInquiryLead } from "@/lib/inquiries/model";

function DetailValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value || "Not provided"}</dd></div>;
}
function ContextValues({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Not provided</span>;
  if (typeof value !== "object") {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      let url: URL | null = null;
      try { url = new URL(value); } catch { /* Keep an unreadable link visible as ordinary text. */ }
      if (url && !url.username && !url.password) return <a href={url.href} target="_blank" rel="noopener noreferrer" className="break-words underline underline-offset-4">Open {url.hostname} →</a>;
    }
    return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  }
  if (Array.isArray(value)) return <ul className="list-inside list-disc space-y-1">{value.map((item, i) => <li key={i}><ContextValues value={item} /></li>)}</ul>;
  return <dl className="space-y-3">{Object.entries(value).filter(([key]) => key !== "version").map(([key, item]) => <div key={key}><dt className="text-xs font-medium text-muted-foreground">{key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}</dt><dd className="mt-1 pl-2"><ContextValues value={item} /></dd></div>)}</dl>;
}
export function InquiryDetail({ inquiry, assignees, matchingLeads, readOnly, senderName, emailHistory }: { inquiry: Inquiry; assignees: string[]; matchingLeads: MatchingInquiryLead[]; readOnly: boolean; senderName: string; emailHistory: WebsiteInquiryEmail[] | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<IntakeStatus>(intakeStatus(inquiry));
  const [assignee, setAssignee] = useState(inquiry.assignee || "");
  const [dueDay, setDueDay] = useState(inquiryDueDay(inquiry.due_date));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [existingLeadId, setExistingLeadId] = useState("");
  const [pending, startTransition] = useTransition();
  const payload = inquiry.website_inquiry;
  const names = [...new Set([...assignees, ...(inquiry.assignee ? [inquiry.assignee] : [])])];
  const email = inquiryText(inquiry, "email");
  const emailBlocked = emailHistory === null || emailHistory.some((item) => item.status === "sending" || item.status === "uncertain");
  async function save() {
    setError(""); setMessage("");
    const result = await updateWebsiteInquiry({ id: inquiry.id, expectedUpdatedAt: inquiry.updated_at, status, assignee, dueDay });
    if (result.error) setError(result.error); else { setMessage("Follow-up saved."); router.refresh(); }
  }
  async function convert() {
    setError(""); setMessage("");
    const result = await convertWebsiteInquiry(inquiry.id, existingLeadId || null);
    if (result.error) setError(result.error); else { setMessage("Linked to the lead record."); router.refresh(); }
  }
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
    <div className="min-w-0 space-y-5">
      <section className="rounded-xl border bg-card p-5"><h1 className="text-xl font-semibold">{inquiryText(inquiry, "name")}</h1><p className="mt-1 text-sm text-muted-foreground">Received {inquiryDateLabel(inquiry.created_at)}</p>
        <div className="mt-4"><InquiryActions inquiry={inquiry} assignees={assignees} senderName={senderName} readOnly={readOnly} onMessage={setMessage} detail emailBlocked={emailBlocked} /></div>
        {message && <p role="status" className="mt-3 text-sm text-green-700 dark:text-green-400">{message}</p>}
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">{[["Email", email], ["Phone", inquiryText(inquiry, "phone")], ["Town", inquiryText(inquiry, "town")], ["Project", inquiryText(inquiry, "projectType")], ["Timing", inquiryText(inquiry, "timeline")], ["Reference", inquiryText(inquiry, "reference") || inquiry.id]].map(([label, value]) => <DetailValue key={label} label={label} value={value} />)}</dl>
        {!!inquiryText(inquiry, "message") && <dl className="mt-5 border-t pt-5"><DetailValue label="What they would like to do" value={inquiryText(inquiry, "message")} /></dl>}
      </section>
      <InquiryBooking inquiry={inquiry} senderName={senderName} readOnly={readOnly} emailBlocked={emailBlocked} />
      {!!(payload?.propertyContext || inquiryText(inquiry, "config")) && <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">ADU plan and property review</h2><p className="mt-1 text-sm text-muted-foreground">Submitted planning context; confirm feasibility, dimensions and local requirements with the client.</p><div className="mt-4 space-y-4 text-sm">{!!inquiryText(inquiry, "config") && <p className="whitespace-pre-wrap break-words">{inquiryText(inquiry, "config")}</p>}{!!payload?.propertyContext && <ContextValues value={payload.propertyContext} />}</div></section>}
      <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">How the inquiry reached us</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><DetailValue label="Form page" value={inquiryText(inquiry, "page")} /><DetailValue label="Heard about us" value={inquiryText(inquiry, "heardAbout")} /></dl>{!!payload?.source && <div className="mt-4 text-sm"><ContextValues value={payload.source} /></div>}</section>
      <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-medium">Original submission</summary><p className="mt-4 whitespace-pre-wrap break-words text-sm text-muted-foreground">{inquiry.description}</p></details>
      <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Email history</h2><p className="mt-1 text-sm text-muted-foreground">Replies sent from this inquiry.</p>
        {emailHistory === null ? <p role="alert" className="mt-4 text-sm text-destructive">Recent email activity could not be loaded. Refresh before sending or deleting this inquiry.</p> : emailHistory.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No emails have been sent from this inquiry yet.</p> : <div className="mt-4 space-y-3">{emailHistory.map((item) => <details key={item.id} className="rounded-lg border p-3"><summary className="cursor-pointer"><span className="text-sm font-medium break-words">{item.subject}</span><span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs ${item.status === "sent" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{item.status === "sent" ? "Sent" : item.status === "failed" ? "Not sent" : item.status === "sending" ? "Sending / awaiting confirmation" : "Check Sent folder"}</span><span className="mt-1 block text-xs text-muted-foreground">{inquiryDateLabel(item.sent_at || item.created_at)} · By {item.sender_name || "Penney team"}</span></summary><p className="mt-3 break-all text-xs text-muted-foreground">To: {item.recipient_email}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.body}</p>{item.status !== "sent" && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{item.status === "failed" ? "The email provider rejected this attempt. You can review and send a new reply." : "Check your Sent folder before sending again. This attempt has not been confirmed, and another send is blocked to prevent a duplicate."}</p>}</details>)}</div>}
      </section>
    </div>
    <aside className="space-y-4"><section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Next step</h2>{readOnly && <p className="mt-2 text-sm text-muted-foreground">Exit View as to edit this inquiry.</p>}
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); startTransition(save); }}>
        <label className="block text-sm">Status<select disabled={readOnly || pending} value={status} onChange={(event) => setStatus(event.target.value as IntakeStatus)} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3">{INTAKE_STATUSES.filter((value) => value !== "walkthrough" || intakeStatus(inquiry) === "walkthrough").map((value) => <option key={value} value={value}>{INTAKE_LABELS[value]}</option>)}</select><span className="mt-1 block text-xs text-muted-foreground">Walkthrough booked is set when the calendar invitation is confirmed.</span></label>
        <label className="block text-sm">Owner<select required disabled={readOnly || pending} value={assignee} onChange={(event) => setAssignee(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3"><option value="">Choose owner</option>{names.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="block text-sm">Next follow-up date<input type="date" disabled={readOnly || pending} value={dueDay} onChange={(event) => setDueDay(event.target.value)} required={!isHandedOffStatus(status)} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" /><span className="mt-1 block text-xs text-muted-foreground">Due by 5 p.m. Eastern time.</span></label>
        {inquiry.status === "snoozed" && inquiry.snooze_until && <p className="text-xs text-muted-foreground">Snoozed until {inquiryDateLabel(inquiry.snooze_until)}. Updating follow-up keeps the snooze unless the inquiry is closed.</p>}
        <button disabled={readOnly || pending} type="submit" className="h-10 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save follow-up"}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Move into estimating</h2><p className="mt-2 text-sm text-muted-foreground">Create a lead when the inquiry is ready, or choose a matching lead for the same project. Customer and project creation follow the lead workflow.</p>
      {inquiryProject(inquiry) && <Link className="mt-4 block rounded-lg border bg-muted/20 p-3 text-sm hover:border-amber-500/40" href={`/projects/${inquiryProject(inquiry)!.id}`}><span className="block font-medium">{inquiryProject(inquiry)!.project_number} · {inquiryProject(inquiry)!.name}</span><span className="mt-1 block text-xs text-muted-foreground">Linked project, {(inquiryProject(inquiry)!.status || "").replaceAll("_", " ")}. This inquiry follows its status.</span></Link>}
      {inquiry.lead_id ? <Link className="mt-4 inline-block text-sm font-medium underline underline-offset-4" href={`/crm/leads/${inquiry.lead_id}`}>Open lead record →</Link> : <>
        {matchingLeads.length > 0 && <label className="mt-4 block text-sm">Leads with this email<select disabled={readOnly || pending} value={existingLeadId} onChange={(event) => setExistingLeadId(event.target.value)} className="mt-1.5 min-h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"><option value="">Create a new lead</option>{matchingLeads.map((lead) => <option key={lead.id} value={lead.id}>{[`${lead.first_name} ${lead.last_name}`, lead.project_type, lead.city, lead.status].filter(Boolean).join(" · ")}</option>)}</select><span className="mt-1 block text-xs text-muted-foreground">Only link an existing lead if it is the same project.</span></label>}
        <button disabled={readOnly || pending || !email || ["spam", "closed"].includes(intakeStatus(inquiry))} onClick={() => startTransition(convert)} className="mt-4 min-h-10 w-full rounded-md border px-3 text-sm font-medium disabled:opacity-50">{existingLeadId ? "Link selected lead" : "Create a new lead"}</button>
      </>}
    </section></aside>
  </div>;
}
