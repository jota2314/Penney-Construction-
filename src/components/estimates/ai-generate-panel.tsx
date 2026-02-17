"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Mic, MicOff, Upload, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadEstimateFile } from "@/lib/uploads/upload-estimate-file";
import { createEstimateFile, deleteEstimateFile } from "@/lib/actions/estimate-files";
import { bulkCreateLineItems } from "@/lib/actions/estimates";
import { updateProjectDescription } from "@/lib/actions/projects";
import type { EstimateFile } from "@/types/database";

interface AIGeneratePanelProps {
  estimateId: string;
  projectId: string;
  projectType: string;
  projectName: string;
  projectAddress?: string | null;
  projectDescription?: string | null;
  existingFiles: EstimateFile[];
  hasExistingLineItems: boolean;
  onGenerationComplete: () => void;
  overviewText: string;
  onOverviewChange: (text: string) => void;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function AIGeneratePanel({
  estimateId,
  projectId,
  projectType,
  projectName,
  projectAddress,
  existingFiles,
  hasExistingLineItems,
  onGenerationComplete,
  overviewText,
  onOverviewChange,
}: AIGeneratePanelProps) {
  const [files, setFiles] = useState<EstimateFile[]>(existingFiles);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savingOverview, setSavingOverview] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const overviewSaved = useRef(overviewText);

  // ── Generate signed thumbnail URLs ─────────────────────
  const loadThumbnailUrls = useCallback(async (fileList: EstimateFile[]) => {
    const supabase = createClient();
    const urls: Record<string, string> = {};
    for (const file of fileList) {
      const { data } = await supabase.storage
        .from("project-files")
        .createSignedUrl(file.storage_path, 3600); // 1 hour expiry
      if (data?.signedUrl) {
        urls[file.id] = data.signedUrl;
      }
    }
    setThumbnailUrls((prev) => ({ ...prev, ...urls }));
  }, []);

  // Load thumbnails on mount for existing files
  useEffect(() => {
    if (existingFiles.length > 0) {
      loadThumbnailUrls(existingFiles);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Overview save on blur ──────────────────────────────
  const handleSaveOverview = useCallback(async () => {
    if (overviewText === overviewSaved.current) return;
    setSavingOverview(true);
    const result = await updateProjectDescription(projectId, overviewText);
    setSavingOverview(false);
    if (!result.error) {
      overviewSaved.current = overviewText;
    }
  }, [overviewText, projectId]);

  // ── Voice dictation (continuous) ───────────────────────
  function handleVoiceToggle() {
    if (recording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setRecording(false);
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      const results = event.results;
      for (let i = 0; i < results.length; i++) {
        if (results[i].isFinal) {
          transcript += results[i][0].transcript;
        }
      }
      if (transcript) {
        const separator = overviewText.trim() ? " " : "";
        onOverviewChange(overviewText + separator + transcript);
      }
    };

    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setRecording(true);
    recognition.start();
  }

  // ── File upload ────────────────────────────────────────
  async function handleFileSelect(selectedFiles: FileList | null) {
    if (!selectedFiles || selectedFiles.length === 0) return;
    setError(null);
    setUploading(true);

    for (const file of Array.from(selectedFiles)) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(`${file.name}: only JPG, PNG, and WebP files are accepted`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name}: file must be under 10MB`);
        continue;
      }

      const { storagePath, error: uploadError } = await uploadEstimateFile(
        projectId,
        estimateId,
        file
      );

      if (uploadError || !storagePath) {
        setError(`${file.name}: ${uploadError || "Upload failed"}`);
        continue;
      }

      const { error: dbError } = await createEstimateFile({
        estimate_id: estimateId,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      });

      if (dbError) {
        setError(`${file.name}: ${dbError}`);
        continue;
      }

      // Add to local state with a temp ID (will refresh on next page load)
      const newFile: EstimateFile = {
        id: crypto.randomUUID(),
        estimate_id: estimateId,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: "",
        created_at: new Date().toISOString(),
      };
      setFiles((prev) => [...prev, newFile]);

      // Generate signed URL for the new thumbnail
      loadThumbnailUrls([newFile]);
    }

    setUploading(false);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDeleteFile(file: EstimateFile) {
    const { error: deleteError } = await deleteEstimateFile(
      file.id,
      file.storage_path
    );
    if (deleteError) {
      setError(deleteError);
      return;
    }
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
  }

  // ── Generate estimate ──────────────────────────────────
  function handleGenerateClick() {
    if (hasExistingLineItems) {
      setConfirmOpen(true);
    } else {
      runGeneration("replace");
    }
  }

  async function runGeneration(mode: "replace" | "append") {
    setConfirmOpen(false);
    setGenerating(true);
    setError(null);

    try {
      // Save overview first if changed
      await handleSaveOverview();

      // Generate signed URLs for uploaded files
      const fileUrls: string[] = [];
      if (files.length > 0) {
        const supabase = createClient();
        for (const file of files) {
          const { data } = await supabase.storage
            .from("project-files")
            .createSignedUrl(file.storage_path, 600); // 10 min expiry
          if (data?.signedUrl) {
            fileUrls.push(data.signedUrl);
          }
        }
      }

      // Call the generate API
      const res = await fetch("/api/generate-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectType,
          projectName,
          projectAddress: projectAddress || undefined,
          projectDescription: overviewText.trim(),
          fileUrls,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate estimate");
      }

      const { lineItems } = await res.json();

      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        throw new Error("AI generated no line items");
      }

      // Bulk create line items via server action
      const result = await bulkCreateLineItems(
        estimateId,
        projectId,
        lineItems,
        mode
      );

      if (result.error) {
        throw new Error(result.error);
      }

      onGenerationComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate estimate");
    } finally {
      setGenerating(false);
    }
  }

  // ── Drag & drop handlers ───────────────────────────────
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    handleFileSelect(e.dataTransfer.files);
  }

  return (
    <div className="border rounded-md bg-muted/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">AI Estimate Generator</h3>
        {savingOverview && (
          <span className="text-xs text-muted-foreground">Saving...</span>
        )}
      </div>

      {/* Project description textarea + voice */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">
          Describe the full project for AI
        </label>
        <div className="relative">
          <Textarea
            value={overviewText}
            onChange={(e) => onOverviewChange(e.target.value)}
            onBlur={handleSaveOverview}
            placeholder="Describe the full project so the AI can generate a complete estimate. E.g.: Full kitchen remodel — gutting cabinets, removing wall between kitchen and living room, adding a 12ft beam, new island with quartz countertops, hardwood floors throughout..."
            className="text-sm min-h-[100px] resize-y pr-10"
            rows={4}
            disabled={generating}
          />
          <button
            type="button"
            onClick={handleVoiceToggle}
            disabled={generating}
            className={`absolute top-2 right-2 p-1.5 rounded transition-colors ${
              recording
                ? "bg-red-100 text-red-600 hover:bg-red-200"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
            } disabled:opacity-30 disabled:pointer-events-none`}
            title={recording ? "Stop recording" : "Dictate with voice"}
          >
            {recording ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          This description is also used for per-row AI scope generation.
        </p>
      </div>

      {/* File upload zone */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">
          Photos / Drawings (optional)
        </label>
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed rounded-md p-4 text-center cursor-pointer hover:bg-muted/50 transition-colors"
        >
          <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
          <p className="text-sm text-muted-foreground">
            {uploading
              ? "Uploading..."
              : "Drop images here or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            JPG, PNG, WebP — 10MB max per file
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          multiple
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
      </div>

      {/* File previews */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="relative group w-20 h-20 rounded border overflow-hidden bg-muted"
            >
              {thumbnailUrls[file.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailUrls[file.id]}
                  alt={file.file_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFile(file);
                }}
                className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
                <p className="text-[10px] text-white truncate">
                  {file.file_name}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Generate button */}
      <Button
        onClick={handleGenerateClick}
        disabled={!overviewText.trim() || generating || uploading}
        className="w-full"
      >
        {generating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Analyzing project and generating estimate...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Estimate with AI
          </>
        )}
      </Button>

      {/* Confirmation dialog for existing line items */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Existing Line Items Found</DialogTitle>
            <DialogDescription>
              This estimate already has line items. How would you like to handle
              the AI-generated items?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => runGeneration("append")}
            >
              Add to Existing
            </Button>
            <Button
              variant="default"
              onClick={() => runGeneration("replace")}
            >
              Replace All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
