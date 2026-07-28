"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Flag,
  Megaphone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IssuesList } from "@/components/eos/issues-list";
import { TodosList } from "@/components/eos/todos-list";
import { L10Recorder } from "@/components/eos/l10-recorder";
import type { EosSectionTranscript } from "@/lib/eos/queries";
import {
  L10_SECTIONS,
  ROCK_STATUS_CLASSES,
  ROCK_STATUS_LABELS,
  formatMeasurable,
  formatWeekLabel,
  isOnGoal,
  l10Section,
} from "@/lib/constants/eos";
import {
  concludeMeeting,
  rateMeeting,
  saveSegue,
  setAttendance,
  setMeetingSection,
} from "@/lib/actions/eos-meetings";
import { setRockStatus } from "@/lib/actions/eos-rocks";
import { createHeadline, createIssue, deleteHeadline } from "@/lib/actions/eos-issues";
import type {
  EosAttendee,
  EosHeadline,
  EosIssue,
  EosMeasurable,
  EosMeeting,
  EosPerson,
  EosRock,
  EosRockStatus,
  EosTodo,
} from "@/types/eos";
import { cn } from "@/lib/utils";

export function MeetingRunner({
  meeting,
  attendees,
  rocks,
  measurables,
  issues,
  todos,
  headlines,
  people,
  viewerId,
  thisWeek,
  transcripts,
}: {
  meeting: EosMeeting;
  attendees: EosAttendee[];
  rocks: EosRock[];
  measurables: EosMeasurable[];
  issues: EosIssue[];
  todos: EosTodo[];
  headlines: EosHeadline[];
  people: EosPerson[];
  viewerId: string;
  thisWeek: string;
  transcripts: Record<string, EosSectionTranscript>;
}) {
  const completed = meeting.status === "completed";
  const activeKey = meeting.currentSection ?? L10_SECTIONS[0].key;
  const activeIndex = Math.max(
    0,
    L10_SECTIONS.findIndex((s) => s.key === activeKey),
  );
  const section = L10_SECTIONS[activeIndex];
  const [pending, startTransition] = useTransition();

  function goTo(key: string) {
    if (completed) return;
    startTransition(async () => {
      await setMeetingSection(meeting.id, key);
    });
  }

  return (
    <>
      {completed && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This meeting is closed. Rating {meeting.avgRating ?? "—"}/10.
        </div>
      )}

      {/* ── Agenda stepper ─────────────────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {L10_SECTIONS.map((s, index) => {
          const isActive = !completed && index === activeIndex;
          const isPast = !completed && index < activeIndex;
          return (
            <button
              key={s.key}
              onClick={() => goTo(s.key)}
              disabled={completed || pending}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-amber-500 bg-amber-500/15 text-amber-500"
                  : isPast
                    ? "border-border text-muted-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                completed && "opacity-60",
              )}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
              <span className="tabular-nums opacity-60">{s.minutes}m</span>
            </button>
          );
        })}
      </div>

      {/* ── Current section ────────────────────────────────────── */}
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <section.icon className="h-4 w-4" />
              {section.label}
            </CardTitle>
            {!completed && (
              <SectionTimer
                startedAt={meeting.sectionStartedAt}
                budgetMinutes={section.minutes}
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground">{section.prompt}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Talk, and the AI files it. Available on every section — the
              hand-entry controls below stay for corrections. */}
          {!completed && (
            <L10Recorder
              key={section.key}
              meetingId={meeting.id}
              sectionKey={section.key}
              sectionLabel={section.label}
              savedTranscript={transcripts[section.key]?.transcript ?? ""}
              savedProposals={transcripts[section.key]?.proposals ?? null}
            />
          )}

          {section.key === "segue" && (
            <SeguePanel
              meetingId={meeting.id}
              attendees={attendees}
              viewerId={viewerId}
              readOnly={completed}
            />
          )}

          {section.key === "scorecard" && (
            <ScorecardPanel
              measurables={measurables}
              thisWeek={thisWeek}
              meetingId={meeting.id}
              readOnly={completed}
            />
          )}

          {section.key === "rocks" && (
            <RockPanel rocks={rocks} meetingId={meeting.id} readOnly={completed} />
          )}

          {section.key === "headlines" && (
            <HeadlinesPanel
              headlines={headlines}
              meetingId={meeting.id}
              readOnly={completed}
            />
          )}

          {section.key === "todos" && (
            <TodosList
              todos={todos}
              people={people}
              meetingId={meeting.id}
              compact
            />
          )}

          {section.key === "ids" && (
            <IssuesList
              issues={issues}
              people={people}
              meetingId={meeting.id}
              compact
            />
          )}

          {section.key === "conclude" && (
            <ConcludePanel
              meeting={meeting}
              attendees={attendees}
              todos={todos}
              viewerId={viewerId}
              readOnly={completed}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Prev / next ────────────────────────────────────────── */}
      {!completed && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            disabled={activeIndex === 0 || pending}
            onClick={() => goTo(L10_SECTIONS[activeIndex - 1].key)}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            {activeIndex > 0 ? L10_SECTIONS[activeIndex - 1].label : "Back"}
          </Button>
          <Button
            disabled={activeIndex === L10_SECTIONS.length - 1 || pending}
            onClick={() => goTo(L10_SECTIONS[activeIndex + 1].key)}
            className="gap-2"
          >
            {activeIndex < L10_SECTIONS.length - 1
              ? L10_SECTIONS[activeIndex + 1].label
              : "Done"}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {completed && meeting.sectionLog.length > 0 && (
        <TimeSpent meeting={meeting} />
      )}
    </>
  );
}

/** Counts up from when the section was opened, against its EOS time box. */
function SectionTimer({
  startedAt,
  budgetMinutes,
}: {
  startedAt: string | null;
  budgetMinutes: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!startedAt) return null;

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 1000),
  );
  const over = elapsedSeconds > budgetMinutes * 60;
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = elapsedSeconds % 60;

  return (
    <span
      className={cn(
        "rounded-md border px-2 py-1 text-sm font-semibold tabular-nums",
        over
          ? "border-red-500/40 bg-red-500/10 text-red-500"
          : "border-border text-muted-foreground",
      )}
    >
      {mm}:{String(ss).padStart(2, "0")}
      <span className="ml-1 text-xs font-normal opacity-70">
        / {budgetMinutes}m
      </span>
    </span>
  );
}

function SeguePanel({
  meetingId,
  attendees,
  viewerId,
  readOnly,
}: {
  meetingId: string;
  attendees: EosAttendee[];
  viewerId: string;
  readOnly: boolean;
}) {
  const me = attendees.find((a) => a.profileId === viewerId);
  const [personal, setPersonal] = useState(me?.personalBest ?? "");
  const [business, setBusiness] = useState(me?.businessBest ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="segue-personal">Your personal best</Label>
            <Input
              id="segue-personal"
              value={personal}
              onChange={(e) => setPersonal(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="segue-business">Your business best</Label>
            <Input
              id="segue-business"
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await saveSegue({
                    meetingId,
                    personalBest: personal,
                    businessBest: business,
                  });
                })
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Around the room
        </p>
        {attendees.map((a) => (
          <div
            key={a.profileId}
            className="flex items-start gap-3 border-b py-2 last:border-0"
          >
            {!readOnly && (
              <Checkbox
                id={`present-${a.profileId}`}
                className="mt-0.5"
                checked={a.isPresent}
                onCheckedChange={(checked) =>
                  startTransition(async () => {
                    await setAttendance(meetingId, a.profileId, checked === true);
                  })
                }
              />
            )}
            <div className="min-w-0 flex-1">
              <label
                htmlFor={`present-${a.profileId}`}
                className={cn(
                  "text-sm font-medium",
                  !a.isPresent && "text-muted-foreground line-through",
                )}
              >
                {a.name}
                {a.seatLabel && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {a.seatLabel}
                  </span>
                )}
              </label>
              {(a.personalBest || a.businessBest) && (
                <p className="text-xs text-muted-foreground">
                  {[a.personalBest, a.businessBest].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScorecardPanel({
  measurables,
  thisWeek,
  meetingId,
  readOnly,
}: {
  measurables: EosMeasurable[];
  thisWeek: string;
  meetingId: string;
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  if (measurables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No measurables on the scorecard yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Week ending {formatWeekLabel(thisWeek)}
      </p>
      {measurables.map((m) => {
        const value = m.scores[thisWeek] ?? null;
        const hit = isOnGoal(value, m.goalTarget, m.comparison);
        const alreadyDropped = dropped.has(m.id);

        return (
          <div
            key={m.id}
            className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0"
          >
            {hit === null ? (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            ) : hit ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{m.name}</p>
              <p className="text-xs text-muted-foreground">
                {m.ownerName ?? "Unassigned"}
              </p>
            </div>

            <span
              className={cn(
                "shrink-0 text-sm font-medium tabular-nums",
                hit === false && "text-red-500",
                hit === true && "text-emerald-500",
              )}
            >
              {formatMeasurable(value, m.unit)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {m.goalTarget === null
                ? "goal TBD"
                : `${m.comparison} ${formatMeasurable(m.goalTarget, m.unit)}`}
            </span>

            {hit === false && !readOnly && (
              <Button
                size="sm"
                variant={alreadyDropped ? "ghost" : "secondary"}
                disabled={pending || alreadyDropped}
                className="h-7 shrink-0 text-xs"
                onClick={() =>
                  startTransition(async () => {
                    const result = await createIssue({
                      title: `${m.name} off goal (${formatMeasurable(value, m.unit)} vs ${m.comparison} ${formatMeasurable(m.goalTarget, m.unit)})`,
                      ownerProfileId: m.ownerId,
                      source: "scorecard",
                      sourceRef: m.id,
                      meetingId,
                      term: "short_term",
                    });
                    if (result.ok) {
                      setDropped((prev) => new Set(prev).add(m.id));
                    }
                  })
                }
              >
                {alreadyDropped ? "On the list" : "Drop to issues"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RockPanel({
  rocks,
  meetingId,
  readOnly,
}: {
  rocks: EosRock[];
  meetingId: string;
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  if (rocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Rocks for this quarter yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {rocks.map((rock) => {
        const alreadyDropped = dropped.has(rock.id);
        return (
          <div
            key={rock.id}
            className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{rock.title}</p>
              <p className="text-xs text-muted-foreground">
                {rock.ownerName ?? "Unassigned"}
                {rock.dueDate ? ` · due ${rock.dueDate}` : ""}
              </p>
            </div>

            {readOnly ? (
              <Badge
                variant="outline"
                className={cn("text-[10px]", ROCK_STATUS_CLASSES[rock.status])}
              >
                {ROCK_STATUS_LABELS[rock.status]}
              </Badge>
            ) : (
              <div className="flex shrink-0 gap-1">
                {(["on_track", "off_track", "complete"] as EosRockStatus[]).map(
                  (status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={rock.status === status ? "default" : "secondary"}
                      disabled={pending}
                      className="h-7 text-xs"
                      onClick={() =>
                        startTransition(async () => {
                          await setRockStatus(rock.id, status);
                        })
                      }
                    >
                      {ROCK_STATUS_LABELS[status]}
                    </Button>
                  ),
                )}
              </div>
            )}

            {rock.status === "off_track" && !readOnly && (
              <Button
                size="sm"
                variant={alreadyDropped ? "ghost" : "secondary"}
                disabled={pending || alreadyDropped}
                className="h-7 shrink-0 text-xs"
                onClick={() =>
                  startTransition(async () => {
                    const result = await createIssue({
                      title: `Rock off track: ${rock.title}`,
                      ownerProfileId: rock.ownerId,
                      source: "rock",
                      sourceRef: rock.id,
                      meetingId,
                      term: "short_term",
                    });
                    if (result.ok) {
                      setDropped((prev) => new Set(prev).add(rock.id));
                    }
                  })
                }
              >
                {alreadyDropped ? "On the list" : "Drop to issues"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HeadlinesPanel({
  headlines,
  meetingId,
  readOnly,
}: {
  headlines: EosHeadline[];
  meetingId: string;
  readOnly: boolean;
}) {
  const [kind, setKind] = useState<"customer" | "employee">("customer");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const customer = headlines.filter((h) => h.kind === "customer");
  const employee = headlines.filter((h) => h.kind === "employee");

  return (
    <div className="space-y-4">
      {!readOnly && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = body.trim();
            if (!text) return;
            setBody("");
            startTransition(async () => {
              await createHeadline({ kind, body: text, meetingId });
            });
          }}
        >
          <div className="flex gap-1">
            {(["customer", "employee"] as const).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={kind === k ? "default" : "secondary"}
                onClick={() => setKind(k)}
                className="capitalize"
              >
                {k}
              </Button>
            ))}
          </div>
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="One line — good news or bad"
            className="min-w-[200px] flex-1"
          />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </form>
      )}

      {headlines.length === 0 && (
        <p className="text-sm text-muted-foreground">No headlines this week.</p>
      )}

      {[
        { label: "Customer", items: customer },
        { label: "Employee", items: employee },
      ].map(
        (group) =>
          group.items.length > 0 && (
            <div key={group.label} className="space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Megaphone className="h-3.5 w-3.5" />
                {group.label}
              </p>
              {group.items.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-2 border-b py-1.5 last:border-0"
                >
                  <p className="flex-1 text-sm">{h.body}</p>
                  {!readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-red-500 hover:text-red-500"
                      onClick={() =>
                        startTransition(async () => {
                          await deleteHeadline(h.id);
                        })
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                      <span className="sr-only">Delete headline</span>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ),
      )}
    </div>
  );
}

function ConcludePanel({
  meeting,
  attendees,
  todos,
  viewerId,
  readOnly,
}: {
  meeting: EosMeeting;
  attendees: EosAttendee[];
  todos: EosTodo[];
  viewerId: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const me = attendees.find((a) => a.profileId === viewerId);
  const [message, setMessage] = useState(meeting.cascadingMessage ?? "");
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const newTodos = todos.filter(
    (t) => t.meetingId === meeting.id && t.status === "open",
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          To-dos from this meeting ({newTodos.length})
        </p>
        {newTodos.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            None yet — a solved issue should leave a to-do behind.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {newTodos.map((t) => (
              <li key={t.id} className="text-sm">
                {t.title}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t.ownerName ?? "Unassigned"}
                  {t.dueDate ? ` · due ${t.dueDate}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cascade">Cascading message</Label>
        <Textarea
          id="cascade"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          disabled={readOnly}
          placeholder="What needs to be communicated to the rest of the company?"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="meeting-notes">Notes</Label>
        <Textarea
          id="meeting-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2">
        <Label>Rate the meeting</Label>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              size="icon"
              variant={me?.rating === n ? "default" : "secondary"}
              disabled={readOnly || pending}
              className="h-8 w-8 text-xs"
              onClick={() =>
                startTransition(async () => {
                  await rateMeeting(meeting.id, n);
                })
              }
            >
              {n}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Average so far:{" "}
          <span className="font-semibold tabular-nums">
            {meeting.avgRating ?? "—"}
          </span>
          /10 · anything under 8 means say why.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!readOnly && (
        <Button
          className="gap-2"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await concludeMeeting({
                meetingId: meeting.id,
                cascadingMessage: message,
                notes,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.push("/eos/meetings");
            });
          }}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Flag className="h-4 w-4" />
          )}
          End meeting
        </Button>
      )}
    </div>
  );
}

/** Where the 90 minutes actually went, once the meeting is closed. */
function TimeSpent({ meeting }: { meeting: EosMeeting }) {
  const spent = new Map<string, number>();
  for (const entry of meeting.sectionLog) {
    if (!entry.ended_at) continue;
    const ms =
      new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime();
    spent.set(entry.key, (spent.get(entry.key) ?? 0) + Math.max(0, ms));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Time spent</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {L10_SECTIONS.map((s) => {
          const minutes = Math.round((spent.get(s.key) ?? 0) / 60000);
          const over = minutes > s.minutes;
          return (
            <div
              key={s.key}
              className="flex items-center justify-between border-b py-1.5 text-sm last:border-0"
            >
              <span>{l10Section(s.key)?.label ?? s.key}</span>
              <span
                className={cn("tabular-nums", over && "font-medium text-red-500")}
              >
                {minutes}m
                <span className="ml-1 text-xs text-muted-foreground">
                  / {s.minutes}m
                </span>
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
