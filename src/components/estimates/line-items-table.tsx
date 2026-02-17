"use client";

import { useState, useRef, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, ChevronUp, ChevronDown, Sparkles, Mic, MicOff } from "lucide-react";
import {
  addLineItem,
  updateLineItem,
  deleteLineItem,
  reorderLineItems,
} from "@/lib/actions/estimates";
import type { EstimateLineItem } from "@/types/database";

interface ProjectContext {
  projectType: string;
  projectName: string;
  projectAddress?: string;
  projectOverview?: string;
}

interface LineItemsTableProps {
  estimateId: string;
  projectId: string;
  lineItems: EstimateLineItem[];
  projectContext?: ProjectContext;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);

interface RowState {
  description: string;
  proposal_description: string;
  value: string;
}

function stateFromItem(item: EstimateLineItem): RowState {
  return {
    description: item.description,
    proposal_description: item.proposal_description ?? "",
    value: item.total_price ? String(item.total_price) : "",
  };
}

export function LineItemsTable({
  estimateId,
  projectId,
  lineItems,
  projectContext,
}: LineItemsTableProps) {
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [textareaKeys, setTextareaKeys] = useState<Map<string, number>>(
    new Map()
  );
  const [error, setError] = useState<string | null>(null);
  // Track local edits per row so blur can compare & save
  const localEdits = useRef<Map<string, RowState>>(new Map());
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const total = lineItems.reduce((sum, item) => sum + (item.total_price ?? 0), 0);

  const getLocalState = useCallback(
    (item: EstimateLineItem): RowState => {
      return localEdits.current.get(item.id) ?? stateFromItem(item);
    },
    []
  );

  const setLocalField = useCallback(
    (id: string, field: keyof RowState, value: string) => {
      const existing = localEdits.current.get(id);
      const item = lineItems.find((i) => i.id === id);
      const base = existing ?? (item ? stateFromItem(item) : { description: "", proposal_description: "", value: "" });
      localEdits.current.set(id, { ...base, [field]: value });
    },
    [lineItems]
  );

  async function handleBlurSave(item: EstimateLineItem) {
    const local = localEdits.current.get(item.id);
    if (!local) return; // no edits

    const original = stateFromItem(item);
    const changed =
      local.description !== original.description ||
      local.proposal_description !== original.proposal_description ||
      local.value !== original.value;

    if (!changed) return;

    if (!local.description.trim()) return; // don't save empty item name

    setSavingIds((prev) => new Set(prev).add(item.id));
    setError(null);

    const result = await updateLineItem(item.id, estimateId, projectId, {
      description: local.description.trim(),
      proposal_description: local.proposal_description.trim() || undefined,
      value: parseFloat(local.value) || 0,
    });

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    if (result.error) {
      setError(result.error);
    } else {
      localEdits.current.delete(item.id);
    }
  }

  async function handleAddRow() {
    setError(null);
    const result = await addLineItem(estimateId, projectId, {
      description: "",
      value: 0,
    });
    if (result.error) setError(result.error);
  }

  async function handleDelete(itemId: string) {
    localEdits.current.delete(itemId);
    const result = await deleteLineItem(itemId, estimateId, projectId);
    if (result.error) setError(result.error);
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    const updated = lineItems.map((item, i) => ({
      id: item.id,
      sort_order:
        i === index
          ? lineItems[i - 1].sort_order
          : i === index - 1
            ? lineItems[index].sort_order
            : item.sort_order,
    }));
    await reorderLineItems(estimateId, projectId, updated);
  }

  async function handleMoveDown(index: number) {
    if (index === lineItems.length - 1) return;
    const updated = lineItems.map((item, i) => ({
      id: item.id,
      sort_order:
        i === index
          ? lineItems[i + 1].sort_order
          : i === index + 1
            ? lineItems[index].sort_order
            : item.sort_order,
    }));
    await reorderLineItems(estimateId, projectId, updated);
  }

  async function handleGenerateScope(item: EstimateLineItem, dictation?: string) {
    const local = localEdits.current.get(item.id);
    const itemName = local?.description ?? item.description;
    if (!itemName.trim()) return;

    setGeneratingIds((prev) => new Set(prev).add(item.id));
    setError(null);

    try {
      const res = await fetch("/api/generate-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName: itemName.trim(),
          dictation: dictation?.trim() || undefined,
          projectType: projectContext?.projectType,
          projectName: projectContext?.projectName,
          projectAddress: projectContext?.projectAddress,
          projectOverview: projectContext?.projectOverview,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate scope");
      }

      const { scope } = await res.json();
      setLocalField(item.id, "proposal_description", scope);
      setTextareaKeys((prev) => {
        const next = new Map(prev);
        next.set(item.id, (next.get(item.id) ?? 0) + 1);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate scope");
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  function handleVoiceInput(item: EstimateLineItem) {
    // If already recording this row, stop it
    if (recordingId === item.id && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setRecordingId(null);
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        handleGenerateScope(item, transcript);
      }
      setRecordingId(null);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setRecordingId(null);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setRecordingId(null);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setRecordingId(item.id);
    recognition.start();
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px] text-center">#</TableHead>
              <TableHead className="w-[200px]">Item</TableHead>
              <TableHead>Scope of Work</TableHead>
              <TableHead className="w-[150px] text-right">Value ($)</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineItems.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No line items yet. Click &quot;Add Row&quot; to get started.
                </TableCell>
              </TableRow>
            )}

            {lineItems.map((item, index) => {
              const local = getLocalState(item);
              const isSaving = savingIds.has(item.id);
              const isGenerating = generatingIds.has(item.id);
              const isRecording = recordingId === item.id;
              const taKey = textareaKeys.get(item.id) ?? 0;

              return (
                <TableRow key={item.id} className={isSaving ? "opacity-60" : ""}>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell className="p-1.5">
                    <Input
                      defaultValue={local.description}
                      onChange={(e) =>
                        setLocalField(item.id, "description", e.target.value)
                      }
                      onBlur={() => handleBlurSave(item)}
                      placeholder="Item name"
                      className="h-8"
                      disabled={isSaving}
                    />
                  </TableCell>
                  <TableCell className="p-1.5">
                    <div className="relative">
                      <Textarea
                        key={`scope-${item.id}-${taKey}`}
                        defaultValue={local.proposal_description}
                        onChange={(e) =>
                          setLocalField(
                            item.id,
                            "proposal_description",
                            e.target.value
                          )
                        }
                        onBlur={() => handleBlurSave(item)}
                        placeholder="Describe the scope of work..."
                        className="min-h-[34px] resize-y text-sm pr-14"
                        rows={1}
                        disabled={isSaving}
                      />
                      <div className="absolute top-1 right-1 flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleVoiceInput(item)}
                          disabled={
                            !local.description.trim() ||
                            isGenerating ||
                            isSaving
                          }
                          className={`p-1 rounded transition-colors ${
                            isRecording
                              ? "bg-red-100 text-red-600 hover:bg-red-200"
                              : "hover:bg-muted text-muted-foreground hover:text-foreground"
                          } disabled:opacity-30 disabled:pointer-events-none`}
                          title={isRecording ? "Stop recording" : "Dictate scope with voice"}
                        >
                          {isRecording ? (
                            <MicOff className="h-3.5 w-3.5" />
                          ) : (
                            <Mic className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateScope(item)}
                          disabled={
                            !local.description.trim() ||
                            isGenerating ||
                            isSaving
                          }
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
                          title="Generate scope with AI"
                        >
                          {isGenerating ? (
                            <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="p-1.5">
                    <Input
                      type="number"
                      defaultValue={local.value}
                      onChange={(e) =>
                        setLocalField(item.id, "value", e.target.value)
                      }
                      onBlur={() => handleBlurSave(item)}
                      placeholder="0.00"
                      className="h-8 text-right"
                      step="0.01"
                      min="0"
                      disabled={isSaving}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleDelete(item.id)}
                        disabled={isSaving}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === 0 || isSaving}
                        onClick={() => handleMoveUp(index)}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === lineItems.length - 1 || isSaving}
                        onClick={() => handleMoveDown(index)}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {lineItems.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold">
                  Total
                </TableCell>
                <TableCell className="text-right font-bold">
                  {formatCurrency(total)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <Button variant="outline" size="sm" onClick={handleAddRow}>
        <Plus className="mr-2 h-4 w-4" />
        Add Row
      </Button>
    </div>
  );
}
