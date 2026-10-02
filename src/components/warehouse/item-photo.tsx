"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageOff, Loader2, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageViewer } from "@/components/ui/image-viewer";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/image/compress";
import { cn } from "@/lib/utils";
import {
  PHOTO_MAX_EDGE,
  THUMB_MAX_EDGE,
  warehousePhotoPaths,
} from "@/lib/warehouse/checkouts";
import {
  removeWarehouseItemPhoto,
  setWarehouseItemPhoto,
} from "@/lib/actions/warehouse";

const BUCKET = "warehouse-photos";

/** Small square thumbnail for list rows, with a placeholder when there's no photo. */
export function ItemThumb({
  url,
  name,
  className,
}: {
  url: string | null | undefined;
  name: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!url && failedUrl !== url;
  const isCatalogReference = url?.includes("/catalogref") ?? false;

  return (
    <div
      className={cn(
        "relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/40 flex items-center justify-center",
        className
      )}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
          className="h-full w-full object-contain"
        />
      ) : (
        <ImageOff className="h-5 w-5 text-muted-foreground/50" aria-label="No photo" />
      )}
      {showPhoto && isCatalogReference && (
        <span title="Catalog reference photo" aria-label="Catalog reference photo" className="absolute bottom-0 right-0 rounded-tl bg-background/90 px-1 text-[9px] leading-3 text-muted-foreground">Ref</span>
      )}
    </div>
  );
}

/**
 * The item page photo: full size, tap to enlarge, and — for warehouse staff
 * and admins — Add / Replace / Remove. On a phone the file input offers the
 * camera or the photo library (no `capture` attribute, so both). The browser
 * shrinks the shot to ~1600px + a small list thumbnail before uploading.
 */
export function ItemPhotoCard({
  itemId,
  itemName,
  photoUrl,
  photoPath,
  canManage,
}: {
  itemId: string;
  itemName: string;
  photoUrl: string | null;
  photoPath?: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!photoUrl && failedUrl !== photoUrl;
  const isCatalogReference = (photoPath ?? photoUrl)?.includes("/catalogref") ?? false;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("Preparing photo...");
    let photo: Blob;
    let thumb: Blob;
    try {
      photo = await compressImage(file, PHOTO_MAX_EDGE, 0.82);
      thumb = await compressImage(file, THUMB_MAX_EDGE, 0.75);
    } catch {
      setBusy(null);
      setError("Couldn't read that photo. Try a JPEG or PNG.");
      return;
    }

    setBusy("Uploading...");
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const paths = warehousePhotoPaths(itemId, stamp);
    const supabase = createClient();
    const storage = supabase.storage.from(BUCKET);
    const [up1, up2] = await Promise.all([
      storage.upload(paths.photo, photo, { contentType: "image/jpeg", upsert: false }),
      storage.upload(paths.thumb, thumb, { contentType: "image/jpeg", upsert: false }),
    ]);
    if (up1.error || up2.error) {
      await storage.remove([paths.photo, paths.thumb]).catch(() => {});
      setBusy(null);
      setError(up1.error?.message || up2.error?.message || "Upload failed");
      return;
    }

    const result = await setWarehouseItemPhoto(itemId, {
      photoPath: paths.photo,
      thumbPath: paths.thumb,
    });
    if (result.error) {
      await storage.remove([paths.photo, paths.thumb]).catch(() => {});
      setBusy(null);
      setError(result.error);
      return;
    }
    setBusy(null);
    router.refresh();
  };

  const handleRemove = async () => {
    if (!confirm(`Remove the photo of "${itemName}"?`)) return;
    setError(null);
    setBusy("Removing...");
    const result = await removeWarehouseItemPhoto(itemId);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <Card className="p-3 sm:p-4">
      {showPhoto ? (
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="block w-full overflow-hidden rounded-md bg-muted/40"
          aria-label={`Enlarge photo of ${itemName}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt={itemName}
            onError={() => setFailedUrl(photoUrl)}
            className="mx-auto max-h-[420px] w-auto object-contain"
          />
        </button>
      ) : (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground">
          <ImageOff className="h-8 w-8 opacity-50" />
          <p className="text-sm">{photoUrl ? "Photo unavailable" : "No photo yet"}</p>
        </div>
      )}

      {isCatalogReference && (
        <div className="mt-3 text-xs text-muted-foreground">
          <p className="font-medium">Catalog reference photo</p>
          <p className="mt-1">Use the item label to confirm size, finish and model.</p>
        </div>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void handleFile(file);
            }}
          />
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={!!busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Camera className="h-4 w-4 mr-1" />
            )}
            {busy ?? (photoUrl ? "Replace photo" : "Add photo")}
          </Button>
          {photoUrl && !busy && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-500 hover:text-red-600"
              onClick={handleRemove}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Remove photo
            </Button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {viewerOpen && showPhoto && photoUrl && (
        <ImageViewer url={photoUrl} filename={itemName} onClose={() => setViewerOpen(false)} />
      )}
    </Card>
  );
}
