"use client";

import { useState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  BookOpen,
  ArrowRightLeft,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { formatDate } from "@/lib/utils";
import { uploadProjectFile, deleteProjectFile } from "@/lib/actions/project-files";
import { signProjectFilePath } from "@/lib/storage/project-file-url";
import type { QuoteRequest, ProjectFile as DBProjectFile, ProjectFileCategory } from "@/types/database";
import type { ProjectFile as EmailFile } from "@/components/projects/project-detail-tabs";

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  construction_drawings: { label: "Construction Drawings", icon: <Ruler className="h-3.5 w-3.5" />, color: "bg-blue-500/10 text-blue-400" },
  specs: { label: "Specs & Guidelines", icon: <BookOpen className="h-3.5 w-3.5" />, color: "bg-purple-500/10 text-purple-400" },
  pricing: { label: "Pricing", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-green-500/10 text-green-400" },
  contracts: { label: "Contracts", icon: <FileText className="h-3.5 w-3.5" />, color: "bg-teal-500/10 text-teal-400" },
  permits: { label: "Permits", icon: <FileText className="h-3.5 w-3.5" />, color: "bg-orange-500/10 text-orange-400" },
  estimates: { label: "Estimates", icon: <FileText className="h-3.5 w-3.5" />, color: "bg-emerald-500/10 text-emerald-400" },
  invoices: { label: "Invoices", icon: <FileText className="h-3.5 w-3.5" />, color: "bg-amber-500/10 text-amber-400" },
  photos: { label: "Photos", icon: <ImageIcon className="h-3.5 w-3.5" />, color: "bg-sky-500/10 text-sky-400" },
  quotes: { label: "Quotes & Proposals", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-green-500/10 text-green-400" },
  other: { label: "Other Documents", icon: <Paperclip className="h-3.5 w-3.5" />, color: "bg-muted text-muted-foreground" },
};

const UPLOAD_CATEGORIES: { value: ProjectFileCategory; label: string }[] = [
  { value: "construction_drawings", label: "Construction Drawings" },
  { value: "specs", label: "Specs & Guidelines" },
  { value: "pricing", label: "Pricing" },
  { value: "contracts", label: "Contracts" },
  { value: "permits", label: "Permits" },
  { value: "estimates", label: "Estimates" },
  { value: "invoices", label: "Invoices" },
  { value: "photos", label: "Photos" },
  { value: "other", label: "Other" },
];

const CATEGORY_ORDER = [
  "construction_drawings", "specs", "pricing", "quotes", "invoices",
  "estimates", "contracts", "permits", "photos", "other",
];

interface ProjectFilesTabProps {
  files: EmailFile[];
  quotes: QuoteRequest[];
  uploadedFiles: DBProjectFile[];
  projectId: string;
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

export function ProjectFilesTab({ files, quotes, uploadedFiles: initialUploaded, projectId }: ProjectFilesTabProps) {
  const [uploadedFiles, setUploadedFiles] = useState(initialUploaded);
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

    startTransition(async () => {
      for (const file of Array.from(selectedFiles)) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("category", uploadCategory);
        const result = await uploadProjectFile(projectId, formData);
        if (!result.error) {
          // Refresh uploaded files
          const supabase = createClient();
          const { data } = await supabase
            .from("project_files")
            .select("*")
            .eq("project_id", projectId)
            .order("category")
            .order("created_at", { ascending: false });
          if (data) setUploadedFiles(data);
        }
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
    // Update in local state immediately
    setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, category: newCategory } : f));
    // Update in DB
    const supabase = createClient();
    supabase.from("project_files").update({ category: newCategory }).eq("id", fileId).then(() => {});
  }

  // ── Preview/download for email attachments ──
  async function handlePreviewEmail(file: EmailFile) {
    if (!file.storage_path) return;
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mimeType);
    const supabase = createClient();
    const { data } = await supabase.storage.from("email-attachments").createSignedUrl(file.storage_path, 3600);
    if (data?.signedUrl) {
      if (file.mimeType?.includes("pdf") || file.mimeType?.startsWith("image/")) {
        setPreviewUrl(data.signedUrl);
      } else {
        window.open(data.signedUrl, "_blank");
      }
    }
  }

  // ── Preview/download for uploaded files ──
  // Agent-filed rows live in the email-attachments bucket, app uploads in
  // project-files — signProjectFilePath tries both (and passes through the
  // legacy rows whose storage_path is an external URL).
  async function handlePreviewUploaded(file: DBProjectFile) {
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mime_type || "");
    const url = await signProjectFilePath(createClient(), file.storage_path);
    if (url) {
      if (file.mime_type?.includes("pdf") || file.mime_type?.startsWith("image/")) {
        setPreviewUrl(url);
      } else {
        window.open(url, "_blank");
      }
    }
  }

  async function handleDownloadUploaded(file: DBProjectFile) {
    const url = await signProjectFilePath(createClient(), file.storage_path);
    if (url) window.open(url, "_blank");
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

  function classifyEmailFile(file: EmailFile): string {
    // Manual override takes priority
    const key = getFileKey(file);
    if (categoryOverrides[key]) return categoryOverrides[key];

    // Quote DB linkage
    if (file.storage_path && linkedPaths.has(file.storage_path)) {
      const q = quotes.find(q => q.attachment_storage_path === file.storage_path);
      if (q?.document_type) return q.document_type === "quote" ? "quotes" : q.document_type;
      return "quotes";
    }

    const fn = file.filename.toLowerCase();
    const subj = (file.emailSubject || "").toLowerCase();

    // Quotes & proposals
    if (fn.includes("quote") || fn.includes("proposal") || fn.includes("bid") || fn.includes("rfq") || fn.includes("pricing")) return "quotes";
    // Invoices
    if (fn.includes("invoice") || fn.includes("bill") || fn.includes("payment") || fn.includes("receipt")) return "invoices";
    // Construction drawings / plans
    if (fn.includes("drawing") || fn.includes("plan") || fn.includes("blueprint") || fn.includes("floorplan") ||
        fn.includes("elevation") || fn.includes("section") || fn.includes("detail") || fn.includes("layout") ||
        fn.includes("pricing set") || fn.includes("construction set") || fn.includes("bid set") ||
        fn.includes("architectural") || fn.includes("structural") || fn.includes("mechanical") ||
        fn.includes("plumbing") || fn.includes("electrical") || fn.includes("hvac") ||
        fn.includes("site plan") || fn.includes("as-built") || fn.includes("survey") ||
        fn.endsWith(".dwg") || fn.endsWith(".dxf")) return "construction_drawings";
    // Specs
    if (fn.includes("spec") || fn.includes("guideline") || fn.includes("schedule") ||
        fn.includes("submittal") || fn.includes("cut sheet") || fn.includes("cutsheet") ||
        fn.includes("data sheet") || fn.includes("datasheet") || fn.includes("material")) return "specs";
    // Estimates
    if (fn.includes("estimate") || fn.includes("takeoff") || fn.includes("take-off") || fn.includes("budget") || fn.includes("cost")) return "estimates";
    // Permits
    if (fn.includes("permit") || fn.includes("approval") || fn.includes("zoning") ||
        fn.includes("variance") || fn.includes("inspection") || fn.includes("certificate") ||
        fn.includes("compliance") || fn.includes("code")) return "permits";
    // Contracts
    if (fn.includes("contract") || fn.includes("agreement") || fn.includes("scope") ||
        fn.includes("change order") || fn.includes("addendum") || fn.includes("amendment") ||
        fn.includes("lien") || fn.includes("waiver") || fn.includes("signed")) return "contracts";
    // Photos
    if (file.mimeType?.startsWith("image/")) return "photos";

    // Fallback: check email subject for context clues
    if (subj.includes("quote") || subj.includes("proposal") || subj.includes("bid") || subj.includes("price")) return "quotes";
    if (subj.includes("invoice") || subj.includes("bill") || subj.includes("payment")) return "invoices";
    if (subj.includes("drawing") || subj.includes("plan") || subj.includes("set")) return "construction_drawings";
    if (subj.includes("permit") || subj.includes("inspection")) return "permits";
    if (subj.includes("contract") || subj.includes("agreement") || subj.includes("change order")) return "contracts";
    if (subj.includes("estimate") || subj.includes("budget")) return "estimates";
    if (subj.includes("spec") || subj.includes("submittal")) return "specs";

    return "other";
  }

  function handleRecategorize(fileKey: string, newCategory: string) {
    saveOverride(projectId, fileKey, newCategory);
    setCategoryOverrides(prev => ({ ...prev, [fileKey]: newCategory }));
  }

  // ── Build unified file list grouped by category (deduplicated) ──
  type UnifiedFile = { type: "email"; data: EmailFile } | { type: "uploaded"; data: DBProjectFile };
  const grouped = new Map<string, UnifiedFile[]>();

  // Email files first (these are the real files with actual content)
  const emailFilenames = new Set<string>();
  const emailStoragePaths = new Set<string>();
  const emailFileSignatures = new Set<string>(); // `${filename}|${size}` — same content, any path
  for (const file of filteredEmailFiles) {
    const cat = classifyEmailFile(file);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({ type: "email", data: file });
    emailFilenames.add(file.filename.toLowerCase());
    if (file.storage_path) emailStoragePaths.add(file.storage_path);
    emailFileSignatures.add(`${file.filename.toLowerCase()}|${file.size}`);
  }

  // Uploaded files — skip duplicates that match email attachments
  for (const file of uploadedFiles) {
    // Skip 0-byte files whose filename already exists from email (AI-created duplicate reference)
    const fnLower = file.filename.toLowerCase();
    if (file.size === 0 && emailFilenames.has(fnLower)) continue;
    // Skip if exact storage path already shown from email
    if (emailStoragePaths.has(file.storage_path)) continue;
    // Skip same-content copies the agent routines filed under a fresh path
    // (same filename + byte size as an email attachment already listed)
    if (emailFileSignatures.has(`${fnLower}|${file.size}`)) continue;

    const cat = file.category;
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
          const config = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.other;

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
                          <Select value={file.category} onValueChange={(v) => handleRecategorizeUploaded(file.id, v as ProjectFileCategory)}>
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
