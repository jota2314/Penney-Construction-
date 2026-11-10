"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, Archive, ArrowUpRight, CalendarClock, CheckCircle2, ChevronRight, FolderKanban, Inbox, MapPin, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InquiryActions } from "@/components/inquiries/inquiry-actions";
import { readWalkthroughRequest, walkthroughDateLabel } from "@/lib/inquiries/booking-model";
import { INTAKE_LABELS, INTAKE_STATUSES, WORKFLOW_STEPS, intakeStatus, inquiryProject, inquiryText, inquiryAge, inquiryDateLabel, isInWorkflow, isPendingInquiry, isOverdueInquiry, summarizeInquiries, workflowStepOf, type Inquiry, type WorkflowStep } from "@/lib/inquiries/model";

const STATUS_COLOR: Record<string, string> = {
  new: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  contacted: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  lead: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  walkthrough: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  qualified: "border-teal-500/20 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  estimating: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  proposal_sent: "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  won: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};
const STEP_LABELS: Record<WorkflowStep, string> = {
  new: "New", contacted: "Contacted", lead: "Lead", walkthrough: "Walkthrough",
  estimating: "Estimating", proposal_sent: "Proposal sent", won: "Won",
};
const projectStatusLabel = (status: string | null) => status ? status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "";
const isVisitRequest = (row: Inquiry) => !!readWalkthroughRequest(row) && isPendingInquiry(row) && intakeStatus(row) !== "walkthrough";

export function InquiryList({ rows, now, assignees, senderName, readOnly }: {
  rows: Inquiry[]; now: number; assignees: string[]; senderName: string; readOnly: boolean;
}) {
  const [filter, setFilter] = useState("workflow");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [sort, setSort] = useState("newest");
  const [message, setMessage] = useState("");
  const summary = summarizeInquiries(rows, now);
  const owners = [...new Set([...assignees, ...rows.map((row) => row.assignee).filter((name): name is string => !!name)])].sort();
  const atStep = (row: Inquiry, step: WorkflowStep) => workflowStepOf(intakeStatus(row)) === WORKFLOW_STEPS.indexOf(step);
  const matchesFilter = (row: Inquiry) => {
    if (filter === "all") return true;
    if (filter === "workflow") return isInWorkflow(row);
    if (filter === "pending") return isPendingInquiry(row);
    if (filter === "overdue") return isOverdueInquiry(row, now);
    if (filter === "waiting-ryan") return isVisitRequest(row);
    if ((WORKFLOW_STEPS as readonly string[]).includes(filter)) return atStep(row, filter as WorkflowStep);
    return intakeStatus(row) === filter;
  };
  const visible = rows.filter((row) => matchesFilter(row) &&
    (owner === "all" || (owner === "unassigned" ? !row.assignee : row.assignee === owner)) &&
    [row.contact_name, inquiryText(row, "email"), inquiryText(row, "phone"), inquiryText(row, "town"), inquiryText(row, "projectType"), row.assignee].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
  visible.sort((a, b) => sort === "newest" ? Date.parse(b.created_at) - Date.parse(a.created_at) : sort === "oldest" ? Date.parse(a.created_at) - Date.parse(b.created_at) : (a.due_date ? Date.parse(a.due_date) : Infinity) - (b.due_date ? Date.parse(b.due_date) : Infinity) || Date.parse(a.created_at) - Date.parse(b.created_at));
  const views = [
    { id: "workflow", label: "Whole workflow", count: rows.filter(isInWorkflow).length, icon: Inbox, alert: false },
    { id: "waiting-ryan", label: "Visit requests", count: rows.filter(isVisitRequest).length, icon: CalendarClock, alert: false },
    { id: "overdue", label: "Overdue", count: summary.overdue, icon: AlarmClock, alert: summary.overdue > 0 },
    { id: "closed", label: "Closed", count: rows.filter((row) => intakeStatus(row) === "closed").length, icon: Archive, alert: false },
  ];
  return <div className="space-y-5">
    <div><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Website leads workflow</h1><p className="mt-1 text-sm text-muted-foreground">New inquiry to won job. Replies, calendar invites and the project&apos;s status move each lead along on their own.</p></div>
    <nav aria-label="Lead workflow" className="rounded-xl border bg-card p-1.5 sm:p-2">
      <ol className="grid grid-cols-4 gap-1 sm:grid-cols-7">{WORKFLOW_STEPS.map((step, index) => {
        const active = filter === step;
        return <li key={step} className="relative">
          <button type="button" aria-pressed={active} onClick={() => setFilter(active ? "workflow" : step)} className={`flex h-full w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-3 ${active ? "bg-amber-500/10 ring-1 ring-amber-500/50" : "hover:bg-muted/60"}`}>
            <span className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{index + 1}. {STEP_LABELS[step]}</span>
            <span className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${step === "won" && rows.some((row) => atStep(row, "won")) ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{rows.filter((row) => atStep(row, step)).length}</span>
          </button>
          {index < WORKFLOW_STEPS.length - 1 && <ChevronRight className="pointer-events-none absolute -right-2 top-1/2 z-10 hidden size-3.5 -translate-y-1/2 text-muted-foreground/50 sm:block" aria-hidden="true" />}
        </li>;
      })}</ol>
    </nav>
    <div className="flex flex-wrap gap-2">{views.map(({ id, label, count, icon: Icon, alert }) =>
      <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${filter === id ? "border-amber-500/60 bg-amber-500/10" : "bg-card hover:border-amber-500/40"}`}>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}<span className={`font-semibold tabular-nums ${alert ? "text-red-600 dark:text-red-400" : ""}`}>{count}</span>
      </button>)}</div>
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <label className="relative block"><span className="sr-only">Search inquiries</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, phone, town or project" className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm" /></label>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">Status<select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="workflow">Whole workflow</option><option value="pending">Awaiting follow-up</option><option value="waiting-ryan">Visit requests waiting on Ryan</option><option value="overdue">Overdue follow-up</option><option value="all">All inquiries, including closed and spam</option>{INTAKE_STATUSES.map((status) => <option key={status} value={status}>{INTAKE_LABELS[status]}</option>)}</select></label>
        <label className="text-xs text-muted-foreground">Owner<select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">All owners</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}<option value="unassigned">Unassigned</option></select></label>
        <label className="text-xs text-muted-foreground">Sort by<select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="due">Next follow-up</option><option value="oldest">Oldest first</option></select></label>
      </div>
    </div>
    {readOnly && <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">You are in View as. Exit it to email, edit, or delete an inquiry.</p>}
    {message && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>{visible.length} {visible.length === 1 ? "inquiry" : "inquiries"} shown · {rows.length} total</p><p>Follow-up dates are Eastern time</p></div>
    {visible.length === 0 ? <div className="rounded-xl border bg-card p-8 text-center"><Inbox className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 font-medium">{rows.length === 0 ? "No website inquiries yet" : "No inquiries match this view"}</h2><p className="mt-1 text-sm text-muted-foreground">{rows.length === 0 ? "New website submissions will appear here." : "Try another step, owner, or search."}</p>{rows.length > 0 && <Button variant="outline" className="mt-4 min-h-10" onClick={() => { setSearch(""); setFilter("all"); setOwner("all"); }}>Show all inquiries</Button>}</div> :
      <ul className="space-y-4">{visible.map((row) => {
        const status = intakeStatus(row);
        const step = workflowStepOf(status);
        const overdue = isOverdueInquiry(row, now);
        const project = inquiryText(row, "projectType");
        const phone = inquiryText(row, "phone");
        const requested = readWalkthroughRequest(row);
        const linkedProject = inquiryProject(row);
        return <li key={row.id}><article aria-labelledby={`inquiry-${row.id}`} className={`overflow-hidden rounded-xl border bg-card ${overdue ? "border-red-500/35" : ""}`}>
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link id={`inquiry-${row.id}`} href={`/command-center/inquiries/${row.id}`} className="inline-flex max-w-full items-center gap-2 rounded text-base font-semibold hover:text-amber-600 focus-visible:outline-2 focus-visible:outline-primary dark:hover:text-amber-400"><span className="break-words">{inquiryText(row, "name")}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link><p className="mt-1 text-sm text-muted-foreground"><span className="capitalize">{project === "adu" ? "ADU" : project.replaceAll("-", " ") || "Website inquiry"}</span>{inquiryText(row, "town") && <span className="ml-2 inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" />{inquiryText(row, "town")}</span>}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_COLOR[status] || "border-transparent bg-muted text-muted-foreground"}`}>{INTAKE_LABELS[status]}</span></div>
            {step >= 0 && <div role="img" aria-label={`Step ${step + 1} of ${WORKFLOW_STEPS.length}: ${INTAKE_LABELS[status]}`} className="mt-3 flex gap-1">{WORKFLOW_STEPS.map((item, index) => <span key={item} className={`h-1.5 flex-1 rounded-full ${index <= step ? (status === "won" ? "bg-emerald-500" : "bg-amber-500") : "bg-muted"}`} />)}</div>}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="break-all">{inquiryText(row, "email") || "No email provided"}</span>{phone && <span>{phone}</span>}</p>
            {!!inquiryText(row, "message") && <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{inquiryText(row, "message")}</p>}
            {requested && isPendingInquiry(row) && status !== "walkthrough" && <Link href={`/command-center/inquiries/${row.id}#walkthrough`} className="mt-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 hover:border-primary/50"><CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 text-sm"><span className="block font-medium">Walkthrough requested · Waiting on Ryan</span><span className="mt-1 block text-xs text-muted-foreground">{walkthroughDateLabel(requested.start, requested.end)}</span><span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">Review availability<ArrowUpRight className="size-3" aria-hidden="true" /></span></span></Link>}
            {linkedProject && <Link href={`/projects/${linkedProject.id}`} className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm hover:border-amber-500/40 focus-visible:outline-2 focus-visible:outline-primary"><FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate"><span className="font-medium">{linkedProject.project_number}</span>{linkedProject.name && <span className="text-muted-foreground"> · {linkedProject.name}</span>}</span><span className="shrink-0 text-xs text-muted-foreground">{projectStatusLabel(linkedProject.status)}</span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" aria-hidden="true" />{row.assignee || "Unassigned"}</span>{status === "walkthrough" && row.due_date && !overdue ? <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" aria-hidden="true" />Walkthrough: {inquiryDateLabel(row.due_date)}</span> : isPendingInquiry(row) && <span className={`inline-flex items-center gap-1.5 ${overdue ? "font-medium text-red-600 dark:text-red-400" : ""}`}><CalendarClock className="size-3.5" aria-hidden="true" />{overdue ? "Overdue: " : "Follow-up: "}{inquiryDateLabel(row.due_date)}</span>}<span>Received {inquiryAge(row.created_at, now)}</span></div>
            {row.status === "snoozed" && row.snooze_until && <p className="mt-2 text-xs text-muted-foreground">Snoozed until {inquiryDateLabel(row.snooze_until)}</p>}
          </div>
          <div className="border-t bg-muted/15 px-4 py-3 sm:px-5"><InquiryActions inquiry={row} assignees={assignees} senderName={senderName} readOnly={readOnly} onMessage={setMessage} /></div>
        </article></li>;
      })}</ul>}
  </div>;
}
