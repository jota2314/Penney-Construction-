"use client";

import { useState } from "react";
import Link from "next/link";
import { INTAKE_LABELS, INTAKE_STATUSES, intakeStatus, inquiryText, inquiryAge, inquiryDateLabel, isPendingInquiry, isOverdueInquiry, summarizeInquiries, type Inquiry } from "@/lib/inquiries/model";

export function InquiryList({ rows, now }: { rows: Inquiry[]; now: number }) {
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const summary = summarizeInquiries(rows, now);
  const visible = rows.filter((row) => (filter === "all" || (filter === "pending" ? isPendingInquiry(row) : filter === "overdue" ? isOverdueInquiry(row, now) : intakeStatus(row) === filter)) &&
    [row.contact_name, inquiryText(row, "email"), inquiryText(row, "town"), inquiryText(row, "projectType"), row.assignee].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
  if (["pending", "overdue", "new", "contacted", "walkthrough"].includes(filter)) {
    visible.sort((a, b) => (a.due_date ? Date.parse(a.due_date) : Infinity) - (b.due_date ? Date.parse(b.due_date) : Infinity) || Date.parse(a.created_at) - Date.parse(b.created_at));
  }
  return <div className="space-y-5">
    <div className="grid grid-cols-3 gap-3">{[["Awaiting follow-up", summary.open], ["New", summary.new], ["Overdue", summary.overdue]].map(([label, count]) =>
      <div key={label} className="rounded-xl border bg-card p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{count}</p></div>)}</div>
    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="flex-1"><span className="sr-only">Search inquiries</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, town or project" className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>
      <label><span className="sr-only">Filter by status</span><select className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-56" value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="pending">Awaiting follow-up</option><option value="overdue">Overdue follow-up</option><option value="all">All inquiries</option>{INTAKE_STATUSES.map((status) => <option key={status} value={status}>{INTAKE_LABELS[status]}</option>)}
      </select></label>
    </div>
    <p className="text-sm text-muted-foreground">Every website inquiry stays here with its original details. Dates are Eastern time.</p>
    {visible.length === 0 ? <div className="rounded-xl border p-8 text-center text-muted-foreground">No inquiries match this view.</div> :
      <ul className="space-y-3">{visible.map((row) => <li key={row.id}><Link href={`/command-center/inquiries/${row.id}`} className="block rounded-xl border bg-card p-4 hover:border-amber-500 focus-visible:outline-2 focus-visible:outline-amber-500">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{inquiryText(row, "name")}</span><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{INTAKE_LABELS[intakeStatus(row)]}</span></div>
        <p className="mt-1 text-sm text-muted-foreground">{[inquiryText(row, "projectType").replaceAll("-", " "), inquiryText(row, "town")].filter(Boolean).join(" · ") || "Website inquiry"}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>{inquiryAge(row.created_at, now)}</span><span>Owner: {row.assignee || "Unassigned"}</span><span className={isOverdueInquiry(row, now) ? "font-medium text-red-600 dark:text-red-400" : ""}>{isOverdueInquiry(row, now) ? "Overdue: " : "Follow-up: "}{inquiryDateLabel(row.due_date)}</span></div>
        {row.status === "snoozed" && row.snooze_until && <p className="mt-2 text-xs text-muted-foreground">Snoozed until {inquiryDateLabel(row.snooze_until)}</p>}
      </Link></li>)}</ul>}
  </div>;
}
