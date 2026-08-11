"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, MapPin, ListChecks, User, Search, X } from "lucide-react";
import { v } from "./tokens";
import { ImageViewer } from "@/components/ui/image-viewer";
import type { FeedPunchGroup } from "@/lib/actions/daily-logs";
import {
  togglePunchItemDone,
  updatePunchItemText,
  updatePunchItemAssignee,
  reassignPunchSession,
  listActiveEmployees,
  deletePunchGroup,
} from "@/lib/actions/punch-list";
import { FeedDeleteButton } from "./feed-delete-button";

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
}

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
  // Tapped photo → full-screen viewer (pinch-zoom + swipe through the
  // gallery the photo belongs to). Full-res URLs, not thumbs.
  const [preview, setPreview] = useState<{ url: string; gallery: string[] } | null>(null);
  // Inline assignee picker — opens when the user taps an item's
  // assignee chip. Loads the active-employee list lazily on first
  // open so a feed full of punch posts isn't all hammering the
  // database at once.
  const [assignPickerFor, setAssignPickerFor] = useState<string | null>(null);
  const [assignQuery, setAssignQuery] = useState("");
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const assignSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!assignPickerFor || employees) return;
    setLoadingEmployees(true);
    listActiveEmployees()
      .then(setEmployees)
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmployees(false));
  }, [assignPickerFor, employees]);

  useEffect(() => {
    if (assignPickerFor) {
      requestAnimationFrame(() => assignSearchRef.current?.focus());
    } else {
      setAssignQuery("");
    }
  }, [assignPickerFor]);

  const authorLabel = group.author_name?.trim() || group.author_email?.split("@")[0] || "Someone";
  const avatarBg = colorFromId(group.author_id || group.session_id);
  const avatarInit = initials(group.author_name, group.author_email);
  const totalCount = items.length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const allDone = doneCount === totalCount;

  // Group-level assignee. Single name if every item has the same one,
  // 'Mixed' if multiple workers, null if unassigned.
  const distinctAssignees = Array.from(new Set(items.map((i) => i.assignee).filter((a): a is string => !!a)));
  const groupAssignee: string | "mixed" | null =
    distinctAssignees.length === 0 ? null
    : distinctAssignees.length === 1 ? distinctAssignees[0]
    : "mixed";

  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupMode, setGroupMode] = useState<"open" | "all">("open");
  const [groupReassigning, setGroupReassigning] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const groupSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!groupPickerOpen) {
      setGroupQuery("");
      return;
    }
    if (!employees) {
      setLoadingEmployees(true);
      listActiveEmployees().then(setEmployees).catch(() => setEmployees([])).finally(() => setLoadingEmployees(false));
    }
    requestAnimationFrame(() => groupSearchRef.current?.focus());
  }, [groupPickerOpen, employees]);

  const onGroupReassign = async (assignee: string | null) => {
    setGroupReassigning(true);
    const prevItems = items;
    setItems((arr) =>
      arr.map((it) => {
        if (groupMode === "open" && it.status !== "open") return it;
        return { ...it, assignee };
      })
    );
    const result = await reassignPunchSession(group.session_id, assignee, groupMode);
    setGroupReassigning(false);
    if (result.error) {
      setItems(prevItems);
      alert(result.error);
      return;
    }
    setGroupPickerOpen(false);
    router.refresh();
  };

  const filteredGroupEmployees = (employees ?? []).filter((e) => {
    if (!groupQuery.trim()) return true;
    const q = groupQuery.toLowerCase();
    return (
      e.first_name.toLowerCase().includes(q)
      || e.last_name.toLowerCase().includes(q)
      || `${e.first_name} ${e.last_name}`.toLowerCase().includes(q)
      || (e.title?.toLowerCase().includes(q) ?? false)
    );
  });
  // Session photos: union of all items' creation_photo_paths in the
  // group. We post them on the first item in createPunchListItems, but
  // de-dupe here in case legacy rows have per-item splits. Tiles render
  // the resized thumb; tapping opens the full-res photo in the viewer.
  const sessionPhotos = (() => {
    const seen = new Set<string>();
    const pairs: { thumb: string; full: string }[] = [];
    for (const it of items) {
      const thumbs = it.photo_thumb_urls ?? it.photo_signed_urls;
      it.photo_signed_urls.forEach((full, i) => {
        if (seen.has(full)) return;
        seen.add(full);
        pairs.push({ full, thumb: thumbs[i] ?? full });
      });
    }
    return pairs;
  })();

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

  const onAssign = async (item: LocalItem, value: string | null) => {
    setPendingId(item.id);
    const prev = item.assignee;
    setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, assignee: value } : it)));
    const result = await updatePunchItemAssignee(item.id, value);
    setPendingId(null);
    if (result.error) {
      setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, assignee: prev } : it)));
      alert(result.error);
      return;
    }
    setAssignPickerFor(null);
    router.refresh();
  };

  const filteredEmployees = (employees ?? []).filter((e) => {
    if (!assignQuery.trim()) return true;
    const q = assignQuery.toLowerCase();
    return (
      e.first_name.toLowerCase().includes(q)
      || e.last_name.toLowerCase().includes(q)
      || `${e.first_name} ${e.last_name}`.toLowerCase().includes(q)
      || (e.title?.toLowerCase().includes(q) ?? false)
    );
  });

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

  if (deleted) return null;

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
        <FeedDeleteButton
          label="punch list"
          onDelete={() => deletePunchGroup(group.session_id)}
          onDeleted={() => setDeleted(true)}
        />
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setGroupPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium hover:bg-zinc-800"
            style={{
              background: groupAssignee ? "rgba(217, 119, 6, 0.14)" : v("bg-2"),
              border: `1px solid ${groupAssignee ? "rgba(217, 119, 6, 0.4)" : v("line")}`,
              color: groupAssignee === "mixed" ? "#fbbf24" : groupAssignee ? "#fbbf24" : v("muted"),
            }}
            aria-label="Assign whole list"
          >
            <User className="h-3 w-3" />
            {groupAssignee === "mixed"
              ? "Multiple"
              : groupAssignee
                ? groupAssignee.split(" ")[0]
                : "Assign list"}
          </button>
          {groupPickerOpen && (
            <div
              className="absolute z-30 right-0 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 text-zinc-500" />
                <input
                  ref={groupSearchRef}
                  type="text"
                  value={groupQuery}
                  onChange={(e) => setGroupQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setGroupPickerOpen(false);
                    if (e.key === "Enter" && filteredGroupEmployees[0]) {
                      e.preventDefault();
                      const emp = filteredGroupEmployees[0];
                      onGroupReassign(`${emp.first_name} ${emp.last_name}`);
                    }
                  }}
                  placeholder="Reassign whole list to…"
                  className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setGroupPickerOpen(false)}
                  className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                  aria-label="Close"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="border-b border-zinc-800 px-2 py-1.5 flex items-center gap-1 text-[10px]">
                <span className="text-zinc-500 mr-1">Apply to:</span>
                {(["open", "all"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setGroupMode(m)}
                    className="rounded px-2 py-0.5 font-medium transition"
                    style={{
                      background: groupMode === m ? "rgba(217, 119, 6, 0.18)" : "transparent",
                      color: groupMode === m ? "#fbbf24" : "#a1a1aa",
                      border: `1px solid ${groupMode === m ? "rgba(217, 119, 6, 0.4)" : "transparent"}`,
                    }}
                  >
                    {m === "open" ? `Open only (${totalCount - doneCount})` : `All ${totalCount}`}
                  </button>
                ))}
              </div>
              <div className="max-h-60 overflow-y-auto">
                {groupReassigning ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Reassigning…
                  </div>
                ) : loadingEmployees ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </div>
                ) : filteredGroupEmployees.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-zinc-500">No matches.</div>
                ) : (
                  <>
                    {groupAssignee && (
                      <button
                        type="button"
                        onClick={() => onGroupReassign(null)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                      >
                        <X className="h-3.5 w-3.5" />
                        Unassign all
                      </button>
                    )}
                    {filteredGroupEmployees.map((emp) => {
                      const fullName = `${emp.first_name} ${emp.last_name}`;
                      return (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => onGroupReassign(fullName)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-100 hover:bg-zinc-800"
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-semibold text-amber-300">
                            {emp.first_name[0]}
                          </span>
                          <span className="flex-1">{fullName}</span>
                          {emp.title && <span className="text-[10px] text-zinc-500">{emp.title}</span>}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {sessionPhotos.length > 0 && (
        <div
          className="px-3 pt-2 flex gap-2 overflow-x-auto snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sessionPhotos.map(({ thumb, full }, i) => (
            <button
              key={full}
              type="button"
              onClick={() => setPreview({ url: full, gallery: sessionPhotos.map((p) => p.full) })}
              className="shrink-0 snap-start"
              aria-label={`Open photo ${i + 1} of ${sessionPhotos.length}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumb}
                alt={`Photo ${i + 1}`}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  // Thumb transform failed (e.g. legacy HEIC) — fall back to the original.
                  if (e.currentTarget.src !== full) e.currentTarget.src = full;
                }}
                className="h-40 w-40 rounded-lg object-cover"
                style={{ background: v("bg-2") }}
              />
            </button>
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
                    <div className="min-w-0 flex-1 relative">
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
                      <button
                        type="button"
                        onClick={() => setAssignPickerFor(it.id)}
                        className="ml-1.5 inline-flex items-center gap-1 rounded bg-zinc-700/60 hover:bg-zinc-700 px-1.5 py-0.5 text-[10px] align-middle"
                        style={{ color: it.assignee ? "#e4e4e7" : "#a1a1aa" }}
                        aria-label="Assign worker"
                      >
                        <User className="h-2.5 w-2.5" />
                        {it.assignee ? it.assignee : "Assign"}
                      </button>
                      {assignPickerFor === it.id && (
                        <div
                          className="absolute z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60 overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5">
                            <Search className="h-3.5 w-3.5 text-zinc-500" />
                            <input
                              ref={assignSearchRef}
                              type="text"
                              value={assignQuery}
                              onChange={(e) => setAssignQuery(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setAssignPickerFor(null);
                                if (e.key === "Enter" && filteredEmployees[0]) {
                                  e.preventDefault();
                                  onAssign(it, `${filteredEmployees[0].first_name} ${filteredEmployees[0].last_name}`);
                                }
                              }}
                              placeholder="Search team…"
                              className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setAssignPickerFor(null)}
                              className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                              aria-label="Close"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="max-h-60 overflow-y-auto">
                            {loadingEmployees ? (
                              <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-500">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading…
                              </div>
                            ) : filteredEmployees.length === 0 ? (
                              <div className="px-3 py-3 text-xs text-zinc-500">
                                No matches.
                              </div>
                            ) : (
                              <>
                                {it.assignee && (
                                  <button
                                    type="button"
                                    onClick={() => onAssign(it, null)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    Unassign
                                  </button>
                                )}
                                {filteredEmployees.map((emp) => {
                                  const fullName = `${emp.first_name} ${emp.last_name}`;
                                  const selected = it.assignee === fullName;
                                  return (
                                    <button
                                      key={emp.id}
                                      type="button"
                                      onClick={() => onAssign(it, fullName)}
                                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-800 ${selected ? "bg-amber-500/10 text-amber-200" : "text-zinc-100"}`}
                                    >
                                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-semibold text-amber-300">
                                        {emp.first_name[0]}
                                      </span>
                                      <span className="flex-1">{fullName}</span>
                                      {emp.title && (
                                        <span className="text-[10px] text-zinc-500">{emp.title}</span>
                                      )}
                                      {selected && <Check className="h-3.5 w-3.5 text-amber-300" />}
                                    </button>
                                  );
                                })}
                              </>
                            )}
                          </div>
                        </div>
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
                      <button
                        key={url}
                        type="button"
                        onClick={() => setPreview({ url, gallery: it.photo_signed_urls })}
                        className="shrink-0 snap-start"
                        aria-label={`Open photo ${i + 1} of ${it.photo_signed_urls.length}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={it.photo_thumb_urls?.[i] ?? url}
                          alt={`Issue ${i + 1}`}
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            // Thumb transform failed (e.g. legacy HEIC) — fall back to the original.
                            if (e.currentTarget.src !== url) e.currentTarget.src = url;
                          }}
                          className="h-16 w-16 rounded-md object-cover"
                          style={{ background: v("bg-2") }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ImageViewer
        url={preview?.url ?? null}
        urls={preview?.gallery}
        filename="Punch list photo"
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
