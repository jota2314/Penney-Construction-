"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, Loader2, Search, Split, X } from "lucide-react";
import { InvoiceSplitDialog } from "@/components/projects/invoice-split-dialog";

export interface PickerLine {
  id: string;
  description: string;
  trade: string | null;
  cost: number;
  groupLabel: string;
  isSectionHeader: boolean;
}

interface Props {
  invoiceId: string;
  projectId: string | null;
  vendorName: string;
  invoiceAmount: number;
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
  vendorName,
  invoiceAmount,
  currentLineItemId,
  currentDetail,
  lines,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(currentLineItemId ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => lines.find((l) => l.id === value) ?? null, [lines, value]);

  // Group by estimate version, with section-header rows becoming sub-headers
  // inside each group instead of selectable options.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { label: string; sections: { title: string | null; lines: PickerLine[] }[] }[] = [];
    for (const line of lines) {
      let group = out[out.length - 1];
      if (!group || group.label !== line.groupLabel) {
        group = { label: line.groupLabel, sections: [{ title: null, lines: [] }] };
        out.push(group);
      }
      if (line.isSectionHeader) {
        group.sections.push({ title: line.description, lines: [] });
        continue;
      }
      if (q && !`${line.description} ${line.trade ?? ""}`.toLowerCase().includes(q)) continue;
      group.sections[group.sections.length - 1].lines.push(line);
    }
    for (const g of out) g.sections = g.sections.filter((s) => s.lines.length > 0);
    return out.filter((g) => g.sections.length > 0);
  }, [lines, query]);

  async function handleSelect(next: string) {
    setOpen(false);
    setQuery("");
    if (next === value) return;
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

  const multipleGroups = groups.length > 1 || (groups[0] && groups[0].label !== "Budget lines");

  return (
    <div>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            setTimeout(() => searchRef.current?.focus(), 0);
          }}
          disabled={saving}
          className={`w-full flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:border-amber-500/50 disabled:opacity-60 ${
            open ? "border-amber-500/60 ring-2 ring-amber-500/20" : ""
          }`}
        >
          {selected ? (
            <>
              {selected.trade && (
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                  {selected.trade}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{selected.description}</span>
              {selected.cost > 0 && (
                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{fmt(selected.cost)}</span>
              )}
            </>
          ) : (
            <span className="flex-1 text-[13px] italic text-muted-foreground">Not linked</span>
          )}
          {saving ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : saved ? (
            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setQuery(""); }} />
            <div
              className="absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-xl border bg-popover shadow-2xl"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
            >
              <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search budget lines…"
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
                {value && (
                  <button
                    type="button"
                    onClick={() => handleSelect("")}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] italic text-muted-foreground transition-colors hover:bg-muted/50"
                  >
                    <X className="h-3.5 w-3.5" /> Unlink — no budget line
                  </button>
                )}

                {groups.length === 0 && (
                  <div className="px-3 py-4 text-center text-[12.5px] italic text-muted-foreground">
                    Nothing matches &ldquo;{query}&rdquo;
                  </div>
                )}

                {groups.map((group) => (
                  <div key={group.label}>
                    {multipleGroups && (
                      <div className="sticky top-0 bg-popover px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-amber-500/90">
                        {group.label}
                      </div>
                    )}
                    {group.sections.map((section, si) => (
                      <div key={`${group.label}-${si}`}>
                        {section.title && (
                          <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {section.title}
                          </div>
                        )}
                        {section.lines.map((li) => {
                          const isSelected = li.id === value;
                          return (
                            <button
                              key={li.id}
                              type="button"
                              onClick={() => handleSelect(li.id)}
                              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-amber-500/10 ${
                                isSelected ? "bg-amber-500/15" : ""
                              }`}
                            >
                              <span className="w-4 shrink-0">
                                {isSelected && <Check className="h-3.5 w-3.5 text-amber-500" />}
                              </span>
                              {li.trade && (
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {li.trade}
                                </span>
                              )}
                              <span className="min-w-0 flex-1 truncate text-[12.5px]">{li.description}</span>
                              {li.cost !== 0 && (
                                <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{fmt(li.cost)}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {currentDetail && selected && (
        <div className="mt-1.5 line-clamp-2 text-[11.5px] text-muted-foreground">{currentDetail}</div>
      )}

      {error && <div className="mt-1.5 text-[11.5px] text-red-500">{error}</div>}

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSplitting(true)}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-500 hover:underline"
        >
          <Split className="h-3 w-3" /> Split across lines
        </button>
        {value && (
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-1 text-[11.5px] text-amber-500 hover:underline"
          >
            See the budget <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {splitting && (
        <InvoiceSplitDialog
          invoiceId={invoiceId}
          projectId={projectId}
          vendorName={vendorName}
          invoiceAmount={invoiceAmount}
          onClose={() => setSplitting(false)}
          onComplete={(created) => {
            setSplitting(false);
            // The split replaces this invoice with the new pieces — this page's
            // id no longer exists, so land on the first piece (or the list).
            if (created && created.length > 0) router.push(`/spent/${created[0].id}`);
            else router.push("/spent");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
