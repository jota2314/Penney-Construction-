"use client";

import { useState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  Upload,
  Loader2,
  Eye,
  Download,
  Trash2,
  FileText,
  Image as ImageIcon,
  Paperclip,
  BookOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { ImageViewer } from "@/components/ui/image-viewer";
import { formatDate } from "@/lib/utils";
import { uploadProjectFile, deleteProjectFile } from "@/lib/actions/project-files";
import type { ProjectFile as DBProjectFile } from "@/types/database";

interface ProjectPricingProps {
  projectId: string;
  files: DBProjectFile[];
}

export function ProjectPricing({ projectId, files: initialFiles }: ProjectPricingProps) {
  const [files, setFiles] = useState(initialFiles);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    startTransition(async () => {
      for (const file of Array.from(selectedFiles)) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("category", "pricing");
        const result = await uploadProjectFile(projectId, formData);
        if (!result.error) {
          const supabase = createClient();
          const { data } = await supabase
            .from("project_files")
            .select("*")
            .eq("project_id", projectId)
            .in("category", ["pricing", "specs"])
            .order("created_at", { ascending: false });
          if (data) setFiles(data);
        }
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleDelete(fileId: string) {
    startTransition(async () => {
      const result = await deleteProjectFile(fileId, projectId);
      if (result.success) {
        setFiles(prev => prev.filter(f => f.id !== fileId));
      }
    });
  }

  async function handlePreview(file: DBProjectFile) {
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mime_type || "");
    const supabase = createClient();
    const { data } = await supabase.storage.from("project-files").createSignedUrl(file.storage_path, 3600);
    if (data?.signedUrl) {
      if (file.mime_type?.includes("pdf") || file.mime_type?.startsWith("image/")) {
        setPreviewUrl(data.signedUrl);
      } else {
        window.open(data.signedUrl, "_blank");
      }
    }
  }

  async function handleDownload(file: DBProjectFile) {
    const supabase = createClient();
    const { data } = await supabase.storage.from("project-files").createSignedUrl(file.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const CATEGORY_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
    pricing: { icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-green-500/10 text-green-400" },
    specs: { icon: <BookOpen className="h-3.5 w-3.5" />, color: "bg-purple-500/10 text-purple-400" },
  };

  return (
    <div className="space-y-4">
      {/* Upload bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-green-500/15 flex items-center justify-center">
            <DollarSign className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Pricing & Specs</h2>
            <p className="text-[10px] text-muted-foreground">Pricing guidelines, specs, rates</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{files.length} files</Badge>
          <Button onClick={handleUploadClick} disabled={isPending} size="sm" className="gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload File
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelected}
          accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp"
        />
      </div>

      {/* Files list */}
      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <DollarSign className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="font-medium text-muted-foreground">No pricing or spec files</h3>
          <p className="text-sm text-muted-foreground/70 mt-1">Upload pricing guidelines, specifications, or rate sheets</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {files.map((file) => {
            const isPdf = file.mime_type?.includes("pdf");
            const isImage = file.mime_type?.startsWith("image/");
            const catConfig = CATEGORY_ICON[file.category] ?? CATEGORY_ICON.pricing;

            return (
              <div key={file.id} className="border rounded-lg p-3 bg-card space-y-2">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${isPdf ? "bg-red-500/10" : isImage ? "bg-blue-500/10" : "bg-muted"}`}>
                    {isPdf ? <FileText className="h-5 w-5 text-red-400" /> :
                     isImage ? <ImageIcon className="h-5 w-5 text-blue-400" /> :
                     <Paperclip className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{file.filename}</p>
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${catConfig.color}`}>
                        {catConfig.icon}
                        <span className="ml-1 capitalize">{file.category}</span>
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {formatSize(file.size)} &middot; uploaded {formatDate(file.created_at)}
                    </p>
                    {file.description && <p className="text-[10px] text-muted-foreground/70">{file.description}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-500/50 hover:text-red-500 shrink-0"
                    onClick={() => handleDelete(file.id)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex gap-1.5">
                  {(isPdf || isImage) && (
                    <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handlePreview(file)}>
                      <Eye className="h-3 w-3 mr-1" /> Preview
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handleDownload(file)}>
                    <Download className="h-3 w-3 mr-1" /> Download
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PDF Preview */}
      {previewUrl && previewMimeType?.includes("pdf") && (
        <PdfViewer url={previewUrl} filename={previewFilename} onClose={() => setPreviewUrl(null)} />
      )}

      {/* Image Preview */}
      {previewMimeType?.startsWith("image/") && (
        <ImageViewer
          url={previewUrl}
          filename={previewFilename}
          onClose={() => setPreviewUrl(null)}
        />
      )}
    </div>
  );
}
