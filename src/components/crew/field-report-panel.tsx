"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Camera,
  Mic,
  MicOff,
  X,
  Trash2,
  AlertTriangle,
  Package,
  Wrench,
  CheckCircle,
  Send,
  Image as ImageIcon,
} from "lucide-react";
import { useCamera } from "@/hooks/use-camera";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import {
  addFieldReportPhoto,
  addFieldReportNote,
  deleteFieldReportPhoto,
  deleteFieldReportNote,
} from "@/lib/actions/field-reports";
import { compressImage } from "@/lib/image/compress";
import { createClient } from "@/lib/supabase/client";

interface FieldReportPanelProps {
  timeEntryId: string;
  projectId: string;
  projectName: string;
  existingPhotos?: {
    id: string;
    storage_path: string;
    file_name: string;
    photo_type: string;
    caption: string | null;
  }[];
  existingNotes?: {
    id: string;
    content: string;
    note_type: string;
    source: string;
  }[];
}

const NOTE_TYPES = [
  { key: "completed_work", label: "Work Done", icon: CheckCircle, color: "text-emerald-400" },
  { key: "problem", label: "Problem", icon: AlertTriangle, color: "text-red-400" },
  { key: "material_needed", label: "Material Needed", icon: Package, color: "text-amber-400" },
  { key: "general", label: "Note", icon: Wrench, color: "text-sky-400" },
];

const PHOTO_TYPES = [
  { key: "progress", label: "Progress" },
  { key: "problem", label: "Problem" },
  { key: "material", label: "Material" },
  { key: "other", label: "Other" },
];

export function FieldReportPanel({
  timeEntryId,
  projectId,
  projectName,
  existingPhotos = [],
  existingNotes = [],
}: FieldReportPanelProps) {
  const [photos, setPhotos] = useState(existingPhotos);
  const [notes, setNotes] = useState(existingNotes);
  const [showCamera, setShowCamera] = useState(false);
  const [photoType, setPhotoType] = useState("progress");
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState("completed_work");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    videoRef,
    canvasRef,
    isActive,
    flashEffect,
    capturePhoto,
    stopCamera,
    toggleFacingMode,
  } = useCamera({ autoStart: false });

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported: voiceSupported,
  } = useSpeechRecognition();

  // Update note text from voice
  if (transcript && transcript !== noteText) {
    setNoteText(transcript);
  }

  // ── Photo capture ──

  async function handleCapture() {
    const blob = await capturePhoto();
    if (!blob) return;
    await uploadPhoto(blob, `photo-${Date.now()}.jpg`);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await uploadPhoto(file, file.name);
    }
    e.target.value = "";
  }

  async function uploadPhoto(file: Blob, fileName: string) {
    setUploading(true);
    try {
      const supabase = createClient();

      // Downscale + re-encode as JPEG so multi-MB phone photos upload (and
      // later load) fast. Falls back to the original bytes when the browser
      // can't decode the file (e.g. HEIC).
      let body: Blob = file;
      let uploadName = fileName;
      let contentType = file.type || "image/jpeg";
      try {
        body = await compressImage(
          file instanceof File ? file : new File([file], fileName, { type: contentType }),
        );
        uploadName = `${fileName.replace(/\.[^.]+$/, "")}.jpg`;
        contentType = "image/jpeg";
      } catch {
        // keep the original file
      }

      const path = `field-reports/${timeEntryId}/${Date.now()}-${uploadName}`;

      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(path, body, { contentType });

      if (uploadError) throw uploadError;

      await addFieldReportPhoto(
        timeEntryId,
        projectId,
        path,
        uploadName,
        body.size,
        contentType,
        photoType
      );

      // Get signed URL for display
      const { data: urlData } = await supabase.storage
        .from("project-files")
        .createSignedUrl(path, 3600);

      setPhotos((prev) => [
        ...prev,
        {
          id: `temp-${Date.now()}`,
          storage_path: path,
          file_name: uploadName,
          photo_type: photoType,
          caption: null,
          signedUrl: urlData?.signedUrl,
        },
      ]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeletePhoto(photoId: string, storagePath: string) {
    await deleteFieldReportPhoto(photoId);
    const supabase = createClient();
    await supabase.storage.from("project-files").remove([storagePath]);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  }

  // ── Notes ──

  async function handleAddNote() {
    const text = noteText.trim();
    if (!text) return;

    const result = await addFieldReportNote(
      timeEntryId,
      projectId,
      text,
      noteType,
      isListening ? "voice" : "typed"
    );

    if (!result.error) {
      setNotes((prev) => [
        ...prev,
        {
          id: result.id || `temp-${Date.now()}`,
          content: text,
          note_type: noteType,
          source: isListening ? "voice" : "typed",
        },
      ]);
      setNoteText("");
      stopListening();
    }
  }

  async function handleDeleteNote(noteId: string) {
    await deleteFieldReportNote(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  const noteTypeConfig = NOTE_TYPES.find((t) => t.key === noteType) || NOTE_TYPES[3];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Wrench className="h-4 w-4 text-amber-500" />
        Daily Field Report
      </h3>

      {/* ── Photos Section ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            Photos ({photos.length})
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="h-3 w-3 mr-1" />
              Gallery
            </Button>
            <Button
              size="sm"
              className="text-xs h-7 bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                if (showCamera) {
                  stopCamera();
                  setShowCamera(false);
                } else {
                  setShowCamera(true);
                }
              }}
            >
              <Camera className="h-3 w-3 mr-1" />
              {showCamera ? "Close" : "Camera"}
            </Button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Photo type selector */}
        {(showCamera || uploading) && (
          <div className="flex gap-1">
            {PHOTO_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setPhotoType(t.key)}
                className={`text-xs px-2 py-1 rounded-full border ${
                  photoType === t.key
                    ? "bg-amber-600 text-white border-amber-600"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Camera viewfinder */}
        {showCamera && (
          <div className="relative rounded-xl overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-64 object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Flash effect */}
            {flashEffect && (
              <div className="absolute inset-0 bg-white animate-pulse" />
            )}

            {/* Camera controls */}
            <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-6">
              <button
                onClick={toggleFacingMode}
                className="h-10 w-10 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <Camera className="h-4 w-4" />
              </button>
              <button
                onClick={handleCapture}
                disabled={!isActive || uploading}
                className="h-16 w-16 rounded-full border-4 border-white bg-white/20 flex items-center justify-center active:scale-90 transition-transform"
              >
                <div className="h-12 w-12 rounded-full bg-white" />
              </button>
              <button
                onClick={() => {
                  stopCamera();
                  setShowCamera(false);
                }}
                className="h-10 w-10 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {uploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <p className="text-white text-sm">Uploading...</p>
              </div>
            )}
          </div>
        )}

        {/* Photo grid */}
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <PhotoThumb
                key={photo.id}
                photo={photo}
                onDelete={() =>
                  handleDeletePhoto(photo.id, photo.storage_path)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Notes Section ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Notes ({notes.length})
        </p>

        {/* Note type chips */}
        <div className="flex gap-1 flex-wrap">
          {NOTE_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setNoteType(t.key)}
                className={`text-xs px-2 py-1 rounded-full border flex items-center gap-1 ${
                  noteType === t.key
                    ? "bg-amber-600 text-white border-amber-600"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Note input */}
        <div className="flex gap-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={
              isListening
                ? "Listening... speak now"
                : `What did you ${noteType === "completed_work" ? "work on" : noteType === "problem" ? "find wrong" : noteType === "material_needed" ? "need" : "observe"}?`
            }
            rows={2}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 ${
              isListening ? "border-red-400 bg-red-950/20" : "bg-background"
            }`}
          />
          <div className="flex flex-col gap-1">
            {voiceSupported && (
              <button
                onClick={() => {
                  if (isListening) {
                    stopListening();
                  } else {
                    setNoteText("");
                    startListening();
                  }
                }}
                className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                  isListening
                    ? "bg-red-600 text-white animate-pulse"
                    : "border text-muted-foreground hover:text-amber-400"
                }`}
              >
                {isListening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            )}
            <Button
              size="icon"
              onClick={handleAddNote}
              disabled={!noteText.trim()}
              className="h-10 w-10 rounded-xl bg-amber-600 hover:bg-amber-700"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {isListening && (
          <p className="text-xs text-red-400 animate-pulse">
            Listening... tap mic to stop
          </p>
        )}

        {/* Notes list */}
        {notes.length > 0 && (
          <div className="space-y-1.5">
            {notes.map((note) => {
              const config = NOTE_TYPES.find((t) => t.key === note.note_type) || NOTE_TYPES[3];
              const Icon = config.icon;
              return (
                <div
                  key={note.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 border"
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
                  <p className="text-sm flex-1">{note.content}</p>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="text-muted-foreground hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Photo Thumbnail ──

function PhotoThumb({
  photo,
  onDelete,
}: {
  photo: {
    id: string;
    storage_path: string;
    file_name: string;
    photo_type: string;
    signedUrl?: string;
  };
  onDelete: () => void;
}) {
  const [url, setUrl] = useState(photo.signedUrl || "");

  // Load signed URL if not provided
  if (!url) {
    const supabase = createClient();
    supabase.storage
      .from("project-files")
      .createSignedUrl(photo.storage_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setUrl(data.signedUrl);
      });
  }

  const typeLabel = PHOTO_TYPES.find((t) => t.key === photo.photo_type)?.label || "";

  return (
    <div className="relative rounded-lg overflow-hidden aspect-square bg-muted group">
      {url ? (
        <img
          src={url}
          alt={photo.file_name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      {/* Type badge */}
      <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
        {typeLabel}
      </div>
      {/* Delete button */}
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
