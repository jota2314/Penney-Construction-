"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, Plus, X, Calendar, User } from "lucide-react";
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
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedTodo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onMicClick = async () => {
    setError(null);
    if (isListening) {
      stopListening();
      setTimeout(async () => {
        const text = transcript.trim();
        if (!text) return;
        setParsing(true);
        try {
          const res = await fetch("/api/todos-from-voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Failed to parse");
            return;
          }
          const parsed: ParsedTodo[] = (data.items ?? []).map((it: ParsedTodo) => ({ ...it, keep: true }));
          if (parsed.length === 0) setError("No todos detected — try again");
          setItems(parsed);
        } catch {
          setError("Network error — try again");
        } finally {
          setParsing(false);
        }
      }, 350);
    } else {
      setItems([]);
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
      const result = await createTodos(projectId, projectName, kept);
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems([]);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-3 text-xs text-zinc-500">
        Voice not supported on this browser.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <button
        type="button"
        onClick={onMicClick}
        disabled={parsing || saving}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
          isListening
            ? "bg-red-500/15 text-red-400 border border-red-500/40"
            : parsing
              ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/25"
        }`}
      >
        {parsing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Parsing list…
          </>
        ) : isListening ? (
          <>
            <Square className="h-4 w-4" />
            Stop &amp; build todos
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" />
            Dictate todos
          </>
        )}
      </button>

      {isListening && transcript && (
        <p className="mt-2 rounded border border-zinc-700 bg-zinc-900/60 p-2 text-xs italic text-zinc-300">
          {transcript}
        </p>
      )}

      {error && (
        <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
          {error}
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
