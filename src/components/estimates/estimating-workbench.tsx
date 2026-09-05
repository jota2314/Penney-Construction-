"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, FileText, Mail, Search, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import type { EstimatingWorkbenchData } from "@/lib/actions/estimating-workbench";
import type { PriceEvidence } from "@/lib/estimates/workbench";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const card = "rounded-xl border bg-card p-5";

export function EstimatingWorkbench({ data, estimates }: { data: EstimatingWorkbenchData; estimates: { id: string; project_id: string | null; status: string; version: number; total_price: number; name: string }[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const latest = new Map<string, typeof estimates[number]>();
  for (const estimate of estimates) {
    if (!estimate.project_id || ["rejected", "superseded"].includes(estimate.status)) continue;
    const previous = latest.get(estimate.project_id);
    if (!previous || estimate.version > previous.version) latest.set(estimate.project_id, estimate);
  }
  const projects = data.projects.filter(p => `${p.name} ${p.project_number}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-semibold">What needs an estimate?</h2><p className="text-sm text-muted-foreground mt-1">Requests, drawings, prices, and your next move.</p></div><button className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" onClick={() => router.refresh()}><RefreshCw size={14} />Refresh</button></div>
    {data.error && <div role="alert" className="rounded-lg border border-red-500 p-3 text-sm">Some estimating records could not load: {data.error}</div>}
    <div className="grid gap-3 sm:grid-cols-4">{[["01", "Request", `${data.requests.length} recent requests`], ["02", "Takeoff", "Read plans · count materials"], ["03", "Price", "Materials + labor + sub scopes"], ["04", "Proposal", "Review allowances + margin"]].map(([n, title, subtitle]) => <div className={card} key={n}><span className="text-xs text-amber-500">{n}</span><h3 className="font-semibold mt-2">{title}</h3><p className="text-xs text-muted-foreground mt-1">{subtitle}</p></div>)}</div>
    {data.requests.length > 0 && <section className={card}><h3 className="font-semibold flex items-center gap-2"><Mail size={16} />Recent estimate requests</h3><div className="grid gap-3 mt-4 lg:grid-cols-2">{data.requests.slice(0, 8).map(email => {
      const projectId = email.project_id || email.matched_project_id;
      return <div key={email.id} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{email.from_name || email.from_email} · {new Date(email.date).toLocaleDateString()}</p><p className="font-medium text-sm mt-1">{email.ai_summary || email.subject}</p><div className="flex gap-4 mt-2 text-xs text-amber-500"><Link href={`/command-center/email/${email.id}`}>Read email</Link>{projectId ? <Link href={`/projects/${projectId}`}>Open project →</Link> : <Link href="/projects">Find matching project →</Link>}</div></div>;
    })}</div><p className="text-xs text-muted-foreground mt-3">Latest 90 days · requests may already be underway; open the project to check status.</p></section>}
    <div className="flex items-center gap-2"><Search size={16}/><input aria-label="Find a project to estimate" placeholder="Find a project…" className="bg-transparent border rounded-lg p-2 w-full max-w-md text-sm" value={search} onChange={e => setSearch(e.target.value)}/></div>
    <div className="grid gap-4 lg:grid-cols-3">{projects.map(project => {
      const estimate = latest.get(project.id);
      const quotes = data.quotes.filter(q => q.project_id === project.id);
      const drawings = project.drawingCount;
      return <article className={`${card} flex flex-col gap-3`} key={project.id}><div className="text-xs text-amber-500">{project.project_number} · {project.status.replaceAll("_", " ")}</div><h3 className="font-semibold">{project.name}</h3><p className="text-2xl font-semibold">{estimate ? money(Number(estimate.total_price)) : "Start pricing"}</p><p className="text-xs text-muted-foreground">{estimate ? `${estimate.name} · v${estimate.version} · ${estimate.status}` : "No current estimate"}</p><div className="flex gap-3 text-xs"><span><FileText size={12} className="inline mr-1"/>{drawings} linked drawings</span><span>{quotes.length} recent quotes</span></div><p className="text-sm text-muted-foreground flex-1">{project.next_action || (estimate ? "Review scope, missing prices, and allowances." : "Confirm scope and drawings, then build the preliminary estimate.")}</p><Link className="rounded-lg bg-amber-500/15 text-amber-500 p-3 text-sm flex items-center justify-between" href={estimate ? `/projects/${project.id}/estimates/${estimate.id}` : `/projects/${project.id}`}>{estimate ? "Continue estimate" : "Open project"}<ArrowRight size={16}/></Link></article>;
    })}</div>
    {projects.length === 0 && !data.error && <p className="text-sm text-muted-foreground">No active projects match this search.</p>}
  </div>;
}

export function QuoteEvidence({ quotes }: { quotes: PriceEvidence[] }) {
  const [query, setQuery] = useState("");
  const matches = quotes.filter(q => `${q.trade} ${q.subcontractor_name} ${q.scope_description}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-4"><div><h2 className="text-xl font-semibold">Prices received</h2><p className="text-sm text-muted-foreground">Each bidder and scope stays separate. Package totals are not unit rates.</p></div><input className="border rounded-lg bg-transparent p-3 w-full" aria-label="Search price evidence" placeholder="Plumbing, electrical, kitchen, bidder…" value={query} onChange={e => setQuery(e.target.value)}/><div className="grid gap-3 lg:grid-cols-2">{matches.map(q => <article key={q.id} className={card}><div className="flex justify-between gap-3"><div><p className="text-xs uppercase text-amber-500">{q.trade}</p><h3 className="font-medium mt-1">{q.subcontractor_name}</h3></div><p className="text-xl font-semibold">{q.amount == null ? "Unpriced" : money(Number(q.amount))}</p></div><p className="text-xs text-muted-foreground mt-2">{q.status || "Received"} · recorded {new Date(q.created_at).toLocaleDateString()}</p><p className="text-sm mt-3 whitespace-pre-line">{q.scope_description || "Scope needs review before using this price."}</p>{q.project_id && <Link className="text-xs text-amber-500 inline-block mt-3" href={`/projects/${q.project_id}`}>Check project scope & drawings →</Link>}</article>)}</div><p className="text-xs text-muted-foreground">Latest 150 priced quote records. Recorded date may differ from the proposal date. Quote status is the saved office record, not proof of signature.</p></section>;
}

export function LaborEvidence({ logs }: { logs: EstimatingWorkbenchData["labor"] }) {
  const [query, setQuery] = useState("");
  const paired = logs.filter(day => day.hours > 0 && day.notes.length > 0);
  const filtered = logs.filter(day => `${day.projectName} ${day.workerName} ${day.notes.map(note => note.text).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-4">
    <h2 className="text-xl font-semibold">What the crew did + hours recorded</h2>
    <p className="text-sm text-muted-foreground">Matched by worker, job, and work date. The estimating AI reads these combined records before pricing proposals.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      {[[logs.length, "Worker / job / day records"], [paired.length, "Days with hours + descriptions"], [logs.filter(day => day.flags.length).length, "Days needing review"]].map(([value, label]) => <div className={card} key={label}><p className="text-3xl font-semibold">{value}</p><p className="text-sm text-muted-foreground mt-1">{label}</p></div>)}
    </div>
    <input aria-label="Search field learning" placeholder="Find a job, worker, or task…" value={query} onChange={event => setQuery(event.target.value)} className="border rounded-lg bg-transparent p-3 w-full" />
    <div className="grid gap-3 lg:grid-cols-2">
      {filtered.slice(0, 60).map(day => <article key={`${day.projectId}:${day.workerId}:${day.day}`} className={card}>
        <p className="font-semibold">{day.projectName}</p>
        <p className="text-sm text-muted-foreground mt-1">{day.workerName} · {day.day}</p>
        <p className="text-2xl font-semibold mt-3">{day.hours > 0 ? `${day.hours.toFixed(2)} recorded hours` : "No usable completed hours"}</p>
        <div className="space-y-2 mt-3">{day.notes.length ? day.notes.map(note => <p className="text-sm whitespace-pre-line" key={note.id}>{note.text}</p>) : <p className="text-sm text-muted-foreground">Work description missing.</p>}</div>
        {day.flags.length > 0 && <p className="text-xs text-amber-500 mt-3">{day.flags.join(" · ")}</p>}
        <details className="text-xs text-muted-foreground mt-3"><summary>Evidence used by AI</summary><p className="mt-2 break-all">Shift records: {day.shiftIds.join(", ") || "None"}. Note records: {day.notes.map(note => note.id).join(", ") || "None"}.</p></details>
        <Link href={`/projects/${day.projectId}`} className="text-xs text-amber-500 inline-block mt-3">Open job →</Link>
      </article>)}
    </div>
    <p className="text-xs text-muted-foreground">Past 180 days · showing up to 60 matching days. Hours cover all tasks that day, before unrecorded breaks. Unit production rates require matching completed quantities and task hours.</p>
  </section>;
}
