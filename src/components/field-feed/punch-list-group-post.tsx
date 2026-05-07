"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, MapPin, ListChecks } from "lucide-react";
import { v } from "./tokens";
import type { FeedPunchGroup } from "@/lib/actions/daily-logs";
import { togglePunchItemDone, updatePunchItemText } from "@/lib/actions/punch-list";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diff < 86400 * 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type LocalItem = FeedPunchGroup["items"][number];

export function PunchListGroupPost({ group }: { group: FeedPunchGroup }) {
  const router = useRouter();
  const [items, setItems] = useState<LocalItem[]>(group.items);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const authorLabel = group.author_name?.trim() || group.author_email?.split("@")[0] || "Someone";
  const avatarBg = colorFromId(group.author_id || group.session_id);
  const avatarInit = initials(group.author_name, group.author_email);
  const totalCount = items.length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const allDone = doneCount === totalCount;
  // Session photos: union of all items' creation_photo_paths in the
  // group. We post them on the first item in createPunchListItems, but
  // de-dupe here in case legacy rows have per-item splits.
  const sessionPhotos = Array.from(new Set(items.flatMap((it) => it.photo_signed_urls)));

  const onToggle = async (item: LocalItem) => {
    const nextDone = item.status !== "done";
    setPendingId(item.id);
    // Optimistic update.
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: nextDone ? "done" : "open" } : it)));
    const result = await togglePunchItemDone(item.id, nextDone);
    setPendingId(null);
    if (result.error) {
      // Revert.
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: item.status } : it)));
      alert(result.error);
      return;
    }
    router.refresh();
  };

  const startEdit = (item: LocalItem) => {
    setEditingId(item.id);
    setEditText(item.description);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = async (item: LocalItem) => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === item.description) {
      cancelEdit();
      return;
    }
    setPendingId(item.id);
    const prev = item.description;
    setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, description: trimmed } : it)));
    const result = await updatePunchItemText(item.id, trimmed);
    setPendingId(null);
    if (result.error) {
      setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, description: prev } : it)));
      alert(result.error);
      return;
    }
    cancelEdit();
    router.refresh();
  };

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: v("card"),
        border: `1px solid ${allDone ? "rgba(52, 211, 153, 0.30)" : "rgba(239, 68, 68, 0.30)"}`,
      }}
    >
      <div className="px-4 pt-3 pb-1 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-white"
          style={{ background: avatarBg, fontSize: 11, letterSpacing: "0.04em" }}
        >
          {avatarInit}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={
                allDone
                  ? { background: "rgba(52, 211, 153, 0.15)", color: "#34d399" }
                  : { background: "rgba(239, 68, 68, 0.12)", color: "#fca5a5" }
              }
            >
              <ListChecks className="h-2.5 w-2.5" />
              Punch list · {doneCount}/{totalCount}
            </span>
          </div>
          <div className="text-[14px] font-semibold leading-tight mt-0.5" style={{ color: v("ink") }}>
            {authorLabel}
            <span className="font-normal opacity-70"> · {fmtTime(group.created_at)}</span>
          </div>
          <div className="text-[11px] font-mono truncate" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
            {group.project_name}
          </div>
        </div>
      </div>

      {sessionPhotos.length > 0 && (
        <div
          className="px-3 pt-2 flex gap-2 overflow-x-auto snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sessionPhotos.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={`Photo ${i + 1}`}
              className="h-40 w-40 shrink-0 rounded-lg object-cover snap-start"
              style={{ background: v("bg-2") }}
            />
          ))}
        </div>
      )}

      <ul className="px-3 pt-2 pb-3 flex flex-col gap-1.5">
        {items.map((it) => {
          const isDone = it.status === "done";
          const isEditing = editingId === it.id;
          const isPending = pendingId === it.id;
          return (
            <li
              key={it.id}
              className="flex items-start gap-2 rounded-lg px-2 py-2"
              style={{
                background: isDone ? "rgba(52, 211, 153, 0.06)" : v("bg-2"),
                border: `1px solid ${isDone ? "rgba(52, 211, 153, 0.25)" : v("line-soft")}`,
              }}
            >
              <button
                type="button"
                onClick={() => onToggle(it)}
                disabled={isPending}
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition"
                style={{
                  background: isDone ? "#34d399" : "transparent",
                  borderColor: isDone ? "#34d399" : "rgba(255,255,255,0.25)",
                }}
                aria-label={isDone ? "Mark not done" : "Mark done"}
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin text-zinc-300" />
                ) : isDone ? (
                  <Check className="h-3 w-3 text-zinc-900" strokeWidth={3} />
                ) : null}
              </button>

              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(it);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      autoFocus
                      className="flex-1 rounded border border-amber-500/50 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(it)}
                      className="rounded bg-amber-500/20 px-2 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {it.location && (
                        <span
                          className="mr-1.5 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase font-semibold align-middle"
                          style={{ color: "#fbbf24", letterSpacing: "0.06em" }}
                        >
                          <MapPin className="h-2.5 w-2.5" />
                          {it.location}
                        </span>
                      )}
                      <span
                        className={`text-[14px] leading-snug ${isDone ? "line-through text-zinc-500" : "text-zinc-100"}`}
                      >
                        {it.description}
                      </span>
                      {it.assignee && (
                        <span className="ml-1.5 inline-block rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-300 align-middle">
                          → {it.assignee}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(it)}
                      className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                      aria-label="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Per-item photos hidden when session photos exist —
                    same picture set, just rendered at the top of the
                    post. We still show item-level photos for legacy
                    rows that don't have session-level aggregation. */}
                {it.photo_signed_urls.length > 0 && !isEditing && sessionPhotos.length === 0 && (
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {it.photo_signed_urls.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={url}
                        src={url}
                        alt={`Issue ${i + 1}`}
                        className="h-16 w-16 rounded-md object-cover shrink-0 snap-start"
                        style={{ background: v("bg-2") }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
