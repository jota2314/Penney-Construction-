"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, X, Send, Loader2, Mic, Square, Sparkles } from "lucide-react";
import { postDailyLog } from "@/lib/actions/daily-logs";
import { enqueueDailyLogPhotos } from "@/lib/upload/daily-log-upload-queue";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetBody,
  BottomSheetFooter,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";

const MAX_PHOTOS = 50;

const ASSISTANT_GREETING_PATTERNS = [
  /^hi[.!,]?\s+i['’]?m\b/i,
  /^hello[.!,]?\s+i['’]?m\b/i,
  /^i['’]?m ready to help/i,
  /^sure[,!.]\s+here['’]?s\b/i,
  /^here['’]?s your\b/i,
  /tell me what happened/i,
  /go ahead and tell me/i,
];

function looksLikeAssistantGreeting(text: string): boolean {
  return ASSISTANT_GREETING_PATTERNS.some((re) => re.test(text.trim()));
}

export function DailyLogComposer({
  open,
  onOpenChange,
  phaseId,
  projectId,
  projectName,
  phaseName,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Schedule phase to log against — optional; a bare project works too. */
  phaseId?: string;
  /** Project to log against when there's no schedule phase. */
  projectId?: string;
  projectName: string;
  phaseName?: string;
}) {
  // Text the user typed manually + everything we've already polished. The
  // live mic transcript is rendered ON TOP of this without being saved
  // until the user stops, so we can replace the raw transcript with the
  // AI-polished version.
  const [savedText, setSavedText] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishFlash, setPolishFlash] = useState<"none" | "ok" | "empty">("none");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();

  // Capture the snapshot at the moment recording starts so we know which
  // chunk to replace when the AI polish comes back.
  const snapshotBeforeRecord = useRef<string>("");
  // Track whether the most recent transcript has been polished/finalised
  // so the post-stop effect runs exactly once per recording.
  const handlingStop = useRef<boolean>(false);

  const reset = () => {
    setSavedText("");
    photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setPhotoFiles([]);
    setPhotoPreviews([]);
    setError(null);
    setPosting(false);
    setPolishing(false);
    setPolishFlash("none");
    snapshotBeforeRecord.current = "";
    handlingStop.current = false;
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  // What's currently shown in the textarea: saved text + the in-progress
  // live transcript (with a blank line between them if both have content).
  const displayText = (() => {
    if (!isListening || !transcript.trim()) return savedText;
    const head = snapshotBeforeRecord.current;
    return head.trim() ? `${head.trim()}\n\n${transcript}` : transcript;
  })();

  // While recording, the textarea is read-only (the live transcript is
  // streaming in and would conflict with manual typing). When idle, the
  // user can edit anything — including AI-polished output.
  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isListening) return;
    setSavedText(e.target.value);
  };

  const onMicClick = () => {
    setError(null);
    setPolishFlash("none");
    if (isListening) {
      stopListening();
      return;
    }
    snapshotBeforeRecord.current = savedText;
    handlingStop.current = false;
    startListening();
  };

  // When recording stops, polish the freshly-recorded chunk and merge
  // it into savedText. Runs exactly once per recording session.
  useEffect(() => {
    if (isListening) return;
    if (handlingStop.current) return;
    const raw = transcript.trim();
    if (!raw) return;

    handlingStop.current = true;
    setPolishing(true);
    fetch("/api/structure-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: raw, context: "daily-log" }),
    })
      .then((r) => r.json())
      .then((data) => {
        const cleaned = typeof data.cleaned === "string" ? data.cleaned.trim() : "";
        const head = snapshotBeforeRecord.current.trim();
        const headOk = head ? `${head}\n\n` : "";
        if (data.empty || !cleaned || looksLikeAssistantGreeting(cleaned)) {
          // AI said "no real content" — drop the raw transcript on the
          // floor so we don't pollute the post with garbage.
          setSavedText(head);
          setPolishFlash("empty");
        } else {
          setSavedText(headOk + cleaned);
          setPolishFlash("ok");
        }
      })
      .catch(() => {
        // Network/AI failure — keep the raw transcript so the user
        // doesn't lose their words.
        const head = snapshotBeforeRecord.current.trim();
        const headOk = head ? `${head}\n\n` : "";
        setSavedText(headOk + raw);
        setPolishFlash("empty");
      })
      .finally(() => {
        setPolishing(false);
        setTimeout(() => setPolishFlash("none"), 2500);
      });
  }, [isListening, transcript]);

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
      // 1. Insert the daily_log row immediately with text + zero photos.
      //    The user can close the composer and keep working — photos
      //    upload in the background and append themselves to the row
      //    as each one finishes.
      const result = await postDailyLog({ phaseId, projectId }, savedText, [], photoFiles.length);
      if (result.error || !result.logId) {
        setError(result.error || "Failed to post");
        setPosting(false);
        return;
      }

      // 2. Hand the photos to the global upload queue. Returns
      //    immediately; uploads happen in the background.
      if (photoFiles.length > 0) {
        enqueueDailyLogPhotos(result.logId, photoFiles);
      }

      // 3. Close the composer right away — uploads continue without it.
      router.refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
      setPosting(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent
        className="max-h-[92dvh]"
        // Don't let Radix auto-focus the textarea on open — that pops
        // the iOS keyboard and hides the Voice/Photos/Post buttons.
        // The user can tap the textarea explicitly when they want to type.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <BottomSheetHeader>
          <BottomSheetTitle>Log work · {projectName}</BottomSheetTitle>
          <p className="text-xs text-muted-foreground">{phaseName ?? "Daily update — photos + notes"}</p>
        </BottomSheetHeader>
        <BottomSheetBody className="flex flex-col gap-3">
          <div className="relative">
            <textarea
              value={displayText}
              onChange={onTextareaChange}
              readOnly={isListening || polishing}
              rows={6}
              placeholder="Tap the mic and talk — words appear here live, then AI polishes when you stop. Or just type."
              className={`w-full rounded-lg border p-3 pr-10 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-1 ${
                isListening
                  ? "border-red-500/40 bg-red-500/5 text-zinc-100 ring-red-500/30"
                  : polishing
                    ? "border-amber-500/40 bg-amber-500/5 text-zinc-100"
                    : "border-zinc-700 bg-zinc-900 text-zinc-100 focus:ring-amber-500/40"
              }`}
            />
            {isListening && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                Listening
              </span>
            )}
            {polishing && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                <Sparkles className="h-3 w-3 animate-pulse" />
                Polishing
              </span>
            )}
            {polishFlash === "ok" && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                <Sparkles className="h-3 w-3" />
                AI polished
              </span>
            )}
            {polishFlash === "empty" && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-zinc-700/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-300">
                Didn&apos;t catch that
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isSupported ? (
              <button
                type="button"
                onClick={onMicClick}
                disabled={polishing || posting}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition active:scale-[0.98] ${
                  isListening
                    ? "bg-red-500/15 text-red-400 border border-red-500/40"
                    : polishing
                      ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                      : "bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
                }`}
              >
                {polishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isListening ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                <span>
                  {polishing ? "Polishing…" : isListening ? "Stop" : "Voice note"}
                </span>
              </button>
            ) : (
              <span className="text-xs text-zinc-500 self-center">Voice not supported</span>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isListening || polishing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              <span>Photos</span>
              {photoFiles.length > 0 && (
                <span className="text-xs text-zinc-400">{photoFiles.length}/{MAX_PHOTOS}</span>
              )}
            </button>
            {savedText && !isListening && !polishing && (
              <button
                type="button"
                onClick={() => setSavedText("")}
                className="ml-auto text-xs text-zinc-400 hover:text-zinc-200"
              >
                Clear
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
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
          <Button
            onClick={post}
            disabled={posting || isListening || polishing || (!savedText.trim() && photoFiles.length === 0)}
          >
            {posting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {posting ? "Posting…" : photoFiles.length > 0 ? `Post ${photoFiles.length} photo${photoFiles.length > 1 ? "s" : ""}` : "Post"}
          </Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  );
}
