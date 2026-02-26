"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  addSiteVisitNote,
  updateSiteVisitNote,
  deleteSiteVisitNote,
} from "@/lib/actions/site-visits";
import { Mic, MicOff, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import type { SiteVisitNote } from "@/types/database";

interface SiteVisitNotesPanelProps {
  siteVisitId: string;
  notes: SiteVisitNote[];
}

export function SiteVisitNotesPanel({
  siteVisitId,
  notes: initialNotes,
}: SiteVisitNotesPanelProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [typedText, setTypedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const recognitionRef = useRef<ReturnType<typeof createRecognition> | null>(null);
  const transcriptRef = useRef("");

  function createRecognition() {
    const SpeechRecognition =
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition ??
      window.SpeechRecognition;
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
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      transcriptRef.current = transcript;
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
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

  return (
    <div className="space-y-4">
      {/* Voice button - large for mobile */}
      <div className="flex justify-center">
        <Button
          type="button"
          variant={isRecording ? "destructive" : "default"}
          size="lg"
          className="h-16 w-16 rounded-full"
          onClick={isRecording ? stopRecording : startRecording}
        >
          {isRecording ? (
            <MicOff className="h-7 w-7" />
          ) : (
            <Mic className="h-7 w-7" />
          )}
        </Button>
      </div>
      {isRecording && (
        <p className="text-center text-sm text-muted-foreground animate-pulse">
          Listening... tap to stop
        </p>
      )}

      {/* Typed note input */}
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

      {/* Notes list */}
      <div className="space-y-2">
        {notes.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-4">
            No notes yet. Use the mic or type above to add notes.
          </p>
        )}
        {notes.map((note) => (
          <Card key={note.id}>
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
                        {new Date(note.created_at).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
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
  );
}
