"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Clock, FileUp, HardHat, ImagePlus, MapPin, X } from "lucide-react";
import { compressImage } from "@/lib/image/compress";
import type { FieldData, FieldJob, FieldLog, FieldShift } from "./types";
import {
  Card,
  DISPLAY,
  EmptyState,
  MONO,
  Notice,
  Pill,
  SectionLabel,
  btnPrimary,
  fmtClock,
  inputCls,
  useNow,
} from "./ui";
import { STALE_SHIFT_HOURS } from "./clock-out-sheet";

const LAST_JOB_KEY = "sub_portal_last_job";
const FEED_MINE_KEY = "sub_portal_feed_mine";

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

const fmtHours = (h: number) => (h < 0.05 ? "0 h" : `${h.toFixed(1)} h`);

const fmtDistance = (m: number) => {
  const mi = m / 1609.344;
  return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(1)} mi`;
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
/** Monday-start week, local time. */
const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

const shiftHours = (s: { started_at: string; ended_at: string | null }, now: number) => {
  const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
  return Math.max(0, (end - new Date(s.started_at).getTime()) / 3_600_000);
};

const dayLabel = (iso: string, now: number) => {
  const d = startOfDay(new Date(iso)).getTime();
  const today = startOfDay(new Date(now)).getTime();
  if (d === today) return "Today";
  if (d === today - 86_400_000) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const readLocal = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLocal = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* convenience only */
  }
};

/**
 * Field: the sub's day in one screen — clock (with where they are and how
 * long they've been on), their hours today and this week, a post that's
 * mostly taps, the invoice/quote drop, and the feed on their jobs.
 */
export function FieldTab({
  field,
  reload,
  workTags,
  clockBusy,
  onClockIn,
  onClockOut,
  notice,
  flash,
}: {
  field: FieldData | null;
  reload: () => void;
  workTags: string[];
  clockBusy: boolean;
  onClockIn: (projectId: string) => void;
  onClockOut: () => void;
  notice: { kind: "ok" | "err"; text: string } | null;
  flash: (kind: "ok" | "err", text: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const [clockJob, setClockJob] = useState(() => readLocal(LAST_JOB_KEY) ?? "");
  const [postJob, setPostJob] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [docJob, setDocJob] = useState("");
  const [docType, setDocType] = useState<"quote" | "invoice">("invoice");
  const [docFile, setDocFile] = useState<File | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const [feedMine, setFeedMine] = useState(() => readLocal(FEED_MINE_KEY) === "1");

  // Re-render every 30s so the "on the clock" elapsed time stays honest.
  const now = useNow();

  // Thumbnails for the photos queued on a post; object URLs released when
  // the queue changes.
  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  if (!field) {
    return <p className="py-10 text-center text-sm text-stone-500" style={MONO}>Loading…</p>;
  }

  const jobs = field.jobs;
  const jobById = (id: string) => jobs.find((j) => j.id === id);
  // The job you're standing on is the default everywhere; otherwise the one
  // you used last on this phone; otherwise the first live job.
  const fallbackJob = field.clock?.project_id || (jobById(clockJob) ? clockJob : "") || jobs[0]?.id || "";
  const clockJobId = jobById(clockJob) ? clockJob : jobs[0]?.id || "";
  const postJobId = jobById(postJob) ? postJob : fallbackJob;
  const docJobId = jobById(docJob) ? docJob : fallbackJob;

  function clockIn() {
    if (!clockJobId) return;
    writeLocal(LAST_JOB_KEY, clockJobId);
    onClockIn(clockJobId);
  }

  const toggleTag = (t: string) =>
    setPicked((ps) => (ps.includes(t) ? ps.filter((x) => x !== t) : [...ps, t]));

  async function postUpdate() {
    if (!postJobId) return;
    const text = [picked.length ? `Work: ${picked.join(", ")}` : "", note.trim()].filter(Boolean).join("\n");
    if (!text && photos.length === 0) return flash("err", "Tap what got done, write a line, or add a photo.");
    setBusy("post");
    const res = await fetch("/api/sub-portal/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: postJobId, text, pendingPhotoCount: photos.length }),
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
    if (photoInputRef.current) photoInputRef.current.value = "";
    flash(failed > 0 ? "err" : "ok", failed > 0 ? `Posted, but ${failed} photo(s) didn't upload.` : "Posted. The office sees it now.");
    reload();
  }

  async function sendDoc() {
    if (!docJobId || !docFile) return flash("err", "Pick a job and a file first.");
    setBusy("doc");
    const fd = new FormData();
    fd.append("file", docFile);
    fd.append("projectId", docJobId);
    fd.append("docType", docType);
    const res = await fetch("/api/sub-portal/upload", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return flash("err", d.error || "Couldn't send that. Try again.");
    setDocFile(null);
    if (docInputRef.current) docInputRef.current.value = "";
    flash("ok", d.message || "Received. We'll take a look.");
  }

  const elapsed = field.clock ? Math.max(0, (now - new Date(field.clock.started_at).getTime()) / 3_600_000) : 0;
  const stale = elapsed >= STALE_SHIFT_HOURS;

  const jobPicker = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {jobs.map((j) => (
        <option key={j.id} value={j.id} className="bg-stone-900">
          {j.name}
        </option>
      ))}
    </select>
  );

  const fileBtn =
    "flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-3.5 text-[12px] uppercase tracking-[0.14em] text-stone-400 hover:border-amber-500/40";

  const chipCls = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
      on
        ? "border-amber-500/70 bg-amber-500/15 text-amber-300"
        : "border-white/12 bg-white/[0.03] text-stone-300 active:bg-white/[0.08]"
    }`;

  const clockedJob: FieldJob | undefined = field.clock ? jobById(field.clock.project_id) : undefined;
  const pickedJob = jobById(clockJobId);

  const feedLogs = feedMine ? field.logs.filter((l) => l.is_mine) : field.logs;

  return (
    <div className="space-y-6">
      {notice && <Notice kind={notice.kind} text={notice.text} />}

      {/* time clock */}
      <Card tone={field.clock ? "emerald" : "default"} className="p-4">
        {field.clock ? (
          <>
            <SectionLabel
              right={
                field.clock.on_site === true ? (
                  <Pill tone="emerald">At the job</Pill>
                ) : field.clock.on_site === false && field.clock.distance_m != null ? (
                  <Pill tone="amber">{fmtDistance(field.clock.distance_m)} from the job</Pill>
                ) : null
              }
            >
              On the clock
            </SectionLabel>
            <p className="truncate text-[17px] font-semibold text-stone-100">{field.clock.project_name}</p>
            {(field.clock.address || clockedJob?.address) && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-stone-500">
                <MapPin className="h-3 w-3 shrink-0" />
                {field.clock.address || clockedJob?.address}
              </p>
            )}
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[30px] font-bold leading-none text-emerald-400" style={DISPLAY}>
                  {elapsed.toFixed(1)}
                  <span className="ml-1 text-[14px] font-semibold text-emerald-500/80">h</span>
                </p>
                <p className="mt-1.5 text-[12px] text-stone-400" style={MONO}>
                  Since {fmtClock(field.clock.started_at)}
                </p>
              </div>
              <button onClick={onClockOut} disabled={clockBusy} className={`${btnPrimary} shrink-0`}>
                <Clock className="h-4 w-4" />
                {clockBusy ? "…" : "Clock out"}
              </button>
            </div>
            {stale && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200">
                Still on the clock from {dayLabel(field.clock.started_at, now).toLowerCase()}? Tap Clock out and set the
                time you actually left.
              </p>
            )}
          </>
        ) : jobs.length === 0 ? (
          <>
            <SectionLabel>Time clock</SectionLabel>
            <p className="text-[13px] text-stone-500">No active jobs to clock into.</p>
          </>
        ) : (
          <>
            <SectionLabel>Time clock</SectionLabel>
            <div className="space-y-3">
              {jobPicker(clockJobId, setClockJob)}
              {pickedJob?.address && (
                <p className="-mt-1 flex items-center gap-1 truncate text-[12px] text-stone-500">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {pickedJob.address}
                </p>
              )}
              <button onClick={clockIn} disabled={clockBusy} className={`${btnPrimary} w-full`}>
                <Clock className="h-4 w-4" />
                {clockBusy ? "Working…" : "Clock in"}
              </button>
            </div>
          </>
        )}
      </Card>

      <HoursStrip shifts={field.shifts} now={now} />

      {/* post an update */}
      {jobs.length > 0 && (
        <Card className="p-4">
          <SectionLabel>Post an update</SectionLabel>
          <div className="space-y-3">
            {jobPicker(postJobId, setPostJob)}
            {workTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {workTags.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTag(t)} className={chipCls(picked.includes(t))}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything else? (optional)"
              className={inputCls}
            />
            {previews.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
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
            <label className={fileBtn} style={MONO}>
              <ImagePlus className="h-4 w-4" />
              {photos.length > 0 ? "Add more photos" : "Add photos"}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setPhotos((ps) => [...ps, ...Array.from(e.target.files ?? [])])}
                className="sr-only"
              />
            </label>
            <button onClick={postUpdate} disabled={busy === "post"} className={`${btnPrimary} w-full`}>
              <Camera className="h-4 w-4" />
              {busy === "post" ? "Posting…" : `Post${photos.length > 0 ? ` (${photos.length} photo${photos.length > 1 ? "s" : ""})` : ""}`}
            </button>
          </div>
        </Card>
      )}

      {/* send a quote / invoice */}
      {jobs.length > 0 && (
        <Card className="p-4">
          <SectionLabel>Send us an invoice or quote</SectionLabel>
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["invoice", "quote"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setDocType(t)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-[11px] uppercase tracking-[0.14em] ${
                    docType === t ? "border-amber-500/60 bg-amber-500/10 text-amber-400" : "border-white/10 text-stone-500"
                  }`}
                  style={MONO}
                >
                  {t}
                </button>
              ))}
            </div>
            {jobPicker(docJobId, setDocJob)}
            <label className={fileBtn} style={MONO}>
              <FileUp className="h-4 w-4" />
              <span className="truncate">{docFile ? docFile.name : "PDF or a clear photo"}</span>
              <input
                ref={docInputRef}
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            <button onClick={sendDoc} disabled={busy === "doc" || !docFile} className={`${btnPrimary} w-full`}>
              {busy === "doc" ? "Reading the document…" : `Send ${docType}`}
            </button>
            <p className="text-[11px] text-stone-600">
              Goes straight to the office on the job you picked. Invoices show under Money once they&apos;re reviewed.
            </p>
          </div>
        </Card>
      )}

      {/* recent activity */}
      <section>
        <SectionLabel
          right={
            <div className="flex gap-1" role="tablist" aria-label="Feed filter">
              {(
                [
                  ["all", "All"],
                  ["mine", "Mine"],
                ] as const
              ).map(([key, label]) => {
                const on = feedMine === (key === "mine");
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      setFeedMine(key === "mine");
                      writeLocal(FEED_MINE_KEY, key === "mine" ? "1" : "0");
                    }}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                      on ? "border-amber-500/60 bg-amber-500/10 text-amber-400" : "border-white/10 text-stone-500"
                    }`}
                    style={MONO}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          }
        >
          {feedMine ? "Your log" : "Activity on your jobs"}
        </SectionLabel>
        {feedLogs.length === 0 && (
          <EmptyState
            icon={HardHat}
            title={feedMine ? "Nothing logged yet" : "No field updates yet"}
            body={
              feedMine
                ? "Clock in and out, or post an update — it lands here and in the office feed."
                : "Posts from you and the Penney crew on your jobs land here."
            }
          />
        )}
        <FeedByDay logs={feedLogs} now={now} />
      </section>
    </div>
  );
}

/** Today + this week, then the week split by job. Hidden until there's a shift. */
function HoursStrip({ shifts, now }: { shifts: FieldShift[]; now: number }) {
  const today0 = startOfDay(new Date(now)).getTime();
  const week0 = startOfWeek(new Date(now)).getTime();
  let today = 0;
  let week = 0;
  const byJob = new Map<string, { name: string; hours: number }>();
  for (const s of shifts) {
    const t = new Date(s.started_at).getTime();
    const h = shiftHours(s, now);
    if (t >= today0) today += h;
    if (t >= week0) {
      week += h;
      const cur = byJob.get(s.project_id) ?? { name: s.project_name, hours: 0 };
      cur.hours += h;
      byJob.set(s.project_id, cur);
    }
  }
  if (shifts.length === 0) return null;
  const rows = [...byJob.values()].sort((a, b) => b.hours - a.hours);
  return (
    <Card className="p-4">
      <SectionLabel>Your hours</SectionLabel>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
          <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
            Today
          </p>
          <p className="mt-1.5 text-[22px] font-bold leading-none text-stone-100" style={DISPLAY}>
            {fmtHours(today)}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
          <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
            This week
          </p>
          <p className="mt-1.5 text-[22px] font-bold leading-none text-stone-100" style={DISPLAY}>
            {fmtHours(week)}
          </p>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
          {rows.map((r) => (
            <div key={r.name} className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="truncate text-stone-400">{r.name}</span>
              <span className="shrink-0 text-stone-200" style={MONO}>
                {fmtHours(r.hours)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-stone-600">
        Hours you clock here go to the office feed. They don&apos;t replace your invoice.
      </p>
    </Card>
  );
}

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
                <div className="mt-0.5 flex items-center gap-2">
                  <p className="min-w-0 truncate text-[12px] text-stone-500" style={MONO}>
                    {l.project_name}
                  </p>
                  {l.status === "in_progress" ? (
                    <Pill tone="emerald">On site now</Pill>
                  ) : l.kind === "shift" && l.hours != null && l.hours >= 0.1 ? (
                    <Pill tone="neutral">{fmtHours(l.hours)}</Pill>
                  ) : null}
                </div>
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
