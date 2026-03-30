"use client";

import { useState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Ruler,
  Upload,
  Loader2,
  Eye,
  Download,
  Trash2,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Mail,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { uploadProjectFile, deleteProjectFile } from "@/lib/actions/project-files";
import type { ProjectFile as DBProjectFile } from "@/types/database";

interface EmailDrawing {
  filename: string;
  size: number;
  storage_path: string;
  emailSubject: string;
  emailDate: string;
}

interface ProjectDrawingsProps {
  projectId: string;
  drawings: DBProjectFile[];
  emailDrawings?: EmailDrawing[];
}

export function ProjectDrawings({ projectId, drawings: initialDrawings, emailDrawings = [] }: ProjectDrawingsProps) {
  const [drawings, setDrawings] = useState(initialDrawings);
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
        formData.set("category", "construction_drawings");
        const result = await uploadProjectFile(projectId, formData);
        if (!result.error) {
          const supabase = createClient();
          const { data } = await supabase
            .from("project_files")
            .select("*")
            .eq("project_id", projectId)
            .eq("category", "construction_drawings")
            .order("created_at", { ascending: false });
          if (data) setDrawings(data);
        }
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleDelete(fileId: string) {
    startTransition(async () => {
      const result = await deleteProjectFile(fileId, projectId);
      if (result.success) {
        setDrawings(prev => prev.filter(f => f.id !== fileId));
      }
    });
  }

  // Files saved via AI from email attachments have paths like "19d30.../file.pdf" (email-attachments bucket)
  // Files uploaded directly have paths like "projectId/category/file.pdf" (project-files bucket)
  function getBucket(storagePath: string) {
    return storagePath.startsWith(projectId) ? "project-files" : "email-attachments";
  }

  async function handlePreviewUploaded(file: DBProjectFile) {
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mime_type || "");
    const supabase = createClient();
    const { data } = await supabase.storage.from(getBucket(file.storage_path)).createSignedUrl(file.storage_path, 3600);
    if (data?.signedUrl) {
      if (file.mime_type?.includes("pdf") || file.mime_type?.startsWith("image/")) {
        setPreviewUrl(data.signedUrl);
      } else {
        window.open(data.signedUrl, "_blank");
      }
    }
  }

  async function handlePreviewEmail(drawing: EmailDrawing) {
    setPreviewFilename(drawing.filename);
    setPreviewMimeType("application/pdf");
    const supabase = createClient();
    const { data } = await supabase.storage.from("email-attachments").createSignedUrl(drawing.storage_path, 3600);
    if (data?.signedUrl) setPreviewUrl(data.signedUrl);
  }

  async function handleDownloadEmail(drawing: EmailDrawing) {
    const supabase = createClient();
    const { data } = await supabase.storage.from("email-attachments").createSignedUrl(drawing.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function handleDownloadUploaded(file: DBProjectFile) {
    const supabase = createClient();
    const { data } = await supabase.storage.from(getBucket(file.storage_path)).createSignedUrl(file.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const totalCount = drawings.length + emailDrawings.length;

  return (
    <div className="space-y-4">
      {/* Upload bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
            <Ruler className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Construction Drawings</h2>
            <p className="text-[10px] text-muted-foreground">Plans, blueprints, construction docs</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{totalCount} files</Badge>
          <Button onClick={handleUploadClick} disabled={isPending} size="sm" className="gap-1.5">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload Drawing
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelected}
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.dwg,.dxf,.tiff,.tif"
        />
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Ruler className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="font-medium text-muted-foreground">No drawings yet</h3>
          <p className="text-sm text-muted-foreground/70 mt-1">Upload construction drawings, or they&apos;ll appear here from project emails</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Uploaded drawings */}
          {drawings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Upload className="h-3 w-3" /> Uploaded
                <Badge variant="secondary" className="text-[9px]">{drawings.length}</Badge>
              </h3>
              <div className="grid gap-2">
                {drawings.map((file) => {
                  const isPdf = file.mime_type?.includes("pdf");
                  const isImage = file.mime_type?.startsWith("image/");
                  return (
                    <div key={file.id} className="border rounded-lg p-3 bg-card space-y-2">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg shrink-0 ${isPdf ? "bg-red-500/10" : isImage ? "bg-blue-500/10" : "bg-muted"}`}>
                          {isPdf ? <FileText className="h-5 w-5 text-red-400" /> :
                           isImage ? <ImageIcon className="h-5 w-5 text-blue-400" /> :
                           <Paperclip className="h-5 w-5 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.filename}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatSize(file.size)} &middot; uploaded {formatDate(file.created_at)}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500/50 hover:text-red-500 shrink-0" onClick={() => handleDelete(file.id)} disabled={isPending}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex gap-1.5">
                        {(isPdf || isImage) && (
                          <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handlePreviewUploaded(file)}>
                            <Eye className="h-3 w-3 mr-1" /> Preview
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handleDownloadUploaded(file)}>
                          <Download className="h-3 w-3 mr-1" /> Download
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Email attachment drawings */}
          {emailDrawings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Mail className="h-3 w-3" /> From Emails
                <Badge variant="secondary" className="text-[9px]">{emailDrawings.length}</Badge>
              </h3>
              <div className="grid gap-2">
                {emailDrawings.map((drawing, idx) => (
                  <div key={`email-${drawing.storage_path}-${idx}`} className="border rounded-lg p-3 bg-card space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg shrink-0 bg-red-500/10">
                        <FileText className="h-5 w-5 text-red-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{drawing.filename}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatSize(drawing.size)} &middot; from &quot;{drawing.emailSubject}&quot; &middot; {formatDate(drawing.emailDate)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handlePreviewEmail(drawing)}>
                        <Eye className="h-3 w-3 mr-1" /> Preview
                      </Button>
                      <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handleDownloadEmail(drawing)}>
                        <Download className="h-3 w-3 mr-1" /> Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PDF Preview */}
      {previewUrl && previewMimeType?.includes("pdf") && (
        <PdfViewer url={previewUrl} filename={previewFilename} onClose={() => setPreviewUrl(null)} />
      )}

      {/* Image Preview */}
      <Dialog open={!!previewUrl && !!previewMimeType?.startsWith("image/")} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="w-full h-full sm:max-w-4xl sm:h-[85vh] flex flex-col p-0 gap-0 rounded-none sm:rounded-lg">
          <DialogHeader className="p-3 pb-2 space-y-0">
            <DialogTitle className="text-sm font-medium truncate pr-8">{previewFilename}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-3 pb-3 flex items-center justify-center">
            {previewUrl && <img src={previewUrl} alt={previewFilename} className="max-w-full max-h-full object-contain" />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
