"use client";

import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Building2,
  Camera,
  HardHat,
  Images,
  Loader2,
  Send,
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

const MAX_PHOTOS = 10;

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
  const [error, setError] = useState<string | null>(null);

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
          .filter((mention) => {
            const query = mentionQuery.toLowerCase();
            return (
              mention.token.toLowerCase().includes(query) ||
              mention.label.toLowerCase().includes(query) ||
              mention.detail.toLowerCase().includes(query)
            );
          })
          .slice(0, 10);

  const handleBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    setBody(value);
    setMentionQuery(
      /@([A-Za-z0-9]*)$/.exec(value.slice(0, cursor))?.[1].toLowerCase() ?? null,
    );
  };

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

        <BottomSheetBody className="flex flex-col gap-3">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={body}
              onChange={handleBodyChange}
              rows={5}
              maxLength={4000}
              placeholder="What do you want the team to know? Type @ to tag a job, worker, or subcontractor."
              className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
            <AtSign className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-zinc-500" />

            {mentionQuery !== null && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl">
                {mentionsLoading ? (
                  <div className="px-3 py-3 text-xs text-zinc-500">Loading tags…</div>
                ) : mentionMatches.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-zinc-500">No matching tags.</div>
                ) : (
                  mentionMatches.map((mention) => {
                    const TagIcon = tagIcon(mention.type);
                    return (
                      <button
                        key={`${mention.type}-${mention.id}`}
                        type="button"
                        onClick={() => insertMention(mention)}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-zinc-800"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                          <TagIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-zinc-100">
                            {mention.label}
                          </span>
                          <span className="block truncate text-[11px] text-zinc-500">
                            {mention.detail}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] uppercase text-zinc-500">
                          {mention.type === "worker" ? "Crew" : mention.type}
                        </span>
                      </button>
                    );
                  })
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

          <div className="grid grid-cols-2 gap-2">
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

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
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
            disabled={submitting || (!body.trim() && photoFiles.length === 0)}
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
