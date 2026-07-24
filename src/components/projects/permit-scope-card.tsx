"use client";

import { useState } from "react";
import { Building2, Check, Copy, Download, Sparkles } from "lucide-react";

interface PermitScopeFields {
  summary: string;
  narrative: string;
  structural: string;
  plumbing: string;
  electrical: string;
  mechanical: string;
  site_demo: string;
}

const TRADE_ROWS: { key: keyof PermitScopeFields; label: string }[] = [
  { key: "structural", label: "Structural" },
  { key: "plumbing", label: "Plumbing" },
  { key: "electrical", label: "Electrical" },
  { key: "mechanical", label: "Mechanical (HVAC/Gas)" },
  { key: "site_demo", label: "Site / Demolition" },
];

// A dead-simple "give me the permit description for this job" tool. Jorge (or
// Nicole pulling the permit) clicks Generate, the AI reads the job's scope and
// estimate and returns exactly what the building department asks for — the
// general work plus which trades are touched (structural, plumbing, etc.).
// Everything is editable before he copies it into the town's portal or
// downloads a branded scope sheet to attach.
export function PermitScopeCard({ projectId }: { projectId: string }) {
  const [town, setTown] = useState("");
  const [fields, setFields] = useState<PermitScopeFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-permit-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, town: town.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setFields(json.fields as PermitScopeFields);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof PermitScopeFields, value: string) =>
    setFields((f) => (f ? { ...f, [key]: value } : f));

  const asText = (f: PermitScopeFields): string => {
    const lines = [
      f.summary,
      "",
      f.narrative,
      "",
      "TRADES INVOLVED:",
      ...TRADE_ROWS.map((t) => `- ${t.label}: ${f[t.key] || "None"}`),
    ];
    return lines.join("\n").trim();
  };

  const copy = async () => {
    if (!fields) return;
    try {
      await navigator.clipboard.writeText(asText(fields));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  const downloadPdf = async () => {
    if (!fields) return;
    setPdfBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-permit-description/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, town: town.trim() || undefined, fields }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <section id="fin-permit" className="scroll-mt-20 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
          <Building2 className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Permit Scope</h3>
          <p className="text-xs text-muted-foreground">
            Town-ready description for pulling the permit — no contract, no prices
          </p>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/* Optional town — different offices ask for different emphasis */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Town / city (optional)
            </span>
            <input
              type="text"
              value={town}
              onChange={(e) => setTown(e.target.value)}
              placeholder="e.g. Reading"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {busy ? "Generating…" : fields ? "Regenerate" : "Generate for permitting"}
          </button>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>
        )}

        {!fields && !busy && (
          <p className="text-xs text-muted-foreground">
            Reads this job&apos;s scope and estimate and writes the plain-English scope the
            building department wants — the general work plus which trades are involved
            (structural, plumbing, electrical, mechanical).
          </p>
        )}

        {fields && (
          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Work description (one line)
              </span>
              <textarea
                value={fields.summary}
                onChange={(e) => set("summary", e.target.value)}
                rows={2}
                className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Description of work
              </span>
              <textarea
                value={fields.narrative}
                onChange={(e) => set("narrative", e.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="rounded-lg border">
              <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Trades involved
              </div>
              <div className="divide-y">
                {TRADE_ROWS.map((t) => (
                  <div key={t.key} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-32 shrink-0 text-xs font-medium">{t.label}</span>
                    <input
                      type="text"
                      value={fields[t.key]}
                      onChange={(e) => set(t.key, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium hover:bg-muted/50"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy text"}
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                disabled={pdfBusy}
                className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium hover:bg-muted/50 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {pdfBusy ? "Building PDF…" : "Download PDF"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
