"use client";

import { useMemo, useState } from "react";
import { Empty, PhotoGrid, PhotoViewer, PortalNotice, usePortalAction, type PortalNoticeValue } from "@/components/portal-kit";
import { fmtRelativeDay, fmtShort, fmtTime } from "@/lib/portal-kit/format";
import { isSubLiveStatus } from "@/lib/sub-portal/statuses";
import type {
  SubClockRequest,
  SubClockResponse,
  SubInspection,
  SubInspectionActionRequest,
  SubInspectionActionResponse,
  SubJobPayload,
  SubPost,
} from "@/lib/sub-portal/payload";
import { ClockOutSheet } from "./clock-out-sheet";
import { Composer } from "./composer";

/**
 * A job's Log tab, top to bottom (plan §2.3 S3):
 *  1. the composer
 *  2. every inspection on the job, so gaps read as gaps. Book date / Passed
 *     / Failed / Undo only on the ones in his trade; the rest are one line.
 *  3. his company's posts on this job, by day, 20 at a time, photos in the
 *     swipe viewer (no crew chatter: the server sends only his posts)
 *  4. last, the optional time clock.
 *
 * On a job he can open but not post to (data.can_post false: closed, or one
 * he only billed) the composer, Clock in and the inspection buttons are
 * replaced by one line, since the server would refuse every tap. An open
 * shift can still be clocked out.
 */

const SECTION_TITLE = "px-1 pb-2 pt-1 text-[18px] font-extrabold";

const CHIP = {
  passed: "#2F6B4F",
  failed: "#8A2D10",
  booked: "#252D2B",
  open: "#5F6763",
} as const;

function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-bold text-white" style={{ background: color }}>
      {label}
    </span>
  );
}

export function JobLog({
  data,
  posts,
  nextCursor,
  loadingMore,
  onLoadMore,
  preview,
  compose,
  onChanged,
}: {
  data: SubJobPayload;
  /** Every post loaded so far (first page plus any older pages). */
  posts: SubPost[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  preview: boolean;
  /** The QR landing: focus the composer. */
  compose: boolean;
  /** Something was saved: reload the job (and the home payload). */
  onChanged: () => void;
}) {
  const readOnly = !data.can_post;
  return (
    <div className="space-y-6">
      {readOnly ? (
        <Empty>
          {isSubLiveStatus(data.job.status)
            ? "Scan the job sign to post here."
            : "This job is closed. Call the office if you need to post here."}
        </Empty>
      ) : (
        <Composer projectId={data.job.project_id} context={data.composer} preview={preview} focus={compose} onPosted={onChanged} />
      )}
      <Inspections items={data.inspections} preview={preview} readOnly={readOnly} onChanged={onChanged} />
      <Posts posts={posts} today={data.today} nextCursor={nextCursor} loadingMore={loadingMore} onLoadMore={onLoadMore} />
      <ClockRow data={data} preview={preview} onChanged={onChanged} />
    </div>
  );
}

// ───────────────────────────────────────── inspections

function Inspections({
  items,
  preview,
  readOnly,
  onChanged,
}: {
  items: SubInspection[];
  preview: boolean;
  /** He can't post on this job: names and status chips only. */
  readOnly: boolean;
  onChanged: () => void;
}) {
  const action = usePortalAction("/api/sub-portal/inspections", !preview);
  const update = (insp: SubInspection, body: Omit<SubInspectionActionRequest, "id">, key: string) =>
    action.run<Extract<SubInspectionActionResponse, { ok: true }>>(
      `${key}:${insp.id}`,
      { id: insp.id, ...body } satisfies SubInspectionActionRequest,
      { success: "Updated. Penney sees it in the job log.", onSuccess: onChanged },
    );

  return (
    <section>
      <h3 className={SECTION_TITLE}>Inspections</h3>
      {items.length === 0 ? (
        <Empty>No inspections listed for this job yet.</Empty>
      ) : (
        <ul className="card divide-y divide-[var(--line)]">
          {items.map((insp) => (
            <InspectionRow
              key={insp.id}
              insp={insp}
              action={action}
              canAct={insp.my_trade && !readOnly}
              onUpdate={(body, key) => update(insp, body, key)}
            />
          ))}
        </ul>
      )}
      <PortalNotice notice={action.notice} onDismiss={action.clearNotice} className="mt-3" />
    </section>
  );
}

function inspectionChip(insp: SubInspection): { label: string; color: string } {
  const done = insp.completed_at ? ` ${fmtShort(insp.completed_at, "")}` : "";
  if (insp.status === "passed") return { label: `Passed${done}`, color: CHIP.passed };
  if (insp.status === "failed") return { label: `Failed${done}`, color: CHIP.failed };
  if (insp.scheduled_for) return { label: `Booked ${fmtShort(insp.scheduled_for)}`, color: CHIP.booked };
  return { label: "Not booked", color: CHIP.open };
}

function InspectionRow({
  insp,
  action,
  canAct,
  onUpdate,
}: {
  insp: SubInspection;
  action: ReturnType<typeof usePortalAction>;
  /** His trade's inspection on a job he can post to: Book date / Passed / Failed / Undo. */
  canAct: boolean;
  onUpdate: (body: Omit<SubInspectionActionRequest, "id">, key: string) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<null | "date" | "failed">(null);
  const [date, setDate] = useState(insp.scheduled_for ?? "");
  const [why, setWhy] = useState("");
  const chip = inspectionChip(insp);
  const off = !action.enabled || action.busy;
  const busy = (key: string) => action.isBusy(`${key}:${insp.id}`);

  const save = async (body: Omit<SubInspectionActionRequest, "id">, key: string) => {
    const ok = await onUpdate(body, key);
    if (ok) {
      setMode(null);
      setWhy("");
    }
  };

  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-bold leading-snug">{insp.name}</p>
          {insp.is_final && <p className="text-[15px] text-[var(--muted)]">Final inspection</p>}
        </div>
        <StatusChip label={chip.label} color={chip.color} />
      </div>

      {/* Not his trade (or a job he can't post to): the line above is all he gets. */}
      {canAct && insp.status === "pending" && mode === null && (
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" disabled={off} onClick={() => setMode("date")} className="btn btn-ghost">
            {insp.scheduled_for ? "Change date" : "Book date"}
          </button>
          <button type="button" disabled={off} onClick={() => save({ status: "passed" }, "passed")} className="btn btn-ghost">
            {busy("passed") ? "Saving…" : "✓ Passed"}
          </button>
          <button type="button" disabled={off} onClick={() => setMode("failed")} className="btn btn-ghost">
            Failed
          </button>
        </div>
      )}

      {canAct && mode === "date" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label={`Date for ${insp.name}`}
            className="min-h-[44px] rounded-xl border border-[var(--line)] bg-white px-3 text-[16px]"
          />
          <button type="button" disabled={off || !date} onClick={() => save({ scheduledFor: date }, "book")} className="btn btn-primary">
            {busy("book") ? "Saving…" : "Save date"}
          </button>
          <button type="button" onClick={() => setMode(null)} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      )}

      {canAct && mode === "failed" && (
        <div className="mt-3 space-y-3">
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            rows={2}
            placeholder="What did they flag? (optional)"
            aria-label="What the inspector flagged"
            className="block w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 text-[16px]"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={off}
              onClick={() => save({ status: "failed", ...(why.trim() ? { note: why.trim() } : {}) }, "failed")}
              className="btn btn-primary"
            >
              {busy("failed") ? "Saving…" : "Mark failed"}
            </button>
            <button type="button" onClick={() => setMode(null)} className="btn btn-ghost">
              Cancel
            </button>
          </div>
        </div>
      )}

      {canAct && insp.status !== "pending" && (
        <div className="mt-3">
          <button type="button" disabled={off} onClick={() => save({ status: "pending" }, "undo")} className="btn btn-ghost">
            {busy("undo") ? "Saving…" : "Undo"}
          </button>
        </div>
      )}
    </li>
  );
}

// ───────────────────────────────────────── his posts

function Posts({
  posts,
  today,
  nextCursor,
  loadingMore,
  onLoadMore,
}: {
  posts: SubPost[];
  today: string;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [viewer, setViewer] = useState<number | null>(null);

  // One viewer swipes through every loaded photo; each post's grid starts
  // at its own offset into that list.
  const { photos, offsets, days } = useMemo(() => {
    const offsets = new Map<string, number>();
    const all: SubPost["photos"] = [];
    const days: { day: string; items: SubPost[] }[] = [];
    for (const p of posts) {
      offsets.set(p.id, all.length);
      all.push(...p.photos);
      const last = days[days.length - 1];
      if (last && last.day === p.day) last.items.push(p);
      else days.push({ day: p.day, items: [p] });
    }
    return { photos: all, offsets, days };
  }, [posts]);

  return (
    <section>
      <h3 className={SECTION_TITLE}>Your posts on this job</h3>
      {posts.length === 0 ? (
        <Empty>Nothing posted on this job yet. Your photos and notes show up here.</Empty>
      ) : (
        <div className="space-y-5">
          {days.map((g) => (
            <div key={g.day}>
              <p className="label mb-2 px-1">{fmtRelativeDay(g.day, today, g.day)}</p>
              <ul className="space-y-3">
                {g.items.map((p) => (
                  <PostCard key={p.id} post={p} startIndex={offsets.get(p.id) ?? 0} onOpen={setViewer} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {nextCursor && (
        <button type="button" onClick={onLoadMore} disabled={loadingMore} className="btn btn-ghost btn-lg btn-block mt-4">
          {loadingMore ? "Loading…" : "Show older posts"}
        </button>
      )}
      {viewer != null && photos.length > 0 && (
        <PhotoViewer photos={photos} index={Math.min(viewer, photos.length - 1)} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </section>
  );
}

function PostCard({ post, startIndex, onOpen }: { post: SubPost; startIndex: number; onOpen: (index: number) => void }) {
  const stillSending = Math.max(0, post.photo_count - post.photos.length);
  return (
    <li className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[16px] font-bold">
          {post.author_label}
          {post.kind === "shift" && <span className="font-semibold text-[var(--muted)]"> · Time clock</span>}
        </p>
        <p className="shrink-0 text-[15px] text-[var(--muted)]">{fmtTime(post.posted_at)}</p>
      </div>
      {post.text && <p className="mt-2 whitespace-pre-line text-[16px] leading-relaxed">{post.text}</p>}
      {post.photos.length > 0 && (
        <div className="mt-3">
          <PhotoGrid photos={post.photos} startIndex={startIndex} onOpen={onOpen} />
        </div>
      )}
      {stillSending > 0 && (
        <p className="mt-2 text-[15px] text-[var(--muted)]">
          {stillSending} more photo{stillSending === 1 ? "" : "s"} still sending
        </p>
      )}
      {post.client_hidden && post.photo_count > 0 && (
        <p className="mt-2 text-[15px] text-[var(--muted)]">Penney kept these photos off the homeowner&apos;s page.</p>
      )}
    </li>
  );
}

// ───────────────────────────────────────── the optional time clock

function ClockRow({ data, preview, onChanged }: { data: SubJobPayload; preview: boolean; onChanged: () => void }) {
  const action = usePortalAction("/api/sub-portal/clock", !preview);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [done, setDone] = useState<PortalNoticeValue | null>(null);
  const clock = data.clock;
  const here = !!clock && clock.project_id === data.job.project_id;
  // Clock in needs a job he can post to; an open shift can always be closed.
  const canClockIn = data.can_post;

  const clockIn = () => {
    setDone(null);
    action.run<Extract<SubClockResponse, { ok: true }>>(
      "in",
      { action: "in", projectId: data.job.project_id } satisfies SubClockRequest,
      { success: "You're clocked in. Clock out here when you leave.", onSuccess: onChanged },
    );
  };

  return (
    <section>
      <div className="card flex min-h-[60px] items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="label">Time clock (optional)</p>
          <p className="text-[16px] font-semibold">
            {!clock ? "Not clocked in" : here ? `Clocked in here since ${fmtTime(clock.started_at)}` : `You're clocked in at ${clock.project_name}`}
          </p>
        </div>
        {clock ? (
          <button type="button" disabled={!action.enabled} onClick={() => setSheetOpen(true)} className="btn btn-ghost shrink-0">
            Clock out
          </button>
        ) : canClockIn ? (
          <button type="button" disabled={!action.enabled || action.busy} onClick={clockIn} className="btn btn-ghost shrink-0">
            {action.isBusy("in") ? "Saving…" : "Clock in"}
          </button>
        ) : null}
      </div>
      <PortalNotice notice={done ?? action.notice} onDismiss={() => (done ? setDone(null) : action.clearNotice())} className="mt-3" />
      {sheetOpen && clock && (
        <ClockOutSheet
          clock={clock}
          // Today's phase belongs to this job; on another job's shift only his trades carry over.
          context={here ? data.composer : { trades: data.composer.trades, today_phase: null }}
          onClose={() => setSheetOpen(false)}
          onDone={(message) => {
            setSheetOpen(false);
            setDone({ tone: "success", text: message });
            onChanged();
          }}
        />
      )}
    </section>
  );
}
