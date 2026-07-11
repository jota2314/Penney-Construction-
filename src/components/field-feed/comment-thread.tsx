"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Building2, HardHat, Send, Users } from "lucide-react";
import {
  addFeedComment,
  type FeedComment,
  type FeedCommentSource,
} from "@/lib/actions/feed-comments";
import {
  listActivityMentions,
  type ActivityMention,
} from "@/lib/actions/activity-mentions";
import { v } from "./tokens";

function initials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function relativeTime(value: string): string {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Render @Tokens inside a comment body as highlighted mentions. */
function renderBody(body: string): ReactNode[] {
  return body.split(/(@[A-Za-z0-9]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="font-semibold" style={{ color: v("accent") }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function mentionMatchScore(mention: ActivityMention, query: string): number {
  if (!query) {
    if (mention.type === "worker") return 0;
    if (mention.type === "job") return 1;
    return 2;
  }
  const normalizedQuery = query.toLowerCase();
  const label = mention.label.toLowerCase();
  const token = mention.token.toLowerCase();
  const words = label.split(/[^a-z0-9]+/).filter(Boolean);

  if (label === normalizedQuery || token === normalizedQuery) return 0;
  if (label.startsWith(normalizedQuery)) return 1;
  if (words.some((word) => word.startsWith(normalizedQuery))) return 2;
  if (token.startsWith(normalizedQuery)) return 3;
  if (label.includes(normalizedQuery) || token.includes(normalizedQuery)) return 4;
  if (mention.detail.toLowerCase().includes(normalizedQuery)) return 5;
  return Number.POSITIVE_INFINITY;
}

function MentionTypeIcon({ type }: { type: ActivityMention["type"] }) {
  if (type === "job") return <HardHat className="h-3.5 w-3.5" />;
  if (type === "worker") return <Users className="h-3.5 w-3.5" />;
  return <Building2 className="h-3.5 w-3.5" />;
}

const COLLAPSED_COUNT = 2;

/**
 * Inline comment thread for feed posts (company posts + daily logs).
 * Shows the latest comments collapsed, expands on demand, posts new comments
 * optimistically, and supports @tagging teammates (workers get notified).
 */
export function CommentThread({
  sourceType,
  sourceId,
  initialComments,
}: {
  sourceType: FeedCommentSource;
  sourceId: string;
  initialComments: FeedComment[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [comments, setComments] = useState<FeedComment[]>(initialComments);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [mentions, setMentions] = useState<ActivityMention[] | null>(null);
  const mentionsLoading = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<ActivityMention[]>([]);

  const visible = expanded ? comments : comments.slice(-COLLAPSED_COUNT);
  const hiddenCount = comments.length - visible.length;

  const ensureMentionsLoaded = () => {
    if (mentions !== null || mentionsLoading.current) return;
    mentionsLoading.current = true;
    listActivityMentions()
      .then((rows) => setMentions(rows))
      .catch(() => setMentions([]));
  };

  const handleDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    setDraft(value);
    const query =
      /@([A-Za-z0-9]*)$/.exec(value.slice(0, cursor))?.[1].toLowerCase() ?? null;
    setMentionQuery(query);
    if (query !== null) ensureMentionsLoaded();
  };

  const mentionMatches =
    mentionQuery === null
      ? []
      : (mentions ?? [])
          .map((mention) => ({ mention, score: mentionMatchScore(mention, mentionQuery) }))
          .filter((result) => Number.isFinite(result.score))
          .sort((left, right) =>
            left.score !== right.score
              ? left.score - right.score
              : left.mention.label.localeCompare(right.mention.label),
          )
          .slice(0, 6)
          .map((result) => result.mention)
          .slice(0, 6);

  const insertMention = (mention: ActivityMention) => {
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? draft.length;
    const before = draft
      .slice(0, cursor)
      .replace(/@[A-Za-z0-9]*$/, `@${mention.token} `);
    setDraft(before + draft.slice(cursor));
    setSelectedTags((current) =>
      current.some((tag) => tag.id === mention.id && tag.type === mention.type)
        ? current
        : [...current, mention],
    );
    setMentionQuery(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(before.length, before.length);
    });
  };

  const submit = () => {
    const body = draft.trim();
    if (!body || isPending) return;
    setError(null);
    setDraft("");
    setMentionQuery(null);
    const activeTags = selectedTags.filter((tag) => body.includes(`@${tag.token}`));
    setSelectedTags([]);
    startTransition(async () => {
      const result = await addFeedComment({
        sourceType,
        sourceId,
        body,
        tags: activeTags.map((tag) => ({
          id: tag.id,
          type: tag.type,
          label: tag.label,
          token: tag.token,
          profileId: tag.profileId,
        })),
      });
      if (result.ok) {
        setComments((current) => [...current, result.comment]);
        router.refresh();
      } else {
        setDraft(body);
        setSelectedTags(activeTags);
        setError(result.error);
      }
    });
  };

  return (
    <div className="px-3.5 pb-3" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="pt-2.5 text-[12px] font-semibold"
          style={{ color: v("muted") }}
        >
          View all {comments.length} comments
        </button>
      )}

      {visible.length > 0 && (
        <div className="flex flex-col gap-2.5 pt-2.5">
          {visible.map((comment) => (
            <div key={comment.id} className="flex items-start gap-2">
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                style={{ background: colorFromId(comment.authorId), letterSpacing: "0.04em" }}
              >
                {initials(comment.authorName, comment.authorEmail)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug" style={{ color: v("ink") }}>
                  <span className="mr-1.5 font-semibold">
                    {comment.authorName?.trim() || comment.authorEmail?.split("@")[0] || "Teammate"}
                  </span>
                  {renderBody(comment.body)}
                </p>
                <span className="text-[10px]" style={{ color: v("quiet") }}>
                  {relativeTime(comment.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative flex items-center gap-2 pt-2.5">
      {mentionQuery !== null && (
        <div
          className="absolute bottom-full left-0 right-0 z-20 mb-1.5 max-h-52 overflow-y-auto rounded-xl shadow-xl"
          style={{ background: v("bg-2"), border: `1px solid rgba(217,119,6,0.3)` }}
          aria-label="Tag suggestions"
        >
          {mentions === null ? (
            <p className="px-3 py-2.5 text-[12px]" style={{ color: v("muted") }}>
              Loading names…
            </p>
          ) : mentionMatches.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px]" style={{ color: v("muted") }}>
              No match — try a first name, company, or job.
            </p>
          ) : (
            mentionMatches.map((mention) => (
              <button
                key={`${mention.type}-${mention.id}`}
                type="button"
                onClick={() => insertMention(mention)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition active:scale-[0.99]"
                style={{ borderBottom: `1px solid ${v("line-soft")}` }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background:
                      mention.type === "worker"
                        ? "rgba(59,130,246,0.15)"
                        : mention.type === "subcontractor"
                          ? "rgba(168,85,247,0.15)"
                          : "rgba(217,119,6,0.15)",
                    color:
                      mention.type === "worker"
                        ? "#93c5fd"
                        : mention.type === "subcontractor"
                          ? "#d8b4fe"
                          : "#fbbf24",
                  }}
                >
                  <MentionTypeIcon type={mention.type} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: v("ink") }}>
                    {mention.label}
                  </span>
                  <span className="block truncate text-[10px]" style={{ color: v("quiet") }}>
                    {mention.detail}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (mentionQuery !== null && mentionMatches.length > 0) {
                insertMention(mentionMatches[0]);
              } else {
                submit();
              }
            }
          }}
          maxLength={2000}
          placeholder="Comment — type @ to tag someone…"
          className="min-w-0 flex-1 rounded-full px-3.5 py-2 text-[13px] outline-none"
          style={{
            background: v("bg-2"),
            border: `1px solid ${v("line")}`,
            color: v("ink"),
          }}
          aria-label="Write a comment"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || isPending}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"
          style={{ background: "rgba(217,119,6,0.14)", color: v("accent") }}
          aria-label="Post comment"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p className="pt-1.5 text-[11px]" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </div>
  );
}
