"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import {
  addFeedComment,
  type FeedComment,
  type FeedCommentSource,
} from "@/lib/actions/feed-comments";
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

const COLLAPSED_COUNT = 2;

/**
 * Inline comment thread for feed posts (company posts + daily logs).
 * Shows the latest comments collapsed, expands on demand, and posts new
 * comments optimistically.
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
  const [comments, setComments] = useState<FeedComment[]>(initialComments);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = expanded ? comments : comments.slice(-COLLAPSED_COUNT);
  const hiddenCount = comments.length - visible.length;

  const submit = () => {
    const body = draft.trim();
    if (!body || isPending) return;
    setError(null);
    setDraft("");
    startTransition(async () => {
      const result = await addFeedComment({ sourceType, sourceId, body });
      if (result.ok) {
        setComments((current) => [...current, result.comment]);
        router.refresh();
      } else {
        setDraft(body);
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
                  {comment.body}
                </p>
                <span className="text-[10px]" style={{ color: v("quiet") }}>
                  {relativeTime(comment.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Write a comment…"
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
