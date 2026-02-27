"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  addSiteVisitNote,
  updateSiteVisitNote,
  deleteSiteVisitNote,
} from "@/lib/actions/site-visits";
import {
  createSiteVisitFile,
  deleteSiteVisitFile,
} from "@/lib/actions/site-visit-files";
import { uploadSiteVisitFile } from "@/lib/uploads/upload-site-visit-file";
import { createClient } from "@/lib/supabase/client";
import {
  Mic,
  MicOff,
  Camera,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  ImageIcon,
} from "lucide-react";
import type { SiteVisitNote, SiteVisitFile } from "@/types/database";

// Unified timeline entry — either a note or a photo
type TimelineEntry =
  | { type: "note"; data: SiteVisitNote }
  | { type: "photo"; data: SiteVisitFile };

interface SiteVisitCapturePanelProps {
  siteVisitId: string;
  projectId: string;
  notes: SiteVisitNote[];
  files: SiteVisitFile[];
}

export function SiteVisitCapturePanel({
  siteVisitId,
  projectId,
  notes: initialNotes,
  files: initialFiles,
}: SiteVisitCapturePanelProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [files, setFiles] = useState(initialFiles);
  const [typedText, setTypedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const recognitionRef = useRef<ReturnType<typeof createRecognition> | null>(
    null
  );
  const transcriptRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build chronological timeline
  const timeline: TimelineEntry[] = [
    ...notes.map((n): TimelineEntry => ({ type: "note", data: n })),
    ...files.map((f): TimelineEntry => ({ type: "photo", data: f })),
  ].sort(
    (a, b) =>
      new Date(a.data.created_at).getTime() -
      new Date(b.data.created_at).getTime()
  );

  // ── Speech Recognition ─────────────────────────────

  function createRecognition() {
    const SpeechRecognition =
      (
        window as unknown as {
          webkitSpeechRecognition?: typeof window.SpeechRecognition;
        }
      ).webkitSpeechRecognition ?? window.SpeechRecognition;
    if (!SpeechRecognition) return null;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    return recognition;
  }

  const startRecording = useCallback(() => {
    const recognition = createRecognition();
    if (!recognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    transcriptRef.current = "";
    setLiveTranscript("");
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      transcriptRef.current = transcript;
      setLiveTranscript(transcript);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      setLiveTranscript("");
    };

    recognition.onend = () => {
      setIsRecording(false);
      setLiveTranscript("");
      if (transcriptRef.current.trim()) {
        handleAddNote(transcriptRef.current.trim(), "voice");
      }
    };

    recognition.start();
    setIsRecording(true);
  }, [siteVisitId]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopRecording() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }

  // ── Notes ──────────────────────────────────────────

  async function handleAddNote(content: string, source: "typed" | "voice") {
    if (!content.trim()) return;
    setSaving(true);

    const result = await addSiteVisitNote({
      site_visit_id: siteVisitId,
      content: content.trim(),
      source,
    });

    setSaving(false);

    if (!result.error && result.note) {
      setNotes((prev) => [...prev, result.note!]);
      if (source === "typed") setTypedText("");
    }
  }

  async function handleUpdateNote(noteId: string) {
    if (!editText.trim()) return;
    setSaving(true);

    const result = await updateSiteVisitNote(noteId, editText.trim());
    setSaving(false);

    if (!result.error) {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, content: editText.trim() } : n
        )
      );
      setEditingId(null);
      setEditText("");
    }
  }

  async function handleDeleteNote(noteId: string) {
    const result = await deleteSiteVisitNote(noteId, siteVisitId);
    if (!result.error) {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    }
  }

  // ── Photos ─────────────────────────────────────────

  function getSignedUrl(storagePath: string) {
    const supabase = createClient();
    return supabase.storage
      .from("project-files")
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => data?.signedUrl ?? "");
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    setUploading(true);

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];

      const uploadResult = await uploadSiteVisitFile(
        projectId,
        siteVisitId,
        file
      );
      if (uploadResult.error || !uploadResult.storagePath) continue;

      const dbResult = await createSiteVisitFile({
        site_visit_id: siteVisitId,
        storage_path: uploadResult.storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      });

      if (!dbResult.error && dbResult.file) {
        setFiles((prev) => [...prev, dbResult.file!]);
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDeleteFile(file: SiteVisitFile) {
    const result = await deleteSiteVisitFile(
      file.id,
      file.storage_path,
      siteVisitId
    );
    if (!result.error) {
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Sticky capture bar: Mic + Camera side by side ── */}
      <div className="sticky top-0 z-10 bg-background pb-3 border-b">
        <div className="flex items-center gap-3">
          {/* Mic toggle */}
          <Button
            type="button"
            variant={isRecording ? "destructive" : "default"}
            size="lg"
            className="h-14 flex-1 text-base"
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? (
              <>
                <MicOff className="mr-2 h-5 w-5" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="mr-2 h-5 w-5" />
                Record
              </>
            )}
          </Button>

          {/* Camera */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-14 flex-1 text-base"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Camera className="mr-2 h-5 w-5" />
                Photo
              </>
            )}
          </Button>
        </div>

        {/* Live transcript preview */}
        {isRecording && (
          <div className="mt-2 rounded-md bg-destructive/10 border border-destructive/20 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
              <span className="text-xs font-medium text-destructive">
                Recording...
              </span>
            </div>
            {liveTranscript ? (
              <p className="text-sm text-muted-foreground italic">
                {liveTranscript}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Listening... speak and it will appear here
              </p>
            )}
          </div>
        )}

        {/* Gallery pick (smaller, secondary) */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-muted-foreground"
          disabled={uploading}
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.removeAttribute("capture");
              fileInputRef.current.click();
              setTimeout(() => {
                fileInputRef.current?.setAttribute("capture", "environment");
              }, 1000);
            }
          }}
        >
          <ImageIcon className="mr-2 h-4 w-4" />
          Choose from Gallery
        </Button>
      </div>

      {/* ── Typed note input ── */}
      <div className="flex gap-2">
        <Textarea
          placeholder="Type a note..."
          value={typedText}
          onChange={(e) => setTypedText(e.target.value)}
          rows={2}
          className="min-h-[44px]"
        />
        <Button
          type="button"
          size="icon"
          className="h-[44px] w-[44px] shrink-0"
          disabled={!typedText.trim() || saving}
          onClick={() => handleAddNote(typedText, "typed")}
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Timeline feed: notes + photos interleaved ── */}
      <div className="space-y-3">
        {timeline.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Start recording or take a photo to begin documenting.
          </p>
        )}

        {timeline.map((entry) => {
          if (entry.type === "note") {
            const note = entry.data;
            return (
              <Card key={`note-${note.id}`}>
                <CardContent className="py-3 px-4">
                  {editingId === note.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          disabled={saving}
                          onClick={() => handleUpdateNote(note.id)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm whitespace-pre-wrap">
                          {note.content}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {note.source === "voice" ? "Voice" : "Typed"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(note.created_at).toLocaleTimeString(
                              "en-US",
                              { hour: "numeric", minute: "2-digit" }
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingId(note.id);
                            setEditText(note.content);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleDeleteNote(note.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          }

          // Photo entry
          const file = entry.data;
          return (
            <PhotoTimelineCard
              key={`photo-${file.id}`}
              file={file}
              getSignedUrl={getSignedUrl}
              onDelete={() => handleDeleteFile(file)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Photo card for the timeline ──────────────────────

function PhotoTimelineCard({
  file,
  getSignedUrl,
  onDelete,
}: {
  file: SiteVisitFile;
  getSignedUrl: (path: string) => Promise<string>;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load signed URL on mount
  useState(() => {
    getSignedUrl(file.storage_path).then(setUrl);
  });

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[4/3] bg-muted">
        {url ? (
          <Image
            src={url}
            alt={file.file_name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 50vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <CardContent className="py-2 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Photo
          </Badge>
          <span className="text-xs text-muted-foreground">
            {new Date(file.created_at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            await onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
