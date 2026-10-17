"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/image/compress";

// The picture on a design/drawing document that the client portal's Home tab
// opens on (client_portal_documents.cover_bucket/cover_path). It follows the
// document's publish state, so on a published document every change here is
// something the client sees: those go through the same two-step confirm as
// Publish. Picked files and uploads are both shrunk to a ~1600px JPG and
// stored as their own copy, so the client's phone never pulls a multi-MB
// original and deleting the source file can't break the Home tab.

export const COVER_BUCKET = "project-files";
const COVER_MAX_EDGE = 1600;

export interface CoverImageFile { id: string; filename: string; storage_bucket: string | null; storage_path: string }
export interface CoverDoc { id: string; live: boolean; cover_bucket: string | null; cover_path: string | null }
type Cover = { bucket: string; path: string } | null;

/** Storage + row access. The Portal tab uses the signed-in browser client;
 * the seam exists so the control can be exercised without a session. */
export interface CoverStore {
  read(bucket: string, path: string): Promise<Blob>;
  write(path: string, image: Blob): Promise<void>;
  link(bucket: string, path: string): Promise<string | null>;
  setCover(documentId: string, cover: Cover): Promise<void>;
}

export function browserCoverStore(): CoverStore {
  const supabase = createClient();
  return {
    async read(bucket, path) {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) throw new Error(error?.message || "Could not open that file");
      return data;
    },
    async write(path, image) {
      const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, image, { contentType: "image/jpeg" });
      if (error) throw new Error(error.message);
    },
    async link(bucket, path) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },
    async setCover(documentId, cover) {
      const { error } = await supabase.from("client_portal_documents")
        .update({ cover_bucket: cover?.bucket ?? null, cover_path: cover?.path ?? null, updated_at: new Date().toISOString() })
        .eq("id", documentId);
      if (error) throw new Error(error.message);
    },
  };
}

export const coverPathFor = (projectId: string, documentId: string) =>
  `uploads/${projectId}/portal/covers/${documentId}-${Date.now()}.jpg`;

export function PortalDocumentCover({
  projectId, doc, imageFiles, note, store, disabled, onChanged,
}: {
  projectId: string;
  doc: CoverDoc;
  imageFiles: CoverImageFile[];
  /** Where this picture shows (e.g. "On the client's Home"). */
  note?: string;
  store?: CoverStore;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const [s] = useState(() => store ?? browserCoverStore());
  const [thumb, setThumb] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ blob: Blob; preview: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    if (doc.cover_bucket && doc.cover_path) {
      s.link(doc.cover_bucket, doc.cover_path).then((u) => { if (alive) setThumb(u); });
    } else {
      setThumb(null);
    }
    return () => { alive = false; };
  }, [s, doc.cover_bucket, doc.cover_path]);

  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.preview); }, [pending]);

  async function shrink(source: Blob | Promise<Blob>, label: string) {
    setWorking(label);
    setError(null);
    try {
      const blob = await compressImage(await source, COVER_MAX_EDGE);
      setPending({ blob, preview: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error && e.message !== "Could not decode image"
        ? e.message : "Couldn't read that image. Use a JPG or PNG.");
    } finally {
      setWorking(null);
    }
  }

  function pickFile(fileId: string) {
    const f = imageFiles.find((x) => x.id === fileId);
    if (f) shrink(s.read(f.storage_bucket || COVER_BUCKET, f.storage_path), "pick");
  }

  async function save(cover: Cover, label: string) {
    setWorking(label);
    setError(null);
    try {
      if (cover === null) {
        await s.setCover(doc.id, null);
      } else {
        await s.write(cover.path, pending!.blob);
        await s.setCover(doc.id, cover);
      }
      setPending(null);
      setOpen(false);
      setConfirmRemove(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the picture");
    } finally {
      setWorking(null);
    }
  }

  const off = disabled || !!working;
  const spin = (label: string) => working === label && <Loader2 className="h-3.5 w-3.5 animate-spin" />;

  return (
    <div className="mt-2 rounded-md bg-muted/40 p-2">
      <div className="flex flex-wrap items-center gap-2.5">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="Home picture" className="aspect-[3/2] h-12 shrink-0 rounded border object-cover" />
        ) : (
          <div className="flex aspect-[3/2] h-12 shrink-0 items-center justify-center rounded border border-dashed text-muted-foreground">
            <ImagePlus className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-[9rem] flex-1">
          <p className="text-xs font-medium">{doc.cover_path ? "Home picture" : "No Home picture"}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {doc.cover_path ? note : "The client's Home tab opens on this picture."}
          </p>
        </div>
        {!pending && !confirmRemove && (
          <div className="ml-auto flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={off} onClick={() => { setOpen(!open); setError(null); }}>
              {doc.cover_path ? "Change" : "Add picture"}
            </Button>
            {doc.cover_path && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" disabled={off}
                onClick={() => (doc.live ? setConfirmRemove(true) : save(null, "remove"))}>
                {spin("remove") || <Trash2 className="h-3.5 w-3.5" />} Remove
              </Button>
            )}
          </div>
        )}
      </div>

      {confirmRemove && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">The client sees this document. Take the picture off their Home?</span>
          <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={off} onClick={() => save(null, "remove")}>
            {spin("remove")} Yes, take the picture off
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</Button>
        </div>
      )}

      {open && !pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value="" disabled={off} onChange={(e) => pickFile(e.target.value)}
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs">
            <option value="">{imageFiles.length ? "Pick an image from this project's files…" : "No images in this project's files"}</option>
            {imageFiles.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={off} onClick={() => uploadRef.current?.click()}>
            {spin("upload") || <Upload className="h-3.5 w-3.5" />} Upload
          </Button>
          {spin("pick")}
          <input ref={uploadRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) shrink(f, "upload"); }} />
        </div>
      )}

      {pending && (
        <div className="mt-2 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending.preview} alt="New Home picture" className="aspect-[3/2] w-full max-w-xs rounded border object-cover" />
          {doc.live && <p className="text-xs text-muted-foreground">The client sees this document, so this picture goes on their Home right away.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={off}
              onClick={() => save({ bucket: COVER_BUCKET, path: coverPathFor(projectId, doc.id) }, "save")}>
              {spin("save")} {doc.live ? "Yes, the client sees this picture" : "Use this picture"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={working === "save"} onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}
