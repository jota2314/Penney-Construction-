"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, Plus, X, MapPin, User, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { createPunchListItems } from "@/lib/actions/punch-list";
import { createClient } from "@/lib/supabase/client";
import type { ActivityMention } from "@/lib/actions/activity-mentions";

interface ParsedItem {
  description: string;
  location: string | null;
  priority: string;
  assignee: string | null;
  keep: boolean;
}

export interface PunchListEmployee {
  id: string;
  first_name: string;
  last_name: string;
}

/**
 * Big-button voice composer that turns one ramble into a whole punch
 * list. Dictate → AI splits into items → preview each item, attach
 * per-item photos, assign to a worker, uncheck duds → tap "Add all"
 * → bulk-creates with photos + assignees in one shot.
 */
export function PunchListVoiceComposer({
  projectId,
  projectName,
  employees = [],
  mentions = [],
  onCreated,
}: {
  projectId: string;
  projectName: string;
  employees?: PunchListEmployee[];
  mentions?: ActivityMention[];
  onCreated?: () => void;
}) {
  const router = useRouter();
  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ONE batch of photos for the whole post — site walks generate a
  // bunch of pictures all at once and the user shouldn't have to
  // assign each photo to a specific item. Photos are stored at the
  // session level (we attach them to the first item under the hood,
  // and the feed renders them at the group header).
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // Free-text "type an item" input — works in parallel with dictation
  // so the user can mix typed and spoken items in the same post.
  const [manualText, setManualText] = useState("");
  // @-mention dropdown state. Jobs remain labels in the post; workers and
  // subcontractors also become the item's assignee.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const availableMentions: ActivityMention[] =
    mentions.length > 0
      ? mentions
      : employees.map((employee) => ({
          id: employee.id,
          type: "worker" as const,
          label: `${employee.first_name} ${employee.last_name}`.trim(),
          detail: "Worker",
          token: employee.first_name,
        }));
  const assignableMentions = availableMentions.filter(
    (mention) => mention.type === "worker" || mention.type === "subcontractor",
  );

  const onMicClick = async () => {
    setError(null);
    if (isListening) {
      stopListening();
      setTimeout(async () => {
        const text = transcript.trim();
        if (!text) return;
        setParsing(true);
        try {
          const res = await fetch("/api/punch-list-from-voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Failed to parse");
            return;
          }
          const parsed: ParsedItem[] = (data.items ?? []).map(
            (it: Omit<ParsedItem, "keep" | "assignee">) => ({
              ...it,
              assignee: null,
              keep: true,
            })
          );
          if (parsed.length === 0) setError("No items detected — try again");
          setItems(parsed);
        } catch {
          setError("Network error — try again");
        } finally {
          setParsing(false);
        }
      }, 350);
    } else {
      setItems([]);
      startListening();
    }
  };

  const toggleKeep = (idx: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, keep: !it.keep } : it)));
  };

  const editDescription = (idx: number, value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, description: value } : it)));
  };

  const setAssignee = (idx: number, value: string | null) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, assignee: value } : it)));
  };

  const setAllAssignees = (value: string | null) => {
    setItems((prev) => prev.map((it) => ({ ...it, assignee: value })));
  };

  const onPickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const previews = files.map((f) => URL.createObjectURL(f));
    setPhotoFiles((prev) => [...prev, ...files]);
    setPhotoPreviews((prev) => [...prev, ...previews]);
    e.target.value = "";
  };

  const removePhoto = (idx: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /**
   * Add a manually-typed item to the preview list. Accepts an optional
   * "[Room] description" prefix the same way dictated items do, so the
   * user can scope an item to a location without breaking flow:
   *   "[Master bath] caulk gap behind toilet"
   * If no bracket prefix is present, location stays null.
   *
   * Also scans for @ mentions. Workers and subcontractors become the item's
   * assignee automatically; job tags remain context in the description.
   */
  const addManualItem = () => {
    const raw = manualText.trim();
    if (!raw) return;
    const m = /^\[(.+?)\]\s*(.*)$/.exec(raw);
    const description = (m?.[2] ?? raw).trim();
    if (!description) return;
    const location = m?.[1]?.trim() || null;

    // Resolve an @ mention to a worker or subcontractor assignment. Job tags
    // remain in the description but do not become an assignee.
    let assignee: string | null = null;
    const tokens = Array.from(description.matchAll(/@([A-Za-z0-9]+)/g)).map((match) =>
      match[1].toLowerCase(),
    );
    for (const token of tokens) {
      const mention = assignableMentions.find(
        (candidate) => candidate.token.toLowerCase() === token,
      );
      if (mention) {
        assignee = mention.label;
        break;
      }
    }

    setItems((prev) => [
      ...prev,
      { description, location, priority: "medium", assignee, keep: true },
    ]);
    setManualText("");
    setMentionQuery(null);
  };

  /**
   * Live tracking of the @-mention typed at the cursor. We look at
   * the substring up to the cursor for a trailing "@word" and use
   * that as the dropdown filter.
   */
  const onManualTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setManualText(value);
    const cursor = e.target.selectionStart ?? value.length;
    const upToCursor = value.slice(0, cursor);
    const match = /@([A-Za-z0-9]*)$/.exec(upToCursor);
    setMentionQuery(match ? match[1].toLowerCase() : null);
  };

  const insertMention = (mention: ActivityMention) => {
    const input = manualInputRef.current;
    const cursor = input?.selectionStart ?? manualText.length;
    const upToCursor = manualText.slice(0, cursor);
    const after = manualText.slice(cursor);
    const replaced = upToCursor.replace(/@[A-Za-z0-9]*$/, `@${mention.token} `);
    setManualText(replaced + after);
    setMentionQuery(null);
    // Move focus back into the input with cursor at the end of the replaced chunk.
    requestAnimationFrame(() => {
      input?.focus();
      const pos = replaced.length;
      input?.setSelectionRange(pos, pos);
    });
  };

  const mentionMatches = mentionQuery !== null
    ? availableMentions.filter((mention) =>
        mention.token.toLowerCase().includes(mentionQuery)
        || mention.label.toLowerCase().includes(mentionQuery)
        || mention.detail.toLowerCase().includes(mentionQuery)
      ).slice(0, 6)
    : [];

  const addAll = async () => {
    const kept = items.filter((it) => it.keep);
    if (kept.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in to save.");
        return;
      }

      // Upload all the batch photos once. They get stamped onto the
      // first item — the feed renders them at the group level so all
      // items in the session see them.
      const sessionPhotoPaths: string[] = [];
      for (const file of photoFiles) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${projectId}/punch-list/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("project-files")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) {
          setError(`Photo upload failed: ${upErr.message}`);
          console.error("[punch-list-photo] upload failed:", upErr);
          return;
        }
        sessionPhotoPaths.push(path);
      }

      const itemsWithPhotos = kept.map((it, i) => ({
        description: it.description,
        location: it.location,
        priority: it.priority,
        assignee: it.assignee,
        creation_photo_paths: i === 0 ? sessionPhotoPaths : [],
      }));

      const result = await createPunchListItems(projectId, projectName, itemsWithPhotos);
      if (result.error) {
        setError(`Couldn't save: ${result.error}`);
        console.error("[punch-list-create] failed:", result.error);
        return;
      }
      if (!result.inserted || result.inserted === 0) {
        setError("Save returned 0 items. Check role/permissions.");
        return;
      }
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
      setPhotoFiles([]);
      setPhotoPreviews([]);
      setItems([]);
      onCreated?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — try again");
      console.error("[punch-list-create] threw:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-3 text-xs text-zinc-500">
        Voice not supported on this browser. Use the form below.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMicClick}
          disabled={parsing || saving}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
            isListening
              ? "bg-red-500 hover:bg-red-600 text-white border border-red-500 shadow-lg shadow-red-500/30 animate-pulse"
              : parsing
                ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
          }`}
        >
          {parsing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Parsing list…
            </>
          ) : isListening ? (
            <>
              <Square className="h-4 w-4" />
              Stop &amp; build list
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" />
              Dictate punch list
            </>
          )}
        </button>
      </div>

      {isListening && (
        <div className="mt-2 h-0.5 rounded-full bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-pulse" />
      )}

      {isListening && transcript && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs italic text-zinc-200">
          {transcript}
        </p>
      )}

      {/* Type-an-item fallback — always visible so the user can mix
          typed + dictated items in the same post. Supports an optional
          [Room] prefix that becomes the location chip, plus @-mentions
          that auto-tag an employee as assignee. */}
      {!isListening && !parsing && (
        <div className="mt-2 relative">
          <div className="flex items-center gap-1.5">
            <input
              ref={manualInputRef}
              type="text"
              value={manualText}
              onChange={onManualTextChange}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMentionQuery(null);
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManualItem();
                }
              }}
              placeholder='Type an item — use [Room] or @ to tag'
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            />
            <button
              type="button"
              onClick={addManualItem}
              disabled={!manualText.trim()}
              className="inline-flex items-center justify-center rounded-md bg-amber-500/15 border border-amber-500/40 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-40"
              aria-label="Add item"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {mentionQuery !== null && mentionMatches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/40 overflow-hidden">
              {mentionMatches.map((mention) => (
                <button
                  key={`${mention.type}-${mention.id}`}
                  type="button"
                  onClick={() => insertMention(mention)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-100 hover:bg-zinc-800"
                >
                  <span className="inline-flex h-6 min-w-8 items-center justify-center rounded bg-amber-500/20 px-1 text-[9px] font-semibold uppercase text-amber-300">
                    {mention.type === "job" ? "Job" : mention.type === "worker" ? "Crew" : "Sub"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{mention.label}</span>
                    <span className="block truncate text-[10px] text-zinc-500">{mention.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {items.filter((i) => i.keep).length} of {items.length} items
            </p>
            {assignableMentions.length > 0 && (
              <select
                onChange={(e) => setAllAssignees(e.target.value || null)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
                defaultValue=""
              >
                <option value="">Assign all to…</option>
                {assignableMentions.map((mention) => (
                  <option key={`${mention.type}-${mention.id}`} value={mention.label}>
                    {mention.label} · {mention.type === "worker" ? "Crew" : "Sub"}
                  </option>
                ))}
              </select>
            )}
          </div>
          {items.map((it, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2 rounded-md border p-2 ${
                it.keep ? "bg-zinc-900/40 border-zinc-700" : "bg-zinc-900/20 border-zinc-800 opacity-50"
              }`}
            >
              <input
                type="checkbox"
                checked={it.keep}
                onChange={() => toggleKeep(idx)}
                className="mt-1 h-3.5 w-3.5 accent-amber-500"
              />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex flex-wrap gap-1">
                  {it.location && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-400">
                      <MapPin className="h-2.5 w-2.5" />
                      {it.location}
                    </span>
                  )}
                  {it.priority === "high" && (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase text-red-400">High</span>
                  )}
                </div>
                <input
                  type="text"
                  value={it.description}
                  onChange={(e) => editDescription(idx, e.target.value)}
                  className="w-full bg-transparent text-sm text-zinc-100 focus:outline-none"
                />

                {assignableMentions.length > 0 && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[11px]">
                    <User className="h-3 w-3 text-zinc-500" />
                    <select
                      value={it.assignee ?? ""}
                      onChange={(e) => setAssignee(idx, e.target.value || null)}
                      className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-200"
                    >
                      <option value="">Unassigned</option>
                      {assignableMentions.map((mention) => (
                        <option key={`${mention.type}-${mention.id}`} value={mention.label}>
                          {mention.label} · {mention.type === "worker" ? "Crew" : "Sub"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => toggleKeep(idx)}
                className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                aria-label="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {/* One batch photo picker for the whole post — pick a bunch
              of pictures from a site walk in one tap, no need to
              assign each photo to a specific item. */}
          <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-900/40 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Photos for this post {photoFiles.length > 0 && `(${photoFiles.length})`}
              </span>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
              >
                <Camera className="h-3.5 w-3.5" />
                Add photos
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onPickPhotos}
                className="hidden"
              />
            </div>
            {photoPreviews.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x">
                {photoPreviews.map((url, i) => (
                  <div key={url} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-700 snap-start">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                      aria-label="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button
            onClick={addAll}
            disabled={saving || items.filter((i) => i.keep).length === 0}
            className="mt-2 w-full"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add {items.filter((i) => i.keep).length} item{items.filter((i) => i.keep).length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
