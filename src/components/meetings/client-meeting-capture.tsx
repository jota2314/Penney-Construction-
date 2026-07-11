"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  appendMeetingNote,
  removeMeetingNote,
  finalizeProjectMeeting,
  type ProjectMeeting,
  type MeetingNote,
} from "@/lib/actions/project-meetings";
import {
  Mic,
  MicOff,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  Check,
  ArrowLeft,
} from "lucide-react";

interface ClientMeetingCaptureProps {
  meeting: ProjectMeeting;
  projectName: string;
  clientName: string | null;
}

type Phase = "capture" | "review" | "done";

interface DraftActionItem {
  description: string;
  priority: "low" | "medium" | "high";
  createTodo: boolean;
}

export function ClientMeetingCapture({
  meeting,
  projectName,
  clientName,
}: ClientMeetingCaptureProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    meeting.status === "completed" ? "done" : "capture"
  );
  const [notes, setNotes] = useState<MeetingNote[]>(meeting.notes ?? []);
  const [typedText, setTypedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Review state
  const [title, setTitle] = useState(meeting.title ?? "");
  const [summary, setSummary] = useState(meeting.summary ?? "");
  const [actionItems, setActionItems] = useState<DraftActionItem[]>(
    (meeting.action_items ?? []).map((a) => ({
      description: a.description,
      priority: a.priority,
      createTodo: false,
    }))
  );
  const [todosCreated, setTodosCreated] = useState<number | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");

  // ── Recording (same pattern as walkthrough capture) ──────────────

  const startRecording = useCallback(() => {
    const SpeechRecognitionCtor =
      (
        window as unknown as {
          webkitSpeechRecognition?: typeof window.SpeechRecognition;
        }
      ).webkitSpeechRecognition ?? window.SpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

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
        void handleAddNote(transcriptRef.current.trim(), "voice");
      }
    };

    recognition.start();
    setIsRecording(true);
    setError(null);
  }, [meeting.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopRecording() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }

  // ── Notes ─────────────────────────────────────────────────────────

  async function handleAddNote(content: string, source: "voice" | "typed") {
    if (!content.trim()) return;
    setSaving(true);
    const result = await appendMeetingNote(meeting.id, content, source);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotes(result.notes ?? []);
    if (source === "typed") setTypedText("");
  }

  async function handleRemoveNote(index: number) {
    const result = await removeMeetingNote(meeting.id, index);
    if (!result.error) setNotes(result.notes ?? []);
  }

  // ── Summarize + save ──────────────────────────────────────────────

  async function handleFinish() {
    if (isRecording) stopRecording();
    if (notes.length === 0) {
      setError("Record or type at least one note first.");
      return;
    }
    setSummarizing(true);
    setError(null);
    try {
      const res = await fetch("/api/project-meeting-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: meeting.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Summary failed");
      setSummary(data.summary);
      setActionItems(
        (data.action_items ?? []).map(
          (a: { description: string; priority: "low" | "medium" | "high" }) => ({
            description: a.description,
            priority: a.priority,
            createTodo: true,
          })
        )
      );
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summary failed");
    } finally {
      setSummarizing(false);
    }
  }

  async function handleSave() {
    if (!summary.trim()) {
      setError("Summary is empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await finalizeProjectMeeting(meeting.id, {
      title: title || undefined,
      summary,
      actionItems,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setTodosCreated(result.todosCreated ?? 0);
    setPhase("done");
    router.refresh();
  }

  // ── Render ────────────────────────────────────────────────────────

  const header = (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">
        {projectName}
        {clientName ? ` · ${clientName}` : ""} ·{" "}
        {new Date(meeting.meeting_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
    </div>
  );

  if (phase === "done") {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 flex items-center gap-2">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <p className="text-sm text-green-600 dark:text-green-400">
            Meeting saved
            {todosCreated !== null && todosCreated > 0
              ? ` — ${todosCreated} to-do${todosCreated === 1 ? "" : "s"} created`
              : ""}
            .
          </p>
        </div>
        {meeting.title || title ? (
          <h2 className="text-lg font-semibold">{title || meeting.title}</h2>
        ) : null}
        <Card>
          <CardContent className="py-4 px-4">
            <p className="text-sm whitespace-pre-wrap">{summary || meeting.summary}</p>
          </CardContent>
        </Card>
        {(actionItems.length > 0
          ? actionItems
          : (meeting.action_items ?? []).map((a) => ({
              description: a.description,
              priority: a.priority,
              createTodo: !!a.todo_id,
            }))
        ).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Action items
            </p>
            {(actionItems.length > 0
              ? actionItems
              : (meeting.action_items ?? []).map((a) => ({
                  description: a.description,
                  priority: a.priority,
                  createTodo: !!a.todo_id,
                }))
            ).map((item, i) => (
              <Card key={i}>
                <CardContent className="py-2.5 px-3 flex items-center gap-2">
                  <span className="text-sm flex-1">{item.description}</span>
                  <Badge variant="outline" className="text-xs">
                    {item.priority}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <Button variant="outline" onClick={() => router.push("/meetings")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> All meetings
        </Button>
      </div>
    );
  }

  if (phase === "review") {
    return (
      <div className="space-y-4">
        {header}
        <Input
          placeholder="Meeting title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Summary — review &
            edit before saving
          </p>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={14}
            className="text-sm"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Action items — checked ones become to-dos on the project
          </p>
          {actionItems.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No action items found in the notes.
            </p>
          )}
          {actionItems.map((item, i) => (
            <Card key={i}>
              <CardContent className="py-2.5 px-3 flex items-center gap-2.5">
                <Checkbox
                  checked={item.createTodo}
                  onCheckedChange={(checked) =>
                    setActionItems((prev) =>
                      prev.map((a, j) =>
                        j === i ? { ...a, createTodo: checked === true } : a
                      )
                    )
                  }
                />
                <span className="text-sm flex-1">{item.description}</span>
                <Badge variant="outline" className="text-xs shrink-0">
                  {item.priority}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setPhase("capture")}
            disabled={saving}
          >
            Back to notes
          </Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Save meeting
          </Button>
        </div>
      </div>
    );
  }

  // capture phase
  return (
    <div className="space-y-4">
      {header}

      {/* Big record button */}
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        className={`w-full rounded-2xl border p-6 flex flex-col items-center gap-3 transition ${
          isRecording
            ? "border-red-500/50 bg-red-500/10"
            : "border-border bg-card hover:bg-muted/40"
        }`}
      >
        <span
          className={`flex h-16 w-16 items-center justify-center rounded-full ${
            isRecording
              ? "bg-red-500 text-white animate-pulse"
              : "bg-amber-500/15 text-amber-500"
          }`}
        >
          {isRecording ? (
            <MicOff className="h-7 w-7" />
          ) : (
            <Mic className="h-7 w-7" />
          )}
        </span>
        <span className="text-sm font-semibold">
          {isRecording ? "Tap to stop recording" : "Tap to record the conversation"}
        </span>
        {!isRecording && (
          <span className="text-xs text-muted-foreground">
            Everything you say is transcribed into notes below
          </span>
        )}
      </button>

      {isRecording && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-xs font-medium text-destructive">
              Recording…
            </span>
          </div>
          <p className="text-sm text-muted-foreground italic">
            {liveTranscript || "Listening… speak and it will appear here"}
          </p>
        </div>
      )}

      {/* Typed note input */}
      <div className="flex gap-2">
        <Textarea
          placeholder="Type a note…"
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

      {/* Notes feed */}
      {notes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Notes ({notes.length})
          </p>
          {notes.map((note, i) => (
            <Card key={`${note.at}-${i}`}>
              <CardContent className="py-2.5 px-3 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {note.source === "voice" ? "Voice" : "Typed"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(note.at).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => handleRemoveNote(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        className="w-full"
        size="lg"
        disabled={summarizing || notes.length === 0}
        onClick={handleFinish}
      >
        {summarizing ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        {summarizing ? "Summarizing…" : "Finish — summarize meeting"}
      </Button>
    </div>
  );
}
