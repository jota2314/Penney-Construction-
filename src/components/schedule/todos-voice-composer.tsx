"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, Plus, X, Calendar, User, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { createTodos } from "@/lib/actions/command-center";

interface ParsedTodo {
  description: string;
  priority: string;
  due_date: string | null;
  contact_name: string | null;
  keep: boolean;
}

/**
 * Voice composer for general todos. Parallel to PunchListVoiceComposer
 * but parses into action-oriented todos with optional due-date and
 * contact instead of location-tagged punch items.
 */
export function TodosVoiceComposer({
  projectId,
  projectName,
  onCreated,
}: {
  projectId?: string | null;
  projectName?: string | null;
  onCreated?: (count: number) => void;
}) {
  const router = useRouter();
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
    error: speechError,
  } = useSpeechRecognition();
  const [prompt, setPrompt] = useState("");
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedTodo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (transcript) setPrompt(transcript);
  }, [transcript]);

  const parsePrompt = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    setParsing(true);
    try {
      const res = await fetch("/api/todos-from-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to understand the todo");
        return;
      }
      const parsed: ParsedTodo[] = (data.items ?? []).map((it: ParsedTodo) => ({
        ...it,
        keep: true,
      }));
      if (parsed.length === 0) {
        setError("No todos detected — try saying it another way");
        return;
      }
      setItems(parsed);
    } catch {
      setError("Network error — try again");
    } finally {
      setParsing(false);
    }
  };

  const onMicClick = () => {
    setError(null);
    if (isListening) {
      stopListening();
      setTimeout(() => {
        const text = transcript.trim();
        if (!text) return;
        setPrompt(text);
        void parsePrompt(text);
      }, 350);
    } else {
      setItems([]);
      setPrompt("");
      startListening();
    }
  };

  const toggleKeep = (idx: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, keep: !it.keep } : it)));
  };

  const editDescription = (idx: number, value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, description: value } : it)));
  };

  const addAll = async () => {
    const kept = items.filter((it) => it.keep);
    if (kept.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createTodos(projectId ?? null, projectName ?? null, kept);
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems([]);
      setPrompt("");
      onCreated?.(result.inserted);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Tell AI what you need to do. You can include several tasks at once.
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void parsePrompt(prompt);
        }}
      >
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={2}
          disabled={parsing || saving}
          placeholder="Example: Call Mike tomorrow and order tile for the Smith job"
          aria-label="Describe the todos to create"
          className={`min-h-[52px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 ${
            isListening ? "border-red-500/60" : ""
          }`}
        />
        {isSupported && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onMicClick}
            disabled={parsing || saving}
            aria-label={isListening ? "Stop listening and build todos" : "Speak todos"}
            className={isListening ? "border-red-500/60 text-red-400" : ""}
          >
            {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}
        <Button
          type="submit"
          size="icon"
          disabled={!prompt.trim() || parsing || saving || isListening}
          aria-label="Build todos with AI"
          className="bg-amber-600 text-white hover:bg-amber-700"
        >
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>

      {isListening && (
        <p className="mt-2 text-center text-xs text-red-400">
          Listening… tap the stop button when finished.
        </p>
      )}

      {(error || speechError) && (
        <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
          {error || speechError}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {items.filter((i) => i.keep).length} of {items.length} todos
          </p>
          {items.map((it, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2 rounded-md border p-2 ${
                it.keep ? "bg-zinc-900/40 border-zinc-700" : "bg-zinc-900/20 border-zinc-800 opacity-50"
              }`}
            >
              <input
                type="checkbox"
                checked={it.keep}
                onChange={() => toggleKeep(idx)}
                className="mt-1 h-3.5 w-3.5 accent-emerald-500"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1 mb-0.5">
                  {it.contact_name && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase text-emerald-400">
                      <User className="h-2.5 w-2.5" />
                      {it.contact_name}
                    </span>
                  )}
                  {it.due_date && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-400">
                      <Calendar className="h-2.5 w-2.5" />
                      {new Date(it.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                  {it.priority === "high" && (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase text-red-400">High</span>
                  )}
                </div>
                <input
                  type="text"
                  value={it.description}
                  onChange={(e) => editDescription(idx, e.target.value)}
                  className="w-full bg-transparent text-sm text-zinc-100 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => toggleKeep(idx)}
                className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                aria-label="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button
            onClick={addAll}
            disabled={saving || items.filter((i) => i.keep).length === 0}
            className="mt-2 w-full"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add {items.filter((i) => i.keep).length} todo{items.filter((i) => i.keep).length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
