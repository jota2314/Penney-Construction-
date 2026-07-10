"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  Loader2,
  CheckCircle,
  FileText,
  DollarSign,
  Link2,
  ExternalLink,
  ChevronDown,
  Bot,
  Mail,
  PanelLeft,
  PanelRight,
  Columns2,
  Reply,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PdfPages } from "@/components/ui/pdf-viewer";
import { ImageViewer } from "@/components/ui/image-viewer";
import { linkEmailToProject as serverLinkEmail } from "@/lib/actions/email-actions";
import { formatEmailBody } from "@/lib/email/format-email-body";
import type { StoredEmail, AttachmentMeta, ProjectRef } from "@/components/command-center/email-detail-types";

// ── Props ────────────────────────────────────────────────────────

interface EmailContentProps {
  email: StoredEmail;
  projects: ProjectRef[];
  processed: boolean;
  backUrl?: string;
  onSendChat: (text: string) => void;
  onReply?: () => void;
  router: { refresh: () => void };
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  otherCollapsed?: boolean;
  onShowOther?: () => void;
  viewMode?: "split" | "email" | "chat";
  onViewModeChange?: (mode: "split" | "email" | "chat") => void;
}

// ── Component ───────────────────────────────────────────────────

export function EmailContent({
  email,
  projects,
  processed,
  backUrl,
  onSendChat,
  onReply,
  router,
  collapsed,
  onToggleCollapse,
  otherCollapsed,
  onShowOther,
  viewMode = "split",
  onViewModeChange,
}: EmailContentProps) {
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [previewStoragePath, setPreviewStoragePath] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [showExtractedText, setShowExtractedText] = useState(false);
  const [assigningProject, setAssigningProject] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loggingQuote, setLoggingQuote] = useState(false);

  const fromDisplay = email.from_name || email.from_email.split("@")[0];
  const dateDisplay = new Date(email.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const timeDisplay = new Date(email.date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  // Open attachment preview
  async function handleAttachmentClick(att: AttachmentMeta) {
    if (!att.storage_path) return;

    setPreviewFilename(att.filename);
    setPreviewMimeType(att.mimeType);
    setPreviewStoragePath(att.storage_path);
    setExtractedText(att.text_content || null);
    setShowExtractedText(false);
    setSelectedProjectId("");

    const supabase = createClient();
    const { data } = await supabase.storage
      .from("email-attachments")
      .createSignedUrl(att.storage_path, 3600);

    if (data?.signedUrl) {
      if (att.mimeType?.includes("pdf") || att.mimeType?.startsWith("image/")) {
        setPreviewUrl(data.signedUrl);
      } else {
        window.open(data.signedUrl, "_blank");
      }
    }
  }

  // Extract text from PDF
  async function handleExtractText() {
    setExtracting(true);
    try {
      const res = await fetch("/api/extract-attachment-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id }),
      });
      const data = await res.json();
      if (data.attachments) {
        for (const att of data.attachments) {
          if (att.storage_path === previewStoragePath && att.text_content) {
            setExtractedText(att.text_content);
            setShowExtractedText(true);
            break;
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setExtracting(false);
    }
  }

  // Assign attachment to project
  async function handleAssignToProject() {
    if (!selectedProjectId) return;
    setAssigningProject(true);
    try {
      await serverLinkEmail(email.id, "");
      // Update project_id directly
      const supabase = createClient();
      await supabase
        .from("inbox_emails")
        .update({ project_id: selectedProjectId })
        .eq("id", email.id);
      router.refresh();
    } catch {
      // ignore
    } finally {
      setAssigningProject(false);
    }
  }

  // Log attachment as a quote — send the extracted text to AI chat with storage path
  function handleLogAsQuote() {
    const projectName = projects.find((p) => p.id === selectedProjectId)?.name;
    const storagePath = previewStoragePath || "";
    const prompt = projectName
      ? `This PDF "${previewFilename}" (storage_path: "${storagePath}") is a sub quote/invoice for the ${projectName} project. Read the extracted content and create a quote_request from it. IMPORTANT: include attachment_storage_path: "${storagePath}" in the create_quote data so the file is linked to the quote. Also include the correct document_type (quote, invoice, change_order, estimate, etc). Link the email to the project too.`
      : `This PDF "${previewFilename}" (storage_path: "${storagePath}") is a sub quote/invoice. Read the extracted content and create a quote_request from it. IMPORTANT: include attachment_storage_path: "${storagePath}" in the create_quote data so the file is linked to the quote. Also include the correct document_type (quote, invoice, change_order, estimate, etc). Tell me which project it should be linked to.`;

    setPreviewUrl(null);
    onSendChat(prompt);
  }

  return (
    <>
      {/* ─── Email Panel ─── */}
      {/* Mobile: collapsible card at top */}
      {/* Desktop: scrollable left column */}
      <div className={`${viewMode === "chat" ? "md:hidden" : collapsed ? "md:flex md:flex-col md:w-auto md:flex-none" : "md:flex-1 md:flex md:flex-col"} md:min-h-0 md:min-w-0 md:border-r`}>
        {/* Email header — always visible, clickable to toggle */}
        <div className="border-b">
          {/* Top bar: back + subject + status */}
          <div className="flex items-center gap-2 p-3 pb-0 md:p-4 md:pb-0">
            <Button variant="ghost" size="icon" asChild className="shrink-0 h-8 w-8">
              <Link href={backUrl || "/command-center/emails"}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <button
              onClick={onToggleCollapse}
              className="font-semibold text-sm md:text-base truncate flex-1 text-left hover:text-amber-500 transition-colors"
            >
              {email.subject}
            </button>
            {processed && (
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
            )}
            <div
              className={`p-1 rounded shrink-0 ${email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"}`}
            >
              {email.direction === "inbound" ? (
                <ArrowDownLeft className="h-3 w-3 text-blue-400" />
              ) : (
                <ArrowUpRight className="h-3 w-3 text-green-400" />
              )}
            </div>
            {onViewModeChange && (
              <div className="hidden md:flex items-center border rounded-md shrink-0">
                <button
                  onClick={() => onViewModeChange("email")}
                  className={`p-1 ${viewMode === "email" ? "bg-muted" : "hover:bg-muted/50"}`}
                  title="Email only"
                >
                  <PanelLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onViewModeChange("split")}
                  className={`p-1 ${viewMode === "split" ? "bg-muted" : "hover:bg-muted/50"}`}
                  title="Split view"
                >
                  <Columns2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onViewModeChange("chat")}
                  className={`p-1 ${viewMode === "chat" ? "bg-muted" : "hover:bg-muted/50"}`}
                  title="Chat only"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {onToggleCollapse && (
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform hidden md:block ${collapsed ? "-rotate-90" : ""}`}
              />
            )}
          </div>

          {/* Compact meta row (mobile: always shown, clickable to expand) */}
          {!collapsed && <button
            className="w-full flex items-center gap-2 px-3 py-2 md:px-4 md:py-2 text-left md:cursor-default"
            onClick={() => setEmailExpanded((v) => !v)}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate">
                <span className="font-medium text-foreground">{fromDisplay}</span>
                <span className="mx-1.5">&middot;</span>
                {dateDisplay} at {timeDisplay}
              </p>
            </div>
            {email.attachments && email.attachments.length > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                <Paperclip className="h-2.5 w-2.5" />
                {email.attachments.length}
              </Badge>
            )}
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform md:hidden ${emailExpanded ? "rotate-180" : ""}`}
            />
          </button>}

          {/* Expanded details (mobile: toggled, desktop: always shown) */}
          {!collapsed && <div className={`overflow-hidden transition-all duration-200 ${emailExpanded ? "max-h-[500px]" : "max-h-0"} md:max-h-none`}>
            <div className="px-3 pb-3 md:px-4 md:pb-3 space-y-2">
              <div className="text-xs text-muted-foreground space-y-0.5 bg-muted/50 rounded-lg p-2.5">
                <p className="truncate">
                  <span className="font-medium text-foreground/70">From:</span>{" "}
                  {email.from_name} &lt;{email.from_email}&gt;
                </p>
                <p className="truncate">
                  <span className="font-medium text-foreground/70">To:</span>{" "}
                  {email.to_name} &lt;{email.to_email}&gt;
                </p>
                <p>
                  <span className="font-medium text-foreground/70">Date:</span>{" "}
                  {new Date(email.date).toLocaleString("en-US", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })}
                </p>
              </div>

              {/* Attachments */}
              {email.attachments && email.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {email.attachments.map((att, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className={`text-[10px] gap-1 cursor-pointer hover:bg-amber-500/20 hover:border-amber-500/30 transition-colors ${
                        att.text_content ? "border-green-500/30 bg-green-500/5" : ""
                      }`}
                      onClick={() => handleAttachmentClick(att)}
                    >
                      {att.mimeType?.includes("pdf") ? (
                        <FileText className={`h-2.5 w-2.5 ${att.text_content ? "text-green-400" : ""}`} />
                      ) : (
                        <Paperclip className="h-2.5 w-2.5" />
                      )}
                      {att.filename}
                      {att.text_content && <CheckCircle className="h-2 w-2 text-green-400" />}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Email body preview (mobile only — shown in expanded state) */}
              <div
                className="md:hidden text-xs max-h-40 overflow-y-auto rounded-lg border email-body-rendered"
                dangerouslySetInnerHTML={{
                  __html: formatEmailBody(email.body || email.snippet || "No content"),
                }}
              />
            </div>
          </div>}
        </div>

        {/* Email body — desktop only (scrollable area, hidden when collapsed) */}
        {!collapsed && (
          <div className="hidden md:flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-4">
              <div
                className="text-sm max-w-2xl email-body-rendered"
                dangerouslySetInnerHTML={{
                  __html: formatEmailBody(email.body || email.snippet || "No content"),
                }}
              />
            </div>
            {/* Reply button at bottom of email panel */}
            {onReply && (
              <div className="border-t p-3 shrink-0">
                <Button
                  onClick={onReply}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-xl h-10"
                >
                  <Reply className="h-4 w-4 mr-2" />
                  Reply
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* PDF Preview — full-screen overlay for native pinch-to-zoom */}
      {previewUrl && previewMimeType?.includes("pdf") && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
            <p className="text-sm font-medium truncate flex-1 mr-2">{previewFilename}</p>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setPreviewUrl(null)}>
              <ExternalLink className="h-4 w-4 sr-only" />
              <span className="text-lg leading-none">&times;</span>
            </Button>
          </div>

          {/* Action bar */}
          <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b shrink-0">
            <Button variant="outline" size="sm" className="text-xs h-7 gap-1.5" onClick={handleExtractText} disabled={extracting}>
              {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              {extractedText ? "Re-extract" : "Extract Text"}
            </Button>

            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="h-7 text-xs rounded border bg-background px-2 min-w-0 max-w-[160px]"
            >
              <option value="">Assign to project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {selectedProjectId && (
              <Button variant="outline" size="sm" className="text-xs h-7 gap-1.5" onClick={handleAssignToProject} disabled={assigningProject}>
                {assigningProject ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                Link
              </Button>
            )}

            <Button variant="default" size="sm" className="text-xs h-7 gap-1.5 bg-amber-600 hover:bg-amber-700" onClick={() => { setPreviewUrl(null); handleLogAsQuote(); }}>
              <DollarSign className="h-3 w-3" />
              Log as Quote
            </Button>
          </div>

          {/* PDF pages — scrollable with native pinch-to-zoom */}
          <PdfPages url={previewUrl} filename={previewFilename} />
        </div>
      )}

      {/* Image Preview */}
      {previewMimeType?.startsWith("image/") && (
        <ImageViewer
          url={previewUrl}
          filename={previewFilename}
          onClose={() => setPreviewUrl(null)}
        />
      )}
    </>
  );
}
