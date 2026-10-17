"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PortalNotice, type PortalNoticeValue } from "@/components/portal-kit";
import type { SubComposerContext, SubExceptionChip } from "@/lib/sub-portal/payload";
import { submitSubPost, useSubOutbox, type SubOutboxResult } from "./post-outbox";
import { EXCEPTION_CHIPS, buildPostText, workChipsFor, type WorkChips } from "./work-tags";

/**
 * The one composer for a sub's daily log (plan §2.3 S3), used on the job
 * screen and inside the clock-out sheet:
 *  - ONE dashed "Add photos" bar: a single file input, `multiple`,
 *    image/*, and no `capture`, so iOS offers camera or library itself.
 *    Never the big photo tiles (Jorge, 9/3: "Never bring the big tiles back").
 *  - 3-up previews, each with a 44px Remove.
 *  - "What got done" chips from all his trades, today's first and pre-picked.
 *  - The three alert chips, any combination.
 *  - A 16px box that teaches keyboard dictation.
 *  - The homeowner disclosure: photos are shared, notes stay with Penney.
 * No hours, crew count or form fields.
 *
 * Posting goes through the post outbox (post-outbox.ts): photos are shrunk
 * and saved on the phone before it answers, the row is made with an id from
 * this phone (so a retry can't post twice), and the photos keep sending in
 * the background. Nothing he picked is ever thrown away.
 */

const DICTATION_HINT = "What did you do today? Tap the mic on your keyboard to talk.";
const DISCLOSURE = "Photos also show on the homeowner's project page. Your notes go to Penney only.";

// A selected alert chip uses its own solid colour (all white-text safe).
const EXCEPTION_COLOR: Record<SubExceptionChip, string> = {
  finished: "#2F6B4F",
  waiting: "#7A5A1E",
  problem: "#8A2D10",
};

/** A uuid made on this phone (the daily_logs id). crypto.randomUUID needs iOS 15.4+, so there's a fallback. */
export function newClientId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const photoWord = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

// Some phones hand over a photo with no type; keep anything that looks like one.
const looksLikeImage = (f: File) => !f.type || f.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name);

// ───────────────────────────────────────── the draft

/** Everything typed and picked in a composer, plus the moves on it. */
export function useComposerDraft(context: SubComposerContext | null) {
  const trades = context?.trades;
  const todayTrade = context?.today_phase?.trade ?? null;
  const chipSet: WorkChips = useMemo(() => workChipsFor(trades ?? [], todayTrade), [trades, todayTrade]);
  const preset = useMemo(() => (chipSet.preselect ? [chipSet.preselect] : []), [chipSet]);

  const [picked, setPicked] = useState<string[]>(preset);
  // The pre-picked chip alone isn't "something to post"; a chip he tapped is.
  const [touched, setTouched] = useState(false);
  const [exceptions, setExceptions] = useState<SubExceptionChip[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);

  // Previews follow the files; the old URLs are released when the list changes.
  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // Chips in the order they're shown, not the order they were tapped.
  const orderedChips = useMemo(() => {
    const order = [...chipSet.groups.flatMap((g) => (g.headline ? [g.headline, ...g.chips] : g.chips)), ...chipSet.tail];
    return order.filter((c) => picked.includes(c));
  }, [chipSet, picked]);
  const orderedExceptions = EXCEPTION_CHIPS.map((c) => c.key).filter((k) => exceptions.includes(k));

  const hasSomething = photos.length > 0 || note.trim().length > 0 || exceptions.length > 0 || (touched && picked.length > 0);

  return {
    chipSet,
    picked,
    exceptions: orderedExceptions,
    note,
    photos,
    previews,
    hasSomething,
    text: buildPostText({ chips: orderedChips, exceptions: orderedExceptions, note }),
    toggleChip: (chip: string) => {
      setTouched(true);
      setPicked((ps) => (ps.includes(chip) ? ps.filter((c) => c !== chip) : [...ps, chip]));
    },
    toggleException: (key: SubExceptionChip) =>
      setExceptions((es) => (es.includes(key) ? es.filter((e) => e !== key) : [...es, key])),
    setNote,
    addFiles: (list: FileList | null) => {
      const files = Array.from(list ?? []).filter(looksLikeImage);
      if (files.length) setPhotos((ps) => [...ps, ...files]);
    },
    removePhoto: (index: number) => setPhotos((ps) => ps.filter((_, i) => i !== index)),
    reset: () => {
      setPicked(preset);
      setTouched(false);
      setExceptions([]);
      setNote("");
      setPhotos([]);
    },
  };
}

export type ComposerDraft = ReturnType<typeof useComposerDraft>;

// ───────────────────────────────────────── the fields

function Chip({ label, on, color, disabled, onClick }: { label: string; on: boolean; color?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="inline-flex min-h-[44px] items-center rounded-full border px-4 text-[16px] font-bold disabled:opacity-50"
      style={
        on
          ? { background: color ?? "var(--ink)", borderColor: color ?? "var(--ink)", color: "#fff" }
          : { background: "#fff", borderColor: "var(--line)", color: "var(--ink)" }
      }
    >
      {on && <span aria-hidden className="mr-1.5">✓</span>}
      {label}
    </button>
  );
}

/**
 * The composer's inputs without a submit button: the job screen adds
 * "Post N photos", the clock-out sheet puts its own buttons in its footer.
 */
export function ComposerFields({
  draft,
  disabled = false,
  inputRef,
}: {
  draft: ComposerDraft;
  disabled?: boolean;
  /** The file input, so the QR "compose" landing can focus the bar. */
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { chipSet, picked, photos, previews } = draft;
  const isOpen = (g: WorkChips["groups"][number]) =>
    chipSet.groups.length === 1 || !g.headline || picked.includes(g.headline) || g.chips.some((c) => picked.includes(c));

  return (
    <div className="space-y-4">
      {/* One input, no capture attribute: the phone offers Take Photo / Photo Library itself. */}
      <label
        className={`flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 text-[17px] font-extrabold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${
          disabled ? "opacity-50" : "cursor-pointer"
        }`}
        style={{ borderColor: "var(--accent-dark)", color: "var(--accent-dark)", background: "#FBF1EB", outlineColor: "var(--accent-dark)" }}
      >
        <span aria-hidden>+</span>
        {photos.length > 0 ? `Add more photos · ${photoWord(photos.length)} picked` : "Add photos"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            draft.addFiles(e.target.files);
            // Lets him pick the same photo again after removing it.
            e.target.value = "";
          }}
        />
      </label>

      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {previews.map((url, i) => (
            <div key={url} className="relative aspect-square overflow-hidden rounded-xl bg-[var(--line)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => draft.removePhoto(i)}
                disabled={disabled}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute inset-x-0 bottom-0 min-h-[44px] text-[15px] font-bold text-white"
                style={{ background: "rgba(37,45,43,0.78)" }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="label mb-2">What got done</p>
        <div className="flex flex-wrap gap-3">
          {/* Each trade: its headline, then its details once it's open (the
              only trade, today's trade, or a headline he tapped). */}
          {chipSet.groups.map((g) => {
            const headline = g.headline;
            return (
              <span key={g.key} className="contents">
                {headline && <Chip label={headline} on={picked.includes(headline)} disabled={disabled} onClick={() => draft.toggleChip(headline)} />}
                {isOpen(g) &&
                  g.chips.map((c) => <Chip key={c} label={c} on={picked.includes(c)} disabled={disabled} onClick={() => draft.toggleChip(c)} />)}
              </span>
            );
          })}
          {chipSet.tail.map((c) => (
            <Chip key={c} label={c} on={picked.includes(c)} disabled={disabled} onClick={() => draft.toggleChip(c)} />
          ))}
        </div>
      </div>

      <div>
        <p className="label mb-2">Penney hears about these right away</p>
        <div className="flex flex-wrap gap-3">
          {EXCEPTION_CHIPS.map((c) => (
            <Chip
              key={c.key}
              label={c.label}
              on={draft.exceptions.includes(c.key)}
              color={EXCEPTION_COLOR[c.key]}
              disabled={disabled}
              onClick={() => draft.toggleException(c.key)}
            />
          ))}
        </div>
      </div>

      <textarea
        value={draft.note}
        onChange={(e) => draft.setNote(e.target.value)}
        rows={3}
        disabled={disabled}
        placeholder={DICTATION_HINT}
        aria-label="Notes for Penney"
        className="block w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 text-[16px] leading-snug disabled:opacity-50"
      />

      <p className="text-[13px] text-[var(--muted)]">{DISCLOSURE}</p>
    </div>
  );
}

// ───────────────────────────────────────── the "still sending" banner

/**
 * "Sending 3 of 14 · it finishes next time you open the app", from the
 * outbox's own counts (pending includes what's sending). Something the
 * server refused says why ("Didn't send: That job isn't on your list") and
 * waits for Try again: it won't finish on its own, so it never claims to.
 * Nothing shows when the phone has nothing left to send.
 */
export function OutboxBanner() {
  const { pending, sending, failed, refused, done, total, retryNow } = useSubOutbox();
  const left = pending + failed;
  if (left <= 0) return null;

  const stuck = sending === 0 && failed > 0;
  const of = Math.max(total, done + left);
  const waitingNote = pending > 0 ? ` · ${pending} more waiting to send` : "";
  const message = !stuck
    ? `Sending ${Math.min(done + 1, of)} of ${of} · it finishes next time you open the app`
    : refused.length > 0
      ? `Didn't send: ${refused[0].error}${refused.length > 1 ? ` (+${refused.length - 1} more)` : ""}${waitingNote}`
      : `${failed} didn't send${waitingNote}`;
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border px-3.5 py-2 text-[15px] font-semibold"
      style={{ background: "#F1F0EC", borderColor: "var(--line)", color: "#3A4340" }}
    >
      <p className="min-w-0 flex-1 py-1">{message}</p>
      {stuck && (
        <button type="button" onClick={retryNow} className="btn btn-ghost shrink-0">
          Try again
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────── the job-screen composer

/**
 * The composer card at the top of a job's Log: fields, then the 52px
 * "Post N photos" button, then the sending banner. `focus` is the QR landing
 * (?compose=1): it scrolls the card into view and focuses the photo bar.
 */
export function Composer({
  projectId,
  context,
  preview,
  focus = false,
  onPosted,
}: {
  projectId: string;
  context: SubComposerContext;
  /** Staff preview: everything shows, nothing posts. */
  preview: boolean;
  focus?: boolean;
  onPosted?: () => void;
}) {
  const draft = useComposerDraft(context);
  const cardRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<PortalNoticeValue | null>(null);
  const [saving, setSaving] = useState(false);
  // "Getting photos ready 3 of 10" while the outbox shrinks them.
  const [ready, setReady] = useState<{ done: number; total: number } | null>(null);
  const inFlight = useRef(false);
  // Kept until the post lands, so a retry after a failure reuses the same row id.
  const postId = useRef<string | null>(null);

  useEffect(() => {
    if (!focus) return;
    cardRef.current?.scrollIntoView({ block: "start" });
    inputRef.current?.focus({ preventScroll: true });
  }, [focus]);

  async function post() {
    if (preview || inFlight.current || !draft.hasSomething) return;
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    postId.current ??= newClientId();
    const photos = draft.photos;
    let result: SubOutboxResult;
    try {
      result = await submitSubPost({
        request: {
          id: postId.current,
          projectId,
          text: draft.text,
          exceptions: draft.exceptions,
          pendingPhotoCount: photos.length,
        },
        photos,
        onPrepared: (done, total) => setReady({ done, total }),
      });
    } catch {
      result = { ok: false, error: "Couldn't post. Your photos are still here, so try again." };
    }
    inFlight.current = false;
    setSaving(false);
    setReady(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error || "Couldn't post. Your photos are still here, so try again." });
      return;
    }
    postId.current = null;
    draft.reset();
    setNotice({
      tone: "success",
      text: result.queued
        ? "Saved on your phone. It sends on its own when you have signal."
        : photos.length > 0
          ? `Posted. ${photoWord(photos.length)} sending now; you can leave this screen.`
          : "Posted. Penney sees it now.",
    });
    onPosted?.();
  }

  const n = draft.photos.length;
  const savingLabel = ready && ready.total > 0 ? `Getting photos ready ${Math.min(ready.done + 1, ready.total)} of ${ready.total}` : n > 0 ? "Saving photos…" : "Posting…";
  return (
    <section ref={cardRef} className="card scroll-mt-20 space-y-4 p-4" style={focus ? { borderColor: "var(--accent-dark)" } : undefined}>
      <h3 className="text-[18px] font-extrabold">Add to today&apos;s log</h3>
      <ComposerFields draft={draft} disabled={preview || saving} inputRef={inputRef} />
      <button type="button" onClick={post} disabled={preview || saving || !draft.hasSomething} className="btn btn-primary btn-lg btn-block">
        {saving ? savingLabel : n > 0 ? `Post ${photoWord(n)}` : "Post"}
      </button>
      {preview && <p className="text-[13px] text-[var(--muted)]">Staff preview: posting is off here.</p>}
      <PortalNotice notice={notice} onDismiss={() => setNotice(null)} />
      {!preview && <OutboxBanner />}
    </section>
  );
}
