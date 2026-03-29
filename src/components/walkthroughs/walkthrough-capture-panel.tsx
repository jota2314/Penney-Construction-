"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  addWalkthroughNote,
  updateWalkthroughNote,
  deleteWalkthroughNote,
} from "@/lib/actions/walkthroughs";
import {
  createWalkthroughFile,
  deleteWalkthroughFile,
} from "@/lib/actions/walkthrough-files";
import { uploadWalkthroughFile } from "@/lib/uploads/upload-walkthrough-file";
import { createClient } from "@/lib/supabase/client";
import { useCamera } from "@/hooks/use-camera";
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
import type { WalkthroughNote, WalkthroughFile } from "@/types/database";

interface WalkthroughCapturePanelProps {
  walkthroughId: string;
  notes: WalkthroughNote[];
  files: WalkthroughFile[];
  onNotesChange: (notes: WalkthroughNote[]) => void;
  onFilesChange: (files: WalkthroughFile[]) => void;
}

export function WalkthroughCapturePanel({
  walkthroughId,
  notes,
  files,
  onNotesChange,
  onFilesChange,
}: WalkthroughCapturePanelProps) {
  const [typedText, setTypedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Camera (shared hook)
  const {
    videoRef,
    canvasRef,
    isActive: cameraActive,
    error: cameraError,
    flashEffect,
    startCamera,
    toggleFacingMode: handleFlipCamera,
    capturePhoto,
  } = useCamera();

  // Speech refs
  const recognitionRef = useRef<ReturnType<typeof createRecognition> | null>(
    null
  );
  const transcriptRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sorted notes for display
  const sortedNotes = [...notes].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // ── Camera shutter ─────────────────────────────────

  async function handleShutter() {
    const blob = await capturePhoto();
    if (!blob) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([blob], `walkthrough-${timestamp}.jpg`, {
      type: "image/jpeg",
    });

    setUploading(true);

    const uploadResult = await uploadWalkthroughFile(walkthroughId, file);
    if (!uploadResult.error && uploadResult.storagePath) {
      const dbResult = await createWalkthroughFile({
        walkthrough_id: walkthroughId,
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
  }, [walkthroughId]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const result = await addWalkthroughNote({
      walkthrough_id: walkthroughId,
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

    const result = await updateWalkthroughNote(noteId, editText.trim());
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
    const result = await deleteWalkthroughNote(noteId, walkthroughId);
    if (!result.error) {
      onNotesChange(notes.filter((n) => n.id !== noteId));
    }
  }

  // ── Photos ─────────────────────────────────────────

  async function handleGallerySelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    setUploading(true);

    const newFiles = [...files];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];

      const uploadResult = await uploadWalkthroughFile(walkthroughId, file);
      if (uploadResult.error || !uploadResult.storagePath) continue;

      const dbResult = await createWalkthroughFile({
        walkthrough_id: walkthroughId,
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

  async function handleDeleteFile(file: WalkthroughFile) {
    const result = await deleteWalkthroughFile(
      file.id,
      file.storage_path,
      walkthroughId
    );
    if (!result.error) {
      onFilesChange(files.filter((f) => f.id !== file.id));
    }
  }

  return (
    <div className="space-y-3">
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

        {flashEffect && (
          <div className="absolute inset-0 bg-white z-20 animate-pulse" />
        )}

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

        {uploading && (
          <div className="absolute top-3 right-3 z-10 bg-black/60 rounded-full px-3 py-1 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-white" />
            <span className="text-xs text-white">Saving...</span>
          </div>
        )}

        {isRecording && (
          <div className="absolute top-3 left-3 z-10 bg-black/60 rounded-full px-3 py-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-white font-medium">REC</span>
          </div>
        )}

        <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black/70 to-transparent pt-10 pb-4 px-4">
          <div className="flex items-center justify-between">
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

            <button
              type="button"
              disabled={!cameraActive || uploading}
              onClick={handleShutter}
              className="h-16 w-16 rounded-full border-4 border-white bg-white/30 hover:bg-white/50 active:scale-90 transition-transform disabled:opacity-50 flex items-center justify-center"
            >
              <div className="h-12 w-12 rounded-full bg-white" />
            </button>

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

      {/* ── Photo thumbnails ── */}
      {files.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Photos ({files.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {files.map((file) => (
              <PhotoThumbnail
                key={file.id}
                file={file}
                onDelete={() => handleDeleteFile(file)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Notes feed ── */}
      {sortedNotes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Notes ({sortedNotes.length})
          </p>
          <div className="space-y-2">
            {sortedNotes.map((note) => (
              <Card key={note.id}>
                <CardContent className="py-2.5 px-3">
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
                      <div className="flex-1 min-w-0">
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
            ))}
          </div>
        </div>
      )}

      {files.length === 0 && notes.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">
          Tap the shutter to take photos and the mic to start recording.
        </p>
      )}
    </div>
  );
}

// ── Photo thumbnail ──────────────────────────────────

function PhotoThumbnail({
  file,
  onDelete,
}: {
  file: WalkthroughFile;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.storage
      .from("project-files")
      .createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [file.storage_path]);

  return (
    <div className="relative group h-16 w-16 rounded-md overflow-hidden bg-muted shrink-0">
      {url ? (
        <Image
          src={url}
          alt={file.file_name}
          fill
          className="object-cover"
          sizes="64px"
        />
      ) : (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <button
        type="button"
        disabled={deleting}
        onClick={async () => {
          setDeleting(true);
          await onDelete();
        }}
        className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
