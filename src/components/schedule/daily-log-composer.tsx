"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, X, Send, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { postDailyLog } from "@/lib/actions/daily-logs";
import { VoiceToNotes } from "@/components/ui/voice-to-notes";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetBody,
  BottomSheetFooter,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";

const MAX_PHOTOS = 8;
const PHOTO_BUCKET = "daily-log-photos";

export function DailyLogComposer({
  open,
  onOpenChange,
  phaseId,
  projectName,
  phaseName,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  phaseId: string;
  projectName: string;
  phaseName: string;
}) {
  const [text, setText] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const reset = () => {
    setText("");
    photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setPhotoFiles([]);
    setPhotoPreviews([]);
    setError(null);
    setPosting(false);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const onPickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_PHOTOS - photoFiles.length;
    const accepted = files.slice(0, Math.max(0, remaining));
    const previews = accepted.map((f) => URL.createObjectURL(f));
    setPhotoFiles((prev) => [...prev, ...accepted]);
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

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in to post.");
        setPosting(false);
        return;
      }
      const photoPaths: string[] = [];
      for (const file of photoFiles) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) {
          setError(`Photo upload failed: ${upErr.message}`);
          setPosting(false);
          return;
        }
        photoPaths.push(path);
      }

      const result = await postDailyLog(phaseId, text, photoPaths);
      if (result.error) {
        setError(result.error);
        setPosting(false);
        return;
      }
      router.refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
      setPosting(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[92dvh]">
        <BottomSheetHeader>
          <BottomSheetTitle>Log work · {projectName}</BottomSheetTitle>
          <p className="text-xs text-muted-foreground">{phaseName}</p>
        </BottomSheetHeader>
        <BottomSheetBody className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="What got done? Crew, materials, blockers, next steps…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
          />

          <div className="flex flex-wrap gap-2">
            <VoiceToNotes
              context="daily-log"
              label="Voice note"
              onResult={(cleaned) => {
                setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${cleaned}` : cleaned));
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700"
            >
              <Camera className="h-4 w-4" />
              <span>Photos</span>
              {photoFiles.length > 0 && (
                <span className="text-xs text-zinc-400">{photoFiles.length}/{MAX_PHOTOS}</span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={onPickPhotos}
              className="hidden"
            />
          </div>

          {photoPreviews.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photoPreviews.map((url, i) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-md border border-zinc-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
          )}
        </BottomSheetBody>
        <BottomSheetFooter>
          <Button variant="ghost" onClick={close} disabled={posting}>Cancel</Button>
          <Button onClick={post} disabled={posting}>
            {posting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {posting ? "Posting…" : "Post"}
          </Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  );
}
