"use client";

import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Building2,
  Camera,
  HardHat,
  Images,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
  Users,
  X,
} from "lucide-react";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import {
  listActivityMentions,
  type ActivityMention,
} from "@/lib/actions/activity-mentions";
import { createCompanyFeedPost } from "@/lib/actions/company-feed";
import { createClient } from "@/lib/supabase/client";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { applyDetectedMentions } from "@/lib/activity-mentions/apply-detected";

const MAX_PHOTOS = 10;

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

export function CompanyPostComposer({
  open,
  onOpenChange,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted?: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<ActivityMention[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(true);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<ActivityMention[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [voiceSnapshot, setVoiceSnapshot] = useState("");
  const [autoTagCount, setAutoTagCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handlingVoiceStop = useRef(true);
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
    error: micError,
  } = useSpeechRecognition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listActivityMentions()
      .then((rows) => {
        if (!cancelled) setMentions(rows);
      })
      .catch(() => {
        if (!cancelled) setMentions([]);
      })
      .finally(() => {
        if (!cancelled) setMentionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setBody("");
    setMentionQuery(null);
    setSelectedTags([]);
    setPhotoFiles([]);
    setPhotoPreviews([]);
    setSubmitting(false);
    setPolishing(false);
    setVoiceSnapshot("");
    setAutoTagCount(0);
    handlingVoiceStop.current = true;
    setError(null);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onOpenChange(false);
  };

  const mentionMatches =
    mentionQuery === null
      ? []
      : mentions
          .map((mention) => ({
            mention,
            score: mentionMatchScore(mention, mentionQuery),
          }))
          .filter((result) => Number.isFinite(result.score))
          .sort((left, right) => {
            if (left.score !== right.score) return left.score - right.score;
            return left.mention.label.localeCompare(right.mention.label);
          })
          .slice(0, 12)
          .map((result) => result.mention);

  const handleBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isListening || polishing) return;
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    setBody(value);
    setMentionQuery(
      /@([A-Za-z0-9]*)$/.exec(value.slice(0, cursor))?.[1].toLowerCase() ?? null,
    );
  };

  const displayedBody =
    isListening && transcript.trim()
      ? `${voiceSnapshot.trim()}${voiceSnapshot.trim() ? "\n\n" : ""}${transcript}`
      : body;

  const handleMic = () => {
    setError(null);
    setAutoTagCount(0);
    if (isListening) {
      stopListening();
      return;
    }
    setVoiceSnapshot(body);
    handlingVoiceStop.current = false;
    startListening();
  };

  useEffect(() => {
    if (isListening || handlingVoiceStop.current) return;
    const raw = transcript.trim();
    if (!raw) return;
    handlingVoiceStop.current = true;

    const polishAndTag = async () => {
      setPolishing(true);
      const prefix = voiceSnapshot.trim();
      let cleaned = raw;
      try {
        const polishResponse = await fetch("/api/structure-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: raw, context: "company-post" }),
        });
        const polishResult: unknown = await polishResponse.json();
        if (
          polishResult &&
          typeof polishResult === "object" &&
          "cleaned" in polishResult &&
          typeof polishResult.cleaned === "string" &&
          polishResult.cleaned.trim()
        ) {
          cleaned = polishResult.cleaned.trim();
        }

        const combined = `${prefix}${prefix ? "\n\n" : ""}${cleaned}`.slice(
          0,
          4000,
        );
        const matchResponse = await fetch("/api/match-activity-mentions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: cleaned }),
        });
        const matchResult: unknown = await matchResponse.json();
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
          (mention) => mention.type === "worker" && ids.includes(mention.id),
        );
        setSelectedTags((current) => {
          const next = [...current];
          for (const mention of detected) {
            if (!next.some((tag) => tag.type === "worker" && tag.id === mention.id)) {
              next.push(mention);
            }
          }
          return next;
        });
        setBody(applyDetectedMentions(combined, detected).slice(0, 4000));
        setAutoTagCount(detected.length);
      } catch {
        setBody(`${prefix}${prefix ? "\n\n" : ""}${raw}`.slice(0, 4000));
      } finally {
        setPolishing(false);
      }
    };

    void polishAndTag();
  }, [isListening, mentions, transcript, voiceSnapshot]);

  const insertMention = (mention: ActivityMention) => {
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? body.length;
    const before = body
      .slice(0, cursor)
      .replace(/@[A-Za-z0-9]*$/, `@${mention.token} `);
    setBody(before + body.slice(cursor));
    setSelectedTags((current) =>
      current.some(
        (tag) => tag.id === mention.id && tag.type === mention.type,
      )
        ? current
        : [...current, mention],
    );
    setMentionQuery(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(before.length, before.length);
    });
  };

  const pickPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const remaining = MAX_PHOTOS - photoFiles.length;
    const files = Array.from(event.target.files ?? []).slice(0, remaining);
    if (files.length === 0) return;
    setPhotoFiles((current) => [...current, ...files]);
    setPhotoPreviews((current) => [
      ...current,
      ...files.map((file) => URL.createObjectURL(file)),
    ]);
    event.target.value = "";
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setPhotoPreviews((current) => {
      URL.revokeObjectURL(current[index]);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const submit = async () => {
    if (submitting || (!body.trim() && photoFiles.length === 0)) return;
    setSubmitting(true);
    setError(null);

    const postId = crypto.randomUUID();
    const uploadedPaths: string[] = [];
    try {
      const supabase = createClient();
      for (const file of photoFiles) {
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `company-feed/${postId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("project-files")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);
        uploadedPaths.push(path);
      }

      const activeTags = selectedTags.filter((tag) =>
        body.includes(`@${tag.token}`),
      );
      const linkedJob = activeTags.find((tag) => tag.type === "job") ?? null;
      const result = await createCompanyFeedPost({
        id: postId,
        body,
        projectId: linkedJob?.id ?? null,
        tags: activeTags,
        photoStoragePaths: uploadedPaths,
      });
      if (!result.ok) throw new Error(result.error);

      reset();
      onOpenChange(false);
      onPosted?.();
    } catch (submitError) {
      if (uploadedPaths.length > 0) {
        const supabase = createClient();
        await supabase.storage.from("project-files").remove(uploadedPaths);
      }
      setError(
        submitError instanceof Error ? submitError.message : "Could not publish the post.",
      );
      setSubmitting(false);
    }
  };

  const tagIcon = (type: ActivityMention["type"]) => {
    if (type === "job") return HardHat;
    if (type === "worker") return Users;
    return Building2;
  };

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && close()}>
      <BottomSheetContent
        className="max-h-[94dvh]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <BottomSheetHeader>
          <BottomSheetTitle>Create a company post</BottomSheetTitle>
          <p className="text-xs text-muted-foreground">
            Share with the team. A job tag is optional.
          </p>
        </BottomSheetHeader>

        <BottomSheetBody className="flex flex-col gap-3 scroll-pb-4">
          <div>
            <div className="relative">
              <textarea
                ref={inputRef}
                value={displayedBody}
                onChange={handleBodyChange}
                readOnly={isListening || polishing}
                rows={mentionQuery !== null ? 2 : 5}
                maxLength={4000}
                placeholder="What do you want the team to know? Type @ to tag a job, worker, or subcontractor."
                className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 outline-none transition-[height] placeholder:text-zinc-500 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
              />
              {polishing ? (
                <Sparkles className="pointer-events-none absolute right-3 top-3 h-4 w-4 animate-pulse text-amber-400" />
              ) : (
                <AtSign className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-zinc-500" />
              )}
            </div>

            {mentionQuery !== null && (
              <div
                className="mt-2 max-h-[min(42dvh,18rem)] overflow-y-auto rounded-2xl border border-amber-500/30 bg-[#11100e] shadow-[0_18px_50px_-18px_rgba(0,0,0,0.95)]"
                aria-label="Tag suggestions"
              >
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/[0.07] bg-[#11100e]/95 px-3.5 py-2.5 backdrop-blur">
                  <div>
                    <p className="text-[12px] font-semibold text-zinc-100">
                      Tag a job or person
                    </p>
                    <p className="text-[10px] text-zinc-400">
                      Crew, subcontractors, and active jobs
                    </p>
                  </div>
                  {mentionQuery && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300">
                      @{mentionQuery}
                    </span>
                  )}
                </div>
                {mentionsLoading ? (
                  <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-zinc-300">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                    Loading names…
                  </div>
                ) : mentionMatches.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm font-medium text-zinc-200">No match found</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Try a first name, company, or project number.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06] p-1.5">
                    {mentionMatches.map((mention) => {
                      const TagIcon = tagIcon(mention.type);
                      const typeLabel =
                        mention.type === "worker"
                          ? "Crew"
                          : mention.type === "subcontractor"
                            ? "Sub"
                            : "Job";
                      return (
                        <button
                          key={`${mention.type}-${mention.id}`}
                          type="button"
                          onClick={() => insertMention(mention)}
                          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition active:bg-amber-500/10"
                        >
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                              mention.type === "worker"
                                ? "bg-blue-500/15 text-blue-300"
                                : mention.type === "subcontractor"
                                  ? "bg-purple-500/15 text-purple-300"
                                  : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            <TagIcon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold leading-tight text-white">
                              {mention.label}
                            </span>
                            <span className="mt-1 block truncate text-[12px] text-zinc-400">
                              {mention.detail}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                              mention.type === "worker"
                                ? "bg-blue-500/15 text-blue-300"
                                : mention.type === "subcontractor"
                                  ? "bg-purple-500/15 text-purple-300"
                                  : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {typeLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedTags
                .filter((tag) => body.includes(`@${tag.token}`))
                .map((tag) => (
                  <span
                    key={`${tag.type}-${tag.id}`}
                    className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300"
                  >
                    @{tag.token}
                  </span>
                ))}
            </div>
          )}

          {autoTagCount > 0 && (
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Sparkles className="h-3.5 w-3.5" />
              AI tagged {autoTagCount} teammate{autoTagCount === 1 ? "" : "s"}.
              Review before posting.
            </p>
          )}

          {photoPreviews.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photoPreviews.map((url, index) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                    aria-label={`Remove photo ${index + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleMic}
              disabled={!isSupported || polishing || submitting}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold disabled:opacity-40 ${
                isListening
                  ? "border-red-500/40 bg-red-500/15 text-red-300"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-300"
              }`}
            >
              {polishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isListening ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {polishing ? "AI…" : isListening ? "Stop" : "Talk"}
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={submitting || photoFiles.length >= MAX_PHOTOS}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 text-sm font-semibold text-zinc-200 disabled:opacity-40"
            >
              <Camera className="h-4 w-4 text-amber-400" />
              Take photo
            </button>
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              disabled={submitting || photoFiles.length >= MAX_PHOTOS}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 text-sm font-semibold text-zinc-200 disabled:opacity-40"
            >
              <Images className="h-4 w-4 text-blue-400" />
              Photo library
            </button>
          </div>

          {(error ?? micError) && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error ?? micError}
            </p>
          )}

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={pickPhotos}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={pickPhotos}
          />
        </BottomSheetBody>

        <BottomSheetFooter className="grid grid-cols-[auto_1fr] gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={
              submitting ||
              isListening ||
              polishing ||
              (!body.trim() && photoFiles.length === 0)
            }
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {submitting ? "Publishing…" : "Post to company"}
          </Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  );
}
