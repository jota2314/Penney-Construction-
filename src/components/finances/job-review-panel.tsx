"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet, BottomSheetBody, BottomSheetContent, BottomSheetDescription, BottomSheetFooter, BottomSheetHeader, BottomSheetTitle } from "@/components/ui/bottom-sheet";
import { buildClaudeReviewUrl, buildCodexReviewUrl, buildReviewPrompt, DEFAULT_CODEX_WORKSPACE } from "@/lib/codex/review";
import type { Finding, JobReview } from "@/lib/job-review/engine";
import type { inspectFinding, previewCorrection } from "@/lib/job-review/service";

type Detail = Awaited<ReturnType<typeof inspectFinding>>;
type Preview = Awaited<ReturnType<typeof previewCorrection>>;
const dollars = (c: number | null) => c === null ? "Not verified" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const hours = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
const labels: Record<string, string> = { cost_overrun: "Over cost budget", allocation_question: "Check allocation", missing_budget: "Missing cost budget", forecast_risk: "Forecast risk", question: "Open question", verified_cost: "Reviewed evidence" };

export function JobReviewPanel({ projectId, initialReview }: { projectId: string; initialReview?: JobReview }) {
  const [open, setOpen] = useState(!!initialReview);
  const [review, setReview] = useState<JobReview | null>(initialReview ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState("status");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [record, setRecord] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selected) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [selected]);
  async function request<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch("/api/job-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, project_id: projectId, ...args }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Could not load review.");
    return value as T;
  }
  async function refresh() {
    setOpen(true); setBusy(true); setError(""); setDetail(null); setSelected(null); setPreview(null);
    try { setReview(await request<JobReview>("get_job_review")); }
    catch (e) { setError(e instanceof Error ? e.message : "Review unavailable."); }
    finally { setBusy(false); }
  }
  async function inspect(f: Finding) {
    if (!review) return;
    setSelected(f); setDetail(null); setPreview(null); setRecord(""); setReason(""); setTarget(""); setError(""); setBusy(true);
    try { setDetail(await request<Detail>("inspect_job_finding", { run_id: review.run_id, finding_id: f.id })); }
    catch (e) { setError(e instanceof Error ? e.message : "Evidence unavailable."); }
    finally { setBusy(false); }
  }
  async function makePreview() {
    if (!selected || !record) return;
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await request<Preview>("preview_job_correction", { kind: record.startsWith("invoices:") ? "invoice_allocation" : "labor_allocation", record_id: record.split(":")[1], target_line_id: target, reason, evidence_refs: selected.refs })); }
    catch (e) { setError(e instanceof Error ? e.message : "Preview unavailable."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ verification: string; review?: JobReview }>("apply_job_correction", { preview_id: preview.id, authorized: true });
      setNotice(result.verification); if (result.review) setReview(result.review);
      setPreview(null); setDetail(null); setSelected(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Correction failed. Refresh before retrying."); }
    finally { setBusy(false); }
  }
  function discuss(buildUrl: (prompt: string, workspace: string) => string) {
    const prompt = buildReviewPrompt({ kind: "job", projectId }, window.location.origin);
    let workspace = DEFAULT_CODEX_WORKSPACE; try { workspace = localStorage.getItem("penney.codex.workspace") || workspace; } catch { /* optional */ }
    window.location.href = buildUrl(prompt, workspace);
  }
  const warnings = review?.findings.filter(f => f.amount !== null) ?? [];
  return <>
    <Button type="button" variant="outline" onClick={refresh}><Sparkles aria-hidden="true" />Review job</Button>
    <BottomSheet open={open} onOpenChange={setOpen}>
      <BottomSheetContent className="md:max-w-2xl">
        <BottomSheetHeader>
          <BottomSheetTitle>{review?.project.name ?? "Job review"}</BottomSheetTitle>
          <BottomSheetDescription>{review ? `Checked ${new Date(review.as_of).toLocaleString()} · ${(review.elapsed_ms / 1000).toFixed(1)}s · Saved` : "Checking current costs, billing, work and open issues."}</BottomSheetDescription>
        </BottomSheetHeader>
        <BottomSheetBody className="space-y-5">
          <label className="block text-sm font-medium">Review focus
            <select className="mt-1 w-full rounded border bg-background p-2" value={focus} onChange={e => setFocus(e.target.value)}>
              <option value="status">Where does the job stand?</option><option value="closeout">Can I close this job?</option><option value="unsure">I’m not sure — tell me what matters</option>
            </select>
          </label>
          {busy && <p role="status" className="text-sm">Checking records…</p>}
          {error && <p role="alert" className="rounded border border-red-500/30 p-3 text-sm text-red-500">{error}{review && " The saved results below may be out of date."}</p>}
          {notice && <p role="status" className="text-sm">{notice}</p>}
          {review && <>
            <div className="rounded-lg border p-3">
              <p className="font-semibold">{review.stage.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{review.stage.basis}</p>
              {focus === "closeout" && <p className="mt-2 text-sm font-medium">Closure is not verified. Confirm remaining work, final costs, permit/inspection release and client acceptance.</p>}
              {review.stage.active_phases.length > 0 && <p className="mt-2 text-sm">Active: {review.stage.active_phases.map(p => p.name).join(", ")}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[ ["Recorded cost", dollars(review.money.recorded_cost)], ["Cost budget", dollars(review.money.cost_budget)], ["Contract left to collect", dollars(review.money.contract_remaining)], ["Final profit", "Not verified"] ].map(([label, value]) => <div key={label} className="rounded-lg bg-muted/50 p-3"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}
            </dl>
            <p className="text-xs text-muted-foreground">Cost includes {dollars(review.money.modeled_wages)} modeled wages ({hours(review.money.net_minutes)}). Known unbilled commitments: {dollars(review.money.known_unbilled_commitments)}. Remaining contract is not the same as overdue billing.</p>
            <section className="space-y-2" aria-label="Cost warnings"><p className="font-semibold">Costs that need attention</p>
              {warnings.length === 0 && <p className="text-sm text-muted-foreground">No recorded line-item cost warnings. Source verification and remaining costs still need review.</p>}
              {warnings.map(f => <button key={f.id} type="button" className="block w-full rounded-lg border p-3 text-left hover:bg-muted/40" onClick={() => inspect(f)} disabled={busy}>
                <span className="flex justify-between gap-3 font-medium"><span>{f.title}</span><span className="shrink-0 tabular-nums">{dollars(f.amount)}</span></span>
                <span className="mt-1 block text-xs font-medium text-amber-600 dark:text-amber-400">{labels[f.kind] ?? f.kind} · {f.evidence_state === "verified" ? "Evidence checked" : "Needs verification"}</span>
                {review.scopes.filter(s => s.id === f.line_id).map(s => <span key={s.id} className="mt-1 block text-xs text-muted-foreground">Budget {dollars(s.budget)} · Cost {dollars(s.cost)} · Crew {hours(s.minutes)}</span>)}
              </button>)}
            </section>
            <section><p className="font-semibold">Next three actions</p><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{review.next_actions.map(a => <li key={a}>{a}</li>)}</ol></section>
            <details><summary className="cursor-pointer text-sm font-medium">All scopes and crew hours</summary>
              <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Scope", "Budget", "Cost", "Hours", "Over / (under)"].map(c => <th key={c} className="px-2 py-2">{c}</th>)}</tr></thead><tbody>{review.scopes.filter(s => s.id !== "unallocated" || s.cost || s.minutes).map(s => <tr key={s.id} className="border-t"><td className="p-2">{s.name}</td><td className="p-2 tabular-nums">{dollars(s.budget)}</td><td className="p-2 tabular-nums">{dollars(s.cost)}</td><td className="p-2 whitespace-nowrap">{hours(s.minutes)}</td><td className="p-2 tabular-nums">{s.budget === null || s.budget === 0 ? "No budget" : dollars(s.cost - s.budget)}</td></tr>)}</tbody><tfoot><tr className="border-t font-semibold"><td className="p-2">Total</td><td className="p-2">{dollars(review.money.cost_budget)}</td><td className="p-2">{dollars(review.money.recorded_cost)}</td><td className="p-2 whitespace-nowrap">{hours(review.money.net_minutes)}</td><td className="p-2">{review.money.cost_budget === null ? "Unknown" : dollars(review.money.recorded_cost - review.money.cost_budget)}</td></tr></tfoot></table></div>
            </details>
            <details><summary className="cursor-pointer text-sm font-medium">Billing and open issues ({review.findings.filter(f => f.amount === null).length})</summary><div className="mt-2 space-y-3 text-sm">
              {review.collections.map(i => <p key={i.id}>Invoice #{String(i.number)}: {dollars(i.remaining)} remaining · {i.overdue ? "Overdue" : i.due_date ? `Due ${i.due_date}` : "Due date missing"}</p>)}
              {review.findings.filter(f => f.amount === null).map(f => <button key={f.id} className="block w-full rounded border p-3 text-left" onClick={() => inspect(f)} disabled={busy}>{f.title}<span className="mt-1 block text-xs text-muted-foreground">{f.action}</span></button>)}
            </div></details>
            {selected && <section ref={detailRef} className="space-y-3 rounded-lg border p-3" aria-label="Supporting evidence">
              <p className="font-semibold">{selected.title}</p><p className="text-sm">{selected.detail}</p>
              {detail?.sources.map(s => <div key={s.ref} className="space-y-1 border-t pt-2 text-xs"><p className="break-all font-mono">{s.ref}</p>{"fields" in s && s.fields && <p>{String(s.fields.vendor_name ?? s.fields.description ?? s.fields.name ?? s.fields.title ?? s.fields.subject ?? "Source record")}</p>}{"documents" in s && s.documents?.map(d => d.url ? <a key={d.ref} href={d.url} target="_blank" rel="noopener noreferrer" className="block underline">Open original source</a> : <p key={d.ref}>Source unavailable</p>)}</div>)}
              <details><summary className="cursor-pointer text-sm font-medium">Correct a verified allocation</summary><div className="mt-3 space-y-2 text-sm">
                <p>Open the source first. This moves the selected bill or shift to another scope on this job.</p>
                <label className="block">Record<select className="mt-1 w-full rounded border bg-background p-2" value={record} onChange={e => { setRecord(e.target.value); setPreview(null); }}><option value="">Choose record</option>{selected.refs.filter(r => /^(invoices|all_day_shifts):/.test(r)).map(r => { const source = detail?.sources.find(s => s.ref === r); const f = source && "fields" in source ? source.fields : null; return <option key={r} value={r}>{f ? `${String(f.vendor_name ?? f.started_at ?? "Crew shift")} ${f.invoice_number ? `#${f.invoice_number}` : ""} ${f.amount != null ? dollars(Math.round(Number(f.amount) * 100)) : ""}` : r}</option>; })}</select></label>
                <label className="block">Correct scope<select className="mt-1 w-full rounded border bg-background p-2" value={target} onChange={e => { setTarget(e.target.value); setPreview(null); }}><option value="">Choose scope</option>{review.scopes.filter(s => s.id !== "unallocated").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="block">Evidence and reason<textarea value={reason} onChange={e => { setReason(e.target.value); setPreview(null); }} className="mt-1 w-full rounded border bg-background p-2" placeholder="What in the source confirms this correction?" /></label>
                <Button variant="outline" onClick={makePreview} disabled={busy || !record || !target || reason.trim().length < 8}>Preview correction</Button>
                {preview && <div className="space-y-2 rounded border p-3">{preview.effects.map(e => <p key={e.line_id}>{e.name}: {dollars(e.before_cost)} → {dollars(e.after_cost)}; {hours(e.before_minutes)} → {hours(e.after_minutes)}</p>)}<p>Job cost stays {dollars(preview.total_cost_after)}. Budgets and payments stay the same.</p><Button onClick={apply} disabled={busy}>Apply this correction</Button></div>}
              </div></details>
            </section>}
            <details><summary className="cursor-pointer text-sm font-medium">What changed and what is unverified</summary><div className="mt-2 space-y-2 text-xs text-muted-foreground"><p>{review.changes.added.length} added · {review.changes.changed.length} changed · {review.changes.removed.length} removed · {review.changes.unchanged} unchanged records.</p><p>{review.coverage.explanation}</p>{review.coverage.gaps.map(g => <p key={g}>{g}</p>)}<p>Saved review: {review.run_id}</p></div></details>
          </>}
        </BottomSheetBody>
        <BottomSheetFooter>
          <Button variant="outline" onClick={refresh} disabled={busy}><RefreshCw aria-hidden="true" />Refresh review</Button>
          <Button variant="ghost" onClick={() => discuss(buildClaudeReviewUrl)}><ExternalLink aria-hidden="true" />Discuss in Claude</Button>
          <Button variant="ghost" onClick={() => discuss(buildCodexReviewUrl)}><ExternalLink aria-hidden="true" />Discuss in Codex</Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  </>;
}
