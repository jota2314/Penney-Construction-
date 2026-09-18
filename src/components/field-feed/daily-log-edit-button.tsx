"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Images, Pencil, X } from "lucide-react";
import { enqueueDailyLogPhotos } from "@/lib/upload/daily-log-upload-queue";
import { editDailyLog } from "@/lib/actions/daily-logs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { v } from "./tokens";

export function DailyLogEditButton({ logId, text, onSaved }: {
  logId: string;
  text: string | null;
  onSaved: (text: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, []);

  function clearPhotos() {
    previewUrls.current.splice(0).forEach(url => URL.revokeObjectURL(url));
    setPhotos([]);
    setPreviews([]);
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (photos.length + selected.length > 50) {
      setError("Add up to 50 photos at a time.");
      return;
    }
    setPhotos(current => [...current, ...selected]);
    const urls = selected.map(file => URL.createObjectURL(file));
    previewUrls.current.push(...urls);
    setPreviews(current => [...current, ...urls]);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        if (draft !== (originalText ?? "")) {
          const result = await editDailyLog({ logId, text: draft, originalText });
          if (!result.ok) { setError(result.error); return; }
          onSaved(result.text);
          setOriginalText(result.text);
          setDraft(result.text);
        }
        // Persist the files before closing. If this fails, keep selections so
        // retry can enqueue them without re-saving already committed text.
        if (photos.length) await enqueueDailyLogPhotos(logId, photos);
        clearPhotos();
        setOpen(false);
        router.refresh();
      } catch {
        setError("Could not save the daily log. Your edits are still here; try again.");
      }
    });
  }

  return <>
    <button type="button" aria-label="Edit daily log"
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold"
      style={{ color: v("accent") }}
      onClick={() => { setDraft(text ?? ""); setOriginalText(text); clearPhotos(); setError(null); setOpen(true); }}>
      <Pencil className="h-3.5 w-3.5" /> Edit
    </button>
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto"
        onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Edit daily log</DialogTitle>
          <DialogDescription>Update the details or add more photos. Existing photos stay on the log.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">
            <span>Daily log details</span>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)}
              rows={5} maxLength={20000} disabled={pending}
              className="w-full rounded-md border bg-background p-3 text-base font-normal" />
          </label>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden disabled={pending}
            onChange={event => { addPhotos(event.target.files); event.target.value = ""; }} />
          <input ref={libraryRef} type="file" accept="image/*" multiple hidden disabled={pending}
            onChange={event => { addPhotos(event.target.files); event.target.value = ""; }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => cameraRef.current?.click()}><Camera className="h-4 w-4" /> Take photo</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => libraryRef.current?.click()}><Images className="h-4 w-4" /> Add photos</Button>
          </div>
          {photos.length > 0 && <div className="space-y-2">
            <p className="text-sm">{photos.length} new {photos.length === 1 ? "photo" : "photos"} ready to upload</p>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((file, index) => <div key={index} className="relative overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[index]} alt={file.name} className="aspect-square w-full object-cover" />
                <button type="button" aria-label={`Remove new photo ${index + 1}`} disabled={pending}
                  className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white"
                  onClick={() => {
                    URL.revokeObjectURL(previews[index]);
                    setPhotos(current => current.filter((_, i) => i !== index));
                    setPreviews(current => current.filter((_, i) => i !== index));
                  }}><X className="h-4 w-4" /></button>
              </div>)}
            </div>
            <p className="text-xs text-muted-foreground">Photos upload after saving. Keep the app open until uploads finish.</p>
          </div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => { clearPhotos(); setOpen(false); }}>Cancel</Button>
            <Button type="submit" disabled={pending || (!photos.length && draft === (originalText ?? "")) || (draft !== (originalText ?? "") && !draft.trim())}>{pending ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
