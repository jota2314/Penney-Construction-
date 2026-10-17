"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PortalNotice, PortalSheet, type PortalNoticeValue } from "@/components/portal-kit";
import { fmtTime } from "@/lib/portal-kit/format";
import type { SubClockState, SubComposerContext } from "@/lib/sub-portal/payload";
import { ComposerFields, useComposerDraft } from "./composer";
import { submitSubClockOut, type SubOutboxResult } from "./post-outbox";

/** Past this many hours we assume the sub forgot and ask for the real end time. */
export const STALE_SHIFT_HOURS = 14;

/** Wall-clock time that re-renders every 30 s, without calling Date.now() while rendering. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const photoWord = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

/**
 * The optional time clock's last step (the clock is demoted in v3; the log
 * is what matters). Same composer as the job screen, so whatever he adds
 * here lands on the shift row as a real post, and his photos go through the
 * same outbox (shrunk and saved on the phone first, never dropped).
 * "Just clock out" is always one tap away, and a shift that ran long opens
 * with the "when did you actually leave?" fix showing.
 *
 * `context` is the composer context of the shift's job (his trades, and
 * today's phase only when the shift is on the job he's looking at).
 */
export function ClockOutSheet({
  clock,
  context,
  onClose,
  onDone,
}: {
  clock: SubClockState;
  context: SubComposerContext | null;
  onClose: () => void;
  /** Called after the shift closed, with the line to show ("Clocked out. …"). */
  onDone: (message: string) => void;
}) {
  const now = useNow();
  const draft = useComposerDraft(context);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<PortalNoticeValue | null>(null);
  const [ready, setReady] = useState<{ done: number; total: number } | null>(null);
  const inFlight = useRef(false);

  const startedMs = useMemo(() => new Date(clock.started_at).getTime(), [clock.started_at]);
  const elapsed = Math.max(0, (now - startedMs) / 3_600_000);
  const stale = elapsed >= STALE_SHIFT_HOURS;

  // "Forgot to clock out": a shift past the stale line opens with the time
  // fix showing, defaulted to 8 h after clock-in as a local HH:MM. The sheet
  // mounts on the tap, so these first values are the right ones.
  const [fixTime, setFixTime] = useState(() => (Date.now() - startedMs) / 3_600_000 >= STALE_SHIFT_HOURS);
  const [endTime, setEndTime] = useState(() => {
    const guess = new Date(startedMs + 8 * 3_600_000);
    return `${String(guess.getHours()).padStart(2, "0")}:${String(guess.getMinutes()).padStart(2, "0")}`;
  });

  // The corrected end sits on the clock-in day unless that would land before
  // the clock-in (an overnight shift), in which case it rolls to the next day.
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
  const fixInvalid = fixTime && !endedAtIso;

  async function clockOut(bare: boolean) {
    if (inFlight.current || fixInvalid) return;
    const withPost = !bare && draft.hasSomething;
    const photos = withPost ? draft.photos : [];
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    let result: SubOutboxResult;
    try {
      result = await submitSubClockOut({
        request: {
          action: "out",
          logId: clock.log_id,
          ...(withPost ? { text: draft.text, exceptions: draft.exceptions, pendingPhotoCount: photos.length } : {}),
          ...(endedAtIso ? { endedAt: endedAtIso } : {}),
        },
        photos,
        onPrepared: (done, total) => setReady({ done, total }),
      });
    } catch {
      result = { ok: false, error: "Couldn't clock out. Check your signal and try again." };
    }
    inFlight.current = false;
    setSaving(false);
    setReady(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error || "Couldn't clock out. Try again." });
      return;
    }
    onDone(
      result.queued
        ? "Clock-out saved on your phone. It sends on its own when you have signal."
        : photos.length > 0
          ? `Clocked out. ${photoWord(photos.length)} sending now.`
          : withPost
            ? "Clocked out. Penney has your update."
            : "Clocked out. Thanks.",
    );
  }

  const n = draft.photos.length;
  return (
    <PortalSheet
      title="Clock out"
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <PortalNotice notice={notice} onDismiss={() => setNotice(null)} />
          <button type="button" onClick={() => clockOut(false)} disabled={saving || fixInvalid} className="btn btn-primary btn-lg btn-block">
            {saving
              ? ready && ready.total > 0
                ? `Getting photos ready ${Math.min(ready.done + 1, ready.total)} of ${ready.total}`
                : "Clocking out…"
              : draft.hasSomething ? (n > 0 ? `Clock out & post ${photoWord(n)}` : "Clock out & post") : "Clock out"}
          </button>
          {draft.hasSomething && (
            <button type="button" onClick={() => clockOut(true)} disabled={saving || fixInvalid} className="btn btn-ghost btn-block">
              Just clock out
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-[18px] font-extrabold leading-snug">{clock.project_name}</p>
          <p className="text-[16px] text-[var(--muted)]">
            Since {fmtTime(clock.started_at)} · {elapsed.toFixed(1)} h
          </p>
        </div>

        {stale || fixTime ? (
          <div className="rounded-xl border p-3.5" style={{ background: "#FBF1EB", borderColor: "#E9C9B5" }}>
            <p className="text-[16px] font-bold">
              {stale ? "Looks like this one ran long. When did you actually leave?" : "When did you leave?"}
            </p>
            {fixTime ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  aria-label="Time you left"
                  className="min-h-[52px] rounded-xl border border-[var(--line)] bg-white px-3.5 text-[16px] font-bold"
                />
                <button type="button" onClick={() => setFixTime(false)} className="btn btn-ghost">
                  Use now
                </button>
              </div>
            ) : (
              // Only reachable on a long shift: he chose "Use now" (a real long day).
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-[16px]">Ending now, {elapsed.toFixed(1)} h.</p>
                <button type="button" onClick={() => setFixTime(true)} className="btn btn-ghost">
                  Set the real time
                </button>
              </div>
            )}
            {fixInvalid && (
              <p className="mt-2 text-[15px] font-semibold" style={{ color: "#8A2D10" }}>
                Pick a time after you clocked in and not in the future.
              </p>
            )}
          </div>
        ) : (
          <button type="button" onClick={() => setFixTime(true)} className="btn btn-ghost">
            Left earlier? Fix the time
          </button>
        )}

        <p className="text-[16px]">Add photos or a line if you have them. It goes on today&apos;s log.</p>
        <ComposerFields draft={draft} disabled={saving} />
      </div>
    </PortalSheet>
  );
}
