"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
  Bot,
  Send,
  Mic,
  MicOff,
  Loader2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useRouter } from "next/navigation";
import { renderInlineMarkdown } from "@/lib/chat-markdown";

interface SchedulePhase {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  status: string;
  color: string;
  event_type: string | null;
  notes: string | null;
  sort_order: number;
  estimate_line_item_id?: string | null;
}

interface LineItemOption {
  id: string;
  description: string;
  trade: string | null;
}

interface ProjectScheduleTabProps {
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  projectType?: string | null;
  projectAddress?: string | null;
  phases: SchedulePhase[];
  lineItems: LineItemOption[];
  userId: string;
}

interface AiChatMsg {
  role: "user" | "assistant";
  content: string;
  proposedPhases?: {
    name: string;
    start_date: string;
    end_date: string;
    event_type: string;
    notes?: string;
  }[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  not_started: { label: "Not Started", color: "bg-slate-500", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-blue-500", icon: Clock },
  completed: { label: "Done", color: "bg-emerald-500", icon: CheckCircle },
  on_hold: { label: "On Hold", color: "bg-amber-500", icon: AlertTriangle },
};

const PHASE_COLORS = [
  "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316",
];

export function ProjectScheduleTab({
  projectId,
  projectName,
  projectDescription,
  projectType,
  projectAddress,
  phases: initialPhases,
  lineItems,
  userId,
}: ProjectScheduleTabProps) {
  const [phases, setPhases] = useState(initialPhases);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiChatMsg[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [addingPhases, setAddingPhases] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) setAiInput(transcript);
  }, [transcript]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages.length]);

  async function handleAiSend() {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    setAiInput("");
    stopListening();

    const userMsg: AiChatMsg = { role: "user", content: text };
    const history = [...aiMessages, userMsg];
    setAiMessages(history);
    setAiLoading(true);

    try {
      const res = await fetch("/api/schedule-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          userMessage: text,
          projectContext: {
            id: projectId,
            name: projectName,
            type: projectType,
            description: projectDescription,
            address: projectAddress,
            existingPhases: phases.map((p) => `${p.name} (${p.start_date} to ${p.end_date}) [${p.status}]`),
          },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const assistantMsg: AiChatMsg = {
        role: "assistant",
        content: data.message || "Here's what I suggest:",
        proposedPhases: data.schedule_actions?.filter(
          (a: Record<string, unknown>) => a.action === "create"
        ),
      };
      setAiMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setAiMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Failed"}` },
      ]);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAddAiPhases(proposedPhases: AiChatMsg["proposedPhases"]) {
    if (!proposedPhases || proposedPhases.length === 0) return;
    setAddingPhases(true);

    const supabase = createClient();
    const newPhases: SchedulePhase[] = [];

    for (let i = 0; i < proposedPhases.length; i++) {
      const p = proposedPhases[i];
      const color = PHASE_COLORS[(phases.length + i) % PHASE_COLORS.length];

      const { data, error } = await supabase
        .from("schedule_phases")
        .insert({
          project_id: projectId,
          name: p.name,
          start_date: p.start_date,
          end_date: p.end_date || p.start_date,
          planned_start_date: p.start_date,
          planned_end_date: p.end_date || p.start_date,
          status: "not_started",
          event_type: p.event_type || "phase",
          notes: p.notes || null,
          sort_order: phases.length + i,
          color,
          created_by: userId,
        })
        .select("*")
        .single();

      if (!error && data) newPhases.push(data);
    }

    setPhases((prev) => [...prev, ...newPhases]);
    setAddingPhases(false);
    router.refresh();
  }

  const today = new Date().toISOString().split("T")[0];
  const totalPhases = phases.length;
  const completedPhases = phases.filter((p) => p.status === "completed").length;
  const overduePhases = phases.filter(
    (p) => p.status !== "completed" && p.end_date < today
  ).length;
  const progress = totalPhases > 0 ? Math.round((completedPhases / totalPhases) * 100) : 0;

  async function handleAddPhase(formData: FormData) {
    setSaving(true);
    const supabase = createClient();

    const name = formData.get("name") as string;
    const startDate = formData.get("start_date") as string;
    const endDate = formData.get("end_date") as string || startDate;
    const lineItemId = formData.get("estimate_line_item_id") as string;
    const color = PHASE_COLORS[phases.length % PHASE_COLORS.length];

    const { data, error } = await supabase
      .from("schedule_phases")
      .insert({
        project_id: projectId,
        name,
        start_date: startDate,
        end_date: endDate,
        planned_start_date: startDate,
        planned_end_date: endDate,
        status: "not_started",
        event_type: (formData.get("event_type") as string) || "phase",
        notes: (formData.get("notes") as string) || null,
        sort_order: phases.length,
        color,
        estimate_line_item_id: lineItemId || null,
        created_by: userId,
      })
      .select("*")
      .single();

    if (!error && data) {
      setPhases((prev) => [...prev, data]);
      setShowAdd(false);
    }
    setSaving(false);
  }

  async function handleUpdateStatus(phaseId: string, newStatus: string) {
    const supabase = createClient();
    await supabase
      .from("schedule_phases")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", phaseId);
    setPhases((prev) =>
      prev.map((p) => (p.id === phaseId ? { ...p, status: newStatus } : p))
    );
  }

  async function handleUpdateDates(phaseId: string, startDate: string, endDate: string) {
    const supabase = createClient();
    await supabase
      .from("schedule_phases")
      .update({
        start_date: startDate,
        end_date: endDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", phaseId);
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId ? { ...p, start_date: startDate, end_date: endDate } : p
      )
    );
    setEditingId(null);
  }

  async function handleDelete(phaseId: string) {
    const supabase = createClient();
    await supabase.from("schedule_phases").delete().eq("id", phaseId);
    setPhases((prev) => prev.filter((p) => p.id !== phaseId));
  }

  async function handleUpdateLineItem(phaseId: string, lineItemId: string) {
    const supabase = createClient();
    const value = lineItemId || null;
    await supabase
      .from("schedule_phases")
      .update({ estimate_line_item_id: value, updated_at: new Date().toISOString() })
      .eq("id", phaseId);
    setPhases((prev) =>
      prev.map((p) => (p.id === phaseId ? { ...p, estimate_line_item_id: value } : p))
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-amber-500" />
          <div>
            <h3 className="text-sm font-semibold">Project Schedule</h3>
            <p className="text-xs text-muted-foreground">
              {totalPhases} phases · {completedPhases} done · {progress}% complete
              {overduePhases > 0 && (
                <span className="text-red-400 ml-1">· {overduePhases} overdue</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showAi ? "default" : "outline"}
            onClick={() => {
              setShowAi(!showAi);
              if (!showAi && aiMessages.length === 0) {
                // Auto-prompt on first open
                setAiInput(
                  phases.length === 0
                    ? `Plan the full construction schedule for ${projectName}. It's a ${projectType || "remodel"} project${projectDescription ? `: ${projectDescription}` : ""}. Create all the phases with dates starting next week.`
                    : ""
                );
              }
            }}
            className={showAi ? "bg-violet-600 hover:bg-violet-700 text-white" : ""}
          >
            <Bot className="h-3.5 w-3.5 mr-1" />
            AI Plan
          </Button>
          <Button
            size="sm"
            onClick={() => setShowAdd(!showAdd)}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Phase
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      {totalPhases > 0 && (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* AI Schedule Planner */}
      {showAi && (
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Chat messages */}
          <div className="max-h-80 overflow-y-auto p-3 space-y-3">
            {aiMessages.length === 0 && !aiLoading && (
              <div className="text-center py-4 space-y-2">
                <Bot className="h-8 w-8 mx-auto text-violet-400 opacity-60" />
                <p className="text-xs text-muted-foreground">
                  Tell me about the project and I&apos;ll plan the schedule
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {[
                    `Plan the full schedule for ${projectName}`,
                    "What phases does a bathroom remodel need?",
                    "Add rough plumbing and electrical next week",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setAiInput(q); }}
                      className="text-[11px] px-2 py-1 rounded-full border border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {aiMessages.map((msg, i) => (
              <div key={i}>
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="bg-amber-600/20 border border-amber-600/30 rounded-xl px-3 py-2 max-w-[85%]">
                      <p className="text-sm">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Bot className="h-5 w-5 text-violet-400 shrink-0 mt-0.5" />
                      <div className="bg-muted/50 border rounded-xl px-3 py-2 max-w-[85%]">
                        <p className="text-sm whitespace-pre-wrap">{renderInlineMarkdown(msg.content)}</p>
                      </div>
                    </div>

                    {/* Proposed phases */}
                    {msg.proposedPhases && msg.proposedPhases.length > 0 && (
                      <div className="ml-7 space-y-1.5">
                        {msg.proposedPhases.map((p, j) => (
                          <div
                            key={j}
                            className="text-xs p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-medium">{p.name}</span>
                              <span className="text-muted-foreground ml-2">
                                {p.start_date} — {p.end_date}
                              </span>
                            </div>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          onClick={() => handleAddAiPhases(msg.proposedPhases)}
                          disabled={addingPhases}
                          className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-xl"
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                          {addingPhases
                            ? "Adding..."
                            : `Add ${msg.proposedPhases.length} Phases to Schedule`}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {aiLoading && (
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-violet-400" />
                <div className="flex gap-1">
                  <div className="h-2 w-2 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
                  <div className="h-2 w-2 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
                  <div className="h-2 w-2 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-2 flex items-end gap-2">
            <textarea
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAiSend();
                }
              }}
              placeholder={isListening ? "Listening..." : "Tell me what to schedule..."}
              rows={1}
              disabled={aiLoading}
              className={`flex-1 min-h-[40px] max-h-[80px] resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                isListening ? "border-red-400 bg-red-950/20" : ""
              }`}
            />
            {isSupported && (
              <button
                onClick={() => isListening ? stopListening() : (setAiInput(""), startListening())}
                disabled={aiLoading}
                className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${
                  isListening ? "bg-red-600 text-white animate-pulse" : "border text-muted-foreground hover:text-violet-400"
                }`}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <Button
              size="icon"
              onClick={handleAiSend}
              disabled={aiLoading || !aiInput.trim()}
              className="shrink-0 h-10 w-10 rounded-lg bg-violet-600 hover:bg-violet-700"
            >
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* Add phase form */}
      {showAdd && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddPhase(new FormData(e.currentTarget));
          }}
          className="p-4 rounded-lg border bg-card space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Phase Name *</label>
              <input
                name="name"
                required
                placeholder="e.g. Demolition, Framing, Electrical rough-in..."
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Start Date *</label>
              <input
                name="start_date"
                type="date"
                required
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End Date</label>
              <input
                name="end_date"
                type="date"
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <select
                name="event_type"
                defaultValue="phase"
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="phase">Construction Phase</option>
                <option value="inspection">Inspection</option>
                <option value="walkthrough">Walkthrough</option>
                <option value="meeting">Meeting</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <input
                name="notes"
                placeholder="Optional details..."
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">
                Budget line item {lineItems.length === 0 && <span className="text-amber-500">· no estimate line items on this project yet</span>}
              </label>
              <select
                name="estimate_line_item_id"
                defaultValue=""
                disabled={lineItems.length === 0}
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">— None —</option>
                {lineItems.map((li) => (
                  <option key={li.id} value={li.id}>
                    {li.trade ? `[${li.trade}] ` : ""}{li.description}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Linking a budget line means daily logs on this phase show up against that line item — and roll up into actual cost vs. budget later.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
              {saving ? "Adding..." : "Add Phase"}
            </Button>
          </div>
        </form>
      )}

      {/* Phase list */}
      {phases.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No schedule phases yet</p>
          <p className="text-xs mt-1">Click &quot;Add Phase&quot; to start planning</p>
        </div>
      ) : (
        <div className="space-y-2">
          {phases
            .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.sort_order - b.sort_order)
            .map((phase) => {
              const status = STATUS_CONFIG[phase.status] || STATUS_CONFIG.not_started;
              const isOverdue = phase.status !== "completed" && phase.end_date < today;
              const isEditing = editingId === phase.id;
              const variance = phase.planned_end_date
                ? Math.round(
                    (new Date(phase.end_date).getTime() - new Date(phase.planned_end_date).getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                : 0;

              return (
                <div
                  key={phase.id}
                  className={`rounded-lg border p-3 flex items-start gap-3 ${
                    isOverdue ? "border-red-500/50" : ""
                  }`}
                >
                  {/* Color indicator */}
                  <div
                    className="w-1.5 h-full min-h-[40px] rounded-full shrink-0"
                    style={{ backgroundColor: phase.color }}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{phase.name}</span>
                      <Badge className={`${status.color} text-white text-[10px]`}>
                        {status.label}
                      </Badge>
                      {isOverdue && (
                        <Badge className="bg-red-500 text-white text-[10px] animate-pulse">
                          Overdue
                        </Badge>
                      )}
                      {variance !== 0 && (
                        <span className={`text-[10px] font-medium ${variance > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {variance > 0 ? `+${variance}d behind` : `${Math.abs(variance)}d ahead`}
                        </span>
                      )}
                    </div>

                    {/* Dates */}
                    {isEditing ? (
                      <form
                        className="flex items-center gap-2 mt-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          handleUpdateDates(
                            phase.id,
                            fd.get("start") as string,
                            fd.get("end") as string
                          );
                        }}
                      >
                        <input
                          name="start"
                          type="date"
                          defaultValue={phase.start_date}
                          className="rounded border bg-background px-2 py-1 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                          name="end"
                          type="date"
                          defaultValue={phase.end_date}
                          className="rounded border bg-background px-2 py-1 text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline" className="text-xs h-7">
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="text-xs h-7" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <button
                        onClick={() => setEditingId(phase.id)}
                        className="text-xs text-muted-foreground mt-1 hover:text-foreground"
                      >
                        {new Date(phase.start_date).toLocaleDateString()} — {new Date(phase.end_date).toLocaleDateString()}
                        {phase.planned_start_date && phase.planned_start_date !== phase.start_date && (
                          <span className="ml-2 opacity-50">
                            (planned: {new Date(phase.planned_start_date).toLocaleDateString()} — {new Date(phase.planned_end_date!).toLocaleDateString()})
                          </span>
                        )}
                      </button>
                    )}

                    {phase.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{phase.notes}</p>
                    )}

                    {lineItems.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Budget line</span>
                        <select
                          value={phase.estimate_line_item_id ?? ""}
                          onChange={(e) => handleUpdateLineItem(phase.id, e.target.value)}
                          className="text-[11px] bg-background border rounded px-1.5 py-0.5 max-w-[260px] truncate"
                        >
                          <option value="">— None —</option>
                          {lineItems.map((li) => (
                            <option key={li.id} value={li.id}>
                              {li.trade ? `[${li.trade}] ` : ""}{li.description}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Status selector */}
                    <select
                      value={phase.status}
                      onChange={(e) => handleUpdateStatus(phase.id, e.target.value)}
                      className="text-xs bg-background border rounded px-1.5 py-1"
                    >
                      <option value="not_started">Not Started</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Done</option>
                      <option value="on_hold">On Hold</option>
                    </select>
                    <button
                      onClick={() => handleDelete(phase.id)}
                      className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
