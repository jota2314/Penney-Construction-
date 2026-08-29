"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, FileText, FolderOpen, ImageIcon, MapPin } from "lucide-react";
import { getCrewJobDocuments, type CrewDoc } from "@/lib/actions/project-files";
import { AddressLink } from "@/components/ui/address-link";

export type FolderJob = {
  id: string;
  name: string;
  project_number: string | null;
  address: string | null;
  city: string | null;
  scope_of_work: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  construction_drawings: "Drawings",
  plans: "Plans",
  permits: "Permits",
  specs: "Specs",
  other: "Other",
};
const CATEGORY_ORDER = ["construction_drawings", "plans", "permits", "specs", "other"];

/**
 * The field worker's job folder: pick a job, see its scope and its documents.
 * Deliberately minimal — no financials, no schedule, no office noise.
 */
export function CrewJobFolder({
  jobs,
  initialJobId,
}: {
  jobs: FolderJob[];
  initialJobId: string | null;
}) {
  const initial = useMemo(
    () => jobs.find((j) => j.id === initialJobId) ?? null,
    [jobs, initialJobId],
  );
  const [job, setJob] = useState<FolderJob | null>(initial);
  const [docs, setDocs] = useState<CrewDoc[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [, startLoad] = useTransition();

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    setDocsLoaded(false);
    startLoad(async () => {
      const rows = await getCrewJobDocuments(job.id).catch(() => []);
      if (!cancelled) {
        setDocs(rows);
        setDocsLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [job]);

  if (!job) {
    return (
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-amber-500" />
          Job Folder
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5 mb-4">
          Scope and documents for your jobs.
        </p>
        <div className="flex flex-col gap-2">
          {jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setJob(j)}
              className="text-left rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3 transition active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-tight truncate">{j.name}</div>
                <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
                  {[j.project_number, [j.address, j.city].filter(Boolean).join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
            </button>
          ))}
          {jobs.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No active jobs right now.
            </div>
          )}
        </div>
      </div>
    );
  }

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABEL[cat] ?? cat,
    items: docs.filter((d) => d.category === cat),
  })).filter((g) => g.items.length > 0);

  const scope = job.scope_of_work?.trim() || null;

  return (
    <div>
      <button
        onClick={() => setJob(null)}
        className="flex items-center gap-1 text-[13px] text-muted-foreground mb-3 active:opacity-70"
      >
        <ChevronLeft className="h-4 w-4" />
        All jobs
      </button>

      <h1 className="text-lg font-semibold leading-tight">{job.name}</h1>
      <div className="text-[12px] text-muted-foreground mt-1 flex items-center gap-1.5">
        {job.project_number && <span className="font-mono">{job.project_number}</span>}
        {(job.address || job.city) && (
          <AddressLink
            address={job.address}
            city={job.city}
            className="flex min-w-0 items-center gap-1.5 hover:text-amber-500"
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{[job.address, job.city].filter(Boolean).join(", ")}</span>
          </AddressLink>
        )}
      </div>

      <div className="mt-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
          Scope of work
        </div>
        {scope ? (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {scope}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No scope on file for this job.</div>
        )}
      </div>

      <div className="mt-6">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
          Documents
        </div>
        {!docsLoaded ? (
          <div className="text-sm text-muted-foreground py-4">Loading documents…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">No documents on this job yet.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.cat} className="flex flex-col gap-1.5">
                <div className="text-[11px] text-muted-foreground/70 uppercase tracking-wide">
                  {g.label} · {g.items.length}
                </div>
                {g.items.map((d) => {
                  const isImg = !!d.mime_type && d.mime_type.startsWith("image/");
                  const Icon = isImg ? ImageIcon : FileText;
                  return (
                    <a
                      key={d.id}
                      href={d.url ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3 transition active:scale-[0.99] ${
                        d.url ? "" : "opacity-50 pointer-events-none"
                      }`}
                    >
                      <Icon className="h-5 w-5 text-amber-500 flex-shrink-0" />
                      <span className="text-[14px] leading-snug min-w-0 flex-1 truncate">
                        {d.filename}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
