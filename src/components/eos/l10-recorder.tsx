"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  Square,
  Loader2,
  Sparkles,
  Check,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { applyMeetingAllocation, saveTranscript } from "@/lib/actions/eos-transcribe";
import {
  EMPTY_ALLOCATION,
  allocationCount,
  isAllocationEmpty,
  type MeetingAllocation,
} from "@/lib/eos/allocation";
import { formatMeasurable } from "@/lib/constants/eos";
import { cn } from "@/lib/utils";

/** Every proposal is keyed so a checkbox can turn it off before applying. */
type Key = string;

const ROCK_STATUS_WORD = {
  on_track: "on track",
  off_track: "off track",
  complete: "complete",
} as const;

export function L10Recorder({
  meetingId,
  sectionKey,
  sectionLabel,
  savedTranscript,
  savedProposals,
}: {
  meetingId: string;
  sectionKey: string;
  sectionLabel: string;
  savedTranscript: string;
  savedProposals: MeetingAllocation | null;
}) {
  const router = useRouter();
  const speech = useSpeechRecognition();

  // Text banked from previous takes in this section, plus whatever the mic is
  // hearing right now. startListening() resets the hook's transcript, so takes
  // are banked on stop rather than accumulated in the hook.
  const [banked, setBanked] = useState(savedTranscript);
  const [allocation, setAllocation] = useState<MeetingAllocation | null>(savedProposals);
  const [off, setOff] = useState<Set<Key>>(new Set());
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const live = speech.isListening || speech.isFinalizing;
  const full = [banked, speech.transcript].filter(Boolean).join(" ").trim();

  // Bank + auto-fill once the recognizer is genuinely done (isListening stays
  // true through Android's wind-down, so the text here is complete).
  const wasLive = useRef(false);
  useEffect(() => {
    if (wasLive.current && !live) {
      const text = [banked, speech.transcript].filter(Boolean).join(" ").trim();
      setBanked(text);
      if (text) void fill(text);
    }
    wasLive.current = live;
    // fill/banked intentionally excluded — this fires on the live→idle edge only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  async function fill(text: string) {
    setThinking(true);
    setError(null);
    setApplied(null);
    try {
      const res = await fetch("/api/eos/allocate-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, sectionKey, transcript: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not read that back.");
        return;
      }
      setAllocation(json.allocation as MeetingAllocation);
      setOff(new Set());
    } catch {
      setError("Network hiccup — tap Fill it in to retry.");
    } finally {
      setThinking(false);
    }
  }

  const a = allocation ?? EMPTY_ALLOCATION;
  const on = (key: Key) => !off.has(key);
  const toggle = (key: Key) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const keptCount =
    allocationCount(a) - Array.from(off).filter((k) => k !== "__none").length;

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await applyMeetingAllocation({
        meetingId,
        sectionKey,
        segues: a.segues
          .filter((s, i) => s.profileId && on(`segue:${i}`))
          .map((s) => ({
            profileId: s.profileId!,
            personalBest: s.personalBest,
            businessBest: s.businessBest,
          })),
        scores: a.scores
          .filter((_, i) => on(`score:${i}`))
          .map((s) => ({ measurableId: s.measurableId, value: s.value })),
        rockStatuses: a.rockStatuses
          .filter((_, i) => on(`rock:${i}`))
          .map((r) => ({ rockId: r.rockId, status: r.status })),
        headlines: a.headlines
          .filter((_, i) => on(`headline:${i}`))
          .map((h) => ({ kind: h.kind, body: h.body })),
        todoStatuses: a.todoStatuses
          .filter((_, i) => on(`todoStatus:${i}`))
          .map((t) => ({ todoId: t.todoId, status: t.status })),
        newTodos: a.newTodos
          .filter((_, i) => on(`newTodo:${i}`))
          .map((t) => ({
            title: t.title,
            ownerProfileId: t.ownerProfileId,
            dueDate: t.dueDate,
          })),
        newIssues: a.newIssues
          .filter((_, i) => on(`newIssue:${i}`))
          .map((i) => ({
            title: i.title,
            description: i.description,
            ownerProfileId: i.ownerProfileId,
            term: i.term,
          })),
        solvedIssues: a.solvedIssues
          .filter((_, i) => on(`solved:${i}`))
          .map((s) => ({ issueId: s.issueId, solution: s.solution })),
        ratings: a.ratings
          .filter((r, i) => r.profileId && on(`rating:${i}`))
          .map((r) => ({ profileId: r.profileId!, rating: r.rating })),
        cascadingMessage: on("cascade") ? a.cascadingMessage : null,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApplied(
        result.data.labels.length
          ? `Filed ${result.data.labels.join(", ")}.`
          : "Nothing to file.",
      );
      setAllocation(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
      {/* ── Mic row ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {speech.isSupported ? (
          <Button
            onClick={() => (live ? speech.stopListening() : speech.startListening())}
            disabled={thinking || pending}
            className={cn("gap-2", live && "bg-red-600 hover:bg-red-700")}
          >
            {speech.isFinalizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : live ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {speech.isFinalizing
              ? "Finishing…"
              : live
                ? "Stop and fill in"
                : banked
                  ? "Record more"
                  : `Record ${sectionLabel}`}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            This browser can&apos;t do voice typing — use Chrome or Safari, or type below.
          </p>
        )}

        {live && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-red-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            Listening
          </span>
        )}

        {thinking && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Working out who said what…
          </span>
        )}

        {full && !live && !thinking && (
          <Button variant="secondary" size="sm" onClick={() => fill(full)} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Fill it in
          </Button>
        )}
      </div>

      {speech.error && <p className="text-sm text-red-500">{speech.error}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {applied && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-500">
          <Check className="h-4 w-4" />
          {applied}
        </p>
      )}

      {/* ── Live / banked transcript ────────────────────────────
          Always reachable, not just after a recording: the mic is
          unavailable in some browsers, and someone may want to paste
          notes or fix a mis-heard name before filling in. */}
      <div>
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showTranscript ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {full
              ? `Transcript (${full.split(/\s+/).filter(Boolean).length} words)`
              : "Type or paste what was said instead"}
          </button>
          {showTranscript && (
            <Textarea
              value={full}
              onChange={(e) => {
                setBanked(e.target.value);
              }}
              onBlur={() => void saveTranscript(meetingId, sectionKey, full)}
              rows={5}
              className="mt-1.5 text-sm"
              placeholder="Or type/paste what was said…"
            />
          )}
        </div>

      {/* ── Proposals ───────────────────────────────────────── */}
      {allocation && !isAllocationEmpty(a) && (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          {a.summary && <p className="text-xs italic text-muted-foreground">{a.summary}</p>}

          <Group label="Segue">
            {a.segues.map((s, i) => (
              <Row
                key={i}
                checked={on(`segue:${i}`)}
                onToggle={() => toggle(`segue:${i}`)}
                disabled={!s.profileId}
                title={s.profileId ? s.spokenName : `${s.spokenName} — name not matched`}
                detail={[
                  s.personalBest && `Personal: ${s.personalBest}`,
                  s.businessBest && `Business: ${s.businessBest}`,
                ]
                  .filter(Boolean)
                  .join("  ·  ")}
              />
            ))}
          </Group>

          <Group label="Numbers">
            {a.scores.map((s, i) => (
              <Row
                key={i}
                checked={on(`score:${i}`)}
                onToggle={() => toggle(`score:${i}`)}
                title={s.measurableName}
                detail={formatMeasurable(s.value, "number")}
              />
            ))}
          </Group>

          <Group label="Rocks">
            {a.rockStatuses.map((r, i) => (
              <Row
                key={i}
                checked={on(`rock:${i}`)}
                onToggle={() => toggle(`rock:${i}`)}
                title={r.rockTitle}
                detail={ROCK_STATUS_WORD[r.status]}
                tone={r.status === "off_track" ? "bad" : "good"}
              />
            ))}
          </Group>

          <Group label="Headlines">
            {a.headlines.map((h, i) => (
              <Row
                key={i}
                checked={on(`headline:${i}`)}
                onToggle={() => toggle(`headline:${i}`)}
                title={h.body}
                detail={h.kind}
              />
            ))}
          </Group>

          <Group label="To-dos called">
            {a.todoStatuses.map((t, i) => (
              <Row
                key={i}
                checked={on(`todoStatus:${i}`)}
                onToggle={() => toggle(`todoStatus:${i}`)}
                title={t.title}
                detail={t.status === "done" ? "done" : "still open"}
                tone={t.status === "done" ? "good" : undefined}
              />
            ))}
          </Group>

          <Group label="New to-dos">
            {a.newTodos.map((t, i) => (
              <Row
                key={i}
                checked={on(`newTodo:${i}`)}
                onToggle={() => toggle(`newTodo:${i}`)}
                title={t.title}
                detail={[t.ownerName ?? "unassigned", t.dueDate ? `due ${t.dueDate}` : "due in 7 days"].join(" · ")}
              />
            ))}
          </Group>

          <Group label="New issues">
            {a.newIssues.map((i2, i) => (
              <Row
                key={i}
                checked={on(`newIssue:${i}`)}
                onToggle={() => toggle(`newIssue:${i}`)}
                title={i2.title}
                detail={[i2.ownerName ?? "unassigned", i2.term === "long_term" ? "long term" : null]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </Group>

          <Group label="Solved">
            {a.solvedIssues.map((s, i) => (
              <Row
                key={i}
                checked={on(`solved:${i}`)}
                onToggle={() => toggle(`solved:${i}`)}
                title={s.title}
                detail={s.solution}
                tone="good"
              />
            ))}
          </Group>

          <Group label="Ratings">
            {a.ratings.map((r, i) => (
              <Row
                key={i}
                checked={on(`rating:${i}`)}
                onToggle={() => toggle(`rating:${i}`)}
                disabled={!r.profileId}
                title={r.profileId ? r.spokenName : `${r.spokenName} — name not matched`}
                detail={`${r.rating}/10`}
              />
            ))}
          </Group>

          {a.cascadingMessage && (
            <Group label="Cascading message">
              <Row
                checked={on("cascade")}
                onToggle={() => toggle("cascade")}
                title={a.cascadingMessage}
              />
            </Group>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={apply} disabled={pending || keptCount <= 0} className="gap-2">
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              File {keptCount} {keptCount === 1 ? "item" : "items"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAllocation(null);
                setOff(new Set());
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {allocation && isAllocationEmpty(a) && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          Nothing in that recording mapped to this section. Try again, or fill it
          in by hand below.
        </p>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(items) && items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  checked,
  onToggle,
  title,
  detail,
  disabled,
  tone,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  detail?: string;
  disabled?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Checkbox
        checked={checked && !disabled}
        disabled={disabled}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="text-sm">{title}</span>
        {detail && (
          <span
            className={cn(
              "ml-2 text-xs",
              tone === "good"
                ? "text-emerald-500"
                : tone === "bad"
                  ? "text-red-500"
                  : "text-muted-foreground",
            )}
          >
            {detail}
          </span>
        )}
      </span>
      {disabled && (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          pick owner by hand
        </Badge>
      )}
    </label>
  );
}
