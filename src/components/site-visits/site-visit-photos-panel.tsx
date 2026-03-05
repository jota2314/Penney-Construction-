"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createSiteVisitFile, deleteSiteVisitFile } from "@/lib/actions/site-visit-files";
import { uploadSiteVisitFile } from "@/lib/uploads/upload-site-visit-file";
import { createClient } from "@/lib/supabase/client";
import { Camera, Trash2, Loader2 } from "lucide-react";
import type { SiteVisitFile } from "@/types/database";

interface SiteVisitPhotosPanelProps {
  siteVisitId: string;
  projectId: string;
  files: SiteVisitFile[];
}

export function SiteVisitPhotosPanel({
  siteVisitId,
  projectId,
  files: initialFiles,
}: SiteVisitPhotosPanelProps) {
  const [files, setFiles] = useState(initialFiles);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function getSignedUrl(storagePath: string) {
    const supabase = createClient();
    return supabase.storage
      .from("project-files")
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => data?.signedUrl ?? "");
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    setUploading(true);

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];

      // Upload to storage
      const uploadResult = await uploadSiteVisitFile(siteVisitId, file);
      if (uploadResult.error || !uploadResult.storagePath) continue;

      // Create DB record
      const dbResult = await createSiteVisitFile({
        site_visit_id: siteVisitId,
        storage_path: uploadResult.storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      });

      if (!dbResult.error && dbResult.file) {
        setFiles((prev) => [...prev, dbResult.file!]);
      }
    }

    setUploading(false);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(file: SiteVisitFile) {
    const result = await deleteSiteVisitFile(
      file.id,
      file.storage_path,
      siteVisitId
    );
    if (!result.error) {
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    }
  }

  return (
    <div className="space-y-4">
      {/* Camera button - large for mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <Button
        type="button"
        size="lg"
        className="w-full h-14 text-base"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Camera className="mr-2 h-5 w-5" />
            Take Photo
          </>
        )}
      </Button>

      {/* Also allow gallery pick on mobile */}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={uploading}
        onClick={() => {
          // Remove capture attribute and click
          if (fileInputRef.current) {
            fileInputRef.current.removeAttribute("capture");
            fileInputRef.current.click();
            // Restore capture for next camera use
            setTimeout(() => {
              fileInputRef.current?.setAttribute("capture", "environment");
            }, 1000);
          }
        }}
      >
        Choose from Gallery
      </Button>

      {/* Photo grid */}
      {files.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-4">
          No photos yet. Use the camera button above.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {files.map((file) => (
            <PhotoCard
              key={file.id}
              file={file}
              getSignedUrl={getSignedUrl}
              onDelete={() => handleDelete(file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoCard({
  file,
  getSignedUrl,
  onDelete,
}: {
  file: SiteVisitFile;
  getSignedUrl: (path: string) => Promise<string>;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load signed URL on mount
  useState(() => {
    getSignedUrl(file.storage_path).then(setUrl);
  });

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {url ? (
          <Image
            src={url}
            alt={file.file_name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, 33vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <CardContent className="p-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground truncate flex-1">
          {file.file_name}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            await onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
