"use client";

import { useState } from "react";
import { Clock3, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  BottomSheet, BottomSheetBody, BottomSheetContent, BottomSheetDescription,
  BottomSheetHeader, BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import {
  getTimeMaterials, saveTimeMaterialEntry, publishTimeMaterialEntry, voidTimeMaterialEntry,
} from "@/lib/actions/time-materials";
import type { TimeMaterialEntry, TimeMaterialSource } from "@/lib/time-materials";
import { formatMoney } from "@/lib/money";

const inputClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
const buttonClass = "rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50";
const dateToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const formatRate = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const blank = () => ({ date: dateToday(), category: "labor", description: "", quantity: "", unit: "hr", rate: "", source: "" });

/** A billing log, not a bill or invoice editor. Existing job records remain authoritative. */
export function TimeMaterialsLog({ changeOrderId, projectId, coNumber, terms, status }: {
  changeOrderId: string; projectId: string; coNumber: number; terms: string | null; status: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimeMaterialEntry[]>([]);
  const [sources, setSources] = useState<TimeMaterialSource[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<TimeMaterialEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const inactive = status === "void" || status === "rejected";
  const publishReady = ["submitted", "approved"].includes(status) && !!terms?.trim();

  async function refresh() {
    const result = await getTimeMaterials(changeOrderId, projectId);
    if (result.error) { setError(result.error); return; }
    setEntries(result.entries ?? []);
    setSources(result.sources ?? []);
  }
  async function openLog() {
    setOpen(true); setLoading(true); setError(null);
    try { await refresh(); } catch { setError("Could not load the T&M log. Please try again."); }
    finally { setLoading(false); }
  }
  function edit(entry: TimeMaterialEntry) {
    setEditing(entry); setShowForm(true); setError(null);
    setForm({ date: entry.work_date, category: entry.category, description: entry.description,
      quantity: String(entry.quantity), unit: entry.unit, rate: entry.unit_rate == null ? "" : String(entry.unit_rate),
      source: entry.source_daily_log_id ? `labor:${entry.source_daily_log_id}` : entry.source_invoice_id ? `invoice:${entry.source_invoice_id}` : "" });
  }
  function chooseSource(value: string) {
    const source = sources.find(s => `${s.source_type}:${s.id}` === value);
    setForm(f => source ? { ...f, source: value, date: source.work_date, description: source.description,
      category: source.source_type === "labor" ? "labor" : "material", quantity: String(source.quantity), unit: source.unit, rate: "" }
      : { ...f, source: value });
  }
  async function save() {
    setBusy(true); setError(null);
    try {
      const result = await saveTimeMaterialEntry({
        id: editing?.id, project_id: projectId, change_order_id: changeOrderId,
        work_date: form.date, category: form.category as TimeMaterialEntry["category"],
        description: form.description.trim(), quantity: Number(form.quantity), unit: form.unit.trim(),
        unit_rate: form.rate.trim() === "" ? null : Number(form.rate),
        source_daily_log_id: form.source.startsWith("labor:") ? form.source.slice(6) : null,
        source_invoice_id: form.source.startsWith("invoice:") ? form.source.slice(8) : null,
        expected_updated_at: editing?.updated_at,
      });
      if (result.error) { setError(result.error); return; }
      setEditing(null); setShowForm(false); setForm(blank()); await refresh(); router.refresh();
    } catch { setError("The entry could not be saved. Reload the log before retrying."); }
    finally { setBusy(false); }
  }
  async function publish(entry: TimeMaterialEntry) {
    setBusy(true); setError(null);
    try {
      const result = await publishTimeMaterialEntry(entry.id, projectId, entry.updated_at);
      if (result.error) { setError(result.error); return; }
      setPublishId(null); await refresh(); router.refresh();
    } catch { setError("Publishing could not be confirmed. Reload the log before retrying."); }
    finally { setBusy(false); }
  }
  async function voidEntry(entry: TimeMaterialEntry) {
    setBusy(true); setError(null);
    try {
      const result = await voidTimeMaterialEntry(entry.id, projectId, voidReason.trim(), entry.updated_at);
      if (result.error) { setError(result.error); return; }
      setVoidId(null); setVoidReason(""); await refresh(); router.refresh();
    } catch { setError("The correction could not be confirmed. Reload the log before retrying."); }
    finally { setBusy(false); }
  }

  const published = entries.filter(e => e.status === "published");
  const total = published.reduce((n, e) => n + Math.round(Number(e.amount ?? 0) * 100), 0) / 100;
  const hours = published.filter(e => e.category === "labor" && ["hr", "hour", "hours", "hrs"].includes(e.unit.toLowerCase()))
    .reduce((n, e) => n + Number(e.quantity), 0);

  return <>
    <button onClick={openLog} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium hover:bg-muted"><Clock3 className="h-3 w-3" /> T&M log</button>
    <BottomSheet open={open} onOpenChange={setOpen}>
      <BottomSheetContent className="md:max-w-2xl">
        <BottomSheetHeader>
          <BottomSheetTitle>CO #{coNumber} · Time & materials</BottomSheetTitle>
          <BottomSheetDescription>Measure the added work, review client charges, then publish the entries to the client portal.</BottomSheetDescription>
        </BottomSheetHeader>
        <BottomSheetBody className="space-y-5">
          {loading ? <div className="flex items-center gap-2 py-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading log…</div> : <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-orange-500/10 p-4"><p className="text-xs text-muted-foreground">Published charges to date</p><p className="mt-1 text-2xl font-semibold">{formatMoney(total)}</p></div>
              <div className="rounded-xl bg-muted p-4"><p className="text-xs text-muted-foreground">Published labor hours</p><p className="mt-1 text-2xl font-semibold">{hours.toLocaleString("en-US", { maximumFractionDigits: 3 })}</p></div>
            </div>
            <p className="text-xs text-muted-foreground">Published entries appear when this change order is shared with the client. These are tracked charges, not invoices or payments. Use the existing invoice workflow to bill them.</p>
            <div className="rounded-lg border p-3 text-xs"><p className="font-semibold">Billing rates and terms</p><p className="mt-1 whitespace-pre-wrap">{terms || "Not set. Edit this change order to enter the billing rates and terms before sharing it."}</p></div>
            {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
            {!publishReady && !inactive && <p className="text-xs text-amber-600">Save measured work as drafts now. Share or approve the change order with its billing terms before publishing charges.</p>}
            {!inactive && <button className={`${buttonClass} flex items-center gap-1.5`} disabled={busy} onClick={() => { setEditing(null); setForm(blank()); setShowForm(true); setError(null); }}><Plus className="h-3.5 w-3.5" />Add entry</button>}
            {showForm && <div className="space-y-3 rounded-xl border p-4">
              <h3 className="font-semibold text-sm">{editing ? "Edit draft entry" : "New draft entry"}</h3>
              <label className="block text-xs">Existing job record (optional)
                <select className={inputClass} value={form.source} onChange={e => chooseSource(e.target.value)}>
                  <option value="">Enter measured work manually</option>
                  {form.source && !sources.some(s => `${s.source_type}:${s.id}` === form.source) && <option value={form.source}>Linked source record</option>}
                  {sources.map(s => <option key={`${s.source_type}:${s.id}`} value={`${s.source_type}:${s.id}`}>{s.work_date} · {s.description}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">Link completed labor or an existing allocated bill. Enter the client billing rate below; employee pay and vendor cost are not copied into it.</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">Work date<input className={inputClass} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
                <label className="text-xs">Category<select className={inputClass} value={form.category} onChange={e => setForm({ ...form, category: e.target.value, unit: e.target.value === "labor" ? "hr" : "ea" })}>{["labor", "material", "equipment", "other"].map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
              </div>
              <label className="block text-xs">Client description<textarea className={inputClass} rows={3} maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Chip out damaged bathroom slab" /></label>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-xs">Quantity<input className={inputClass} type="number" min="0.0001" step="0.0001" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
                <label className="text-xs">Unit<input className={inputClass} value={form.unit} maxLength={24} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="hr, ea, SF" /></label>
                <label className="text-xs">Client rate ($)<input className={inputClass} type="number" min="0" step="0.0001" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder="Pending" /></label>
              </div>
              <p className="text-xs text-muted-foreground">A blank rate means pricing is pending. Save the measured quantity now and price it before publishing.</p>
              <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => setShowForm(false)}>Cancel</button><button className={`${buttonClass} bg-orange-600 text-white hover:bg-orange-700`} disabled={busy || !form.description.trim() || !(Number(form.quantity) > 0) || !form.unit.trim() || !form.date || (form.rate !== "" && (!Number.isFinite(Number(form.rate)) || Number(form.rate) < 0))} onClick={save}>{busy ? "Saving…" : "Save draft"}</button></div>
            </div>}
            <div className="space-y-3">
              {entries.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No work recorded yet. Add hours or material quantities to start tracking this change.</p>}
              {entries.map(entry => <article key={entry.id} className="rounded-xl border p-4 space-y-2">
                <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{entry.work_date} · {entry.category} · {entry.status === "published" ? "Published" : entry.status === "void" ? "Voided" : "Draft — not visible to client"}</p><p className={`mt-1 text-sm font-medium ${entry.status === "void" ? "line-through text-muted-foreground" : ""}`}>{entry.description}</p></div><p className="shrink-0 text-sm font-semibold">{entry.amount == null ? "Unpriced" : formatMoney(Number(entry.amount))}</p></div>
                <p className="text-xs text-muted-foreground">{entry.quantity} {entry.unit} × {entry.unit_rate == null ? "rate pending" : formatRate(Number(entry.unit_rate))}</p>
                {entry.void_reason && <p className="text-xs text-muted-foreground">Correction: {entry.void_reason}</p>}
                {!inactive && entry.status !== "void" && <div className="flex flex-wrap gap-2">
                  {entry.status === "draft" && <><button className={buttonClass} disabled={busy} onClick={() => edit(entry)}>Edit</button><button className={buttonClass} disabled={busy || entry.unit_rate == null || !publishReady} onClick={() => { setPublishId(entry.id); setVoidId(null); }}>Review & publish</button></>}
                  <button className={buttonClass} disabled={busy} onClick={() => { setVoidId(entry.id); setPublishId(null); setVoidReason(""); }}>Void entry</button>
                </div>}
                {publishId === entry.id && <div className="space-y-2 rounded-lg bg-orange-500/10 p-3"><p className="text-xs">Publish this description, {entry.quantity} {entry.unit} at {formatRate(Number(entry.unit_rate))}, totaling {formatMoney(Number(entry.amount))}, to the client portal? Published charges can be corrected by voiding the entry with a reason.</p><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => setPublishId(null)}>Cancel</button><button className={buttonClass} disabled={busy} onClick={() => publish(entry)}>{busy ? "Publishing…" : "Publish entry"}</button></div></div>}
                {voidId === entry.id && <div className="space-y-2 rounded-lg bg-muted p-3"><label className="text-xs">{entry.published_at ? "Client-visible reason for correction" : "Reason for correction"}<input className={inputClass} value={voidReason} onChange={e => setVoidReason(e.target.value)} maxLength={1000} /></label><p className="text-xs text-muted-foreground">The original entry remains in the history and is excluded from the running total.</p><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => setVoidId(null)}>Cancel</button><button className={buttonClass} disabled={busy || !voidReason.trim()} onClick={() => voidEntry(entry)}>{busy ? "Saving…" : "Void with reason"}</button></div></div>}
              </article>)}
            </div>
          </>}
        </BottomSheetBody>
      </BottomSheetContent>
    </BottomSheet>
  </>;
}
