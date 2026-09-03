"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  ImageIcon,
  MapPin,
  Navigation,
  Search,
} from "lucide-react";
import { getCrewJobDocuments, type CrewDoc } from "@/lib/actions/project-files";
import { getCurrentPosition, type Coords } from "@/lib/geo/current-position";
import { distanceMeters, formatDistance, GEOFENCE_METERS } from "@/lib/crew/geo";
import { ProjectMap } from "@/components/crew/project-map";

export type FolderJob = {
  id: string;
  name: string;
  project_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  scope_of_work: string | null;
  /** Drawings, plans, permits, specs on file. */
  doc_count: number;
  /** Last time THIS worker clocked in here (ISO), within the last two weeks. */
  last_worked_at: string | null;
  /** A task on the schedule today with this worker on it. */
  today_task: string | null;
  /** Currently on the clock here. */
  clocked_in: boolean;
};

const CATEGORY_LABEL: Record<string, string> = {
  construction_drawings: "Drawings",
  plans: "Plans",
  permits: "Permits",
  specs: "Specs",
  other: "Other",
};
const CATEGORY_ORDER = ["construction_drawings", "plans", "permits", "specs", "other"];

function relativeDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function mapsHref(j: FolderJob): string {
  if (j.latitude != null && j.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${j.latitude},${j.longitude}`;
  }
  const q = [j.address, j.city, j.state, j.zip].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/**
 * The field worker's job folder. Two things a guy in a truck wants: find the
 * job fast (search, nearest first, the ones he actually works on top) and get
 * what's on it (scope, drawings, directions). No financials, no office noise.
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
  const [query, setQuery] = useState("");
  const [here, setHere] = useState<Coords | null>(null);
  // Documents keyed by the job they belong to, so switching jobs never shows
  // the previous job's files and no reset is needed inside the effect.
  const [docsState, setDocsState] = useState<{ jobId: string; rows: CrewDoc[] } | null>(null);
  const [, startLoad] = useTransition();
  const docsLoaded = !!job && docsState?.jobId === job.id;
  const docs = docsLoaded && docsState ? docsState.rows : [];

  // One location fix so the job he's standing at floats to the top.
  useEffect(() => {
    let cancelled = false;
    getCurrentPosition().then((c) => {
      if (!cancelled && c) setHere(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const jobId = job.id;
    startLoad(async () => {
      const rows = await getCrewJobDocuments(jobId).catch(() => []);
      if (!cancelled) setDocsState({ jobId, rows });
    });
    return () => {
      cancelled = true;
    };
  }, [job]);

  const withDistance = useMemo(
    () =>
      jobs.map((j) => ({
        job: j,
        dist:
          here && j.latitude != null && j.longitude != null
            ? distanceMeters(here.lat, here.lng, j.latitude, j.longitude)
            : null,
      })),
    [jobs, here],
  );

  // Name, number, street or town — whatever the worker remembers about the job.
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return withDistance;
    return withDistance.filter(({ job: j }) =>
      [j.name, j.project_number, j.address, j.city]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(term)),
    );
  }, [withDistance, query]);

  // "Your jobs": on the clock, scheduled today, or worked in the last two
  // weeks — ordered by that urgency, then by how recently. Everything else is
  // "All jobs", nearest first when we have a fix, else by name.
  const { mine, others } = useMemo(() => {
    const rank = (j: FolderJob) =>
      j.clocked_in ? 0 : j.today_task ? 1 : j.last_worked_at ? 2 : 3;
    const mineRows = filtered
      .filter(({ job: j }) => rank(j) < 3)
      .sort((a, b) => {
        const ra = rank(a.job);
        const rb = rank(b.job);
        if (ra !== rb) return ra - rb;
        return (b.job.last_worked_at ?? "").localeCompare(a.job.last_worked_at ?? "");
      });
    const otherRows = filtered
      .filter(({ job: j }) => rank(j) === 3)
      .sort((a, b) => {
        if (a.dist == null && b.dist == null) return a.job.name.localeCompare(b.job.name);
        if (a.dist == null) return 1;
        if (b.dist == null) return -1;
        return a.dist - b.dist;
      });
    return { mine: mineRows, others: otherRows };
  }, [filtered]);

  if (!job) {
    const renderRow = ({ job: j, dist }: { job: FolderJob; dist: number | null }) => {
      const onSite = dist != null && dist <= GEOFENCE_METERS;
      const accent = `hsl(${hue(j.id)} 55% 45%)`;
      return (
        <button
          key={j.id}
          onClick={() => setJob(j)}
          className={`text-left rounded-2xl border bg-card px-3.5 py-3 flex items-center gap-3 transition active:scale-[0.99] ${
            j.clocked_in ? "border-emerald-500/50" : "border-border"
          }`}
        >
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
            style={{ background: accent }}
            aria-hidden
          >
            {initials(j.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight truncate">{j.name}</div>
            <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
              {[j.project_number, [j.address, j.city].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {(j.clocked_in || j.today_task || j.last_worked_at) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {j.clocked_in && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    On the clock
                  </span>
                )}
                {j.today_task && (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                    <Clock className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">Today · {j.today_task}</span>
                  </span>
                )}
                {!j.clocked_in && !j.today_task && j.last_worked_at && (
                  <span className="text-[11px] text-muted-foreground">
                    Last here {relativeDay(j.last_worked_at)}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1">
            {dist != null ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  onSite ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
                }`}
              >
                {onSite ? "Here" : formatDistance(dist)}
              </span>
            ) : null}
            {j.doc_count > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <FileText className="h-3 w-3" />
                {j.doc_count}
              </span>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
        </button>
      );
    };

    return (
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-amber-500" />
          Job Folder
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5 mb-3">
          Scope, drawings and directions for every active job.
        </p>

        <div className="sticky top-0 z-10 -mx-4 bg-background px-4 pb-3 pt-1">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
            <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, number, street, town"
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/70"
              inputMode="search"
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-[12px] text-muted-foreground active:opacity-70"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {jobs.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">No active jobs right now.</div>
        )}
        {jobs.length > 0 && filtered.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">No job matches that.</div>
        )}

        {mine.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Your jobs
            </div>
            <div className="flex flex-col gap-2">{mine.map(renderRow)}</div>
          </div>
        )}
        {others.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between px-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {mine.length > 0 ? "All jobs" : "Jobs"}
              </div>
              {here && (
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">Nearest first</div>
              )}
            </div>
            <div className="flex flex-col gap-2">{others.map(renderRow)}</div>
          </div>
        )}
      </div>
    );
  }

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABEL[cat] ?? cat,
    items: docs.filter((d) => d.category === cat),
  })).filter((g) => g.items.length > 0);

  const scope = job.scope_of_work?.trim() || null;
  const fullAddress = [job.address, job.city].filter(Boolean).join(", ");

  return (
    <div>
      <button
        onClick={() => setJob(null)}
        className="flex items-center gap-1 text-[13px] text-muted-foreground mb-3 active:opacity-70"
      >
        <ChevronLeft className="h-4 w-4" />
        All jobs
      </button>

      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-[14px] font-bold text-white"
          style={{ background: `hsl(${hue(job.id)} 55% 45%)` }}
          aria-hidden
        >
          {initials(job.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">{job.name}</h1>
          <div className="text-[12px] text-muted-foreground mt-1 flex items-center gap-1.5">
            {job.project_number && <span className="font-mono">{job.project_number}</span>}
            {fullAddress && (
              <>
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{fullAddress}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {(job.clocked_in || job.today_task) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.clocked_in && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              On the clock here
            </span>
          )}
          {job.today_task && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-400">
              <Clock className="h-3 w-3" />
              Today · {job.today_task}
            </span>
          )}
        </div>
      )}

      {(job.address || job.city || job.latitude != null) && (
        <div className="mt-4">
          <ProjectMap
            address={job.address}
            city={job.city}
            state={job.state}
            zip={job.zip}
            latitude={job.latitude}
            longitude={job.longitude}
          />
          <a
            href={mapsHref(job)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-[14px] font-semibold transition active:scale-[0.98]"
          >
            <Navigation className="h-4 w-4 text-amber-500" />
            Directions
          </a>
        </div>
      )}

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
          Documents{docsLoaded && docs.length > 0 ? ` · ${docs.length}` : ""}
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
                      <span className="text-[14px] leading-snug min-w-0 flex-1 truncate">{d.filename}</span>
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
