"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DollarSign,
  FolderOpen,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Download,
  Loader2,
  Eye,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import type { QuoteRequest } from "@/types/database";
import type { ProjectFile } from "@/components/projects/project-detail-tabs";

const fmt = (val: number | null) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : "—";

interface ProjectFilesTabProps {
  files: ProjectFile[];
  quotes: QuoteRequest[];
}

export function ProjectFilesTab({ files, quotes }: ProjectFilesTabProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<Map<string, string>>(new Map());

  async function handlePreview(file: ProjectFile) {
    if (!file.storage_path) return;
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mimeType);

    const supabase = createClient();
    const { data } = await supabase.storage
      .from("email-attachments")
      .createSignedUrl(file.storage_path, 3600);

    if (data?.signedUrl) {
      if (file.mimeType?.includes("pdf") || file.mimeType?.startsWith("image/")) {
        setPreviewUrl(data.signedUrl);
      } else {
        window.open(data.signedUrl, "_blank");
      }
    }
  }

  async function handleDownload(file: ProjectFile) {
    if (!file.storage_path) return;
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("email-attachments")
      .createSignedUrl(file.storage_path, 3600);
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  }

  async function handleExtractText(file: ProjectFile) {
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
          if (att.storage_path && att.text_content) {
            newMap.set(att.storage_path, att.text_content);
          }
        }
        setExtractedText(newMap);
      }
    } catch {
      // ignore
    } finally {
      setExtracting(null);
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (files.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No files yet</p>
        <p className="text-sm mt-1">Attachments from linked emails will appear here</p>
      </div>
    );
  }

  // Build a set of storage paths already linked to quotes
  const linkedPaths = new Set(
    quotes.filter((q) => q.attachment_storage_path).map((q) => q.attachment_storage_path!)
  );

  // Classify files by document category using filename heuristics + quote linkage
  type DocCategory = "quote" | "invoice" | "change_order" | "estimate" | "permit" | "contract" | "photo" | "other";

  function classifyFile(file: ProjectFile): DocCategory {
    // If linked to a quote, use the quote's document_type
    if (file.storage_path && linkedPaths.has(file.storage_path)) {
      const matchingQuote = quotes.find((q) => q.attachment_storage_path === file.storage_path);
      if (matchingQuote?.document_type) return matchingQuote.document_type as DocCategory;
      return "quote";
    }

    // Classify by filename patterns
    const fn = file.filename.toLowerCase();
    if (fn.includes("quote") || fn.includes("proposal") || fn.includes("bid")) return "quote";
    if (fn.includes("invoice") || fn.includes("bill")) return "invoice";
    if (fn.includes("change order") || fn.includes("co-") || fn.includes("change_order")) return "change_order";
    if (fn.includes("estimate") || fn.includes("est-")) return "estimate";
    if (fn.includes("permit")) return "permit";
    if (fn.includes("contract") || fn.includes("agreement")) return "contract";
    if (file.mimeType?.startsWith("image/")) return "photo";
    return "other";
  }

  const categoryLabels: Record<DocCategory, string> = {
    quote: "Quotes & Proposals",
    invoice: "Invoices",
    change_order: "Change Orders",
    estimate: "Estimates",
    permit: "Permits",
    contract: "Contracts",
    photo: "Photos & Images",
    other: "Other Documents",
  };

  const categoryIcons: Record<DocCategory, React.ReactNode> = {
    quote: <DollarSign className="h-3.5 w-3.5" />,
    invoice: <FileText className="h-3.5 w-3.5" />,
    change_order: <FileText className="h-3.5 w-3.5" />,
    estimate: <FileText className="h-3.5 w-3.5" />,
    permit: <FileText className="h-3.5 w-3.5" />,
    contract: <FileText className="h-3.5 w-3.5" />,
    photo: <ImageIcon className="h-3.5 w-3.5" />,
    other: <Paperclip className="h-3.5 w-3.5" />,
  };

  const categoryOrder: DocCategory[] = ["quote", "invoice", "change_order", "estimate", "permit", "contract", "photo", "other"];

  // Group files
  const grouped = new Map<DocCategory, ProjectFile[]>();
  for (const file of files) {
    const cat = classifyFile(file);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(file);
  }

  const renderFileCard = (file: ProjectFile) => {
    const isPdf = file.mimeType?.includes("pdf");
    const isImage = file.mimeType?.startsWith("image/");
    const text = file.storage_path ? extractedText.get(file.storage_path) : null;
    const isLinkedToQuote = file.storage_path && linkedPaths.has(file.storage_path);
    const linkedQuote = isLinkedToQuote
      ? quotes.find((q) => q.attachment_storage_path === file.storage_path)
      : null;

    return (
      <div key={`${file.emailId}-${file.filename}`} className="border rounded-lg p-3 bg-card space-y-2">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${isPdf ? "bg-red-500/10" : isImage ? "bg-blue-500/10" : "bg-muted"}`}>
            {isPdf ? <FileText className="h-5 w-5 text-red-400" /> :
             isImage ? <ImageIcon className="h-5 w-5 text-blue-400" /> :
             <Paperclip className="h-5 w-5 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.filename}</p>
            <p className="text-[10px] text-muted-foreground">
              {formatSize(file.size)} &middot; from &quot;{file.emailSubject}&quot;
            </p>
            {linkedQuote && (
              <p className="text-[10px] text-green-400 mt-0.5">
                Linked to: {linkedQuote.subcontractor_name} {linkedQuote.amount != null ? `— ${fmt(linkedQuote.amount)}` : ""}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-1.5">
          {file.storage_path && (isPdf || isImage) && (
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handlePreview(file)}>
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          )}
          {file.storage_path && (
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handleDownload(file)}>
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          )}
          {isPdf && file.storage_path && !text && (
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-7"
              onClick={() => handleExtractText(file)}
              disabled={extracting === file.storage_path}
            >
              {extracting === file.storage_path ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <FileText className="h-3 w-3 mr-1" />
              )}
              OCR
            </Button>
          )}
        </div>

        {text && (
          <div className="bg-muted rounded p-2 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
            {text.substring(0, 2000)}
            {text.length > 2000 && "..."}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {categoryOrder.map((cat) => {
        const catFiles = grouped.get(cat);
        if (!catFiles || catFiles.length === 0) return null;
        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              {categoryIcons[cat]}
              {categoryLabels[cat]}
              <Badge variant="secondary" className="text-[9px]">{catFiles.length}</Badge>
            </h3>
            <div className="grid gap-2">{catFiles.map(renderFileCard)}</div>
          </div>
        );
      })}

      {/* PDF Preview — full-screen overlay for native pinch-to-zoom */}
      {previewUrl && previewMimeType?.includes("pdf") && (
        <PdfViewer
          url={previewUrl}
          filename={previewFilename}
          onClose={() => setPreviewUrl(null)}
        />
      )}

      {/* Image Preview dialog */}
      <Dialog
        open={!!previewUrl && !!previewMimeType?.startsWith("image/")}
        onOpenChange={(open) => !open && setPreviewUrl(null)}
      >
        <DialogContent className="w-full h-full sm:max-w-4xl sm:h-[85vh] flex flex-col p-0 gap-0 rounded-none sm:rounded-lg">
          <DialogHeader className="p-3 pb-2 space-y-0">
            <DialogTitle className="text-sm font-medium truncate pr-8">{previewFilename}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-3 pb-3 flex items-center justify-center">
            <img src={previewUrl!} alt={previewFilename} className="max-w-full max-h-full object-contain" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
