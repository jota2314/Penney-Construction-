"use client";

import { useState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  FolderOpen,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Download,
  Loader2,
  Eye,
  Upload,
  Trash2,
  Ruler,
  ArrowRightLeft,
} from "lucide-react";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { ImageViewer } from "@/components/ui/image-viewer";
import { formatDate } from "@/lib/utils";
import {
  deleteProjectFile,
  dismissProjectFile,
  getProjectFiles,
  getProjectFileSignedUrl,
  updateProjectFileCategory,
  uploadProjectFile,
} from "@/lib/actions/project-files";
import type { QuoteRequest, ProjectFile as DBProjectFile, ProjectFileCategory } from "@/types/database";
import type { ProjectFile as EmailFile } from "@/components/projects/project-detail-tabs";

type DisplayCategory = "construction_drawings" | "photos" | "quotes" | "documents";

const CATEGORY_CONFIG: Record<DisplayCategory, { label: string; icon: React.ReactNode; color: string }> = {
  construction_drawings: { label: "Construction Drawings", icon: <Ruler className="h-3.5 w-3.5" />, color: "bg-blue-500/10 text-blue-400" },
  photos: { label: "Job Photos", icon: <ImageIcon className="h-3.5 w-3.5" />, color: "bg-sky-500/10 text-sky-400" },
  quotes: { label: "Quotes", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-green-500/10 text-green-400" },
  documents: { label: "Documents", icon: <FileText className="h-3.5 w-3.5" />, color: "bg-amber-500/10 text-amber-400" },
};

const UPLOAD_CATEGORIES: { value: ProjectFileCategory; label: string }[] = [
  { value: "construction_drawings", label: "Construction Drawings" },
  { value: "photos", label: "Job Photos" },
  { value: "pricing", label: "Quotes" },
  { value: "other", label: "Documents" },
];

const CATEGORY_ORDER: DisplayCategory[] = [
  "construction_drawings",
  "quotes",
  "documents",
  "photos",
];

// Map a stored project_files.category (DB enum) onto one of the display
// sections. Everything lands somewhere so uploaded files never silently hide.
function uploadedDisplayCategory(dbCategory: string): DisplayCategory {
  switch (dbCategory) {
    case "photos":
      return "photos";
    case "construction_drawings":
      return "construction_drawings";
    case "pricing":
    case "estimates":
    case "invoices":
    case "quotes":
      return "quotes";
    default: // specs, contracts, permits, other, …
      return "documents";
  }
}

// Reverse map used when the user re-files an uploaded document, so we always
// persist a valid project_files.category (DB enum has no "quotes"/"documents").
function displayToDbCategory(display: DisplayCategory): ProjectFileCategory {
  switch (display) {
    case "construction_drawings":
      return "construction_drawings";
    case "photos":
      return "photos";
    case "quotes":
      return "pricing";
    case "documents":
      return "other";
  }
}

interface ProjectFilesTabProps {
  files: EmailFile[];
  quotes: QuoteRequest[];
  uploadedFiles: DBProjectFile[];
  projectId: string;
  /** Canonical keys (name|size) the user has hidden from this project. */
  dismissedKeys?: string[];
  /** Field daily logs — their photos render as the "Job photos" strip. */
  dailyLogs?: import("@/lib/actions/daily-logs").FeedDailyLog[];
}

// Canonical identity for a file = lowercased name + byte size. This is the
// single key used for dedup AND for the "remove from project" hide list, so
// hiding an email attachment also suppresses any project_files pointer row for
// the same physical document (and vice-versa).
function canonicalKey(filename: string, size: number) {
  return `${(filename || "").toLowerCase()}|${size ?? 0}`;
}

// Storage key for manual category overrides
function getOverrideStorageKey(projectId: string) {
  return `file-cat-overrides-${projectId}`;
}

function loadOverrides(projectId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(getOverrideStorageKey(projectId)) || "{}"); } catch { return {}; }
}

function saveOverride(projectId: string, fileKey: string, category: string) {
  if (typeof window === "undefined") return;
  const overrides = loadOverrides(projectId);
  overrides[fileKey] = category;
  localStorage.setItem(getOverrideStorageKey(projectId), JSON.stringify(overrides));
}

export function ProjectFilesTab({ files, quotes, uploadedFiles: initialUploaded, projectId, dismissedKeys = [], dailyLogs = [] }: ProjectFilesTabProps) {
  const [uploadedFiles, setUploadedFiles] = useState(initialUploaded);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(dismissedKeys));
  const [uploadStatus, setUploadStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<Map<string, string>>(new Map());
  const [uploadCategory, setUploadCategory] = useState<ProjectFileCategory>("construction_drawings");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>(() => loadOverrides(projectId));

  // ── Upload handler ──
  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploadStatus(null);
    startTransition(async () => {
      const succeeded: string[] = [];
      const failed: string[] = [];
      for (const file of Array.from(selectedFiles)) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("category", uploadCategory);
        const result = await uploadProjectFile(projectId, formData);
        if (result.error) {
          failed.push(`${file.name}: ${result.error}`);
        } else {
          succeeded.push(file.name);
        }
      }

      // Refresh the uploaded list once, after the batch.
      if (succeeded.length > 0) {
        setUploadedFiles(await getProjectFiles(projectId));
      }

      if (failed.length > 0) {
        setUploadStatus({
          kind: "error",
          message: `Couldn't upload ${failed.length} file${failed.length > 1 ? "s" : ""} — ${failed.join("; ")}`,
        });
      } else if (succeeded.length > 0) {
        setUploadStatus({
          kind: "success",
          message: `Uploaded ${succeeded.length} file${succeeded.length > 1 ? "s" : ""}.`,
        });
      }

      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function handleDeleteUploaded(fileId: string) {
    startTransition(async () => {
      const result = await deleteProjectFile(fileId, projectId);
      if (result.success) {
        setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
      }
    });
  }

  function handleRecategorizeUploaded(fileId: string, newCategory: ProjectFileCategory) {
    const previous = uploadedFiles;
    setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, category: newCategory } : f));
    startTransition(async () => {
      const result = await updateProjectFileCategory(fileId, projectId, newCategory);
      if (result.error) {
        setUploadedFiles(previous);
        setUploadStatus({ kind: "error", message: result.error });
      }
    });
  }

  // ── Preview/download for email attachments ──
  async function handlePreviewEmail(file: EmailFile) {
    if (!file.storage_path) return;
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mimeType);
    const result = await getProjectFileSignedUrl({
      source: "email",
      projectId,
      emailId: file.emailId,
      storagePath: file.storage_path,
    });
    if (result.url) {
      if (file.mimeType?.includes("pdf") || file.mimeType?.startsWith("image/")) {
        setPreviewUrl(result.url);
      } else {
        window.open(result.url, "_blank");
      }
    }
  }

  // ── Preview/download for uploaded files ──
  // Read from the bucket the object actually lives in — email-promoted rows
  // point at `email-attachments`, genuine uploads at `project-files`.
  async function handlePreviewUploaded(file: DBProjectFile) {
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mime_type || "");
    const result = await getProjectFileSignedUrl({
      source: "uploaded",
      projectId,
      fileId: file.id,
    });
    if (result.url) {
      if (file.mime_type?.includes("pdf") || file.mime_type?.startsWith("image/")) {
        setPreviewUrl(result.url);
      } else {
        window.open(result.url, "_blank");
      }
    }
  }

  async function handleDownloadUploaded(file: DBProjectFile) {
    const result = await getProjectFileSignedUrl({
      source: "uploaded",
      projectId,
      fileId: file.id,
    });
    if (result.url) window.open(result.url, "_blank");
  }

  // ── Remove an email-sourced attachment from this project (non-destructive) ──
  function handleDismissEmail(file: EmailFile) {
    const key = canonicalKey(file.filename, file.size);
    setDismissed(prev => new Set(prev).add(key));
    startTransition(async () => {
      await dismissProjectFile(projectId, key);
    });
  }

  async function handleExtractText(file: EmailFile) {
    if (!file.storage_path || extractedText.has(file.storage_path)) return;
    setExtracting(file.storage_path);
    try {
      const res = await fetch("/api/extract-attachment-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: file.emailId }),
      });
      const data = await res.json();
      if (data.attachments) {
        const newMap = new Map(extractedText);
        for (const att of data.attachments) {
          if (att.storage_path && att.text_content) newMap.set(att.storage_path, att.text_content);
        }
        setExtractedText(newMap);
      }
    } catch { /* ignore */ } finally {
      setExtracting(null);
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Filter out email signature junk (tiny images, social icons, tracking pixels) ──
  const filteredEmailFiles = files.filter(file => {
    // Hidden via "remove from project"
    if (dismissed.has(canonicalKey(file.filename, file.size))) return false;
    // Calendar invites are email noise, not project documents
    const nameLower = file.filename.toLowerCase();
    if (nameLower.endsWith(".ics") || nameLower.startsWith("invite")) return false;
    if (!file.mimeType?.startsWith("image/")) return true;
    // Small images are almost always signature icons / tracking pixels
    if (file.size < 80000) return false;
    // Outlook inline image pattern
    const fn = file.filename.toLowerCase();
    if (fn.startsWith("outlook-") || fn.startsWith("image0")) return false;
    // Common social/signature icon names
    if (/^(icon|logo|banner|spacer|pixel|tracking|badge|button)/i.test(fn)) return false;
    return true;
  });

  // ── Classify email files ──
  const linkedPaths = new Set(quotes.filter(q => q.attachment_storage_path).map(q => q.attachment_storage_path!));

  function getFileKey(file: EmailFile): string {
    return file.storage_path || `${file.emailId}:${file.filename}`;
  }

  function classifyEmailFile(file: EmailFile): DisplayCategory {
    // Manual override takes priority
    const key = getFileKey(file);
    const override = categoryOverrides[key];
    if (CATEGORY_ORDER.includes(override as DisplayCategory)) {
      return override as DisplayCategory;
    }

    // Quote DB linkage
    if (file.storage_path && linkedPaths.has(file.storage_path)) {
      const q = quotes.find(q => q.attachment_storage_path === file.storage_path);
      const type = q?.document_type?.toLowerCase();
      return !type || type === "quote" || type === "proposal" || type === "bid"
        ? "quotes"
        : "documents";
    }

    const fn = file.filename.toLowerCase();
    const subj = (file.emailSubject || "").toLowerCase();

    // Quotes & proposals
    if (fn.includes("quote") || fn.includes("proposal") || fn.includes("bid") || fn.includes("rfq") || fn.includes("pricing")) return "quotes";
    // Construction drawings / plans
    if (fn.includes("drawing") || fn.includes("plan") || fn.includes("blueprint") || fn.includes("floorplan") ||
        fn.includes("elevation") || fn.includes("section") || fn.includes("detail") || fn.includes("layout") ||
        fn.includes("pricing set") || fn.includes("construction set") || fn.includes("bid set") ||
        fn.includes("architectural") || fn.includes("structural") || fn.includes("mechanical") ||
        fn.includes("plumbing") || fn.includes("electrical") || fn.includes("hvac") ||
        fn.includes("site plan") || fn.includes("as-built") || fn.includes("survey") ||
        fn.endsWith(".dwg") || fn.endsWith(".dxf")) return "construction_drawings";
    // Photos
    if (file.mimeType?.startsWith("image/")) return "photos";

    // Fallback: check email subject for context clues
    if (subj.includes("quote") || subj.includes("proposal") || subj.includes("bid") || subj.includes("price")) return "quotes";
    if (subj.includes("drawing") || subj.includes("plan") || subj.includes("set")) return "construction_drawings";

    // Everything else is still a real project document — never hide it.
    return "documents";
  }

  function handleRecategorize(fileKey: string, newCategory: string) {
    saveOverride(projectId, fileKey, newCategory);
    setCategoryOverrides(prev => ({ ...prev, [fileKey]: newCategory }));
  }

  // ── Build unified file list grouped by category (deduplicated) ──
  type UnifiedFile = { type: "email"; data: EmailFile } | { type: "uploaded"; data: DBProjectFile };
  const grouped = new Map<string, UnifiedFile[]>();

  // `canonicalKey` (name+size) collapses the same physical document across both
  // sources (email copies live in `email-attachments`, uploads in
  // `project-files`, so their storage paths are never string-equal) AND hides
  // genuine duplicate project_files rows. Pure display dedup — nothing deleted.
  const seenKeys = new Set<string>();

  // Email files first (these carry the real content + email context + OCR).
  for (const file of filteredEmailFiles) {
    const key = canonicalKey(file.filename, file.size);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const cat = classifyEmailFile(file);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({ type: "email", data: file });
  }

  // Uploaded files — skip any whose identity already appeared (an email copy
  // or an earlier upload row) or that the user has hidden.
  for (const file of uploadedFiles) {
    const key = canonicalKey(file.filename, file.size);
    if (seenKeys.has(key) || dismissed.has(key)) continue;
    seenKeys.add(key);
    // Every uploaded file maps to a section so none silently disappear.
    const cat = uploadedDisplayCategory(String(file.category));
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({ type: "uploaded", data: file });
  }

  const totalFiles = Array.from(grouped.values()).reduce((sum, g) => sum + g.length, 0);

  return (
    <div className="space-y-4">
      {/* Upload bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as ProjectFileCategory)}>
          <SelectTrigger className="w-[200px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UPLOAD_CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleUploadClick} disabled={isPending} size="sm" className="gap-1.5">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelected}
          accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.dwg,.dxf"
        />
        <span className="text-xs text-muted-foreground ml-auto">{totalFiles} files total</span>
      </div>

      {/* Upload result banner */}
      {uploadStatus && (
        <div
          className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
            uploadStatus.kind === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          <span className="min-w-0 break-words">{uploadStatus.message}</span>
          <button onClick={() => setUploadStatus(null)} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Job photos — field daily-log photos, newest first */}
      {(() => {
        const jobPhotos = dailyLogs.flatMap((log) =>
          (log.photo_signed_urls ?? []).map((url, i) => ({
            key: `${log.id}-${i}`,
            url,
            author: log.author_name ?? log.author_email?.split("@")[0] ?? "Field",
            date: new Date(log.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            note: log.text,
          })),
        );
        if (jobPhotos.length === 0) return null;
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Job photos</h3>
              <span className="text-xs text-muted-foreground">{jobPhotos.length} from the field</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {jobPhotos.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setPreviewUrl(p.url);
                    setPreviewFilename(`${p.author} · ${p.date}`);
                    setPreviewMimeType("image/jpeg");
                  }}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border/60 text-left"
                  title={p.note ?? undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo by ${p.author}`} className="h-full w-full object-cover transition group-hover:scale-105" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] leading-tight text-white/90 truncate">
                    {p.author} · {p.date}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* File list by category */}
      {totalFiles === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="font-medium text-muted-foreground">No files yet</h3>
          <p className="text-sm text-muted-foreground/70 mt-1">Upload files or process emails to add attachments</p>
        </div>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const catFiles = grouped.get(cat);
          if (!catFiles || catFiles.length === 0) return null;
          const config = CATEGORY_CONFIG[cat];

          return (
            <div key={cat} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                {config.icon}
                {config.label}
                <Badge variant="secondary" className="text-[9px]">{catFiles.length}</Badge>
              </h3>
              <div className="grid gap-2">
                {catFiles.map((item, idx) => {
                  if (item.type === "email") {
                    const file = item.data;
                    const isPdf = file.mimeType?.includes("pdf");
                    const isImage = file.mimeType?.startsWith("image/");
                    const text = file.storage_path ? extractedText.get(file.storage_path) : null;

                    return (
                      <div key={`email-${file.emailId}-${file.filename}-${idx}`} className="border rounded-lg p-3 bg-card space-y-2">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg shrink-0 ${isPdf ? "bg-red-500/10" : isImage ? "bg-blue-500/10" : "bg-muted"}`}>
                            {isPdf ? <FileText className="h-5 w-5 text-red-400" /> :
                             isImage ? <ImageIcon className="h-5 w-5 text-blue-400" /> :
                             <Paperclip className="h-5 w-5 text-muted-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{file.filename}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatSize(file.size)} &middot; from email &quot;{file.emailSubject}&quot;
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Remove from project (the email keeps its copy)"
                            className="h-7 w-7 p-0 text-red-500/50 hover:text-red-500 shrink-0"
                            onClick={() => handleDismissEmail(file)}
                            disabled={isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="flex gap-1.5">
                          {file.storage_path && (isPdf || isImage) && (
                            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handlePreviewEmail(file)}>
                              <Eye className="h-3 w-3 mr-1" /> Preview
                            </Button>
                          )}
                          {file.storage_path && (
                            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handlePreviewEmail(file)}>
                              <Download className="h-3 w-3 mr-1" /> Download
                            </Button>
                          )}
                          {isPdf && file.storage_path && !text && (
                            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handleExtractText(file)} disabled={extracting === file.storage_path}>
                              {extracting === file.storage_path ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />} OCR
                            </Button>
                          )}
                          <Select value={cat} onValueChange={(v) => handleRecategorize(getFileKey(file), v)}>
                            <SelectTrigger className="h-7 w-auto text-[10px] gap-1 border-dashed">
                              <ArrowRightLeft className="h-3 w-3" />
                              <span className="hidden sm:inline">Move</span>
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORY_ORDER.map(c => (
                                <SelectItem key={c} value={c} className="text-xs">
                                  {CATEGORY_CONFIG[c]?.label || c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {text && (
                          <div className="bg-muted rounded p-2 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
                            {text.substring(0, 2000)}{text.length > 2000 && "..."}
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    const file = item.data;
                    const isPdf = file.mime_type?.includes("pdf");
                    const isImage = file.mime_type?.startsWith("image/");

                    return (
                      <div key={`uploaded-${file.id}`} className="border rounded-lg p-3 bg-card space-y-2">
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
                            {file.description && <p className="text-[10px] text-muted-foreground/70">{file.description}</p>}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500/50 hover:text-red-500 shrink-0"
                            onClick={() => handleDeleteUploaded(file.id)}
                            disabled={isPending}
                          >
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
                          <Select value={uploadedDisplayCategory(String(file.category))} onValueChange={(v) => handleRecategorizeUploaded(file.id, displayToDbCategory(v as DisplayCategory))}>
                            <SelectTrigger className="h-7 w-auto text-[10px] gap-1 border-dashed">
                              <ArrowRightLeft className="h-3 w-3" />
                              <span className="hidden sm:inline">Move</span>
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORY_ORDER.map(c => (
                                <SelectItem key={c} value={c} className="text-xs">
                                  {CATEGORY_CONFIG[c]?.label || c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  }
                })}
              </div>
            </div>
          );
        })
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
