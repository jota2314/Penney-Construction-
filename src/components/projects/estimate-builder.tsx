"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Plus,
  Trash2,
  DollarSign,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileSpreadsheet,
  Mic,
  MicOff,
} from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface LineItem {
  id: string;
  category: string;
  scope_text: string;
  cost: number;
  markup_pct: number;
  client_price: number;
  profit: number;
  quote_status: string;
  notes: string;
}

interface EstimateBuilderProps {
  projectId: string;
  projectName: string;
  projectType: string | null;
  projectDescription: string | null;
  estimateId?: string;
  existingLineItems?: LineItem[];
  defaultMarkup?: number;
  hasWalkthrough?: boolean;
  hasTakeoff?: boolean;
  walkthroughCount?: number;
  takeoffCount?: number;
}

const STATUS_ICONS: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  known: { icon: CheckCircle, color: "text-emerald-400", label: "Known" },
  quoted: { icon: CheckCircle, color: "text-emerald-400", label: "Quoted" },
  allowance: { icon: AlertTriangle, color: "text-amber-400", label: "Allowance" },
  waiting: { icon: Clock, color: "text-red-400", label: "Waiting" },
};

function calcPrice(cost: number, markupPct: number) {
  return Math.round(cost * (1 + markupPct / 100));
}

function calcProfit(cost: number, clientPrice: number) {
  return clientPrice - cost;
}

export function EstimateBuilder({
  projectId,
  projectName,
  projectType,
  projectDescription,
  estimateId,
  existingLineItems = [],
  defaultMarkup = 30,
  hasWalkthrough = false,
  hasTakeoff = false,
  walkthroughCount = 0,
  takeoffCount = 0,
}: EstimateBuilderProps) {
  const [lines, setLines] = useState<LineItem[]>(existingLineItems);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [useWalkthrough, setUseWalkthrough] = useState(hasWalkthrough);
  const [useTakeoff, setUseTakeoff] = useState(hasTakeoff);
  const router = useRouter();

  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();
  if (transcript && transcript !== aiInput) setAiInput(transcript);

  // Totals
  const totalCost = lines.reduce((s, l) => s + l.cost, 0);
  const totalPrice = lines.reduce((s, l) => s + l.client_price, 0);
  const totalProfit = totalPrice - totalCost;
  const marginPct = totalPrice > 0 ? Math.round((totalProfit / totalPrice) * 100) : 0;
  const waitingCount = lines.filter((l) => l.quote_status === "waiting").length;
  const allowanceCount = lines.filter((l) => l.quote_status === "allowance").length;

  function updateLine(id: string, field: string, value: string | number) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, [field]: value };

        // Auto-calculate when cost or markup changes
        if (field === "cost" || field === "markup_pct") {
          const cost = field === "cost" ? Number(value) : l.cost;
          const markup = field === "markup_pct" ? Number(value) : l.markup_pct;
          updated.cost = cost;
          updated.markup_pct = markup;
          updated.client_price = calcPrice(cost, markup);
          updated.profit = calcProfit(cost, updated.client_price);
        }

        // If client_price is manually changed, back-calculate profit
        if (field === "client_price") {
          updated.client_price = Number(value);
          updated.profit = calcProfit(updated.cost, updated.client_price);
          updated.markup_pct = updated.cost > 0
            ? Math.round(((updated.client_price / updated.cost) - 1) * 100)
            : 30;
        }

        return updated;
      })
    );
  }

  function addLine() {
    const newLine: LineItem = {
      id: `new-${Date.now()}`,
      category: "",
      scope_text: "",
      cost: 0,
      markup_pct: defaultMarkup,
      client_price: 0,
      profit: 0,
      quote_status: "known",
      notes: "",
    };
    setLines((prev) => [...prev, newLine]);
    setEditingLine(newLine.id);
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function handleAiGenerate() {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    setAiInput("");
    stopListening();
    setAiLoading(true);

    try {
      const res = await fetch("/api/estimate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName,
          projectType,
          projectDescription,
          userMessage: text,
          includeWalkthrough: useWalkthrough,
          includeTakeoff: useTakeoff,
        }),
      });
      const data = await res.json();

      if (data.line_items && Array.isArray(data.line_items)) {
        const newLines: LineItem[] = data.line_items.map(
          (item: Record<string, unknown>, i: number) => {
            const cost = Number(item.cost) || 0;
            const markup = Number(item.markup_pct) || defaultMarkup;
            const price = Number(item.client_price) || calcPrice(cost, markup);
            return {
              id: `ai-${Date.now()}-${i}`,
              category: String(item.category || ""),
              scope_text: String(item.scope_text || ""),
              cost,
              markup_pct: markup,
              client_price: price,
              profit: calcProfit(cost, price),
              quote_status: String(item.quote_status || "allowance"),
              notes: String(item.notes || ""),
            };
          }
        );
        setLines((prev) => [...prev, ...newLines]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI estimate failed");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const supabase = createClient();

      // Create or update estimate
      let estId = estimateId;
      if (!estId) {
        const { data: est } = await supabase
          .from("estimates")
          .insert({
            project_id: projectId,
            name: `${projectName} Estimate`,
            total_price: totalPrice,
            total_cost: totalCost,
            total_profit: totalProfit,
            markup_pct: defaultMarkup,
            estimate_type: "preliminary",
            status: "draft",
            version: 1,
            created_by: (await supabase.auth.getUser()).data.user?.id,
          })
          .select("id")
          .single();
        estId = est?.id;
      } else {
        await supabase
          .from("estimates")
          .update({
            total_price: totalPrice,
            total_cost: totalCost,
            total_profit: totalProfit,
            updated_at: new Date().toISOString(),
          })
          .eq("id", estId);
      }

      if (!estId) throw new Error("Failed to create estimate");

      // Delete existing line items and re-insert
      await supabase.from("estimate_line_items").delete().eq("estimate_id", estId);

      const lineItems = lines.map((l, i) => ({
        estimate_id: estId,
        description: l.category,
        scope_text: l.scope_text,
        quantity: 1,
        unit_price: l.client_price,
        total_price: l.client_price,
        cost: l.cost,
        markup_pct: l.markup_pct,
        client_price: l.client_price,
        profit: l.profit,
        quote_status: l.quote_status,
        sort_order: i,
        sub_quote_id: null,
      }));

      await supabase.from("estimate_line_items").insert(lineItems);

      router.refresh();
      alert("Estimate saved!");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const fmt = (n: number) => "$" + n.toLocaleString();

  return (
    <div className="space-y-4">
      {/* Header with totals */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{projectName} — Estimate</h3>
          <p className="text-xs text-muted-foreground">
            {lines.length} line items
            {waitingCount > 0 && <span className="text-red-400 ml-2">{waitingCount} waiting on quotes</span>}
            {allowanceCount > 0 && <span className="text-amber-400 ml-2">{allowanceCount} allowances</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
          </Button>
          <a
            href={`/api/generate-proposal?projectId=${projectId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-green-500" />
            Proposal Excel
          </a>
          <Button size="sm" onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
            {saving ? "Saving..." : "Save Estimate"}
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Total Cost</p>
          <p className="text-lg font-bold">{fmt(totalCost)}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Client Price</p>
          <p className="text-lg font-bold text-amber-400">{fmt(totalPrice)}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Profit</p>
          <p className={`text-lg font-bold ${totalProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(totalProfit)}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Margin</p>
          <p className={`text-lg font-bold ${marginPct >= 25 ? "text-emerald-400" : marginPct >= 20 ? "text-amber-400" : "text-red-400"}`}>{marginPct}%</p>
        </div>
      </div>

      {/* AI Estimate Generator */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-amber-500" />
            <span className="font-medium">AI Estimate</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">— describe the project or use your data</span>
          </div>
          <div className="flex items-center gap-2">
            {walkthroughCount > 0 && (
              <button
                onClick={() => setUseWalkthrough(!useWalkthrough)}
                className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 ${
                  useWalkthrough
                    ? "bg-amber-600 text-white border-amber-600"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <CheckCircle className="h-3 w-3" />
                Walkthrough ({walkthroughCount})
              </button>
            )}
            {takeoffCount > 0 && (
              <button
                onClick={() => setUseTakeoff(!useTakeoff)}
                className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 ${
                  useTakeoff
                    ? "bg-violet-600 text-white border-violet-600"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <CheckCircle className="h-3 w-3" />
                Takeoff ({takeoffCount})
              </button>
            )}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAiGenerate(); }
            }}
            placeholder={isListening ? "Listening..." : `"Estimate a 2-bathroom remodel, full gut, about 200 sqft total"...`}
            rows={2}
            disabled={aiLoading}
            className={`flex-1 rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 ${isListening ? "border-red-400" : ""}`}
          />
          {isSupported && (
            <button
              onClick={() => isListening ? stopListening() : (setAiInput(""), startListening())}
              disabled={aiLoading}
              className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${isListening ? "bg-red-600 text-white animate-pulse" : "border text-muted-foreground hover:text-amber-400"}`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <Button onClick={handleAiGenerate} disabled={aiLoading || !aiInput.trim()} className="shrink-0 h-10 bg-amber-600 hover:bg-amber-700">
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Line items table */}
      {lines.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          {/* Header */}
          <div className="hidden sm:grid grid-cols-12 gap-px bg-muted/50 text-xs font-medium text-muted-foreground p-2">
            <div className="col-span-3">Category</div>
            <div className="col-span-3">Scope</div>
            <div className="col-span-1 text-right">Cost</div>
            <div className="col-span-1 text-center">Markup</div>
            <div className="col-span-1 text-right">Price</div>
            <div className="col-span-1 text-right">Profit</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-1"></div>
          </div>

          {/* Lines */}
          {lines.map((line) => {
            const statusConfig = STATUS_ICONS[line.quote_status] || STATUS_ICONS.known;
            const StatusIcon = statusConfig.icon;
            const isEditing = editingLine === line.id;
            const profitColor = line.profit > 0 ? "text-emerald-400" : line.profit < 0 ? "text-red-400" : "";

            return (
              <div
                key={line.id}
                className="border-t p-2 hover:bg-muted/30 cursor-pointer"
                onClick={() => setEditingLine(isEditing ? null : line.id)}
              >
                {/* Compact view */}
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6 sm:col-span-3">
                    {isEditing ? (
                      <input
                        value={line.category}
                        onChange={(e) => updateLine(line.id, "category", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-background border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-amber-500"
                        placeholder="Category name"
                      />
                    ) : (
                      <span className="text-sm font-medium">{line.category || "Untitled"}</span>
                    )}
                  </div>
                  <div className="hidden sm:block col-span-3">
                    <p className="text-xs text-muted-foreground truncate">{line.scope_text || "—"}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        value={line.cost || ""}
                        onChange={(e) => updateLine(line.id, "cost", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-background border rounded px-1 py-1 text-xs text-right focus:ring-1 focus:ring-amber-500"
                      />
                    ) : (
                      <span className="text-xs">{fmt(line.cost)}</span>
                    )}
                  </div>
                  <div className="hidden sm:block col-span-1 text-center">
                    <span className="text-xs">{line.markup_pct}%</span>
                  </div>
                  <div className="col-span-2 sm:col-span-1 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        value={line.client_price || ""}
                        onChange={(e) => updateLine(line.id, "client_price", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-background border rounded px-1 py-1 text-xs text-right focus:ring-1 focus:ring-amber-500"
                      />
                    ) : (
                      <span className="text-xs font-medium text-amber-400">{fmt(line.client_price)}</span>
                    )}
                  </div>
                  <div className="hidden sm:block col-span-1 text-right">
                    <span className={`text-xs font-medium ${profitColor}`}>{fmt(line.profit)}</span>
                  </div>
                  <div className="hidden sm:block col-span-1 text-center">
                    <StatusIcon className={`h-3.5 w-3.5 inline ${statusConfig.color}`} />
                  </div>
                  <div className="col-span-2 sm:col-span-1 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); removeLine(line.id); }}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 ml-auto"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Expanded edit view */}
                {isEditing && (
                  <div className="mt-2 pt-2 border-t space-y-2" onClick={(e) => e.stopPropagation()}>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Scope of Work</label>
                      <textarea
                        value={line.scope_text}
                        onChange={(e) => updateLine(line.id, "scope_text", e.target.value)}
                        rows={3}
                        className="w-full bg-background border rounded px-2 py-1 text-xs resize-none focus:ring-1 focus:ring-amber-500"
                        placeholder="- Detailed scope description..."
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Cost</label>
                        <input
                          type="number"
                          value={line.cost || ""}
                          onChange={(e) => updateLine(line.id, "cost", e.target.value)}
                          className="w-full bg-background border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Markup %</label>
                        <input
                          type="number"
                          value={line.markup_pct || ""}
                          onChange={(e) => updateLine(line.id, "markup_pct", e.target.value)}
                          className="w-full bg-background border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Client Price</label>
                        <input
                          type="number"
                          value={line.client_price || ""}
                          onChange={(e) => updateLine(line.id, "client_price", e.target.value)}
                          className="w-full bg-background border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Status</label>
                        <select
                          value={line.quote_status}
                          onChange={(e) => updateLine(line.id, "quote_status", e.target.value)}
                          className="w-full bg-background border rounded px-2 py-1 text-xs"
                        >
                          <option value="known">Known</option>
                          <option value="quoted">Quoted</option>
                          <option value="allowance">Allowance</option>
                          <option value="waiting">Waiting</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Internal Notes</label>
                      <input
                        value={line.notes}
                        onChange={(e) => updateLine(line.id, "notes", e.target.value)}
                        className="w-full bg-background border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500"
                        placeholder="Which sub, where the price came from..."
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Totals row */}
          <div className="border-t bg-muted/30 p-2">
            <div className="grid grid-cols-12 gap-2 items-center font-semibold text-sm">
              <div className="col-span-6 sm:col-span-6">TOTAL</div>
              <div className="col-span-2 sm:col-span-1 text-right">{fmt(totalCost)}</div>
              <div className="hidden sm:block col-span-1 text-center">{marginPct}%</div>
              <div className="col-span-2 sm:col-span-1 text-right text-amber-400">{fmt(totalPrice)}</div>
              <div className="hidden sm:block col-span-1 text-right">
                <span className={totalProfit >= 0 ? "text-emerald-400" : "text-red-400"}>{fmt(totalProfit)}</span>
              </div>
              <div className="col-span-2 sm:col-span-2"></div>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {lines.length === 0 && !aiLoading && (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No line items yet</p>
          <p className="text-xs mt-1">Use AI to generate an estimate or add lines manually</p>
        </div>
      )}
    </div>
  );
}
