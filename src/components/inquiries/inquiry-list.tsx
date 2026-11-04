"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, CheckCircle2, Inbox, Mail, MapPin, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InquiryActions } from "@/components/inquiries/inquiry-actions";
import { INTAKE_LABELS, INTAKE_STATUSES, intakeStatus, inquiryText, inquiryAge, inquiryDateLabel, isPendingInquiry, isOverdueInquiry, summarizeInquiries, type Inquiry } from "@/lib/inquiries/model";

const STATUS_COLOR: Record<string, string> = {
  new: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  contacted: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  walkthrough: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  qualified: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function InquiryList({ rows, now, assignees, senderName, readOnly }: {
  rows: Inquiry[]; now: number; assignees: string[]; senderName: string; readOnly: boolean;
}) {
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [sort, setSort] = useState("due");
  const [message, setMessage] = useState("");
  const summary = summarizeInquiries(rows, now);
  const owners = [...new Set([...assignees, ...rows.map((row) => row.assignee).filter((name): name is string => !!name)])].sort();
  const visible = rows.filter((row) =>
    (filter === "all" || (filter === "pending" ? isPendingInquiry(row) : filter === "overdue" ? isOverdueInquiry(row, now) : intakeStatus(row) === filter)) &&
    (owner === "all" || (owner === "unassigned" ? !row.assignee : row.assignee === owner)) &&
    [row.contact_name, inquiryText(row, "email"), inquiryText(row, "phone"), inquiryText(row, "town"), inquiryText(row, "projectType"), row.assignee].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
  visible.sort((a, b) => sort === "newest" ? Date.parse(b.created_at) - Date.parse(a.created_at) : sort === "oldest" ? Date.parse(a.created_at) - Date.parse(b.created_at) : (a.due_date ? Date.parse(a.due_date) : Infinity) - (b.due_date ? Date.parse(b.due_date) : Infinity) || Date.parse(a.created_at) - Date.parse(b.created_at));
  const tiles = [
    { id: "pending", label: "Awaiting follow-up", count: summary.open, icon: Inbox },
    { id: "new", label: "New inquiries", count: summary.new, icon: Mail },
    { id: "overdue", label: "Overdue", count: summary.overdue, icon: CalendarClock },
  ];
  return <div className="space-y-5">
    <div><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Turn inquiries into next steps</h1><p className="mt-1 text-sm text-muted-foreground">Reply to clients, assign follow-up, and keep the queue moving.</p></div>
    <div className="grid grid-cols-3 gap-2 sm:gap-3">{tiles.map(({ id, label, count, icon: Icon }) =>
      <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:p-4 ${filter === id ? "border-amber-500/60 bg-amber-500/5" : "bg-card hover:border-amber-500/40"}`}>
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:text-sm">{label}<Icon className="hidden size-4 sm:block" aria-hidden="true" /></span><span className={`mt-2 block text-2xl font-semibold sm:text-3xl ${id === "overdue" && count > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{count}</span>
      </button>)}</div>
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <label className="relative block"><span className="sr-only">Search inquiries</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, phone, town or project" className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm" /></label>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">Status<select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="pending">Awaiting follow-up</option><option value="overdue">Overdue follow-up</option><option value="all">All inquiries</option>{INTAKE_STATUSES.map((status) => <option key={status} value={status}>{INTAKE_LABELS[status]}</option>)}</select></label>
        <label className="text-xs text-muted-foreground">Owner<select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">All owners</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}<option value="unassigned">Unassigned</option></select></label>
        <label className="text-xs text-muted-foreground">Sort by<select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={sort} onChange={(event) => setSort(event.target.value)}><option value="due">Next follow-up</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>
    </div>
    {readOnly && <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">You are in View as. Exit it to email, edit, or delete an inquiry.</p>}
    {message && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>{visible.length} {visible.length === 1 ? "inquiry" : "inquiries"} shown · {rows.length} total</p><p>Follow-up dates are Eastern time</p></div>
    {visible.length === 0 ? <div className="rounded-xl border bg-card p-8 text-center"><Inbox className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 font-medium">{rows.length === 0 ? "No website inquiries yet" : "No inquiries match this view"}</h2><p className="mt-1 text-sm text-muted-foreground">{rows.length === 0 ? "New website submissions will appear here." : "Try another status, owner, or search."}</p>{rows.length > 0 && <Button variant="outline" className="mt-4 min-h-10" onClick={() => { setSearch(""); setFilter("all"); setOwner("all"); }}>Show all inquiries</Button>}</div> :
      <ul className="space-y-4">{visible.map((row) => {
        const status = intakeStatus(row);
        const overdue = isOverdueInquiry(row, now);
        const project = inquiryText(row, "projectType");
        const phone = inquiryText(row, "phone");
        return <li key={row.id}><article aria-labelledby={`inquiry-${row.id}`} className={`overflow-hidden rounded-xl border bg-card ${overdue ? "border-red-500/35" : ""}`}>
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link id={`inquiry-${row.id}`} href={`/command-center/inquiries/${row.id}`} className="inline-flex max-w-full items-center gap-2 rounded text-base font-semibold hover:text-amber-600 focus-visible:outline-2 focus-visible:outline-primary dark:hover:text-amber-400"><span className="break-words">{inquiryText(row, "name")}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link><p className="mt-1 text-sm text-muted-foreground"><span className="capitalize">{project === "adu" ? "ADU" : project.replaceAll("-", " ") || "Website inquiry"}</span>{inquiryText(row, "town") && <span className="ml-2 inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" />{inquiryText(row, "town")}</span>}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_COLOR[status] || "border-transparent bg-muted text-muted-foreground"}`}>{INTAKE_LABELS[status]}</span></div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="break-all">{inquiryText(row, "email") || "No email provided"}</span>{phone && <span>{phone}</span>}</p>
            {!!inquiryText(row, "message") && <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{inquiryText(row, "message")}</p>}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" aria-hidden="true" />{row.assignee || "Unassigned"}</span><span className={`inline-flex items-center gap-1.5 ${overdue ? "font-medium text-red-600 dark:text-red-400" : ""}`}><CalendarClock className="size-3.5" aria-hidden="true" />{overdue ? "Overdue: " : "Follow-up: "}{inquiryDateLabel(row.due_date)}</span><span>Received {inquiryAge(row.created_at, now)}</span></div>
            {row.status === "snoozed" && row.snooze_until && <p className="mt-2 text-xs text-muted-foreground">Snoozed until {inquiryDateLabel(row.snooze_until)}</p>}
          </div>
          <div className="border-t bg-muted/15 px-4 py-3 sm:px-5"><InquiryActions inquiry={row} assignees={assignees} senderName={senderName} readOnly={readOnly} onMessage={setMessage} /></div>
        </article></li>;
      })}</ul>}
  </div>;
}
