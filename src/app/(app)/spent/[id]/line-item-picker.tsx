"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";

export interface PickerLine {
  id: string;
  description: string;
  trade: string | null;
  cost: number;
  groupLabel: string;
}

interface Props {
  invoiceId: string;
  projectId: string | null;
  currentLineItemId: string | null;
  currentLabel: string | null;
  currentDetail: string | null;
  lines: PickerLine[];
}

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export function LineItemPicker({
  invoiceId,
  projectId,
  currentLineItemId,
  currentLabel,
  currentDetail,
  lines,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(currentLineItemId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preserve the order the server sent (estimate version, then sort_order)
  const groups: { label: string; lines: PickerLine[] }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.label === line.groupLabel) last.lines.push(line);
    else groups.push({ label: line.groupLabel, lines: [line] });
  }

  async function handleChange(next: string) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/link-invoice-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId, line_item_id: next || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!projectId) {
    return <div className="text-[13px] text-muted-foreground italic">No project — nothing to book it to</div>;
  }

  if (lines.length === 0) {
    return (
      <div className="text-[13px] text-muted-foreground italic">
        This project has no estimate lines yet.{" "}
        <Link href={`/projects/${projectId}`} className="text-amber-500 hover:underline not-italic">
          Open the project
        </Link>
      </div>
    );
  }

  return (
    <div>
      {currentLineItemId && currentLabel && (
        <div className="mb-2">
          <div className="text-[14px] font-semibold">{currentLabel}</div>
          {currentDetail && (
            <div className="text-[11.5px] text-muted-foreground mt-1 line-clamp-2">{currentDetail}</div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          disabled={saving}
          className="w-full rounded-lg border bg-background px-3 py-2 text-[13px] text-foreground disabled:opacity-60"
        >
          <option value="">— Not linked —</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.lines.map((li) => (
                <option key={li.id} value={li.id}>
                  {li.trade ? `[${li.trade}] ` : ""}{li.description}
                  {li.cost ? ` · ${fmt(li.cost)}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
        {!saving && saved && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
      </div>

      {error && <div className="mt-1.5 text-[11.5px] text-red-500">{error}</div>}

      {value && (
        <Link
          href={`/projects/${projectId}`}
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-amber-500 hover:underline"
        >
          See the budget <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
