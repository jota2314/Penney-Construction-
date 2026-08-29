"use client";

import { useState, useRef, useTransition } from "react";
import { useSignedLogPhotos } from "@/components/field-feed/use-signed-log-photos";
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
  FileSignature,
  ScrollText,
  Receipt,
  Calculator,
  Image as ImageIcon,
  Download,
  Loader2,
  Eye,
  Upload,
  Trash2,
  Ruler,
  ArrowRightLeft,
  ChevronDown,
  Camera,
  Search,
  X,
  Pencil,
  Check,
} from "lucide-react";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { ImageViewer } from "@/components/ui/image-viewer";
import { formatDate } from "@/lib/utils";
import {
  deleteProjectFile,
  dismissProjectFile,
  getProjectFiles,
  getProjectFileSignedUrl,
  setProjectFileOverride,
  updateProjectFileCategory,
  uploadProjectFile,
  type ProjectFileOverride,
} from "@/lib/actions/project-files";
import type { QuoteRequest, ProjectFile as DBProjectFile, ProjectFileCategory } from "@/types/database";
import type { ProjectFile as EmailFile } from "@/components/projects/project-detail-tabs";

// The Files tab now mirrors the full ProjectFileCategory taxonomy so a permit
// isn't dumped into "Job photos" and a client contract/proposal isn't mislabeled
// a subcontractor "Quote". Every category the DB can hold has a home here, so
// nothing is silently dropped from the tab.
type DisplayCategory = ProjectFileCategory;

const CATEGORY_CONFIG: Record<DisplayCategory, { label: string; icon: React.ReactNode; color: string }> = {
  construction_drawings: { label: "Construction Drawings", icon: <Ruler className="h-3.5 w-3.5" />, color: "bg-blue-500/10 text-blue-400" },
  estimates: { label: "Estimates", icon: <Calculator className="h-3.5 w-3.5" />, color: "bg-purple-500/10 text-purple-400" },
  quotes: { label: "Quotes", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-green-500/10 text-green-400" },
  contracts: { label: "Contracts & Proposals", icon: <FileSignature className="h-3.5 w-3.5" />, color: "bg-amber-500/10 text-amber-400" },
  permits: { label: "Permits", icon: <ScrollText className="h-3.5 w-3.5" />, color: "bg-teal-500/10 text-teal-400" },
  invoices: { label: "Invoices", icon: <Receipt className="h-3.5 w-3.5" />, color: "bg-rose-500/10 text-rose-400" },
  pricing: { label: "Pricing", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-emerald-500/10 text-emerald-400" },
  specs: { label: "Specs", icon: <FileText className="h-3.5 w-3.5" />, color: "bg-indigo-500/10 text-indigo-400" },
  photos: { label: "Job Photos", icon: <ImageIcon className="h-3.5 w-3.5" />, color: "bg-sky-500/10 text-sky-400" },
  other: { label: "Other", icon: <Paperclip className="h-3.5 w-3.5" />, color: "bg-muted text-muted-foreground" },
};

// Sections shown on the tab, in order. "pricing" is intentionally NOT here — the
// email-promotion flow used it as a junk drawer for both Penney estimates AND
// sub quotes, so we re-derive those from stronger signals and fold any leftover
// "pricing" row into Estimates for display (see dbToDisplay).
const CATEGORY_ORDER: DisplayCategory[] = [
  "construction_drawings",
  "estimates",
  "quotes",
  "contracts",
  "permits",
  "invoices",
  "specs",
  "photos",
  "other",
];

const UPLOAD_CATEGORIES: { value: ProjectFileCategory; label: string }[] = CATEGORY_ORDER.map(
  (value) => ({ value, label: CATEGORY_CONFIG[value].label }),
);

// Field daily-log photos get a section of their own alongside the file
// categories — same header, count and toggle, but a thumbnail grid inside.
type SectionKey = DisplayCategory | "field_photos";

const SECTION_CONFIG: Record<SectionKey, { label: string; icon: React.ReactNode; color: string }> = {
  ...CATEGORY_CONFIG,
  field_photos: {
    label: "Field Photos",
    icon: <Camera className="h-3.5 w-3.5" />,
    color: "bg-amber-500/10 text-amber-400",
  },
};

const SECTION_ORDER: SectionKey[] = [
  "construction_drawings",
  "field_photos",
  ...CATEGORY_ORDER.filter((c) => c !== "construction_drawings"),
];

interface ProjectFilesTabProps {
  files: EmailFile[];
  quotes: QuoteRequest[];
  uploadedFiles: DBProjectFile[];
  projectId: string;
  /** Canonical keys (name|size) the user has hidden from this project. */
  dismissedKeys?: string[];
  /** Manual move/rename overrides, keyed by canonical key (name|size). */
  fileOverrides?: Record<string, ProjectFileOverride>;
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

// Legacy read-only fallback: before overrides moved server-side (shared with
// the whole team), manual moves were saved per-browser in localStorage keyed by
// storage_path. Keep honoring those so old fixes don't revert; new moves write
// to the project_file_overrides table.
function loadLegacyOverrides(projectId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(`file-cat-overrides-${projectId}`) || "{}"); } catch { return {}; }
}

export function ProjectFilesTab({ files, quotes, uploadedFiles: initialUploaded, projectId, dismissedKeys = [], fileOverrides = {}, dailyLogs = [] }: ProjectFilesTabProps) {
  const [uploadedFiles, setUploadedFiles] = useState(initialUploaded);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(dismissedKeys));
  const [uploadStatus, setUploadStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  /** When the preview came from a photo grid, the whole grid is swipeable. */
  const [previewGallery, setPreviewGallery] = useState<string[] | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Partial<Record<SectionKey, boolean>>>({});
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<Map<string, string>>(new Map());
  const [uploadCategory, setUploadCategory] = useState<ProjectFileCategory>("construction_drawings");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [legacyOverrides] = useState<Record<string, string>>(() => loadLegacyOverrides(projectId));
  const [overrides, setOverrides] = useState<Record<string, ProjectFileOverride>>(fileOverrides);
  /** Card currently in rename mode: its canonical key + the draft name. */
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  // Field photos arrive unsigned from the project page; sign them once this
  // tab is open rather than blocking the page load on 200+ Storage calls.
  const signedLogs = useSignedLogPhotos(dailyLogs);

  // ── Move / rename overrides (shared team-wide via project_file_overrides) ──
  function applyOverride(fileKey: string, patch: { category?: string; displayName?: string | null }) {
    setOverrides(prev => ({
      ...prev,
      [fileKey]: {
        category: patch.category !== undefined ? patch.category : prev[fileKey]?.category ?? null,
        display_name: patch.displayName !== undefined ? (patch.displayName?.trim() || null) : prev[fileKey]?.display_name ?? null,
      },
    }));
    startTransition(async () => {
      const result = await setProjectFileOverride(projectId, fileKey, patch);
      if (result.error) setUploadStatus({ kind: "error", message: result.error });
    });
  }

  const displayName = (filename: string, size: number) =>
    overrides[canonicalKey(filename, size)]?.display_name || filename;

  function commitRename(fileKey: string) {
    if (!renaming || renaming.key !== fileKey) return;
    applyOverride(fileKey, { displayName: renaming.value });
    setRenaming(null);
  }

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

  function handleRecategorizeUploaded(file: DBProjectFile, newCategory: ProjectFileCategory) {
    const previous = uploadedFiles;
    setUploadedFiles(prev => prev.map(f => f.id === file.id ? { ...f, category: newCategory } : f));
    // Record the manual override too, so the display classifier can't second-
    // guess the move (e.g. the drawing-set rule or a quote linkage).
    applyOverride(canonicalKey(file.filename, file.size), { category: newCategory });
    startTransition(async () => {
      const result = await updateProjectFileCategory(file.id, projectId, newCategory);
      if (result.error) {
        setUploadedFiles(previous);
        setUploadStatus({ kind: "error", message: result.error });
      }
    });
  }

  // ── Preview/download for email attachments ──
  async function handlePreviewEmail(file: EmailFile) {
    if (!file.storage_path) return;
    setPreviewFilename(displayName(file.filename, file.size));
    setPreviewMimeType(file.mimeType);
    setPreviewGallery(undefined);
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
    setPreviewFilename(displayName(file.filename, file.size));
    setPreviewMimeType(file.mime_type || "");
    setPreviewGallery(undefined);
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

  // ── Filter out non-document junk (calendar invites, tiny signature images) ──
  const filteredEmailFiles = files.filter(file => {
    // Hidden via "remove from project"
    if (dismissed.has(canonicalKey(file.filename, file.size))) return false;
    const fn = file.filename.toLowerCase();
    // Calendar invites ride along on every "Accepted:"/"Invitation:" email — not files.
    if (fn.endsWith(".ics") || file.mimeType?.includes("calendar") || file.mimeType === "application/ics") return false;
    if (!file.mimeType?.startsWith("image/")) return true;
    // Small images are almost always signature icons / tracking pixels
    if (file.size < 80000) return false;
    // Outlook inline image pattern
    if (fn.startsWith("outlook-") || fn.startsWith("image0")) return false;
    // Common social/signature icon names
    if (/^(icon|logo|banner|spacer|pixel|tracking|badge|button)/i.test(fn)) return false;
    return true;
  });

  function getFileKey(file: EmailFile): string {
    return file.storage_path || `${file.emailId}:${file.filename}`;
  }

  // ── Authoritative signal #1: quote_requests linkage ──
  // A file the estimator tracked as a quote/estimate/invoice is THAT, no matter
  // what its filename says (e.g. a sub quote literally named "…proposal.pdf").
  // Gmail re-saves the same attachment under a fresh storage_path per message,
  // so match on BOTH the exact path and the normalized basename to catch every
  // copy, not just the one the quote row happened to capture.
  function normalizeName(s: string): string {
    return (s.split("/").pop() || s).toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  const quoteTypeByPath = new Map<string, string>();
  const quoteTypeByName = new Map<string, string>();
  for (const q of quotes) {
    if (!q.attachment_storage_path) continue;
    const type = (q.document_type || "quote").toLowerCase();
    quoteTypeByPath.set(q.attachment_storage_path, type);
    quoteTypeByName.set(normalizeName(q.attachment_storage_path), type);
  }
  function quoteCategoryFor(filename: string, storagePath: string | null): DisplayCategory | null {
    const type =
      (storagePath && quoteTypeByPath.get(storagePath)) ||
      quoteTypeByName.get(normalizeName(filename)) ||
      null;
    if (!type) return null;
    if (type === "invoice") return "invoices";
    if (type === "change_order") return "contracts";
    if (type === "estimate") return "estimates";
    // quote / bid / proposal / unset → a genuine subcontractor quote
    return "quotes";
  }

  // A "…set" of drawings (permit set, pricing set, construction/bid/plan set) is
  // construction drawings, even when the word "permit" appears in the name.
  function isDrawingSet(name: string): boolean {
    return /\b(permit|pricing|construction|bid|plan|drawing|design) set/.test(
      name.toLowerCase().replace(/[_\-]+/g, " "),
    );
  }

  // ── Signal #2: filename / subject keywords ──
  // Match on text with separators normalized to spaces so \bword\b boundaries
  // hold ("Invoice_1967_from_COSENTINO..." → \binvoice\b). Higher-stakes doc
  // types are tested before the broad drawings bucket, and the drawings bucket
  // deliberately contains NO bare trade names (plumbing/electrical/hvac) — those
  // collide with sub invoices/quotes and were the main source of miscategories.
  function matchCategory(text: string): DisplayCategory | null {
    const t = text.toLowerCase().replace(/[_\-]+/g, " ");
    // A drawing SET (incl. "permit set") is construction drawings — it's the
    // plan set submitted for permitting, not the issued permit itself. Checked
    // before the generic "permit" rule so it wins.
    if (isDrawingSet(t)) return "construction_drawings";
    if (/\binvoices?\b|\breceipt\b|paid in full/.test(t)) return "invoices";
    if (/\bpermits?\b|inspection card|\bzoning\b|building department|certificate of occupancy/.test(t)) return "permits";
    if (/\bcontract\b|\bproposal\b|\bagreement\b|\bchange order\b|\bsow\b|scope of work|welcome deck/.test(t)) return "contracts";
    if (/\bestimates?\b|\btake ?off\b|\bbudget\b/.test(t)) return "estimates";
    if (/\bquotes?\b|\bquotation\b|\bbid\b|\brfq\b/.test(t)) return "quotes";
    if (/\bspecs?\b|\bspecification\b|\bsubmittal\b|cut sheet|data sheet|\bselections?\b/.test(t)) return "specs";
    if (/\bdrawings?\b|\bblueprints?\b|\bfloor ?plans?\b|\bsite ?plan\b|\belevations?\b|\bas ?built\b|\bplan set\b|construction set|design set|\bplans?\b|\barchitectural\b/.test(t)) return "construction_drawings";
    return null;
  }

  function heuristicCategory(filename: string, mimeType: string | undefined, subject: string | undefined): DisplayCategory {
    const byName = matchCategory(filename);
    if (byName) return byName;
    if (/\.(dwg|dxf)$/.test(filename.toLowerCase())) return "construction_drawings";
    if (mimeType?.startsWith("image/")) return "photos";
    const bySubject = subject ? matchCategory(subject) : null;
    if (bySubject) return bySubject;
    return "other";
  }

  // Fold a curated DB category into a display section. "pricing" was a junk
  // drawer → show as Estimates; unknown values → Other.
  const TRUSTED_DB = new Set<string>(["construction_drawings", "permits", "specs", "invoices", "estimates", "contracts", "photos", "quotes"]);
  function dbToDisplay(cat: string): DisplayCategory {
    if (cat === "pricing") return "estimates";
    return (CATEGORY_ORDER as string[]).includes(cat) ? (cat as DisplayCategory) : "other";
  }

  // A manual move (server override, canonical key) beats every automatic
  // signal — the user said where this file lives, so it lives there.
  function manualCategoryFor(filename: string, size: number): DisplayCategory | null {
    const cat = overrides[canonicalKey(filename, size)]?.category;
    return cat && (CATEGORY_ORDER as string[]).includes(cat) ? (cat as DisplayCategory) : null;
  }

  // Email attachment: manual move → legacy local move → linkage → keywords →
  // image → subject → other.
  function classifyEmailFile(file: EmailFile): DisplayCategory {
    const manual = manualCategoryFor(file.filename, file.size);
    if (manual) return manual;

    const legacy = legacyOverrides[getFileKey(file)];
    if (CATEGORY_ORDER.includes(legacy as DisplayCategory)) return legacy as DisplayCategory;

    const linked = quoteCategoryFor(file.filename, file.storage_path);
    if (linked) return linked;

    return heuristicCategory(file.filename, file.mimeType, file.emailSubject);
  }

  // Uploaded/promoted file: a category the user (or promotion flow) explicitly
  // set and that we trust wins; otherwise re-derive from linkage + keywords, and
  // only fall back to the raw DB category (pricing→Estimates) as a last resort.
  function classifyUploadedFile(file: DBProjectFile): DisplayCategory {
    // A manual move wins over everything, including the drawing-set rule.
    const manual = manualCategoryFor(file.filename, file.size);
    if (manual) return manual;
    // A drawing set overrides even a curated "permits" tag.
    if (isDrawingSet(file.filename)) return "construction_drawings";
    if (file.category && TRUSTED_DB.has(file.category) && file.category !== "quotes") {
      return dbToDisplay(file.category);
    }
    const linked = quoteCategoryFor(file.filename, file.storage_path);
    if (linked) return linked;
    if (file.category === "quotes") return "quotes";
    const byHeuristic = heuristicCategory(file.filename, file.mime_type ?? undefined, undefined);
    if (byHeuristic !== "other") return byHeuristic;
    return dbToDisplay(file.category);
  }

  function handleRecategorizeEmail(file: EmailFile, newCategory: string) {
    applyOverride(canonicalKey(file.filename, file.size), { category: newCategory });
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
    const cat = classifyUploadedFile(file);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({ type: "uploaded", data: file });
  }

  // ── Field daily-log photos — their own section, newest first ──
  const jobPhotos = signedLogs.flatMap((log) =>
    (log.photo_signed_urls ?? []).map((url, i) => ({
      key: `${log.id}-${i}`,
      url,
      author: log.author_name ?? log.author_email?.split("@")[0] ?? "Field",
      date: new Date(log.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      note: log.text,
    })),
  );

  // ── Search: filename, the email a file arrived on, or an upload note ──
  const query = search.trim().toLowerCase();
  function matchesSearch(item: UnifiedFile) {
    if (!query) return true;
    const haystack =
      item.type === "email"
        ? `${item.data.filename} ${displayName(item.data.filename, item.data.size)} ${item.data.emailSubject ?? ""}`
        : `${item.data.filename} ${displayName(item.data.filename, item.data.size)} ${item.data.description ?? ""}`;
    return haystack.toLowerCase().includes(query);
  }

  const visible = new Map<DisplayCategory, UnifiedFile[]>();
  for (const cat of CATEGORY_ORDER) {
    visible.set(cat, (grouped.get(cat) ?? []).filter(matchesSearch));
  }
  // Field photos have no filename to match on — hide the section while searching.
  const visibleJobPhotos = query ? [] : jobPhotos;
  const jobPhotoUrls = visibleJobPhotos.map((p) => p.url);

  const totalFiles = Array.from(grouped.values()).reduce((sum, g) => sum + g.length, 0);
  const shownFiles = Array.from(visible.values()).reduce((sum, g) => sum + g.length, 0);

  const countFor = (section: SectionKey) =>
    section === "field_photos" ? visibleJobPhotos.length : (visible.get(section) ?? []).length;
  // Only sections that actually hold something get a square — with nine
  // categories, empty ones would crowd out the real content.
  const activeSections = SECTION_ORDER.filter((s) => countFor(s) > 0);

  // Sections start closed so the tab opens as a clean index of counts. A search
  // forces every matching section open so hits are never hidden behind a toggle.
  const isOpen = (section: SectionKey) => (query ? true : expanded[section] ?? false);
  const toggleSection = (section: SectionKey) => setExpanded((e) => ({ ...e, [section]: !e[section] }));
  const allOpen = activeSections.every(isOpen);
  const toggleAll = () =>
    setExpanded(
      allOpen
        ? {}
        : (Object.fromEntries(activeSections.map((s) => [s, true])) as Partial<Record<SectionKey, boolean>>),
    );

  // Plain render function (not a nested component) so the rename input keeps
  // focus across parent re-renders while typing.
  function renderFileName(filename: string, size: number) {
    const key = canonicalKey(filename, size);
    const name = displayName(filename, size);
    if (renaming?.key === key) {
      return (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={renaming.value}
            onChange={(e) => setRenaming({ key, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(key);
              if (e.key === "Escape") setRenaming(null);
            }}
            className="h-6 w-full min-w-0 rounded border bg-background px-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button type="button" onClick={() => commitRename(key)} aria-label="Save name" className="shrink-0 text-green-500 hover:text-green-400">
            <Check className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setRenaming(null)} aria-label="Cancel rename" className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 truncate text-sm font-medium" title={name !== filename ? `Original file: ${filename}` : undefined}>
          {name}
        </p>
        <button
          type="button"
          onClick={() => setRenaming({ key, value: name })}
          aria-label="Rename file"
          title="Rename"
          className="shrink-0 text-muted-foreground/50 hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  function SectionHeader({ section }: { section: SectionKey }) {
    const config = SECTION_CONFIG[section];
    const open = isOpen(section);
    return (
      <button
        type="button"
        onClick={() => toggleSection(section)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left transition hover:bg-muted/40"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {config.icon}
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{config.label}</h3>
        <Badge variant="secondary" className="text-[9px]">{countFor(section)}</Badge>
      </button>
    );
  }

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
        <span className="text-xs text-muted-foreground ml-auto">
          {query ? `${shownFiles} of ${totalFiles} files` : `${totalFiles} files total`}
        </span>
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

      {/* Search + count squares — one square per section, click to open it */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents…"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-8 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={toggleAll} disabled={!!query}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>

        {activeSections.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {activeSections.map((section) => {
              const config = SECTION_CONFIG[section];
              const open = isOpen(section);
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => toggleSection(section)}
                  aria-expanded={open}
                  className={`rounded-xl border p-3 text-left transition ${
                    open ? "border-foreground/25 bg-muted/50" : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${config.color}`}>
                      {config.icon}
                    </span>
                    <span className="text-lg font-semibold leading-none tabular-nums">{countFor(section)}</span>
                  </div>
                  <div className="mt-1.5 truncate text-[11px] font-medium text-muted-foreground">{config.label}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sections */}
      {activeSections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="font-medium text-muted-foreground">
            {query ? "No documents match that search" : "No files yet"}
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {query ? `Nothing named “${search.trim()}” in this project` : "Upload files or process emails to add attachments"}
          </p>
        </div>
      ) : (
        activeSections.map((section) => {
          const open = isOpen(section);

          // Field photos render as a thumbnail grid, not a document list.
          if (section === "field_photos") {
            return (
              <div key={section} className="space-y-1">
                <SectionHeader section={section} />
                {open && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {visibleJobPhotos.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => {
                          setPreviewGallery(jobPhotoUrls);
                          setPreviewUrl(p.url);
                          setPreviewFilename(`${p.author} · ${p.date}`);
                          setPreviewMimeType("image/jpeg");
                        }}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-border/60 text-left"
                        title={p.note ?? undefined}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={`Photo by ${p.author}`} className="h-full w-full object-cover transition group-hover:scale-105" />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] leading-tight text-white/90">
                          {p.author} · {p.date}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          const cat = section;
          const catFiles = visible.get(cat) ?? [];

          return (
            <div key={cat} className="space-y-1">
              <SectionHeader section={cat} />
              <div className={`grid gap-2 ${open ? "" : "hidden"}`}>
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
                            {renderFileName(file.filename, file.size)}
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
                          <Select value={cat} onValueChange={(v) => handleRecategorizeEmail(file, v)}>
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
                            {renderFileName(file.filename, file.size)}
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
                          <Select value={cat} onValueChange={(v) => handleRecategorizeUploaded(file, v as ProjectFileCategory)}>
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
          urls={previewGallery}
          filename={previewFilename}
          onClose={() => setPreviewUrl(null)}
        />
      )}
    </div>
  );
}
