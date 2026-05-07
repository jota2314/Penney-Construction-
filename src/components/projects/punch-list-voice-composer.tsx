"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, Plus, X, MapPin, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { createPunchListItems } from "@/lib/actions/punch-list";

interface ParsedItem {
  description: string;
  location: string | null;
  priority: string;
  assignee: string | null;
  keep: boolean;
}

export interface PunchListEmployee {
  id: string;
  first_name: string;
  last_name: string;
}

/**
 * Big-button voice composer that turns one ramble into a whole punch
 * list. Dictate → AI splits into items → you preview, assign to a
 * worker, uncheck duds → tap "Add all" → bulk-creates the rows.
 *
 * If `employees` is provided, every preview row gets an Assign-to
 * dropdown so items can be routed to specific crew members up front.
 */
export function PunchListVoiceComposer({
  projectId,
  projectName,
  employees = [],
}: {
  projectId: string;
  projectName: string;
  employees?: PunchListEmployee[];
}) {
  const router = useRouter();
  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
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
          const res = await fetch("/api/punch-list-from-voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Failed to parse");
            return;
          }
          const parsed: ParsedItem[] = (data.items ?? []).map((it: Omit<ParsedItem, "keep" | "assignee">) => ({
            ...it,
            assignee: null,
            keep: true,
          }));
          if (parsed.length === 0) setError("No items detected — try again");
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

  const setAssignee = (idx: number, value: string | null) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, assignee: value } : it)));
  };

  const setAllAssignees = (value: string | null) => {
    setItems((prev) => prev.map((it) => ({ ...it, assignee: value })));
  };

  const addAll = async () => {
    const kept = items.filter((it) => it.keep);
    if (kept.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createPunchListItems(projectId, projectName, kept);
      if (result.error) {
        setError(`Couldn't save: ${result.error}`);
        console.error("[punch-list-create] failed:", result.error);
        return;
      }
      if (!result.inserted || result.inserted === 0) {
        setError("Save returned 0 items. Check role/permissions.");
        return;
      }
      setItems([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — try again");
      console.error("[punch-list-create] threw:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-3 text-xs text-zinc-500">
        Voice not supported on this browser. Use the form below.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMicClick}
          disabled={parsing || saving}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
            isListening
              ? "bg-red-500 hover:bg-red-600 text-white border border-red-500 shadow-lg shadow-red-500/30 animate-pulse"
              : parsing
                ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
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
              Stop &amp; build list
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" />
              Dictate punch list
            </>
          )}
        </button>
      </div>

      {isListening && (
        <div className="mt-2 h-0.5 rounded-full bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-pulse" />
      )}

      {isListening && transcript && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs italic text-zinc-200">
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {items.filter((i) => i.keep).length} of {items.length} items
            </p>
            {employees.length > 0 && (
              <select
                onChange={(e) => setAllAssignees(e.target.value || null)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
                defaultValue=""
              >
                <option value="">Assign all to…</option>
                {employees.map((emp) => {
                  const name = `${emp.first_name} ${emp.last_name}`;
                  return <option key={emp.id} value={name}>{name}</option>;
                })}
              </select>
            )}
          </div>
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
                className="mt-1 h-3.5 w-3.5 accent-amber-500"
              />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex flex-wrap gap-1">
                  {it.location && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-400">
                      <MapPin className="h-2.5 w-2.5" />
                      {it.location}
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
                {employees.length > 0 && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px]">
                    <User className="h-3 w-3 text-zinc-500" />
                    <select
                      value={it.assignee ?? ""}
                      onChange={(e) => setAssignee(idx, e.target.value || null)}
                      className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-200"
                    >
                      <option value="">Unassigned</option>
                      {employees.map((emp) => {
                        const name = `${emp.first_name} ${emp.last_name}`;
                        return <option key={emp.id} value={name}>{name}</option>;
                      })}
                    </select>
                  </div>
                )}
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
                Add {items.filter((i) => i.keep).length} item{items.filter((i) => i.keep).length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
  const router = useRouter();
  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onMicClick = async () => {
    setError(null);
    if (isListening) {
      stopListening();
      // The transcript is captured by the hook; small delay so the final
      // chunk lands before we POST.
      setTimeout(async () => {
        const text = transcript.trim();
        if (!text) return;
        setParsing(true);
        try {
          const res = await fetch("/api/punch-list-from-voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Failed to parse");
            return;
          }
          const parsed: ParsedItem[] = (data.items ?? []).map((it: ParsedItem) => ({
            ...it,
            keep: true,
          }));
          if (parsed.length === 0) setError("No items detected — try again");
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
      const result = await createPunchListItems(projectId, projectName, kept);
      if (result.error) {
        setError(`Couldn't save: ${result.error}`);
        console.error("[punch-list-create] failed:", result.error);
        return;
      }
      if (!result.inserted || result.inserted === 0) {
        setError("Save returned 0 items. Check role/permissions.");
        return;
      }
      setItems([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — try again");
      console.error("[punch-list-create] threw:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-3 text-xs text-zinc-500">
        Voice not supported on this browser. Use the form below.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMicClick}
          disabled={parsing || saving}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
            isListening
              ? "bg-red-500/15 text-red-400 border border-red-500/40"
              : parsing
                ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
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
              Stop & build list
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" />
              Dictate punch list
            </>
          )}
        </button>
      </div>

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
            {items.filter((i) => i.keep).length} of {items.length} items
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
                className="mt-1 h-3.5 w-3.5 accent-amber-500"
              />
              <div className="min-w-0 flex-1">
                {it.location && (
                  <div className="mb-0.5 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-400">
                    <MapPin className="h-2.5 w-2.5" />
                    {it.location}
                  </div>
                )}
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
                Add {items.filter((i) => i.keep).length} item{items.filter((i) => i.keep).length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
