"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Clock, HardHat, ImagePlus, MapPin, X, XCircle } from "lucide-react";
import { compressImage } from "@/lib/image/compress";
import type { FieldData, FieldLog, Inspection, JobRollup } from "./types";
import { Card, DirectionsLink, EmptyState, MONO, Notice, Pill, SectionLabel, btnGhost, btnPrimary, fmtClock, fmtShortDate, inputCls, statusLabel, useNow } from "./ui";

const OPEN_JOB_KEY = "sub_portal_field_job";

/** Best-effort phone GPS fix — never blocks the clock-in. */
export function getLocation(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 5500, maximumAge: 60000 },
    );
  });
}

const readLocal = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLocal = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* convenience only */
  }
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const dayLabel = (iso: string, now: number) => {
  const d = startOfDay(new Date(iso)).getTime();
  const today = startOfDay(new Date(now)).getTime();
  if (d === today) return "Today";
  if (d === today - 86_400_000) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const fmtHours = (h: number) => `${h.toFixed(1)} h`;

const STATUS_TONE: Record<string, "emerald" | "amber" | "blue" | "neutral"> = {
  in_progress: "emerald",
  contracted: "blue",
  on_hold: "amber",
};

/**
 * Field: one list of the sub's jobs. Tap a job and everything for it is on
 * one screen — photos into the log, the inspections he can update, a clock
 * row, and the job's feed. Nothing else.
 */
export function FieldTab({
  rollups,
  field,
  reload,
  workTags,
  clockBusy,
  onClockIn,
  onClockOut,
  notice,
  flash,
}: {
  rollups: JobRollup[];
  field: FieldData | null;
  reload: () => void;
  workTags: string[];
  clockBusy: boolean;
  onClockIn: (projectId: string) => void;
  onClockOut: () => void;
  notice: { kind: "ok" | "err"; text: string } | null;
  flash: (kind: "ok" | "err", text: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(() => readLocal(OPEN_JOB_KEY));
  const now = useNow();

  const open = openId ? rollups.find((j) => j.proj.id === openId) : undefined;
  const pick = (id: string | null) => {
    setOpenId(id);
    writeLocal(OPEN_JOB_KEY, id);
    window.scrollTo({ top: 0 });
  };

  const fieldLogs = field?.logs;
  const logs = useMemo(() => fieldLogs ?? [], [fieldLogs]);
  const lastLogByJob = useMemo(() => {
    const m = new Map<string, FieldLog>();
    for (const l of logs) if (!m.has(l.project_id)) m.set(l.project_id, l);
    return m;
  }, [logs]);

  const elapsed = field?.clock ? Math.max(0, (now - new Date(field.clock.started_at).getTime()) / 3_600_000) : 0;

  if (open) {
    return (
      <JobScreen
        job={open}
        field={field}
        logs={logs.filter((l) => l.project_id === open.proj.id)}
        now={now}
        elapsed={elapsed}
        reload={reload}
        workTags={workTags}
        clockBusy={clockBusy}
        onClockIn={onClockIn}
        onClockOut={onClockOut}
        onBack={() => pick(null)}
        notice={notice}
        flash={flash}
      />
    );
  }

  return (
    <div className="space-y-5">
      {notice && <Notice kind={notice.kind} text={notice.text} />}

      {field?.clock && (
        <Card tone="emerald" className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-500/80" style={MONO}>
              On the clock
            </p>
            <p className="mt-1 truncate text-[15px] font-semibold text-stone-100">{field.clock.project_name}</p>
            <p className="mt-0.5 text-[12px] text-emerald-400" style={MONO}>
              {fmtHours(elapsed)} · since {fmtClock(field.clock.started_at)}
            </p>
          </div>
          <button onClick={onClockOut} disabled={clockBusy} className={`${btnPrimary} shrink-0`}>
            <Clock className="h-4 w-4" />
            {clockBusy ? "…" : "Clock out"}
          </button>
        </Card>
      )}

      <section>
        <SectionLabel>Your jobs</SectionLabel>
        {rollups.length === 0 ? (
          <EmptyState icon={HardHat} title="No live jobs" body="Jobs show up here once you're on them." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
            {rollups.map((j, i) => {
              const pending = j.inspections.filter((x) => x.status === "pending").length;
              const last = lastLogByJob.get(j.proj.id);
              return (
                <button
                  key={j.proj.id}
                  onClick={() => pick(j.proj.id)}
                  className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-white/[0.03] ${
                    i > 0 ? "border-t border-white/[0.06]" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 truncate text-[15px] font-semibold text-stone-100">{j.proj.name}</p>
                      <Pill tone={STATUS_TONE[j.proj.status] ?? "neutral"}>{statusLabel(j.proj.status)}</Pill>
                    </div>
                    {j.proj.address && <p className="mt-0.5 truncate text-[12px] text-stone-500">{j.proj.address}</p>}
                    <p className="mt-1 text-[11px] text-stone-600" style={MONO}>
                      {pending > 0 ? `${pending} inspection${pending === 1 ? "" : "s"} pending` : "Inspections done"}
                      {last ? ` · last update ${dayLabel(last.started_at, now).toLowerCase()}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-600" />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── One job ────────────────────────────────────────────────────────────────

function JobScreen({
  job,
  field,
  logs,
  now,
  elapsed,
  reload,
  workTags,
  clockBusy,
  onClockIn,
  onClockOut,
  onBack,
  notice,
  flash,
}: {
  job: JobRollup;
  field: FieldData | null;
  logs: FieldLog[];
  now: number;
  elapsed: number;
  reload: () => void;
  workTags: string[];
  clockBusy: boolean;
  onClockIn: (projectId: string) => void;
  onClockOut: () => void;
  onBack: () => void;
  notice: { kind: "ok" | "err"; text: string } | null;
  flash: (kind: "ok" | "err", text: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const clockedHere = field?.clock?.project_id === job.proj.id;
  const clockedElsewhere = !!field?.clock && !clockedHere;
  const hasSomething = picked.length > 0 || note.trim().length > 0 || photos.length > 0;

  const toggleTag = (t: string) => setPicked((ps) => (ps.includes(t) ? ps.filter((x) => x !== t) : [...ps, t]));
  const addPhotos = (files: FileList | null) => files && setPhotos((ps) => [...ps, ...Array.from(files)]);

  async function post() {
    const text = [picked.length ? `Work: ${picked.join(", ")}` : "", note.trim()].filter(Boolean).join("\n");
    if (!text && photos.length === 0) return flash("err", "Take a photo, tap what got done, or write a line.");
    setBusy("post");
    const res = await fetch("/api/sub-portal/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: job.proj.id, text, pendingPhotoCount: photos.length }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.logId) {
      setBusy(null);
      return flash("err", d.error || "Couldn't post. Try again.");
    }
    const failed = await uploadPhotos(d.logId, photos);
    setBusy(null);
    setNote("");
    setPicked([]);
    setPhotos([]);
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
    flash(failed > 0 ? "err" : "ok", failed > 0 ? `Posted, but ${failed} photo(s) didn't upload.` : "Posted. The office sees it now.");
    reload();
  }

  async function updateInspection(id: string, body: { status?: string; scheduledFor?: string; note?: string }) {
    setBusy(`insp:${id}`);
    const res = await fetch("/api/sub-portal/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return flash("err", d.error || "Couldn't update that. Try again.");
    flash("ok", "Updated. The office sees it in the feed.");
    reload();
  }

  const chipCls = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
      on ? "border-amber-500/70 bg-amber-500/15 text-amber-300" : "border-white/12 bg-white/[0.03] text-stone-300 active:bg-white/[0.08]"
    }`;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-[11px] uppercase tracking-[0.2em] text-stone-400" style={MONO}>
        <ChevronLeft className="h-4 w-4" />
        Your jobs
      </button>

      {notice && <Notice kind={notice.kind} text={notice.text} />}

      {/* header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[20px] font-bold leading-tight text-stone-100">{job.proj.name}</h2>
          <Pill tone={STATUS_TONE[job.proj.status] ?? "neutral"}>{statusLabel(job.proj.status)}</Pill>
        </div>
        {job.proj.address && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="flex items-center gap-1 text-[13px] text-stone-400">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {job.proj.address}
            </p>
            <DirectionsLink address={job.proj.address} />
          </div>
        )}
      </div>

      {/* add to the log */}
      <Card tone="amber" className="p-4">
        <SectionLabel>Add to the log</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-4 text-stone-950 active:opacity-80">
            <Camera className="h-6 w-6" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={MONO}>
              Take a photo
            </span>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files)} className="sr-only" />
          </label>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.03] px-3 py-4 text-stone-200 active:bg-white/[0.08]">
            <ImagePlus className="h-6 w-6" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={MONO}>
              From library
            </span>
            <input ref={libraryRef} type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} className="sr-only" />
          </label>
        </div>
        {previews.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {previews.map((u, i) => (
              <div key={u} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="aspect-square w-full rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos((ps) => ps.filter((_, idx) => idx !== i))}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-900 text-stone-300 ring-1 ring-white/20"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {workTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {workTags.map((t) => (
              <button key={t} type="button" onClick={() => toggleTag(t)} className={chipCls(picked.includes(t))}>
                {t}
              </button>
            ))}
          </div>
        )}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything else? (optional)" className={`${inputCls} mt-3`} />
        <button onClick={post} disabled={busy === "post" || !hasSomething} className={`${btnPrimary} mt-3 w-full py-3.5 text-[13px]`}>
          {busy === "post" ? "Posting…" : `Post${photos.length > 0 ? ` · ${photos.length} photo${photos.length > 1 ? "s" : ""}` : ""}`}
        </button>
      </Card>

      {/* inspections */}
      <Card className="p-4">
        <SectionLabel>Inspections</SectionLabel>
        {job.inspections.length === 0 ? (
          <p className="text-[13px] text-stone-500">None logged for this job yet.</p>
        ) : (
          <div className="space-y-2">
            {job.inspections.map((insp) => (
              <InspectionRow key={insp.id} insp={insp} busy={busy === `insp:${insp.id}`} onUpdate={(b) => updateInspection(insp.id, b)} />
            ))}
          </div>
        )}
      </Card>

      {/* clock row */}
      <Card tone={clockedHere ? "emerald" : "default"} className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
            Time clock
          </p>
          <p className="mt-0.5 truncate text-[13px] text-stone-300">
            {clockedHere
              ? `On the clock here · ${fmtHours(elapsed)} since ${fmtClock(field!.clock!.started_at)}`
              : clockedElsewhere
                ? `On the clock at ${field!.clock!.project_name}`
                : "Not clocked in"}
          </p>
        </div>
        {clockedHere || clockedElsewhere ? (
          <button onClick={onClockOut} disabled={clockBusy} className={`${btnGhost} shrink-0 px-3 py-2`}>
            <Clock className="h-4 w-4" />
            {clockBusy ? "…" : "Clock out"}
          </button>
        ) : (
          <button onClick={() => onClockIn(job.proj.id)} disabled={clockBusy} className={`${btnGhost} shrink-0 px-3 py-2`}>
            <Clock className="h-4 w-4" />
            {clockBusy ? "…" : "Clock in"}
          </button>
        )}
      </Card>

      {/* the job's log */}
      <section>
        <SectionLabel>Log</SectionLabel>
        {logs.length === 0 ? (
          <EmptyState icon={HardHat} title="Nothing on this job yet" body="Your photos and updates, and the Penney crew's, show up here." />
        ) : (
          <FeedByDay logs={logs} now={now} />
        )}
      </section>
    </div>
  );
}

// ── Inspection row ─────────────────────────────────────────────────────────

function InspectionRow({
  insp,
  busy,
  onUpdate,
}: {
  insp: Inspection;
  busy: boolean;
  onUpdate: (body: { status?: string; scheduledFor?: string; note?: string }) => void;
}) {
  const [mode, setMode] = useState<null | "date" | "failed">(null);
  const [date, setDate] = useState("");
  const [why, setWhy] = useState("");

  const tone = insp.status === "passed" ? "emerald" : insp.status === "failed" ? "red" : "neutral";
  const label =
    insp.status === "passed"
      ? `Passed${insp.completed_at ? ` ${fmtShortDate(insp.completed_at.slice(0, 10))}` : ""}`
      : insp.status === "failed"
        ? `Failed${insp.completed_at ? ` ${fmtShortDate(insp.completed_at.slice(0, 10))}` : ""}`
        : "Pending";

  const small = "rounded-lg border px-3 py-2 text-[11px] uppercase tracking-[0.14em] disabled:opacity-40";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[14px] font-medium text-stone-100">{insp.name}</p>
        <Pill tone={tone}>{label}</Pill>
      </div>
      {insp.notes && <p className="mt-1 whitespace-pre-line text-[12px] text-stone-500">{insp.notes}</p>}

      {insp.status === "pending" && mode === null && (
        <div className="mt-2.5 flex gap-2">
          <button disabled={busy} onClick={() => setMode("date")} className={`${small} flex-1 border-white/12 text-stone-300`} style={MONO}>
            Book a date
          </button>
          <button disabled={busy} onClick={() => onUpdate({ status: "passed" })} className={`${small} flex-1 border-emerald-500/40 text-emerald-400`} style={MONO}>
            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
            Passed
          </button>
          <button disabled={busy} onClick={() => setMode("failed")} className={`${small} flex-1 border-red-500/40 text-red-400`} style={MONO}>
            <XCircle className="mr-1 inline h-3.5 w-3.5" />
            Failed
          </button>
        </div>
      )}

      {mode === "date" && (
        <div className="mt-2.5 flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} flex-1`} />
          <button
            disabled={busy || !date}
            onClick={() => {
              onUpdate({ scheduledFor: date });
              setMode(null);
            }}
            className={`${btnPrimary} px-3 py-2`}
          >
            Save
          </button>
          <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
            Cancel
          </button>
        </div>
      )}

      {mode === "failed" && (
        <div className="mt-2.5 space-y-2">
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="What did they flag? (optional)" className={inputCls} />
          <div className="flex items-center gap-2">
            <button
              disabled={busy}
              onClick={() => {
                onUpdate({ status: "failed", note: why.trim() || undefined });
                setMode(null);
                setWhy("");
              }}
              className={`${btnPrimary} flex-1 py-2`}
            >
              Mark failed
            </button>
            <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {insp.status !== "pending" && (
        <button
          disabled={busy}
          onClick={() => onUpdate({ status: "pending" })}
          className="mt-2 text-[11px] uppercase tracking-[0.14em] text-stone-500 underline underline-offset-2 disabled:opacity-40"
          style={MONO}
        >
          Undo
        </button>
      )}
    </div>
  );
}

// ── Feed ───────────────────────────────────────────────────────────────────

/** The feed grouped under Today / Yesterday / date headers. */
function FeedByDay({ logs, now }: { logs: FieldLog[]; now: number }) {
  const groups: { label: string; items: FieldLog[] }[] = [];
  for (const l of logs) {
    const label = dayLabel(l.started_at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(l);
    else groups.push({ label, items: [l] });
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-2 text-[10px] uppercase tracking-[0.24em] text-stone-600" style={MONO}>
            {g.label}
          </p>
          <div className="space-y-3">
            {g.items.map((l) => (
              <Card key={l.id} className="p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[14px] font-semibold text-stone-100">
                    {l.author_name}
                    {l.is_mine && (
                      <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-amber-500/80" style={MONO}>
                        You
                      </span>
                    )}
                  </p>
                  <p className="shrink-0 text-[11px] text-stone-500" style={MONO}>
                    {fmtClock(l.started_at)}
                  </p>
                </div>
                {l.status === "in_progress" ? (
                  <p className="mt-1 text-[12px] text-emerald-400" style={MONO}>
                    On site now
                  </p>
                ) : l.kind === "shift" && l.hours != null && l.hours >= 0.1 ? (
                  <p className="mt-1 text-[12px] text-stone-500" style={MONO}>
                    {fmtHours(l.hours)}
                  </p>
                ) : null}
                {l.text && <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-stone-300">{l.text}</p>}
                {l.photo_thumb_urls.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {l.photo_thumb_urls.map((u, i) => (
                      <a key={i} href={l.photo_urls[i] ?? u} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="" className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compress + upload a queue of photos onto a log; returns how many failed. */
export async function uploadPhotos(logId: string, photos: File[]): Promise<number> {
  let failed = 0;
  for (const photo of photos) {
    // Shrink on-device first — full-size phone photos stall on job-site signal.
    const blob = await compressImage(photo).catch(() => photo);
    const fd = new FormData();
    fd.append("logId", logId);
    fd.append("file", blob, "photo.jpg");
    const up = await fetch("/api/sub-portal/logs/photo", { method: "POST", body: fd }).catch(() => null);
    if (!up || !up.ok) failed += 1;
  }
  return failed;
}
