"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { HeaderAction, PortalHeader, PortalTheme } from "@/components/portal-kit";
import { MAX_GUEST_PHOTOS, MAX_GUEST_REQUEST_BYTES, prepareGuestPhoto } from "@/lib/site-qr/prepare-photo";

type Photo = { id: string; blob: Blob; preview: string };
export type GuestSiteProject = { name: string; number: string; town: string | null };

/** The QR's default experience: choose photos and post. No account or PIN. */
export function GuestSitePhotos({ code, project }: { code: string; project: GuestSiteProject }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false);
  const submissionId = useRef<string | null>(null);
  const uncertainResponse = useRef(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview));
    };
  }, []);

  function updatePhotos(next: Photo[]) {
    photosRef.current = next;
    setPhotos(next);
  }

  async function choosePhotos(files: File[]) {
    if (postingRef.current || preparing || locked) return;
    const room = MAX_GUEST_PHOTOS - photosRef.current.length;
    if (room <= 0) return;
    setPreparing(true);
    setPosted(false);
    setError(files.length > room ? `Add up to ${MAX_GUEST_PHOTOS} photos in one post. You can post more afterward.` : null);
    for (const file of files.slice(0, room)) {
      if (!mounted.current) return;
      try {
        const blob = await prepareGuestPhoto(file);
        if (!mounted.current) return;
        updatePhotos([...photosRef.current, { id: crypto.randomUUID(), blob, preview: URL.createObjectURL(blob) }]);
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : "Couldn't prepare that photo. Try another.");
      }
    }
    if (mounted.current) setPreparing(false);
  }

  function removePhoto(id: string) {
    if (postingRef.current || preparing || locked) return;
    const removed = photosRef.current.find((photo) => photo.id === id);
    if (removed) URL.revokeObjectURL(removed.preview);
    updatePhotos(photosRef.current.filter((photo) => photo.id !== id));
    setError(null);
  }

  async function postPhotos() {
    if (postingRef.current || preparing || photosRef.current.length === 0) return;
    const selected = photosRef.current;
    if (selected.reduce((sum, photo) => sum + photo.blob.size, 0) > MAX_GUEST_REQUEST_BYTES - 32 * 1024) {
      setError("These photos are too large together. Remove a photo and try again.");
      return;
    }
    postingRef.current = true;
    setPosting(true);
    setLocked(true);
    setError(null);
    submissionId.current ??= crypto.randomUUID();
    const body = new FormData();
    body.set("code", code);
    body.set("submissionId", submissionId.current);
    body.set("name", name.trim());
    body.set("note", note.trim());
    body.set("website", website);
    selected.forEach((photo, index) => body.append("photos", photo.blob, `site-photo-${index + 1}.jpg`));
    let definitiveRejection = false;
    try {
      const response = await fetch("/api/site-photos", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok || !result?.ok) {
        definitiveRejection = response.status >= 400 && response.status < 500 && typeof result?.error === "string";
        if (definitiveRejection && !uncertainResponse.current) {
          // The server definitely refused this attempt before a save. Let
          // the worker replace a rejected photo or correct the optional text.
          submissionId.current = null;
          setLocked(false);
        }
        throw new Error(result?.error || "We couldn't confirm the upload. Your photos are still here—tap Try again.");
      }
      selected.forEach((photo) => URL.revokeObjectURL(photo.preview));
      updatePhotos([]);
      submissionId.current = null;
      uncertainResponse.current = false;
      setLocked(false);
      setNote("");
      setPosted(true);
    } catch (cause) {
      // Keep the same photos and request ID after an uncertain response, so
      // Retry cannot duplicate a saved post or silently omit changed photos.
      if (!definitiveRejection) uncertainResponse.current = true;
      if (!mounted.current) return;
      setError(cause instanceof Error && !(cause instanceof TypeError)
        ? cause.message
        : "No signal. Your photos are still here—tap Try again.");
    } finally {
      postingRef.current = false;
      if (mounted.current) setPosting(false);
    }
  }

  const disabled = preparing || posting || locked;
  return (
    <PortalTheme variant="field">
      <PortalHeader title="Job photos" safeTop right={<HeaderAction href="tel:9786214387" label="Call" ariaLabel="Call the Penney office" />} />
      <main className="mx-auto w-full max-w-md space-y-5 px-4 py-5 pc-safe-bottom">
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight">{project.name}</h1>
          <p className="mt-1 text-[15px] text-[var(--muted)]">{project.number}{project.town ? ` · ${project.town}` : ""}</p>
          <p className="mt-3 text-[17px] font-bold">Add photos. Tap Post. That&apos;s it.</p>
          <p className="mt-1 text-[15px] text-[var(--muted)]">No account or PIN needed.</p>
        </div>

        {posted && <div role="status" className="card flex gap-3 p-4 text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
          <div><p className="font-extrabold">Photos posted</p><p className="mt-1 text-sm">Saved to {project.name}. You&apos;re all set.</p></div>
        </div>}

        <section className="card space-y-4 p-4" aria-label="Post job photos">
          <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" aria-label="Choose job photos" disabled={disabled}
            onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void choosePhotos(files); }} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled || photos.length >= MAX_GUEST_PHOTOS} className="btn btn-ghost btn-lg btn-block">
            {preparing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            {preparing ? "Getting photos ready…" : posted ? "Add more photos" : "Add photos"}
          </button>
          {photos.length === 0 && !preparing && <p className="text-center text-sm text-[var(--muted)]">Take a picture or choose from your photo library.</p>}
          {photos.length > 0 && <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => <div key={photo.id} className="relative aspect-square overflow-hidden rounded-xl bg-stone-100">
              {/* eslint-disable-next-line @next/next/no-img-element -- local image preview, never a remote file */}
              <img src={photo.preview} alt={`Selected photo ${index + 1}`} className="h-full w-full object-cover" />
              <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => removePhoto(photo.id)} disabled={disabled} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-bl-xl bg-black/70 text-white disabled:hidden"><X className="h-5 w-5" /></button>
            </div>)}
          </div>}
          {photos.length > 0 && <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold text-[var(--muted)]">Add your name or a note (optional)</summary>
            <div className="mt-2 space-y-3">
              <label className="block text-sm font-semibold">Your name or company
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={disabled} autoComplete="name" className="mt-1 min-h-12 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-[16px]" />
              </label>
              <label className="block text-sm font-semibold">Note
                <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={disabled} rows={3} className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white p-3 text-[16px]" />
              </label>
            </div>
          </details>}
          <div className="hidden" aria-hidden><label>Website<input name="website" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label></div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
          {photos.length > 0 && <button type="button" onClick={() => void postPhotos()} disabled={preparing || posting} aria-busy={posting} className="btn btn-primary btn-lg btn-block">
            {posting && <Loader2 className="h-5 w-5 animate-spin" />}
            {posting ? "Posting photos…" : locked ? "Try again" : `Post ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
          </button>}
          {posting && <p role="status" className="text-center text-sm text-[var(--muted)]">Keep this page open until your photos are posted.</p>}
        </section>

        <a href={`/sub/j/${encodeURIComponent(code)}?tools=1`} className="block py-2 text-center text-sm text-[var(--muted)] underline underline-offset-2">Project tools / drawings</a>
      </main>
    </PortalTheme>
  );
}
