"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Clock, FileUp, HardHat, ImagePlus, X } from "lucide-react";
import { compressImage } from "@/lib/image/compress";
import type { FieldData } from "./types";
import { Card, EmptyState, MONO, Notice, SectionLabel, btnPrimary, fmtClock, fmtLogTime, inputCls, useNow } from "./ui";

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

/**
 * Field: time clock, post an update (photos + note), send a quote/invoice,
 * and the recent activity feed on the sub's jobs.
 */
export function FieldTab({
  field,
  reload,
  clockBusy,
  onClockIn,
  onClockOut,
  notice,
  flash,
}: {
  field: FieldData | null;
  reload: () => void;
  clockBusy: boolean;
  onClockIn: (projectId: string) => void;
  onClockOut: () => void;
  notice: { kind: "ok" | "err"; text: string } | null;
  flash: (kind: "ok" | "err", text: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const [clockJob, setClockJob] = useState("");
  const [postJob, setPostJob] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [docJob, setDocJob] = useState("");
  const [docType, setDocType] = useState<"quote" | "invoice">("invoice");
  const [docFile, setDocFile] = useState<File | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

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
  const clockJobId = clockJob || jobs[0]?.id || "";
  const postJobId = postJob || jobs[0]?.id || "";
  const docJobId = docJob || jobs[0]?.id || "";

  async function postUpdate() {
    if (!postJobId) return;
    if (!note.trim() && photos.length === 0) return flash("err", "Add a note or a photo first.");
    setBusy("post");
    const res = await fetch("/api/sub-portal/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: postJobId, text: note, pendingPhotoCount: photos.length }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.logId) {
      setBusy(null);
      return flash("err", d.error || "Couldn't post. Try again.");
    }
    let failed = 0;
    for (const photo of photos) {
      // Shrink on-device first — full-size phone photos stall on job-site signal.
      const blob = await compressImage(photo).catch(() => photo);
      const fd = new FormData();
      fd.append("logId", d.logId);
      fd.append("file", blob, "photo.jpg");
      const up = await fetch("/api/sub-portal/logs/photo", { method: "POST", body: fd }).catch(() => null);
      if (!up || !up.ok) failed += 1;
    }
    setBusy(null);
    setNote("");
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

  const elapsed = field.clock
    ? Math.max(0, (now - new Date(field.clock.started_at).getTime()) / 3_600_000)
    : 0;

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

  return (
    <div className="space-y-6">
      {notice && <Notice kind={notice.kind} text={notice.text} />}

      {/* time clock */}
      <Card tone={field.clock ? "emerald" : "default"} className="p-4">
        <SectionLabel>Time clock</SectionLabel>
        {field.clock ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold text-stone-100">{field.clock.project_name}</p>
              <p className="mt-1 text-[12px] text-emerald-400" style={MONO}>
                Since {fmtClock(field.clock.started_at)} · {elapsed.toFixed(1)} h
              </p>
            </div>
            <button onClick={onClockOut} disabled={clockBusy} className={`${btnPrimary} shrink-0`}>
              <Clock className="h-4 w-4" />
              {clockBusy ? "…" : "Clock out"}
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-[13px] text-stone-500">No active jobs to clock into.</p>
        ) : (
          <div className="space-y-3">
            {jobPicker(clockJobId, setClockJob)}
            <button onClick={() => onClockIn(clockJobId)} disabled={clockBusy} className={`${btnPrimary} w-full`}>
              <Clock className="h-4 w-4" />
              {clockBusy ? "Working…" : "Clock in"}
            </button>
          </div>
        )}
      </Card>

      {/* post an update */}
      {jobs.length > 0 && (
        <Card className="p-4">
          <SectionLabel>Post an update</SectionLabel>
          <div className="space-y-3">
            {jobPicker(postJobId, setPostJob)}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What got done today?"
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
        <SectionLabel>Recent activity on your jobs</SectionLabel>
        {field.logs.length === 0 && (
          <EmptyState icon={HardHat} title="No field updates yet" body="Posts from you and the Penney crew on your jobs land here." />
        )}
        <div className="space-y-3">
          {field.logs.map((l) => (
            <Card key={l.id} className="p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[14px] font-semibold text-stone-100">
                  {l.author_name}
                  {l.is_mine && (
                    <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-amber-500/80" style={MONO}>You</span>
                  )}
                </p>
                <p className="shrink-0 text-[11px] text-stone-500" style={MONO}>{fmtLogTime(l.started_at)}</p>
              </div>
              <p className="text-[12px] text-stone-500" style={MONO}>{l.project_name}</p>
              {l.status === "in_progress" && (
                <p className="mt-1 text-[12px] text-emerald-400" style={MONO}>On site now</p>
              )}
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
      </section>
    </div>
  );
}
