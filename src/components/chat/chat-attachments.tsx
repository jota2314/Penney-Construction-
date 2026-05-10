"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Paperclip,
  Upload,
  FolderOpen,
  X,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  File,
  Loader2,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export interface ChatAttachment {
  type: "upload" | "drive";
  filename: string;
  mimeType: string;
  storagePath?: string;   // For uploaded files
  driveFileId?: string;   // For Drive files
  driveLink?: string;     // For Drive files
  size?: number;
}

interface ChatAttachmentsProps {
  attachments: ChatAttachment[];
  onAttachmentsChange: (attachments: ChatAttachment[]) => void;
  projectId?: string;
  disabled?: boolean;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  size?: string;
  modifiedTime?: string;
}

function fileIcon(mimeType: string) {
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FileSpreadsheet;
  if (mimeType.includes("image")) return ImageIcon;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text")) return FileText;
  return File;
}

function friendlyType(mimeType: string): string {
  if (mimeType.includes("folder")) return "Folder";
  if (mimeType.includes("spreadsheet")) return "Sheet";
  if (mimeType.includes("document")) return "Doc";
  if (mimeType.includes("presentation")) return "Slides";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("image")) return "Image";
  return "";
}

export function ChatAttachments({ attachments, onAttachmentsChange, projectId, disabled }: ChatAttachmentsProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const removeAttachment = (idx: number) => {
    onAttachmentsChange(attachments.filter((_, i) => i !== idx));
  };

  // ── File Upload ──
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    setPopoverOpen(false);
    const supabase = createClient();

    // Collect every successful upload, then commit once.
    // Calling onAttachmentsChange inside the loop with [...attachments, file]
    // races: the closure `attachments` is stale, so each new file overwrites
    // the previous one — only the last file selected ever persists.
    const newAttachments: ChatAttachment[] = [];
    for (const file of Array.from(files)) {
      const path = `chat-uploads/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const { error } = await supabase.storage
        .from("email-attachments")
        .upload(path, file);

      if (!error) {
        newAttachments.push({
          type: "upload",
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          storagePath: path,
          size: file.size,
        });
      }
    }

    if (newAttachments.length > 0) {
      onAttachmentsChange([...attachments, ...newAttachments]);
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [attachments, onAttachmentsChange]);

  // ── Google Drive Browse ──
  const loadDriveFolder = useCallback(async (folderId?: string) => {
    setDriveLoading(true);
    try {
      const params = folderId
        ? `folderId=${folderId}`
        : projectId
          ? `projectId=${projectId}`
          : "";
      const res = await fetch(`/api/drive-files?${params}`);
      const data = await res.json();
      setDriveFiles(data.files || []);
    } catch {
      setDriveFiles([]);
    }
    setDriveLoading(false);
  }, [projectId]);

  const openDrivePicker = useCallback(() => {
    setDriveOpen(true);
    setFolderStack([]);
    loadDriveFolder();
  }, [loadDriveFolder]);

  const navigateFolder = (folder: DriveFile) => {
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
    loadDriveFolder(folder.id);
  };

  const navigateBack = () => {
    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);
    const parentId = newStack.length > 0 ? newStack[newStack.length - 1].id : undefined;
    loadDriveFolder(parentId);
  };

  const selectDriveFile = (file: DriveFile) => {
    onAttachmentsChange([
      ...attachments,
      {
        type: "drive",
        filename: file.name,
        mimeType: file.mimeType,
        driveFileId: file.id,
        driveLink: file.webViewLink,
        size: file.size ? parseInt(file.size) : undefined,
      },
    ]);
    setDriveOpen(false);
    setPopoverOpen(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {attachments.map((att, i) => {
            const Icon = fileIcon(att.mimeType);
            return (
              <Badge key={i} variant="secondary" className="gap-1.5 pl-1.5 pr-1 py-0.5 text-[11px]">
                <Icon className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[150px]">{att.filename}</span>
                <button onClick={() => removeAttachment(i)} className="hover:text-destructive ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Attach button */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || uploading}
            className="h-10 w-10 rounded-xl shrink-0 hover:text-amber-500"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          {!driveOpen ? (
            <>
              <button
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-accent text-sm text-left"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 text-muted-foreground" />
                Upload File
              </button>
              {projectId && (
                <button
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-accent text-sm text-left"
                  onClick={openDrivePicker}
                >
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  Google Drive
                </button>
              )}
            </>
          ) : (
            <div className="min-h-[200px]">
              {/* Drive folder header */}
              <div className="flex items-center gap-2 px-2 py-1.5 border-b mb-1">
                {folderStack.length > 0 ? (
                  <button onClick={navigateBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-3 w-3" />
                    Back
                  </button>
                ) : (
                  <button onClick={() => setDriveOpen(false)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-3 w-3" />
                    Menu
                  </button>
                )}
                <span className="text-xs font-medium truncate flex-1 text-right">
                  {folderStack.length > 0 ? folderStack[folderStack.length - 1].name : "Project Folder"}
                </span>
              </div>

              {driveLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">No files found</div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                  {driveFiles.map((file) => {
                    const isFolder = file.mimeType === "application/vnd.google-apps.folder";
                    const Icon = isFolder ? FolderOpen : fileIcon(file.mimeType);
                    const typeLabel = friendlyType(file.mimeType);

                    return (
                      <button
                        key={file.id}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-accent text-left text-xs"
                        onClick={() => isFolder ? navigateFolder(file) : selectDriveFile(file)}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate flex-1">{file.name}</span>
                        {typeLabel && <span className="text-[10px] text-muted-foreground shrink-0">{typeLabel}</span>}
                        {isFolder && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
    </div>
  );
}
