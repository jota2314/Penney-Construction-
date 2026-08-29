"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  Camera,
  CalendarDays,
  FolderPlus,
  HardHat,
  FileText,
  Clock,
  MessageSquare,
  Send,
  Loader2,
  AtSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageViewer } from "@/components/ui/image-viewer";
import { postProjectUpdate } from "@/lib/actions/project-updates";
import { DailyLogPost } from "@/components/field-feed/daily-log-post";
import { useSignedLogPhotos } from "@/components/field-feed/use-signed-log-photos";
import { PCC_TOKENS } from "@/components/field-feed/tokens";
import type { FeedDailyLog } from "@/lib/actions/daily-logs";

export interface ActivityItem {
  id: string;
  type:
    | "project_created"
    | "estimate"
    | "site_visit"
    | "schedule_phase"
    | "subcontractor"
    | "status_change"
    | "daily_log"
    | "project_update";
  title: string;
  description?: string | null;
  timestamp: string;
  userName?: string | null;
  phaseName?: string | null;
  photoUrls?: string[];
  mentionedNames?: string[];
}

export interface ActivityTeamMember {
  id: string;
  full_name: string | null;
  email: string;
}

const ICON_MAP: Record<ActivityItem["type"], React.ReactNode> = {
  project_created: <FolderPlus className="h-4 w-4" />,
  estimate: <Calculator className="h-4 w-4" />,
  site_visit: <Camera className="h-4 w-4" />,
  schedule_phase: <CalendarDays className="h-4 w-4" />,
  subcontractor: <HardHat className="h-4 w-4" />,
  status_change: <FileText className="h-4 w-4" />,
  daily_log: <HardHat className="h-4 w-4" />,
  project_update: <MessageSquare className="h-4 w-4" />,
};

const COLOR_MAP: Record<ActivityItem["type"], string> = {
  project_created: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  estimate: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  site_visit: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  schedule_phase: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  subcontractor: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  status_change: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
  daily_log: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  project_update: "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400",
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ProjectActivityFeed({
  items,
  projectId,
  teamMembers,
  dailyLogs = [],
}: {
  items: ActivityItem[];
  projectId: string;
  teamMembers: ActivityTeamMember[];
  /** Full log rows — a matched item renders as a command-center photo card. */
  dailyLogs?: FeedDailyLog[];
}) {
  const [preview, setPreview] = useState<{ url: string; urls: string[] } | null>(null);
  // The feed is capped at ~20 items but is handed every log on the job, so
  // narrow to the ones actually on screen before signing their photos —
  // otherwise Overview signs the Production tab's photos too.
  const visibleLogs = useMemo(() => {
    const shown = new Set(items.map((i) => i.id));
    return dailyLogs.filter((log) => shown.has(`daily-log-${log.id}`));
  }, [items, dailyLogs]);
  // Photos arrive unsigned from the project page and fill in right after mount.
  const logs = useSignedLogPhotos(visibleLogs);
  // Activity ids for logs are minted as `daily-log-${log.id}` upstream.
  const logById = new Map(logs.map((log) => [`daily-log-${log.id}`, log]));

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card">
      <div className="border-b bg-muted/20 px-4 py-3">
        <h3 className="text-sm font-semibold">Project Activity</h3>
        <p className="text-xs text-muted-foreground">
          Daily logs, project changes, and team updates
        </p>
      </div>
      <ProjectUpdateComposer projectId={projectId} teamMembers={teamMembers} />

      {items.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Clock className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No activity yet</p>
        </div>
      ) : (
        <div className="divide-y">
          {items.map((item) => {
            // Photo posts get the full command-center card — avatar header,
            // swipeable carousel, reactions, comments. Everything else stays a
            // one-line row so the feed is still scannable.
            const log = logById.get(item.id);
            if (log) {
              return (
                <div key={item.id} className="p-3" style={PCC_TOKENS}>
                  <DailyLogPost log={log} />
                </div>
              );
            }
            return (
            <article key={item.id} className="flex min-w-0 gap-3 px-4 py-3.5">
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${COLOR_MAP[item.type]}`}
              >
                {ICON_MAP[item.type]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="min-w-0 break-words text-sm font-medium leading-snug">{item.title}</p>
                    {item.phaseName && (
                      <p className="mt-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        {item.phaseName}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                    {timeAgo(item.timestamp)}
                  </span>
                </div>
                {item.description && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                )}
                {item.photoUrls && item.photoUrls.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {item.photoUrls.slice(0, 4).map((url, index) => (
                      <button
                        key={`${item.id}-photo-${index}`}
                        type="button"
                        onClick={() => setPreview({ url, urls: item.photoUrls! })}
                        className="relative shrink-0"
                        aria-label={`Open photo ${index + 1} of ${item.photoUrls!.length}`}
                      >
                        <Image
                          src={url}
                          alt={`Daily log photo ${index + 1}`}
                          width={96}
                          height={72}
                          unoptimized
                          className="h-18 w-24 rounded-lg border object-cover"
                        />
                        {index === 3 && item.photoUrls!.length > 4 && (
                          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55 text-sm font-semibold text-white">
                            +{item.photoUrls!.length - 4}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {item.mentionedNames && item.mentionedNames.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.mentionedNames.map((name) => (
                      <span
                        key={`${item.id}-${name}`}
                        className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400"
                      >
                        @{name}
                      </span>
                    ))}
                  </div>
                )}
                {item.userName && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    by {item.userName}
                  </p>
                )}
              </div>
            </article>
            );
          })}
        </div>
      )}

      <ImageViewer
        url={preview?.url ?? null}
        urls={preview?.urls}
        filename="Daily log photo"
        onClose={() => setPreview(null)}
      />
    </section>
  );
}

function ProjectUpdateComposer({
  projectId,
  teamMembers,
}: {
  projectId: string;
  teamMembers: ActivityTeamMember[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberName = (member: ActivityTeamMember) =>
    member.full_name?.trim() || member.email.split("@")[0];

  const mentionMatches = mentionQuery === null
    ? []
    : teamMembers
        .filter((member) =>
          memberName(member).toLowerCase().includes(mentionQuery.toLowerCase()),
        )
        .slice(0, 6);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    setBody(value);
    setMentionQuery(/@([\w-]*)$/.exec(value.slice(0, cursor))?.[1] ?? null);
  };

  const insertMention = (member: ActivityTeamMember) => {
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? body.length;
    const before = body.slice(0, cursor).replace(
      /@[\w-]*$/,
      `@${memberName(member).split(/\s+/)[0]} `,
    );
    const nextBody = before + body.slice(cursor);
    setBody(nextBody);
    setMentionedIds((current) =>
      current.includes(member.id) ? current : [...current, member.id],
    );
    setMentionQuery(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    const activeMentionIds = mentionedIds.filter((id) => {
      const member = teamMembers.find((candidate) => candidate.id === id);
      if (!member) return false;
      const firstName = memberName(member).split(/\s+/)[0];
      return body.includes(`@${firstName}`);
    });
    const result = await postProjectUpdate(projectId, body, activeMentionIds);

    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setBody("");
    setMentionedIds([]);
    setMentionQuery(null);
    setSubmitting(false);
    router.refresh();
  };

  return (
    <div className="border-b px-4 py-3">
      <div className="relative">
        <textarea
          ref={inputRef}
          value={body}
          onChange={handleChange}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Share an update… Type @ to tag someone"
          maxLength={2000}
          rows={2}
          className="min-h-20 w-full resize-none rounded-xl border bg-background px-3 py-2.5 pr-12 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
        />
        <AtSign className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />

        {mentionQuery !== null && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border bg-popover shadow-xl">
            {mentionMatches.length > 0 ? (
              mentionMatches.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMention(member)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-500">
                    {memberName(member).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {memberName(member)}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {member.email}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">
                No team member found
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Tagged teammates receive a notification
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={!body.trim() || submitting}
          className="gap-1.5"
        >
          {submitting
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Send className="h-3.5 w-3.5" />}
          Post
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
