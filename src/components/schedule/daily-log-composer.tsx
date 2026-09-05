"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Images, X, Send, Loader2, Mic, Square, Sparkles, Megaphone } from "lucide-react";
import { postDailyLog } from "@/lib/actions/daily-logs";
import { getMyPendingDailyReports } from "@/lib/actions/daily-reports";
import type { PendingDailyReport } from "@/lib/crew/pending-reports";
import { enqueueDailyLogPhotos } from "@/lib/upload/daily-log-upload-queue";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetDescription,
  BottomSheetBody,
  BottomSheetFooter,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import type { ActivityMention } from "@/lib/actions/activity-mentions";
import { isGroupMentionType } from "@/lib/activity-mentions/groups";
import { applyDetectedMentions } from "@/lib/activity-mentions/apply-detected";

const MAX_PHOTOS = 50;

const ASSISTANT_GREETING_PATTERNS = [
  /^hi[.!,]?\s+i['’]?m\b/i,
  /^hello[.!,]?\s+i['’]?m\b/i,
  /^i['’]?m ready to help/i,
  /^sure[,!.]\s+here['’]?s\b/i,
  /^here['’]?s your\b/i,
  /tell me what happened/i,
  /go ahead and tell me/i,
];

function looksLikeAssistantGreeting(text: string): boolean {
  return ASSISTANT_GREETING_PATTERNS.some((re) => re.test(text.trim()));
}

export function DailyLogComposer({
  open,
  onOpenChange,
  phaseId,
  projectId,
  projectName,
  phaseName,
  keepOpenAfterPost = false,
  onPosted,
  onChangeProject,
  mentions = [],
  mentionsLoading = false,
  report,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Schedule phase to log against — optional; a bare project works too. */
  phaseId?: string;
  /** Project to log against when there's no schedule phase. */
  projectId?: string;
  projectName: string;
  phaseName?: string;
  /** Reset the draft but keep the composer open for another daily log. */
  keepOpenAfterPost?: boolean;
  onPosted?: () => void;
  onChangeProject?: () => void;
  /** Jobs, workers, and subcontractors available from the @ picker. */
  mentions?: ActivityMention[];
  mentionsLoading?: boolean;
  report?: PendingDailyReport;
}) {
  // Text the user typed manually + everything we've already polished. The
  // live mic transcript is rendered ON TOP of this without being saved
  // until the user stops, so we can replace the raw transcript with the
  // AI-polished version.
  const [savedText, setSavedText] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishFlash, setPolishFlash] = useState<"none" | "ok" | "empty">("none");
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<ActivityMention[]>([]);
  const [autoTagCount, setAutoTagCount] = useState(0);
  const [dueReports, setDueReports] = useState<PendingDailyReport[]>([]);
  const [resolvedReportProject, setResolvedReportProject] = useState<string | null>(null);
  const reportLoading = !report && !!projectId && resolvedReportProject !== projectId;
  const [reportLoadError, setReportLoadError] = useState(false);
  const [chosenReportId, setChosenReportId] = useState<string | null>(null);
  const matchingReports = resolvedReportProject === projectId ? dueReports : [];
  const activeReport = report ?? matchingReports.find(r => r.logId === chosenReportId) ?? matchingReports[0];
  useEffect(() => {
    if (report || !projectId || !open) return;
    let cancelled = false;
    getMyPendingDailyReports(projectId).then(rows => { if (!cancelled) { setDueReports(rows); setReportLoadError(false); } })
      .catch(() => { if (!cancelled) setReportLoadError(true); })
      .finally(() => { if (!cancelled) setResolvedReportProject(projectId); });
    return () => { cancelled = true; };
  }, [projectId, report, open]);

  const {
    isListening,
    isFinalizing,
    transcript,
    sessionId,
    startListening,
    stopListening,
    isSupported,
    error: micError,
  } = useSpeechRecognition();

  // Capture the snapshot at the moment recording starts so we know which
  // chunk to replace when the AI polish comes back.
  const [snapshotBeforeRecord, setSnapshotBeforeRecord] = useState("");
  // Last recording we've already handled. Keyed by session instead of a
  // boolean latch so a re-render can't strand a recording as "handled"
  // before its text was actually processed.
  const polishedSession = useRef<number>(0);
  const polishTimerRef = useRef<number | null>(null);

  const reset = () => {
    setSavedText("");
    photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setPhotoFiles([]);
    setPhotoPreviews([]);
    setError(null);
    setSuccessMessage(null);
    setPosting(false);
    setPolishing(false);
    setPolishFlash("none");
    setSnapshotBeforeRecord("");
    setMentionQuery(null);
    setSelectedTags([]);
    setAutoTagCount(0);
    // Ignore the speech hook's previous transcript after clearing a draft.
    // Starting a new recording gets a new session id and runs again.
    polishedSession.current = sessionId;
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  // What's currently shown in the textarea: saved text + the in-progress
  // live transcript (with a blank line between them if both have content).
  const displayText = (() => {
    if (!isListening || !transcript.trim()) return savedText;
    const head = snapshotBeforeRecord;
    return head.trim() ? `${head.trim()}\n\n${transcript}` : transcript;
  })();

  // While recording, the textarea is read-only (the live transcript is
  // streaming in and would conflict with manual typing). When idle, the
  // user can edit anything — including AI-polished output.
  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isListening) return;
    setSuccessMessage(null);
    const value = e.target.value;
    setSavedText(value);
    const cursor = e.target.selectionStart ?? value.length;
    const trailingMention = /@([A-Za-z0-9]*)$/.exec(value.slice(0, cursor));
    setMentionQuery(trailingMention ? trailingMention[1].toLowerCase() : null);
  };

  const mentionMatches =
    mentionQuery === null
      ? []
      : mentions
          .filter((mention) => {
            const query = mentionQuery.toLowerCase();
            return (
              mention.token.toLowerCase().includes(query) ||
              mention.label.toLowerCase().includes(query) ||
              mention.detail.toLowerCase().includes(query)
            );
          })
          .slice(0, 8);

  const insertMention = (mention: ActivityMention) => {
    const textarea = notesRef.current;
    const cursor = textarea?.selectionStart ?? savedText.length;
    const beforeCursor = savedText.slice(0, cursor);
    const afterCursor = savedText.slice(cursor);
    const replacement = `@${mention.token} `;
    const updatedBefore = beforeCursor.replace(/@[A-Za-z0-9]*$/, replacement);
    setSavedText(updatedBefore + afterCursor);
    setSelectedTags((current) =>
      current.some(
        (tag) => tag.type === mention.type && tag.id === mention.id,
      )
        ? current
        : [...current, mention],
    );
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const nextCursor = updatedBefore.length;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const onMicClick = () => {
    // Mid wind-down the recognizer is still handing us the last sentence —
    // another tap here would either restart or strand it.
    if (isFinalizing) return;
    setError(null);
    setSuccessMessage(null);
    setPolishFlash("none");
    if (isListening) {
      stopListening();
      return;
    }
    setSnapshotBeforeRecord(savedText);
    startListening();
  };

  // When recording stops, polish the freshly-recorded chunk and merge
  // it into savedText. Runs exactly once per recording session.
  useEffect(() => {
    if (isListening) return;
    if (sessionId === 0) return; // nothing dictated yet this composer
    if (polishedSession.current === sessionId) return;
    // Claim the session up front so re-renders can't double-fire the polish.
    // isListening only flips once the recognizer is fully done, so the
    // transcript we read here is the complete recording.
    polishedSession.current = sessionId;

    const raw = transcript.trim();
    // Deferred out of the effect body (cascading-render lint rule). The
    // cleanup deliberately lives in an unmount-only effect: cancelling this
    // on a dep change would strand the session as "handled" and silently
    // drop the recording — that was the original bug.
    polishTimerRef.current = window.setTimeout(() => {
      polishTimerRef.current = null;
      if (!raw) {
        // The recognizer handed back nothing. Say so — silently reverting
        // the textarea reads as "the app ate my note".
        setError("Didn't pick up any audio. Check the mic and try again.");
        setPolishFlash("empty");
        window.setTimeout(() => setPolishFlash("none"), 2500);
        return;
      }
      setPolishing(true);
      fetch("/api/structure-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw, context: "daily-log" }),
      })
        .then((r) => r.json())
        .then(async (data) => {
          const cleaned = typeof data.cleaned === "string" ? data.cleaned.trim() : "";
          const head = snapshotBeforeRecord.trim();
          const headOk = head ? `${head}\n\n` : "";
          if (data.empty || !cleaned || looksLikeAssistantGreeting(cleaned)) {
            // Polish came back empty (too short to structure, or the model
            // echoed a greeting). Keep the raw words — an unpolished note
            // beats a deleted one.
            setSavedText(headOk + raw);
            setPolishFlash("empty");
          } else {
            const combined = headOk + cleaned;
            try {
              const response = await fetch("/api/match-activity-mentions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: cleaned, projectId }),
              });
              const matchResult: unknown = await response.json();
              const ids =
                matchResult &&
                typeof matchResult === "object" &&
                "mentionIds" in matchResult &&
                Array.isArray(matchResult.mentionIds)
                  ? matchResult.mentionIds.filter(
                      (id): id is string => typeof id === "string",
                    )
                  : [];
              const detected = mentions.filter(
                (mention) =>
                  mention.type === "worker" && ids.includes(mention.id),
              );
              setSelectedTags((current) => {
                const next = [...current];
                for (const mention of detected) {
                  if (
                    !next.some(
                      (tag) =>
                        tag.type === "worker" && tag.id === mention.id,
                    )
                  ) {
                    next.push(mention);
                  }
                }
                return next;
              });
              setSavedText(applyDetectedMentions(combined, detected));
              setAutoTagCount(detected.length);
            } catch {
              setSavedText(combined);
            }
            setPolishFlash("ok");
          }
        })
        .catch(() => {
          // Network/AI failure — keep the raw transcript so the user
          // doesn't lose their words.
          const head = snapshotBeforeRecord.trim();
          const headOk = head ? `${head}\n\n` : "";
          setSavedText(headOk + raw);
          setPolishFlash("empty");
        })
        .finally(() => {
          setPolishing(false);
          setTimeout(() => setPolishFlash("none"), 2500);
        });
    }, 0);
  }, [isListening, mentions, projectId, sessionId, snapshotBeforeRecord, transcript]);

  // Only tearing the composer down cancels a pending polish.
  useEffect(
    () => () => {
      if (polishTimerRef.current) window.clearTimeout(polishTimerRef.current);
    },
    [],
  );

  const onPickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_PHOTOS - photoFiles.length;
    const accepted = files.slice(0, Math.max(0, remaining));
    const previews = accepted.map((f) => URL.createObjectURL(f));
    setPhotoFiles((prev) => [...prev, ...accepted]);
    setPhotoPreviews((prev) => [...prev, ...previews]);
    setSuccessMessage(null);
    e.target.value = "";
  };

  const removePhoto = (idx: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      // 1. Insert the daily_log row immediately with text + zero photos.
      //    The user can close the composer and keep working — photos
      //    upload in the background and append themselves to the row
      //    as each one finishes.
      const activeTags = selectedTags.filter((tag) =>
        savedText.includes(`@${tag.token}`),
      );
      const result = await postDailyLog(
        { phaseId, projectId, reportLogId: activeReport?.logId },
        savedText,
        [],
        photoFiles.length,
        activeTags,
      );
      if (result.error || !result.logId) {
        setError(result.error || "Failed to post");
        setPosting(false);
        return;
      }

      // 2. Hand the photos to the global upload queue. Returns
      //    immediately; uploads happen in the background.
      if (photoFiles.length > 0) {
        enqueueDailyLogPhotos(result.logId, photoFiles);
      }

      // 3. Keep the current job selected when posting several quick field
      //    updates, or close for the traditional one-and-done flow.
      router.refresh();
      onPosted?.();
      if (keepOpenAfterPost && !activeReport) {
        reset();
        setSuccessMessage("Daily log posted. Ready for another.");
      } else {
        close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
      setPosting(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent
        className="max-h-[92dvh]"
        // Don't let Radix auto-focus the textarea on open — that pops
        // the iOS keyboard and hides the Voice/Photos/Post buttons.
        // The user can tap the textarea explicitly when they want to type.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // NEVER dismiss on outside interaction. Tapping the mic pops the
        // OS microphone-permission alert, and on iOS the alert's dismissal
        // tap ghost-clicks through onto the dimmed backdrop — Radix read
        // that as pointer-down-outside and closed the whole composer
        // (losing the draft). Only Cancel / X / posting close this sheet.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <BottomSheetHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <BottomSheetTitle className="truncate pr-0">Daily log · {projectName}</BottomSheetTitle>
              <BottomSheetDescription>{phaseName ?? "Photos and notes from the jobsite"}</BottomSheetDescription>
            </div>
            {onChangeProject && (
              <button
                type="button"
                onClick={onChangeProject}
                disabled={posting}
                className="shrink-0 text-xs font-semibold text-amber-500 disabled:opacity-50"
              >
                Change job
              </button>
            )}
          </div>
        </BottomSheetHeader>
        <BottomSheetBody className="flex flex-col gap-3">
          <div className="space-y-1 text-sm">
            <p className="font-semibold">What did you finish?</p>
            <p className="font-semibold">What is left, and how much more time?</p>
            <p className="font-semibold">Anything blocking the next visit?</p>
            <p className="text-muted-foreground">Answer together below by voice or typing. Say “none” if nothing remains or there are no blockers.</p>
          </div>
          {reportLoadError && <p role="alert">Could not check this job’s daily logs. Close and reopen to try again.</p>}
          {reportLoading && <p className="text-sm text-muted-foreground">Finding your clock-in and clock-out records…</p>}
          {!reportLoading && !reportLoadError && !activeReport && <p className="rounded-lg border p-3 text-sm text-muted-foreground">No unreported, clocked-out time is linked to this job. You can post a field update here. To finish a required daily log, choose the job under Daily logs due.</p>}
          {activeReport && <div className="rounded-lg border border-amber-500/30 p-3 text-sm space-y-2">
            <p className="font-semibold">Linked to your time · {activeReport.workDate} · {activeReport.minutes} minutes</p>
            {activeReport.firstClockIn && activeReport.lastClockOut && <p>First clock-in: {new Date(activeReport.firstClockIn).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} · Last clock-out: {new Date(activeReport.lastClockOut).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}</p>}
            <p>Your photos and voice notes below are part of this same daily log. Submitting does not change your clocked hours.</p>
            {!report && matchingReports.length > 1 && <select aria-label="Workday to report" className="w-full rounded border bg-background p-2 text-base" value={activeReport.logId} onChange={e => setChosenReportId(e.target.value)}>
              {matchingReports.map(r => <option key={r.logId} value={r.logId}>{r.workDate}</option>)}
            </select>}
          </div>}
          {successMessage && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300">
              {successMessage}
            </div>
          )}
          <div className="relative">
            <textarea
              ref={notesRef}
              value={displayText}
              onChange={onTextareaChange}
              readOnly={isListening || polishing}
              rows={6}
              placeholder={"Finished: …\nRemaining / time needed: …\nBlocked by: …\n\nTap Voice note to talk, or type here."}
              className={`w-full rounded-lg border p-3 pr-10 text-base placeholder:text-zinc-500 focus:outline-none focus:ring-1 ${
                isListening
                  ? "border-red-500/40 bg-red-500/5 text-zinc-100 ring-red-500/30"
                  : polishing
                    ? "border-amber-500/40 bg-amber-500/5 text-zinc-100"
                    : "border-zinc-700 bg-zinc-900 text-zinc-100 focus:ring-amber-500/40"
              }`}
            />
            {isListening && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                {isFinalizing ? "Finishing" : "Listening"}
              </span>
            )}
            {polishing && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                <Sparkles className="h-3 w-3 animate-pulse" />
                Polishing
              </span>
            )}
            {polishFlash === "ok" && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                <Sparkles className="h-3 w-3" />
                AI polished
              </span>
            )}
            {polishFlash === "empty" && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-zinc-700/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-300">
                Didn&apos;t catch that
              </span>
            )}
            {mentionQuery !== null && !isListening && !polishing && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl">
                {mentionsLoading ? (
                  <div className="px-3 py-3 text-xs text-zinc-500">Loading jobs and people…</div>
                ) : mentionMatches.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-zinc-500">No matching jobs, workers, or subcontractors.</div>
                ) : (
                  mentionMatches.map((mention) => (
                    <button
                      key={`${mention.type}-${mention.id}`}
                      type="button"
                      onClick={() => insertMention(mention)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-zinc-800"
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase ${
                          isGroupMentionType(mention.type)
                            ? "bg-rose-500/15 text-rose-400"
                            : mention.type === "job"
                              ? "bg-amber-500/15 text-amber-400"
                              : mention.type === "worker"
                                ? "bg-blue-500/15 text-blue-400"
                                : "bg-purple-500/15 text-purple-400"
                        }`}
                      >
                        {mention.type === "everyone"
                          ? "All"
                          : mention.type === "office"
                            ? "Office"
                            : mention.type === "field"
                              ? "Field"
                              : mention.type === "job"
                                ? "Job"
                                : mention.type === "worker"
                                  ? "Crew"
                                  : "Sub"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-100">{mention.label}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{mention.detail}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-500">@{mention.token}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <p className="-mt-1 text-[11px] text-zinc-500">
            Type <span className="font-semibold text-amber-400">@</span> to tag this job, a worker, or a subcontractor.
          </p>
          {selectedTags.some((tag) => savedText.includes(`@${tag.token}`)) && (
            <div className="flex flex-wrap gap-1.5">
              {selectedTags
                .filter((tag) => savedText.includes(`@${tag.token}`))
                .map((tag) => (
                  <span
                    key={`${tag.type}-${tag.id}`}
                    className={`rounded-full border px-2 py-1 text-[10px] font-medium ${
                      isGroupMentionType(tag.type)
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        : "border-amber-500/20 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    @{tag.token}
                  </span>
                ))}
            </div>
          )}
          {(() => {
            const groups = selectedTags.filter(
              (tag) =>
                isGroupMentionType(tag.type) &&
                savedText.includes(`@${tag.token}`),
            );
            if (groups.length === 0) return null;
            const audience = groups.some((tag) => tag.type === "everyone")
              ? "EVERYONE on the team"
              : groups
                  .map((tag) => `the ${tag.token.toLowerCase()} team`)
                  .join(" and ");
            return (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-rose-200">
                <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-xs font-semibold leading-snug">
                  This will notify {audience} — in-app, push, and email. Use it
                  only when the whole group needs to see it.
                </p>
              </div>
            );
          })()}
          {autoTagCount > 0 && (
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Sparkles className="h-3.5 w-3.5" />
              AI tagged {autoTagCount} teammate{autoTagCount === 1 ? "" : "s"}.
              Review before posting.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {isSupported ? (
              <button
                type="button"
                onClick={onMicClick}
                disabled={polishing || posting || isFinalizing}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition active:scale-[0.98] ${
                  isListening
                    ? "bg-red-500/15 text-red-400 border border-red-500/40"
                    : polishing
                      ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                      : "bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
                }`}
              >
                {polishing || isFinalizing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isListening ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                <span>
                  {polishing
                    ? "Polishing…"
                    : isFinalizing
                      ? "Finishing…"
                      : isListening
                        ? "Stop"
                        : "Voice note"}
                </span>
              </button>
            ) : (
              <span className="text-xs text-zinc-500 self-center">Voice not supported</span>
            )}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isListening || polishing || posting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold bg-amber-500 text-zinc-950 border border-amber-400 hover:bg-amber-400 disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              <span>Take photo</span>
              {photoFiles.length > 0 && (
                <span className="text-xs text-zinc-800">{photoFiles.length}/{MAX_PHOTOS}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              disabled={isListening || polishing || posting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-50"
            >
              <Images className="h-4 w-4" />
              <span>Library</span>
            </button>
            {savedText && !isListening && !polishing && (
              <button
                type="button"
                onClick={() => setSavedText("")}
                className="ml-auto text-xs text-zinc-400 hover:text-zinc-200"
              >
                Clear
              </button>
            )}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhotos}
              className="hidden"
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickPhotos}
              className="hidden"
            />
          </div>

          {photoPreviews.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photoPreviews.map((url, i) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-md border border-zinc-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {(error ?? micError) && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error ?? micError}</p>
          )}
        </BottomSheetBody>
        <BottomSheetFooter>
          <Button variant="ghost" onClick={close} disabled={posting}>
            {successMessage ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={post}
            disabled={posting || isListening || polishing || reportLoading || reportLoadError || (!savedText.trim() && (!!activeReport || photoFiles.length === 0))}
          >
            {posting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {posting ? "Posting…" : activeReport ? "Submit daily log" : photoFiles.length > 0 ? `Post ${photoFiles.length} photo${photoFiles.length > 1 ? "s" : ""}` : "Post"}
          </Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  );
}
