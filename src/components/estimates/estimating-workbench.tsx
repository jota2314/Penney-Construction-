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
  const timed = logs.filter(l => l.started_at && l.ended_at && new Date(l.ended_at).getTime() > new Date(l.started_at).getTime());
  const linked = timed.filter(l => l.estimate_line_item_id && !l.line_item_needs_review);
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Learn from field work</h2><div className="grid gap-3 sm:grid-cols-3">{[[logs.length, "Recent field entries"], [timed.length, "Entries with recorded time"], [linked.length, "Timed entries linked to scope"]].map(([value, label]) => <div className={card} key={label}><p className="text-3xl font-semibold">{value}</p><p className="text-sm text-muted-foreground mt-1">{label}</p></div>)}</div><p className="text-sm text-muted-foreground">A reliable labor rate needs completed quantity + crew hours + loaded labor cost for the same scope. A daily note alone does not establish hours per linear foot. Latest 200 entries, up to 90 days.</p><div className="grid gap-3 lg:grid-cols-2">{logs.slice(0, 24).map(log => <article key={log.id} className={card}><p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleDateString()} · {log.estimate_line_item_id ? "Scope linked" : "Scope link needed"}</p><p className="text-sm mt-2">{log.text || "Time entry"}</p>{log.project_id && <Link href={`/projects/${log.project_id}`} className="text-xs text-amber-500 inline-block mt-3">Open job →</Link>}</article>)}</div></section>;
}
