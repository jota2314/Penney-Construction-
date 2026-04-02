"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  X,
  Loader2,
  ChevronDown,
  Mail,
  Paperclip,
  FileText,
  Trash2,
  Upload,
} from "lucide-react";
import type { DraftState, DraftAttachment, StoredEmail, AttachmentMeta } from "@/components/command-center/email-detail-types";
import { EmailAutocomplete } from "@/components/ui/email-autocomplete";

interface EmailDraftEditorProps {
  open: boolean;
  draft: DraftState;
  originalEmail: StoredEmail;
  onUpdateField: (field: keyof DraftState, value: string) => void;
  onAddAttachment: (att: DraftAttachment) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
  onDiscard: () => void;
  sending: boolean;
}

interface ProjectFileItem {
  filename: string;
  storagePath: string;
  mimeType: string;
  size: number;
  source: string;
}

export function EmailDraftEditor({
  open,
  draft,
  originalEmail,
  onUpdateField,
  onAddAttachment,
  onRemoveAttachment,
  onSend,
  onDiscard,
  sending,
}: EmailDraftEditorProps) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFileItem[]>([]);
  const [projectFilesLoaded, setProjectFilesLoaded] = useState(false);

  useEffect(() => {
    if (open) {
      setTimeout(() => bodyRef.current?.focus(), 200);
    }
  }, [open]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 200)}px`;
  }, [draft.body]);

  if (!open) return null;

  // Available attachments from the original email that aren't already added
  const availableAttachments = (originalEmail.attachments || []).filter(
    (att) =>
      att.storage_path &&
      !draft.attachments.some((da) => da.storagePath === att.storage_path)
  );

  // Available project files that aren't already added
  const availableProjectFiles = projectFiles.filter(
    (pf) => !draft.attachments.some((da) => da.storagePath === pf.storagePath)
  );

  async function loadProjectFiles() {
    if (projectFilesLoaded || !originalEmail.project_id) return;
    setProjectFilesLoaded(true);
    try {
      const res = await fetch("/api/todo-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_project_files",
          data: { project_id: originalEmail.project_id },
        }),
      });
      const data = await res.json();
      setProjectFiles(data.files || []);
    } catch {
      // ignore
    }
  }

  function handleAddFromEmail(att: AttachmentMeta) {
    if (!att.storage_path) return;
    onAddAttachment({
      filename: att.filename,
      mimeType: att.mimeType,
      storagePath: att.storage_path,
      size: att.size,
    });
    setShowAttachmentPicker(false);
  }

  function handleAddProjectFile(file: ProjectFileItem) {
    onAddAttachment({
      filename: file.filename,
      mimeType: file.mimeType,
      storagePath: file.storagePath,
      size: file.size,
    });
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] || "";
        onAddAttachment({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          storagePath: `local://${file.name}`,
          size: file.size,
          content: base64,
        });
      };
      reader.readAsDataURL(file);
    });
    setShowAttachmentPicker(false);
    // Reset input so same file can be selected again
    e.target.value = "";
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onDiscard} />

      <div className="fixed inset-4 md:inset-x-[10%] md:inset-y-[5%] z-50 flex flex-col bg-background rounded-lg border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Compose Reply</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 text-muted-foreground"
              onClick={onDiscard}
              disabled={sending}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Discard
            </Button>
            <Button
              size="sm"
              className="text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={onSend}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              Send
            </Button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Email fields */}
          <div className="px-4 py-3 space-y-2.5 border-b">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-10 shrink-0 font-medium">To:</label>
              <EmailAutocomplete
                value={draft.to}
                onChange={(v) => onUpdateField("to", v)}
                placeholder="Start typing a name..."
                disabled={sending}
                className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm h-9 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-10 shrink-0 font-medium">CC:</label>
              <EmailAutocomplete
                value={draft.cc}
                onChange={(v) => onUpdateField("cc", v)}
                placeholder="Start typing to add people..."
                disabled={sending}
                className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm h-9 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-10 shrink-0 font-medium">Subj:</label>
              <Input
                value={draft.subject}
                onChange={(e) => onUpdateField("subject", e.target.value)}
                className="text-sm h-9"
                disabled={sending}
              />
            </div>
          </div>

          {/* Attachments */}
          <div className="px-4 py-2 border-b">
            <div className="flex items-center gap-2 flex-wrap">
              {draft.attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-xs"
                >
                  <FileText className="h-3 w-3 text-amber-500" />
                  <span className="truncate max-w-[150px]">{att.filename}</span>
                  <span className="text-muted-foreground">({formatSize(att.size)})</span>
                  <button
                    onClick={() => onRemoveAttachment(i)}
                    className="text-muted-foreground hover:text-red-400 ml-0.5"
                    disabled={sending}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 gap-1"
                  onClick={() => {
                    setShowAttachmentPicker(!showAttachmentPicker);
                    loadProjectFiles();
                  }}
                  disabled={sending}
                >
                  <Paperclip className="h-3 w-3" />
                  Attach
                </Button>

                {showAttachmentPicker && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowAttachmentPicker(false)} />
                    <div className="absolute top-full left-0 mt-1 z-20 bg-background border rounded-lg shadow-lg p-2 min-w-[300px] max-w-[400px] max-h-64 overflow-y-auto">
                      {/* Email attachments */}
                      {availableAttachments.length > 0 && (
                        <>
                          <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                            From this email:
                          </p>
                          {availableAttachments.map((att, i) => (
                            <button
                              key={`email-${i}`}
                              onClick={() => handleAddFromEmail(att)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-xs text-left"
                            >
                              <FileText className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                              <span className="truncate">{att.filename}</span>
                              <span className="text-muted-foreground shrink-0">
                                ({formatSize(att.size)})
                              </span>
                            </button>
                          ))}
                        </>
                      )}

                      {/* Project files */}
                      {availableProjectFiles.length > 0 && (
                        <>
                          <p className="text-xs font-medium text-muted-foreground px-2 py-1 mt-1 border-t pt-2">
                            Project files:
                          </p>
                          {availableProjectFiles.map((file, i) => (
                            <button
                              key={`proj-${i}`}
                              onClick={() => handleAddProjectFile(file)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-xs text-left"
                            >
                              <FileText className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span className="truncate flex-1">{file.filename}</span>
                              <span className="text-muted-foreground shrink-0">
                                {file.source}
                              </span>
                            </button>
                          ))}
                        </>
                      )}

                      {availableAttachments.length === 0 && availableProjectFiles.length === 0 && (
                        <p className="text-xs text-muted-foreground px-2 py-1">
                          {!projectFilesLoaded ? "Loading project files..." : "No files from project"}
                        </p>
                      )}

                      {/* Upload from computer */}
                      <div className="border-t mt-1 pt-1">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-xs text-left font-medium"
                        >
                          <Upload className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          <span>Upload from computer</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Hidden file input for computer uploads */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileUpload}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.zip,.csv,.txt"
              />
            </div>
          </div>

          {/* Body editor */}
          <div className="px-4 py-3">
            <Textarea
              ref={bodyRef}
              value={draft.body}
              onChange={(e) => onUpdateField("body", e.target.value)}
              className="text-sm min-h-[250px] resize-none border-0 shadow-none focus-visible:ring-0 p-0"
              placeholder="Write your email..."
              disabled={sending}
            />
          </div>

          {/* Original email reference */}
          <details className="mx-4 mb-4 border rounded-lg">
            <summary className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground cursor-pointer hover:bg-muted/50">
              <ChevronDown className="h-3 w-3" />
              Original email from {originalEmail.from_name || originalEmail.from_email}
            </summary>
            <div className="px-3 pb-3 text-xs text-muted-foreground/70 whitespace-pre-wrap max-h-48 overflow-y-auto border-t pt-2">
              {originalEmail.body || originalEmail.snippet || "No content"}
            </div>
          </details>
        </div>

        {/* Bottom send bar */}
        <div className="px-4 py-3 border-t shrink-0 flex justify-between items-center bg-muted/30">
          <p className="text-xs text-muted-foreground">
            {draft.attachments.length > 0
              ? `${draft.attachments.length} attachment${draft.attachments.length > 1 ? "s" : ""}`
              : "Use the AI chat to refine this email"}
          </p>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={onSend}
            disabled={sending}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Email
          </Button>
        </div>
      </div>
    </>
  );
}
