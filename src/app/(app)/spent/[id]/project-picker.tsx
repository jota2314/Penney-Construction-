"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Building2, Check, ChevronDown, Loader2, Search, X } from "lucide-react";

export interface PickerProject {
  id: string;
  name: string;
  projectNumber: string | null;
  status: string | null;
  isOverhead: boolean;
}

interface Props {
  invoiceId: string;
  currentProjectId: string | null;
  projects: PickerProject[];
}

export function ProjectPicker({ invoiceId, currentProjectId, projects }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(currentProjectId ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => projects.find((p) => p.id === value) ?? null, [projects, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      `${p.projectNumber ?? ""} ${p.name}`.toLowerCase().includes(q),
    );
  }, [projects, query]);

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
      const res = await fetch("/api/move-invoice-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId, project_id: next || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not move");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : "Could not move");
    } finally {
      setSaving(false);
    }
  }

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
              <Building2 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {selected.projectNumber ? `${selected.projectNumber} · ` : ""}
                {selected.name}
              </span>
            </>
          ) : (
            <span className="flex-1 text-[13px] italic text-muted-foreground">
              Overhead — not tied to a project
            </span>
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
                  placeholder="Search projects…"
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
                <button
                  type="button"
                  onClick={() => handleSelect("")}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] italic text-muted-foreground transition-colors hover:bg-muted/50 ${
                    !value ? "bg-amber-500/15" : ""
                  }`}
                >
                  <span className="w-4 shrink-0">
                    {!value && <Check className="h-3.5 w-3.5 text-amber-500" />}
                  </span>
                  Overhead — not tied to a project
                </button>

                {filtered.length === 0 && (
                  <div className="px-3 py-4 text-center text-[12.5px] italic text-muted-foreground">
                    Nothing matches &ldquo;{query}&rdquo;
                  </div>
                )}

                {filtered.map((p) => {
                  const isSelected = p.id === value;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelect(p.id)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-amber-500/10 ${
                        isSelected ? "bg-amber-500/15" : ""
                      }`}
                    >
                      <span className="w-4 shrink-0">
                        {isSelected && <Check className="h-3.5 w-3.5 text-amber-500" />}
                      </span>
                      {p.projectNumber && (
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-amber-500/90">
                          {p.projectNumber}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{p.name}</span>
                      {p.status && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {p.status.replace(/_/g, " ")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {error && <div className="mt-1.5 text-[11.5px] text-red-500">{error}</div>}

      <div className="mt-2 flex items-center gap-3">
        {value && (
          <Link
            href={`/projects/${value}`}
            className="inline-flex items-center gap-1 text-[11.5px] text-amber-500 hover:underline"
          >
            Open the project <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
