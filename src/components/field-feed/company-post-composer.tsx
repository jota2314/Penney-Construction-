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
  RefreshCw,
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
import {
  createCompanyFeedPost,
  type CompanyFeedPost,
} from "@/lib/actions/company-feed";
import { compressImage } from "@/lib/image/compress";
import { createClient } from "@/lib/supabase/client";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { applyDetectedMentions } from "@/lib/activity-mentions/apply-detected";

const MAX_PHOTOS = 10;

/** A picked photo. Upload starts the moment it's picked so hitting Post
 * doesn't have to wait; the uploaded storage path lives in resultsRef. */
type ComposerPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "done" | "error";
};

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
  authorName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the post is saved, with a local copy the feed can render
   * immediately (photo URLs are the local previews until refresh). */
  onPosted?: (post: CompanyFeedPost) => void;
  /** Display name for the instant local copy of the post. */
  authorName?: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<ActivityMention[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(true);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<ActivityMention[]>([]);
  const [photos, setPhotos] = useState<ComposerPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // The post id is fixed up front because uploaded photo paths must live
  // under company-feed/<postId>/ (the server action validates the prefix).
  const postIdRef = useRef<string>(crypto.randomUUID());
  // In-flight upload promises, uploaded storage paths, and ids removed while
  // an upload was still in flight (so it can clean up after itself).
  const uploadsRef = useRef(new Map<string, Promise<void>>());
  const resultsRef = useRef(new Map<string, string>());
  const removedRef = useRef(new Set<string>());
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

  // Clears composer state. Does NOT revoke preview URLs — after a successful
  // post they transfer to the feed's instant copy (which revokes them once
  // the server copy arrives); on cancel, discardPhotos() revokes them first.
  const reset = () => {
    setBody("");
    setMentionQuery(null);
    setSelectedTags([]);
    setPhotos([]);
    setSubmitting(false);
    setPolishing(false);
    setVoiceSnapshot("");
    setAutoTagCount(0);
    handlingVoiceStop.current = true;
    setError(null);
    resultsRef.current.clear();
    uploadsRef.current.clear();
    postIdRef.current = crypto.randomUUID();
  };

  // Cancel without posting: reclaim previews and any already-uploaded files.
  const discardPhotos = () => {
    const uploadedPaths: string[] = [];
    for (const photo of photos) {
      removedRef.current.add(photo.id);
      URL.revokeObjectURL(photo.previewUrl);
      const path = resultsRef.current.get(photo.id);
      if (path) uploadedPaths.push(path);
    }
    if (uploadedPaths.length > 0) {
      const supabase = createClient();
      void supabase.storage
        .from("project-files")
        .remove(uploadedPaths)
        .catch(() => {});
    }
  };

  const close = () => {
    if (submitting) return;
    discardPhotos();
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

  const uploadOne = async (photo: ComposerPhoto): Promise<void> => {
    try {
      const supabase = createClient();
      // Downscale + re-encode as JPEG so multi-MB phone photos upload (and
      // later load) fast. Falls back to the original bytes when the browser
      // can't decode the file (e.g. HEIC).
      let uploadBody: Blob = photo.file;
      let extension = photo.file.name.split(".").pop()?.toLowerCase() || "jpg";
      let contentType = photo.file.type;
      try {
        uploadBody = await compressImage(photo.file);
        extension = "jpg";
        contentType = "image/jpeg";
      } catch {
        // keep the original file
      }
      const path = `company-feed/${postIdRef.current}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(path, uploadBody, { contentType, upsert: false });
      if (removedRef.current.has(photo.id)) {
        // Removed or cancelled while in flight — don't leave an orphan.
        if (!uploadError) {
          void supabase.storage.from("project-files").remove([path]).catch(() => {});
        }
        return;
      }
      if (uploadError) throw new Error(uploadError.message);
      resultsRef.current.set(photo.id, path);
      setPhotos((current) =>
        current.map((p) => (p.id === photo.id ? { ...p, status: "done" } : p)),
      );
    } catch {
      if (!removedRef.current.has(photo.id)) {
        setPhotos((current) =>
          current.map((p) => (p.id === photo.id ? { ...p, status: "error" } : p)),
        );
      }
    }
  };

  const startUpload = (photo: ComposerPhoto): Promise<void> => {
    setPhotos((current) =>
      current.map((p) => (p.id === photo.id ? { ...p, status: "uploading" } : p)),
    );
    const promise = uploadOne(photo);
    uploadsRef.current.set(photo.id, promise);
    void promise.finally(() => {
      if (uploadsRef.current.get(photo.id) === promise) {
        uploadsRef.current.delete(photo.id);
      }
    });
    return promise;
  };

  const pickPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const remaining = MAX_PHOTOS - photos.length;
    const files = Array.from(event.target.files ?? []).slice(0, remaining);
    if (files.length === 0) return;
    const added: ComposerPhoto[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setPhotos((current) => [...current, ...added]);
    // Start uploading in the background right away, all in parallel, so the
    // photos are (usually) already up by the time Post is tapped.
    added.forEach((photo) => void startUpload(photo));
    event.target.value = "";
  };

  const removePhoto = (photo: ComposerPhoto) => {
    removedRef.current.add(photo.id);
    URL.revokeObjectURL(photo.previewUrl);
    setPhotos((current) => current.filter((p) => p.id !== photo.id));
    const path = resultsRef.current.get(photo.id);
    resultsRef.current.delete(photo.id);
    if (path) {
      const supabase = createClient();
      void supabase.storage.from("project-files").remove([path]).catch(() => {});
    }
  };

  const submit = async () => {
    if (submitting || (!body.trim() && photos.length === 0)) return;
    setSubmitting(true);
    setError(null);

    const snapshot = photos;
    try {
      // Photos started uploading when they were picked, so this usually
      // resolves instantly. Anything that failed gets one automatic retry.
      await Promise.all([...uploadsRef.current.values()]);
      const missing = snapshot.filter((p) => !resultsRef.current.has(p.id));
      if (missing.length > 0) {
        await Promise.all(missing.map((p) => startUpload(p)));
      }
      const failed = snapshot.filter((p) => !resultsRef.current.has(p.id));
      if (failed.length > 0) {
        throw new Error(
          failed.length === 1
            ? "A photo didn't upload. Tap it to retry, or remove it, then post again."
            : `${failed.length} photos didn't upload. Tap them to retry, or remove them, then post again.`,
        );
      }

      const activeTags = selectedTags.filter((tag) =>
        body.includes(`@${tag.token}`),
      );
      const linkedJob = activeTags.find((tag) => tag.type === "job") ?? null;
      const postId = postIdRef.current;
      const photoStoragePaths = snapshot
        .map((p) => resultsRef.current.get(p.id))
        .filter((path): path is string => !!path);
      const result = await createCompanyFeedPost({
        id: postId,
        body,
        projectId: linkedJob?.id ?? null,
        tags: activeTags,
        photoStoragePaths,
      });
      if (!result.ok) throw new Error(result.error);

      // Local copy for the feed to render immediately while router.refresh()
      // catches up. Preview URLs transfer with it; the feed revokes them once
      // the server copy arrives.
      const posted: CompanyFeedPost = {
        id: postId,
        body,
        projectId: linkedJob?.id ?? null,
        projectName: linkedJob?.label ?? null,
        authorId: "",
        authorName: authorName ?? null,
        authorEmail: null,
        tags: activeTags.map((tag) => ({
          id: tag.id,
          type: tag.type,
          label: tag.label,
          token: tag.token,
          profileId: tag.profileId,
        })),
        photoUrls: snapshot.map((p) => p.previewUrl),
        photoThumbUrls: snapshot.map((p) => p.previewUrl),
        createdAt: new Date().toISOString(),
        comments: [],
      };

      reset();
      onOpenChange(false);
      onPosted?.(posted);
    } catch (submitError) {
      // Keep the uploaded photos attached — fixing the problem and hitting
      // Post again doesn't re-upload anything.
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

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo, index) => (
                <div key={photo.id} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
                  {photo.status === "uploading" && (
                    <span className="absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
                    </span>
                  )}
                  {photo.status === "error" && (
                    <button
                      type="button"
                      onClick={() => void startUpload(photo)}
                      disabled={submitting}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-[10px] font-semibold text-red-300"
                      aria-label={`Retry uploading photo ${index + 1}`}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Tap to retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(photo)}
                    disabled={submitting}
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
              disabled={submitting || photos.length >= MAX_PHOTOS}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 text-sm font-semibold text-zinc-200 disabled:opacity-40"
            >
              <Camera className="h-4 w-4 text-amber-400" />
              Take photo
            </button>
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              disabled={submitting || photos.length >= MAX_PHOTOS}
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
              (!body.trim() && photos.length === 0)
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
