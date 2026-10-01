"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BrainCircuit, Loader2, RefreshCw, Send, Users, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildWarehouseInsights, type WarehouseSnapshot } from "@/lib/warehouse/intelligence";
import { formatShopDateTime } from "@/lib/warehouse/checkouts";

type Answer = {
  answer: string;
  materials: { itemId: string; name: string; sku: string; quantity: number; unit: string; location: string | null; reason: string; verify: string }[];
  questions: string[];
  capturedAt: string;
  warnings: string[];
};

const starters = ["What should the warehouse handle first today?", "What do we have for roofing work?", "Who has materials out, and for which jobs?", "Which materials need better identification?"];

export function WarehouseIntelligence({ snapshot, error }: { snapshot: WarehouseSnapshot | null; error?: string }) {
  const router = useRouter();
  const insights = useMemo(() => snapshot ? buildWarehouseInsights(snapshot) : null, [snapshot]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [failure, setFailure] = useState("");
  const [tab, setTab] = useState<"priorities" | "people" | "activity">("priorities");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  async function ask(text: string) {
    if (busy || text.trim().length < 3) return;
    setBusy(true); setFailure(""); setAnswer(null); setAnswerQuestion(text); setQuestion(text);
    try {
      const response = await fetch("/api/warehouse/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }), signal: AbortSignal.timeout(60000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load answer");
      setAnswer(data);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not load answer. Please retry.");
    } finally { setBusy(false); }
  }

  const actions = insights?.actions.filter(a => `${a.title} ${a.detail}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const movements = snapshot?.transactions.filter(t => `${t.performed_by_name} ${t.employee_name} ${t.projects?.name} ${snapshot.items.find(i => i.id === t.item_id)?.name ?? t.item_id} ${t.notes}`.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><BrainCircuit className="h-5 w-5 shrink-0 text-primary" /> Warehouse intelligence</h2>
            <p className="mt-1 text-sm text-muted-foreground">Find materials, review stock needs, and track who is handling each item.</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Refresh warehouse records" onClick={() => { setAnswer(null); router.refresh(); }}><RefreshCw className="h-4 w-4" /></Button>
        </div>
        <form onSubmit={e => { e.preventDefault(); void ask(question); }} className="flex gap-2">
          <Input aria-label="Ask the warehouse assistant" placeholder="Tell me what you need for the job…" value={question} maxLength={1500} onChange={e => setQuestion(e.target.value)} disabled={busy} className="bg-background h-12" />
          <Button type="submit" disabled={busy || question.trim().length < 3} className="h-12 px-4" aria-label="Ask assistant">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
        </form>
        <div className="flex flex-wrap gap-2">{starters.map(s => <Button key={s} type="button" variant="outline" size="sm" disabled={busy} onClick={() => void ask(s)} className="h-auto whitespace-normal py-2 text-xs text-left">{s}</Button>)}</div>
        <div aria-live="polite">
          {busy && <p className="text-sm text-muted-foreground">Reading current stock, requests, checkouts and recorded activity…</p>}
          {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
          {answer && <div className="rounded-xl border bg-background p-4 space-y-4">
            <div><p className="text-xs text-muted-foreground">{answerQuestion} · Checked {formatShopDateTime(answer.capturedAt)}</p><p className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{answer.answer}</p></div>
            <div className="grid gap-3 md:grid-cols-2">{answer.materials.map((m, idx) => <Link key={`${m.itemId}:${idx}`} href={`/warehouse/items/${m.itemId}`} className="rounded-lg border p-3 hover:border-primary/40">
              <p className="text-sm font-semibold">{m.name} <ArrowRight className="inline h-3 w-3" /></p>
              <p className="text-xs text-muted-foreground mt-1">{m.sku} · {m.quantity} {m.unit} on shelf · {m.location || "Location not recorded"}</p>
              <p className="text-sm mt-2">{m.reason}</p>{m.verify && <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">Verify: {m.verify}</p>}
            </Link>)}</div>
            {answer.questions.length > 0 && <div className="text-sm"><p className="font-medium">Details to confirm</p><ul className="list-disc pl-5">{answer.questions.map(q => <li key={q}>{q}</li>)}</ul></div>}
            {answer.warnings.map(w => <p key={w} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
            <p className="text-xs text-muted-foreground">AI suggestions use recorded information. Open a material to verify its specifications and use the existing check-out, receiving or request workflow.</p>
          </div>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error} Refresh to retry; unavailable records are not treated as zero.</p>}
        {snapshot && insights && <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[[insights.actions.filter(a => a.priority === "urgent").length, "Urgent follow-ups"], [snapshot.orders.length, "Open requests"], [snapshot.checkouts.length, "Open checkouts"], [snapshot.transactions.length, "Recorded moves / 30 days"]].map(([n, label]) => <div key={label} className="rounded-lg bg-muted/40 border p-3"><p className="text-xl font-semibold">{n}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            {([['priorities', 'Next actions'], ['people', 'Who has what'], ['activity', 'Activity']] as const).map(([key, label]) => <Button key={key} variant={tab === key ? "default" : "ghost"} size="sm" onClick={() => { setTab(key); setFilter(""); setExpanded(false); }}>{label}</Button>)}
          </div>
          {tab !== "people" && <Input aria-label="Filter warehouse follow-ups or activity" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by material, person or job…" className="bg-background" />}
          {tab === "priorities" && <div className="space-y-2">
            {!snapshot.orders.length && <p className="text-xs text-muted-foreground">No open material requests are recorded. Job demand is unknown until requests are entered.</p>}
            {!actions.length && <p className="text-sm text-muted-foreground">No matching follow-ups in the loaded records.</p>}
            {actions.slice(0, expanded ? actions.length : 6).map(a => <Link key={a.id} href={a.href} className="flex gap-3 items-start rounded-lg border bg-background p-3 hover:border-primary/40"><ClipboardCheck className={`h-4 w-4 mt-0.5 shrink-0 ${a.priority === "urgent" ? "text-destructive" : "text-primary"}`} /><div className="min-w-0"><p className="text-sm font-medium">{a.title}</p><p className="text-xs text-muted-foreground mt-1">{a.detail}</p><p className="text-xs font-medium text-primary mt-2">{a.action} →</p></div></Link>)}
            {actions.length > 6 && <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${actions.length} follow-ups`}</Button>}
          </div>}
          {tab === "people" && <div className="space-y-4">
            <p className="text-xs text-muted-foreground">The person holding a material and the person recording its movement may be different.</p>
            {!snapshot.checkouts.length && <p className="text-sm">No open checkouts recorded.</p>}
            {snapshot.checkouts.map(c => <Link key={c.id} href="/warehouse/out" className="block rounded-lg bg-background border p-3"><div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" />{c.employee_name ?? "Holder not recorded"}</div><p className="text-sm mt-1">{c.quantity_outstanding} {c.unit} · {c.item_name}</p><p className="text-xs text-muted-foreground mt-1">{c.project_name ?? "Job not recorded"} · Out {formatShopDateTime(c.checked_out_at)} · Logged by {c.performed_by_name ?? "unknown"}</p></Link>)}
            <div className="border-t pt-3"><p className="text-sm font-medium mb-2">Who recorded movements · last 30 days</p>{insights.people.map(p => <p key={p.id} className="text-xs text-muted-foreground py-1">{p.name}{p.id.startsWith("unlinked:") ? " (unlinked name)" : ""} · {p.movements} movements · Last {formatShopDateTime(p.lastAt)}</p>)}<p className="text-xs text-muted-foreground mt-2">Activity reflects app records, not attendance or total work performed.</p></div>
          </div>}
          {tab === "activity" && <div className="space-y-2">
            {!movements.length && <p className="text-sm text-muted-foreground">No matching movements in the last 30 days.</p>}
            {movements.slice(0, expanded ? movements.length : 12).map(t => <Link key={t.id} href={`/warehouse/items/${t.item_id}`} className="block rounded-lg border bg-background p-3"><p className="text-sm font-medium">{snapshot.items.find(i => i.id === t.item_id)?.name ?? "Archived material"} · {t.type.replaceAll("_", " ")} · {Number(t.quantity_change) > 0 ? "+" : ""}{t.quantity_change}</p><p className="text-xs text-muted-foreground mt-1">{formatShopDateTime(t.created_at)} · Logged by {t.performed_by_name ?? "unknown"}{t.employee_name ? ` · Handled by ${t.employee_name}` : " · Handler not recorded"}{t.projects?.name ? ` · ${t.projects.name}` : ""}</p>{t.notes && <p className="text-xs mt-1">{t.notes}</p>}</Link>)}
            {movements.length > 12 && <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${movements.length} movements`}</Button>}
          </div>}
          {snapshot.warnings.map(w => <p key={w} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
          <p className="text-[11px] text-muted-foreground">Records checked {formatShopDateTime(snapshot.capturedAt)}. Refresh after changes. Suggested replenishment is a planning estimate, not a purchase or reservation.</p>
        </>}
      </div>
    </Card>
  );
}
