"use client";

import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Clock, ImagePlus, X } from "lucide-react";
import type { FieldClock } from "./types";
import { Card, DISPLAY, MONO, btnGhost, btnPrimary, fmtClock, inputCls, useNow } from "./ui";

/** Past this many hours we assume the sub forgot and ask for the real end time. */
export const STALE_SHIFT_HOURS = 14;

export interface ClockOutPayload {
  tags: string[];
  note: string;
  photos: File[];
  endedAt?: string;
}

/**
 * Bottom sheet shown when a sub taps Clock out. One screen: tap what got done,
 * add a line or a photo if there's more to say, and the shift lands in the
 * office feed as a real daily log. "Just clock out" is always one tap away —
 * the log is the bonus, the hours are the point.
 */
export function ClockOutSheet({
  clock,
  tags,
  busy,
  onCancel,
  onSubmit,
}: {
  clock: FieldClock;
  tags: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: ClockOutPayload) => void;
}) {
  const now = useNow(30000);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);

  const startedMs = useMemo(() => new Date(clock.started_at).getTime(), [clock.started_at]);
  const elapsed = Math.max(0, (now - startedMs) / 3_600_000);
  const stale = elapsed >= STALE_SHIFT_HOURS;

  // "Forgot to clock out" — a shift that ran past the stale line opens with
  // the time fix showing, defaulted to 8 h after clock-in as a local HH:MM.
  // The sheet mounts on the tap, so the initial values are the right ones.
  const [fixTime, setFixTime] = useState(() => (Date.now() - startedMs) / 3_600_000 >= STALE_SHIFT_HOURS);
  const [endTime, setEndTime] = useState(() => {
    const guess = new Date(startedMs + 8 * 3_600_000);
    return `${String(guess.getHours()).padStart(2, "0")}:${String(guess.getMinutes()).padStart(2, "0")}`;
  });

  // The corrected end sits on the clock-in day unless that would land before
  // the clock-in (an overnight shift), in which case roll to the next day.
  const endedAtIso = useMemo(() => {
    if (!fixTime) return undefined;
    const [h, m] = endTime.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
    const d = new Date(startedMs);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= startedMs) d.setDate(d.getDate() + 1);
    if (d.getTime() > now) return undefined;
    return d.toISOString();
  }, [fixTime, endTime, startedMs, now]);

  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const toggle = (t: string) =>
    setPicked((ps) => (ps.includes(t) ? ps.filter((x) => x !== t) : [...ps, t]));

  const fixInvalid = fixTime && !endedAtIso;
  const submit = (bare: boolean) =>
    onSubmit({
      tags: bare ? [] : picked,
      note: bare ? "" : note.trim(),
      photos: bare ? [] : photos,
      endedAt: endedAtIso,
    });

  const chipCls = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
      on
        ? "border-amber-500/70 bg-amber-500/15 text-amber-300"
        : "border-white/12 bg-white/[0.03] text-stone-300 active:bg-white/[0.08]"
    }`;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
      />
      <div
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/[0.1] bg-[#12100c] px-5 pb-6 pt-4 shadow-2xl"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500" style={MONO}>
              Clocking out
            </p>
            <p className="mt-1 truncate text-[17px] font-semibold text-stone-100">{clock.project_name}</p>
            <p className="mt-0.5 text-[12px] text-stone-500" style={MONO}>
              Since {fmtClock(clock.started_at)} · {elapsed.toFixed(1)} h
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-stone-400"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Forgot-to-clock-out fix */}
        {(stale || fixTime) && (
          <Card tone="amber" className="mt-4 p-3.5">
            <div className="flex items-center gap-2">
              <AlarmClock className="h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-[13px] text-amber-200">
                {stale ? "Looks like this one ran long. When did you actually leave?" : "Set the real end time"}
              </p>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`${inputCls} max-w-[10rem]`}
              />
              <button
                type="button"
                onClick={() => setFixTime(false)}
                className="text-[11px] uppercase tracking-[0.14em] text-stone-400 underline underline-offset-2"
                style={MONO}
              >
                Use now
              </button>
            </div>
            {fixInvalid && (
              <p className="mt-2 text-[12px] text-red-300">Pick a time after you clocked in and not in the future.</p>
            )}
          </Card>
        )}
        {!stale && !fixTime && (
          <button
            type="button"
            onClick={() => setFixTime(true)}
            className="mt-2 text-[11px] uppercase tracking-[0.14em] text-stone-500 underline underline-offset-2"
            style={MONO}
          >
            Left earlier? Fix the time
          </button>
        )}

        {/* What got done */}
        <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-stone-500" style={MONO}>
          What got done?
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => toggle(t)} className={chipCls(picked.includes(t))}>
              {t}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Anything the office should know? (optional)"
          className={`${inputCls} mt-3`}
        />

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
        <label
          className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-3 text-[12px] uppercase tracking-[0.14em] text-stone-400"
          style={MONO}
        >
          <ImagePlus className="h-4 w-4" />
          {photos.length > 0 ? "Add more photos" : "Add photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setPhotos((ps) => [...ps, ...Array.from(e.target.files ?? [])])}
            className="sr-only"
          />
        </label>

        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={busy || fixInvalid}
            className={`${btnPrimary} w-full py-3.5 text-[13px]`}
          >
            <Clock className="h-4 w-4" />
            {busy ? "Clocking out…" : picked.length || note.trim() || photos.length ? "Clock out & post" : "Clock out"}
          </button>
          {(picked.length > 0 || note.trim() || photos.length > 0) && (
            <button type="button" onClick={() => submit(true)} disabled={busy || fixInvalid} className={`${btnGhost} w-full`}>
              Just clock out
            </button>
          )}
        </div>
        <p className="mt-3 text-center text-[11px] text-stone-600" style={DISPLAY}>
          The office sees your hours and what got done as soon as you tap.
        </p>
      </div>
    </div>
  );
}
