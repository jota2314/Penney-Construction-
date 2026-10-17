"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reviewSuggestion } from "@/lib/actions/agents";
import { PRICE_SOURCE_LABEL, STAGE_LABEL, type PriceSource, type Stage } from "@/lib/selections/ladder";
import type { PendingSelectionSuggestion } from "@/lib/selections/suggestions";

// Email suggestions waiting on a person, inside the Selections log panel.
// ✓ applies the change through the selections service (the ladder may refuse
// it, and then its words show here); ✗ only closes the suggestion.

// In reading order: the step, who picked it, the money, then the paperwork.
const FIELD_LABEL: Record<string, string> = {
  stage: "Step", selected_source: "Picked", ext_price: "Price", unit_price: "Unit price", price_source: "Price source",
  price_ref: "Price ref", price_date: "Price date", price_pending: "Price pending", vendor: "Vendor",
  order_ref: "Order", ordered_at: "Ordered", delivered_at: "Delivered",
  name: "Name", brand_model: "Model", section: "Section", quantity: "Qty", unit: "Unit",
};
const ORDER = Object.keys(FIELD_LABEL);
const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

function shown(field: string, v: unknown): string {
  if (v == null || v === "") return "none";
  if (field === "stage") return STAGE_LABEL[v as Stage] ?? String(v);
  if (field === "price_source") return PRICE_SOURCE_LABEL[v as PriceSource] ?? String(v);
  if (field === "unit_price" || field === "ext_price") return usd(Number(v));
  if (field.endsWith("_at") || field === "price_date") return day(String(v));
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function SelectionSuggestions({ suggestions, onChanged }: { suggestions: PendingSelectionSuggestion[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (suggestions.length === 0) return null;

  async function review(id: string, decision: "approved" | "dismissed") {
    setBusy(id);
    setErrors((e) => { const next = { ...e }; delete next[id]; return next; });
    const res = await reviewSuggestion(id, decision);
    setBusy(null);
    if (res.error) { setErrors((e) => ({ ...e, [id]: res.error! })); return; }
    onChanged();
  }

  return (
    <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <Mail className="h-3.5 w-3.5 text-amber-500" /> From email, waiting for a person ({suggestions.length})
      </p>
      <p className="mb-2 text-[11px] text-muted-foreground">Read from the job&apos;s mail. Nothing changes until someone approves it here.</p>
      <ul className="space-y-2">
        {suggestions.map((s) => {
          const p = s.payload;
          const fields = Object.entries(s.changes)
            .filter(([k]) => k !== "name" && (k !== "price_pending" || p.op === "update"))
            .sort(([a], [b]) => rank(a) - rank(b));
          return (
            <li key={s.id} className="rounded-md bg-background/60 p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-medium">{s.title}</p>
                <span className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" disabled={busy === s.id} onClick={() => review(s.id, "approved")} aria-label="Approve">
                    {busy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" disabled={busy === s.id} onClick={() => review(s.id, "dismissed")} aria-label="Dismiss">
                    <X className="h-4 w-4" />
                  </Button>
                </span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {fields.map(([k, v]) => (
                  <li key={k} className="text-[11px]">
                    <span className="text-muted-foreground">{FIELD_LABEL[k] ?? k}:</span>{" "}
                    {p.op === "update" && <><span className="text-muted-foreground line-through">{shown(k, s.before[k])}</span> → </>}
                    <span className="font-medium">{shown(k, v)}</span>
                  </li>
                ))}
              </ul>
              {p.evidence[0] && <p className="mt-1 text-[11px] italic text-muted-foreground">&ldquo;{p.evidence[0].text}&rdquo;</p>}
              <p className="text-[11px] text-muted-foreground">
                {p.email.from_name || p.email.from_email} · {day(p.email.date)} · {p.email.subject || "(no subject)"} ·{" "}
                <Link href={`/command-center/email/${p.email.id}`} className="underline hover:text-foreground">open email</Link>
              </p>
              {[...p.warnings.filter((w) => !w.startsWith("Approving will be refused")), ...(s.conflict ? [s.conflict] : [])].map((w) => (
                <p key={w} className="mt-1 flex gap-1 text-[11px] text-amber-500"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</p>
              ))}
              {s.blocked_by.length > 0 && (
                <p className="mt-1 text-[11px] text-red-400">Approving will be refused until this is fixed: {s.blocked_by.join(" ")}</p>
              )}
              {errors[s.id] && <p className="mt-1 rounded bg-red-500/10 p-1.5 text-[11px] text-red-400">{errors[s.id]}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
