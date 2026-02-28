"use client";

import { useState, useRef, useCallback, useEffect } from "react";
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
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  ImageIcon,
  VideoOff,
  SwitchCamera,
} from "lucide-react";
import type { SiteVisitNote, SiteVisitFile } from "@/types/database";

// Unified timeline entry
type TimelineEntry =
  | { type: "note"; data: SiteVisitNote }
  | { type: "photo"; data: SiteVisitFile };

interface SiteVisitCapturePanelProps {
  siteVisitId: string;
  projectId: string;
  notes: SiteVisitNote[];
  files: SiteVisitFile[];
  onNotesChange: (notes: SiteVisitNote[]) => void;
  onFilesChange: (files: SiteVisitFile[]) => void;
}

export function SiteVisitCapturePanel({
  siteVisitId,
  projectId,
  notes,
  files,
  onNotesChange,
  onFilesChange,
}: SiteVisitCapturePanelProps) {
  const [typedText, setTypedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment"
  );
  const [flashEffect, setFlashEffect] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Speech refs
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

  // ── Camera ──────────────────────────────────────────

  const startCamera = useCallback(
    async (facing: "environment" | "user" = facingMode) => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setCameraActive(true);
        setCameraError(null);
      } catch {
        setCameraError("Could not access camera. Check permissions.");
        setCameraActive(false);
      }
    },
    [facingMode]
  );

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFlipCamera() {
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    await startCamera(newFacing);
  }

  async function handleShutter() {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);

    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 150);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([blob], `site-visit-${timestamp}.jpg`, {
      type: "image/jpeg",
    });

    setUploading(true);

    const uploadResult = await uploadSiteVisitFile(
      projectId,
      siteVisitId,
      file
    );
    if (!uploadResult.error && uploadResult.storagePath) {
      const dbResult = await createSiteVisitFile({
        site_visit_id: siteVisitId,
        storage_path: uploadResult.storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      });

      if (!dbResult.error && dbResult.file) {
        onFilesChange([...files, dbResult.file!]);
      }
    }

    setUploading(false);
  }

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
      onNotesChange([...notes, result.note!]);
      if (source === "typed") setTypedText("");
    }
  }

  async function handleUpdateNote(noteId: string) {
    if (!editText.trim()) return;
    setSaving(true);

    const result = await updateSiteVisitNote(noteId, editText.trim());
    setSaving(false);

    if (!result.error) {
      onNotesChange(
        notes.map((n) =>
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
      onNotesChange(notes.filter((n) => n.id !== noteId));
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

  async function handleGallerySelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    setUploading(true);

    const newFiles = [...files];
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
        newFiles.push(dbResult.file!);
      }
    }

    onFilesChange(newFiles);
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
      onFilesChange(files.filter((f) => f.id !== file.id));
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Live Camera Viewfinder ── */}
      <div className="relative rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full aspect-[4/3] object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Flash overlay */}
        {flashEffect && (
          <div className="absolute inset-0 bg-white z-20 animate-pulse" />
        )}

        {/* Camera error overlay */}
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 p-4">
            <VideoOff className="h-10 w-10 text-white/60 mb-3" />
            <p className="text-white/80 text-sm text-center mb-3">
              {cameraError}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => startCamera()}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Uploading indicator */}
        {uploading && (
          <div className="absolute top-3 right-3 z-10 bg-black/60 rounded-full px-3 py-1 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-white" />
            <span className="text-xs text-white">Saving...</span>
          </div>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <div className="absolute top-3 left-3 z-10 bg-black/60 rounded-full px-3 py-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-white font-medium">REC</span>
          </div>
        )}

        {/* Controls overlay */}
        <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black/70 to-transparent pt-10 pb-4 px-4">
          <div className="flex items-center justify-between">
            {/* Mic toggle */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`h-12 w-12 rounded-full ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-white/20 hover:bg-white/30 text-white"
              }`}
              onClick={isRecording ? stopRecording : startRecording}
            >
              {isRecording ? (
                <MicOff className="h-6 w-6" />
              ) : (
                <Mic className="h-6 w-6" />
              )}
            </Button>

            {/* Shutter button */}
            <button
              type="button"
              disabled={!cameraActive || uploading}
              onClick={handleShutter}
              className="h-16 w-16 rounded-full border-4 border-white bg-white/30 hover:bg-white/50 active:scale-90 transition-transform disabled:opacity-50 flex items-center justify-center"
            >
              <div className="h-12 w-12 rounded-full bg-white" />
            </button>

            {/* Flip camera */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-12 w-12 rounded-full bg-white/20 hover:bg-white/30 text-white"
              onClick={handleFlipCamera}
            >
              <SwitchCamera className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </div>

      {/* Live transcript */}
      {isRecording && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
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

      {/* Gallery fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleGallerySelect}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageIcon className="mr-2 h-4 w-4" />
        Choose from Gallery
      </Button>

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

      {/* ── Timeline feed ── */}
      <div className="space-y-3">
        {timeline.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Tap the shutter to take photos and the mic to start recording.
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

  useEffect(() => {
    getSignedUrl(file.storage_path).then(setUrl);
  }, [file.storage_path]); // eslint-disable-line react-hooks/exhaustive-deps

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
