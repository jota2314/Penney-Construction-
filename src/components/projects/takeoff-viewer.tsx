"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Move,
  Ruler,
  Pentagon,
  Hash,
  ZoomIn,
  ZoomOut,
  Save,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Scaling,
  Undo,
  Loader2,
  Bot,
  Send,
  Pencil,
  Check,
  Plus,
  GripVertical,
  FolderOpen,
  Folder,
  FileSpreadsheet,
  Sparkles,
  Eye,
  AlertTriangle,
  FileText,
  Mic,
  ImagePlus,
  MessageSquare,
  PanelRightClose,
  Paperclip,
  Mail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { REQUIRED_TRADES } from "@/lib/constants/trade-rate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedMeasurement {
  id?: string;
  type: "linear" | "area" | "count";
  label: string;           // individual entry label (e.g., "North wall") or composite "guideItem | subLabel"
  guideItemLabel?: string; // parent guide item label (e.g., "Pre-Stained White Cedar Shingle Siding")
  points: { x: number; y: number }[];
  value: number;
  unit: string;
  color: string;
  pageNumber: number;
  saved?: boolean;
}

export interface TakeoffChecklistItem {
  label: string;
  type: "linear" | "area" | "count";
  trade: string;
  description: string;
  done: boolean;
}

// Phase 1.5: per-page parallel extraction → scope organized by trade.
// Every residential trade is guaranteed to have at least one scope line
// (real or "needs quote") so nothing falls out of the bid package.
type DerivedFrom =
  | "footprint"
  | "perimeter"
  | "wall_area"
  | "wall_area_minus_openings"
  | "roof_area"
  | "count_windows"
  | "count_doors"
  | "";

interface ScopeItem {
  id: string;
  trade: string;                 // slug key — matches tradeOrder
  description: string;
  quantity: number | null;
  unit: string | null;
  materialSpec?: string;
  sourceSheet?: string;
  sourceType?: "dimension_string" | "schedule_row" | "callout" | "computed" | "note" | "visible_on_plan";
  sourceDetail?: string;
  computation?: string;
  confidence: "high" | "medium" | "low" | "none";
  needsQuote: boolean;
  notes?: string;
  derivedFrom?: DerivedFrom;
}

interface ProjectDim { value: number; source?: string; confidence?: "high" | "medium" | "low" | "none"; }
interface ProjectDimensions {
  footprintSF?: ProjectDim;
  perimeterLF?: ProjectDim;
  wallHeight?: ProjectDim;
  roofPitchFactor?: ProjectDim;
  exteriorWindowCount?: ProjectDim;
  exteriorDoorCount?: ProjectDim;
}

interface AnalysisScheduleWindow {
  tag?: string; manufacturer?: string; model?: string; size?: string;
  count: number; sourceSheet?: string; notes?: string;
}

interface AnalysisScheduleDoor {
  tag?: string; type?: string; size?: string;
  count: number; sourceSheet?: string; notes?: string;
}

interface AnalysisScheduleStructural {
  tag?: string; type: string; size: string; span?: string;
  count: number; sourceSheet?: string; notes?: string;
}

interface AnalysisScheduleFinish {
  room?: string; floor?: string; walls?: string; ceiling?: string; sourceSheet?: string;
}

interface FullAnalysisResult {
  projectSummary?: { sheetsAnalyzed?: number; coverSheet?: string };
  projectDimensions?: ProjectDimensions;
  sheetIndex?: { page: number; sheetNumber?: string; title: string; purpose?: string }[];
  scopeByTrade: Record<string, ScopeItem[]>;
  tradeOrder: string[];
  tradeLabels: Record<string, string>;
  schedules?: {
    windows?: AnalysisScheduleWindow[];
    doors?: AnalysisScheduleDoor[];
    structural?: AnalysisScheduleStructural[];
    finishes?: AnalysisScheduleFinish[];
  };
  missingInfo?: { item: string; whyNeeded: string; suggestedSource: string }[];
  materialNotes?: string[];
  pagesAnalyzed?: number;
  pagesFailed?: number;
  model?: string;
}

export interface TakeoffViewerProps {
  pdfUrl: string;
  filename: string;
  initialMeasurements?: SavedMeasurement[];
  initialScale?: number;
  initialChecklist?: TakeoffChecklistItem[];
  projectId?: string;
  storagePath?: string;
  drawingText?: string;
  scopeOfWork?: string;
  onSave?: (measurements: SavedMeasurement[], scalePixelsPerFoot: number | null, checklist?: TakeoffChecklistItem[]) => void;
  onClose?: () => void;
}

type ToolMode = "pan" | "scale" | "measure" | "area" | "count";

interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function polygonArea(pts: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  const n = pts.length;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const AMBER = "#F59E0B";
const GREEN = "#22C55E";

const GUIDE_COLORS = [
  "#3B82F6", // blue
  "#EF4444", // red
  "#10B981", // emerald
  "#F59E0B", // amber
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F97316", // orange
];

/** Parse a composite label "guideItem | subLabel" back into parts */
function parseCompositeLabel(label: string): { guideItemLabel?: string; subLabel: string } {
  const sepIdx = label.indexOf(" | ");
  if (sepIdx >= 0) {
    return { guideItemLabel: label.slice(0, sepIdx), subLabel: label.slice(sepIdx + 3) };
  }
  return { subLabel: label };
}

/** Build a composite label for storage/backward compat */
function buildCompositeLabel(guideItemLabel: string | undefined, subLabel: string): string {
  if (guideItemLabel) return `${guideItemLabel} | ${subLabel}`;
  return subLabel;
}

/** Get the display sub-label from a measurement (strips guideItemLabel prefix if present) */
function getSubLabel(m: SavedMeasurement): string {
  if (m.guideItemLabel) {
    const parsed = parseCompositeLabel(m.label);
    return parsed.subLabel;
  }
  return m.label;
}

/** Compute the fill color string for area overlays from any hex color */
function hexToAreaFill(hex: string): string {
  // Parse hex to r,g,b
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.15)`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TakeoffViewer({
  pdfUrl,
  filename,
  initialMeasurements,
  initialChecklist,
  projectId: propProjectId,
  storagePath: propStoragePath,
  initialScale,
  drawingText,
  scopeOfWork,
  onSave,
  onClose,
}: TakeoffViewerProps) {
  const router = useRouter();

  // ---- Create Estimate state -----------------------------------------------

  // ---- PDF state -----------------------------------------------------------
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageImages, setPageImages] = useState<Map<number, ImageBitmap>>(
    new Map()
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Canvas refs ---------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // ---- Viewport / interaction state ----------------------------------------
  const transformRef = useRef<ViewTransform>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [transform, setTransform] = useState<ViewTransform>(
    transformRef.current
  );
  const [tool, setTool] = useState<ToolMode>("pan");
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const spaceHeldRef = useRef(false);

  // ---- Scale calibration ---------------------------------------------------
  const [pixelsPerFoot, setPixelsPerFoot] = useState<number | null>(initialScale ?? null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [scalePoints, setScalePoints] = useState<{ x: number; y: number }[]>(
    []
  );
  const [showScaleInput, setShowScaleInput] = useState(false);
  const [scaleInputValue, setScaleInputValue] = useState("");
  const scalePixelDist = useRef(0);

  // ---- Measurements --------------------------------------------------------
  const [measurements, setMeasurements] = useState<SavedMeasurement[]>(
    () => (initialMeasurements ?? []).map(m => {
      // Restore guideItemLabel from composite label for backward compat
      const parsed = parseCompositeLabel(m.label);
      return { ...m, saved: true, guideItemLabel: m.guideItemLabel ?? parsed.guideItemLabel };
    })
  );
  const [activePoints, setActivePoints] = useState<{ x: number; y: number }[]>(
    []
  );
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null
  );

  // ---- Inline naming for new measurements ----------------------------------
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");

  // ---- Toast notification --------------------------------------------------
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ---- Grouped measurement collapse state ---------------------------------
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ---- Count groups --------------------------------------------------------
  const [countLabel, setCountLabel] = useState("Items");

  // ---- AI Chat & Checklist --------------------------------------------------
  const [showAiChat, setShowAiChat] = useState(!!drawingText);
  const [aiMessages, setAiMessages] = useState<Array<{
    role: "user" | "assistant";
    content: string;
    actions?: Array<{ id: string; type: string; label: string; data: Record<string, unknown>; status: "pending" | "executing" | "approved" | "error" }>;
  }>>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiToolStatus, setAiToolStatus] = useState<string | null>(null);
  const [aiPendingImages, setAiPendingImages] = useState<Array<{ base64: string; mediaType: string; preview: string }>>([]);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [takeoffConvId, setTakeoffConvId] = useState<string | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  const { isListening, transcript, startListening, stopListening, isSupported: micSupported } = useSpeechRecognition();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [checklist, setChecklist] = useState<TakeoffChecklistItem[]>(initialChecklist ?? []);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const checklistGenerated = useRef(!!(initialChecklist && initialChecklist.length > 0));

  // ---- Per-trade chat state -------------------------------------------------
  const [activeTrade, setActiveTrade] = useState<string | null>(null);
  const [activeTradeLabel, setActiveTradeLabel] = useState<string | null>(null);
  const tradeConvCache = useRef<Record<string, { convId: string | null; messages: typeof aiMessages }>>({});
  const [activeTradeConvs, setActiveTradeConvs] = useState<Array<{
    id: string;
    title: string;
    messageCount: number;
    lineItem?: { id: string; total_cost: number; total_price: number; needs_sub_quote: boolean } | null;
    quotesCount?: number;
  }>>([]);

  // ---- Line item bound to the active trade chat ----------------------------
  const [tradeLineItem, setTradeLineItem] = useState<{
    id: string;
    description: string;
    quantity: number;
    unit: string;
    unit_cost: number;
    total_cost: number;
    markup_percentage: number;
    total_price: number;
    needs_sub_quote?: boolean;
  } | null>(null);
  const [tradeQuotes, setTradeQuotes] = useState<Array<{
    id: string;
    subcontractor_name: string;
    amount: number | null;
    status: string;
  }>>([]);
  const [tradeScreenshots, setTradeScreenshots] = useState<Array<{ path: string; url: string; name: string }>>([]);
  const [priceSaving, setPriceSaving] = useState(false);

  // ---- Full AI Analysis state ----------------------------------------------
  const [fullAnalysis, setFullAnalysis] = useState<FullAnalysisResult | null>(null);
  const [fullAnalysisLoading, setFullAnalysisLoading] = useState(false);
  const [fullAnalysisProgress, setFullAnalysisProgress] = useState("");
  const [showAnalysisResults, setShowAnalysisResults] = useState(false);
  const [confirmedQuantityIds, setConfirmedQuantityIds] = useState<Set<string>>(new Set());

  // Project Dimensions — the key numbers that drive all derived scope qtys.
  // Editable in the overlay; changes cascade to every scope line with
  // derivedFrom set.
  const [projectDims, setProjectDims] = useState<ProjectDimensions>({});


  // ---- Touch state ---------------------------------------------------------
  const touchStartDist = useRef(0);
  const touchStartScale = useRef(1);
  const touchStartCenter = useRef({ x: 0, y: 0 });
  const touchStartOffset = useRef({ x: 0, y: 0 });

  // ---- Derived: count unsaved measurements ---------------------------------
  const unsavedCount = measurements.filter(m => !m.saved).length;

  // ---- Available trades for the trade picker --------------------------------
  const availableTrades = useMemo(() => {
    if (fullAnalysis?.tradeOrder?.length) {
      return fullAnalysis.tradeOrder.map(key => ({
        key,
        label: fullAnalysis.tradeLabels?.[key] || key,
        description: REQUIRED_TRADES.find(t => t.key === key)?.description || "",
      }));
    }
    return REQUIRED_TRADES;
  }, [fullAnalysis]);

  // Load active trade conversations list when chat panel opens
  useEffect(() => {
    if (!showChatPanel || !propProjectId) return;
    fetch(`/api/takeoff-chat/history?projectId=${propProjectId}&listAll=true`)
      .then(r => r.json())
      .then(data => setActiveTradeConvs(data.conversations || []))
      .catch(() => {});
  }, [showChatPanel, propProjectId]);

  // Switch to a different trade's chat
  async function switchTrade(tradeKey: string, label: string) {
    // Cache current trade state
    if (activeTrade) {
      tradeConvCache.current[activeTrade] = {
        convId: takeoffConvId,
        messages: [...aiMessages],
      };
    }

    setActiveTrade(tradeKey);
    setActiveTradeLabel(label);
    setAiPendingImages([]);
    setAiToolStatus(null);
    setShowChatPanel(true);

    // Check cache first
    const cached = tradeConvCache.current[tradeKey];
    if (cached) {
      setTakeoffConvId(cached.convId);
      setAiMessages(cached.messages);
      return;
    }

    // Load from server
    setAiMessages([]);
    setTakeoffConvId(null);
    setTradeLineItem(null);
    setTradeQuotes([]);
    setTradeScreenshots([]);
    setAiLoading(true);
    try {
      const res = await fetch(
        `/api/takeoff-chat/history?projectId=${propProjectId}&trade=${tradeKey}&tradeLabel=${encodeURIComponent(label)}`
      );
      if (res.ok) {
        const data = await res.json();
        setTakeoffConvId(data.conversationId || null);
        setAiMessages(
          data.messages?.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })) || []
        );
        if (data.lineItem) setTradeLineItem(data.lineItem);
        if (Array.isArray(data.quotes)) setTradeQuotes(data.quotes);
        if (Array.isArray(data.screenshots)) setTradeScreenshots(data.screenshots);
      }
    } catch { /* ignore */ }
    finally { setAiLoading(false); }
  }

  // Save a pricing field edit — hits the direct (non-AI) update endpoint,
  // then syncs local state with the server-computed totals.
  async function saveLineItemField(
    field: "unit_cost" | "quantity" | "unit" | "markup_percentage",
    value: number | string
  ) {
    if (!tradeLineItem) return;
    setPriceSaving(true);
    try {
      const res = await fetch("/api/update-line-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_item_id: tradeLineItem.id, [field]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        setTradeLineItem(prev => prev ? {
          ...prev,
          unit_cost: Number(data.unit_cost),
          quantity: Number(data.quantity),
          unit: String(data.unit),
          markup_percentage: Number(data.markup_percentage),
          total_cost: Number(data.total_cost),
          total_price: Number(data.total_price),
        } : prev);
      }
    } catch { /* non-critical */ }
    finally { setPriceSaving(false); }
  }

  // Delete a trade chat conversation
  async function deleteTradeChat(tradeKey: string, label: string) {
    const conv = activeTradeConvs.find(c => c.title === `Takeoff - ${label}`);
    if (!conv) return;
    if (!confirm(`Delete the ${label} chat? This removes all messages and scope.`)) return;

    try {
      await fetch("/api/takeoff-chat/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv.id }),
      });

      // Clear from state
      setActiveTradeConvs(prev => prev.filter(c => c.id !== conv.id));
      delete tradeConvCache.current[tradeKey];

      // If this was the active trade, close the chat panel
      if (activeTrade === tradeKey) {
        setActiveTrade(null);
        setActiveTradeLabel(null);
        setShowChatPanel(false);
        setAiMessages([]);
        setTakeoffConvId(null);
      }
    } catch { /* ignore */ }
  }

  // ---- Full AI Analysis — render all pages and send to vision API ----------
  async function runFullAnalysis() {
    if (!pdfDoc || fullAnalysisLoading) return;

    setFullAnalysisLoading(true);
    setFullAnalysisProgress("Rendering pages...");

    try {
      const pages: { data: string; mediaType: string; label?: string }[] = [];

      // Render each page to base64 JPEG at a resolution Claude can actually
      // read dim strings from. Architectural drawings need ~2400px long edge
      // minimum; at 1600 Claude was missing numbers. We compensate payload
      // pressure with tighter JPEG quality + a per-page size floor check.
      const TARGET_LONG_EDGE = 3000;   // px — dim text on dense architectural sheets needs this
      const MAX_TOTAL_BYTES = 4_000_000; // stay well under Vercel's 4.5 MB body limit
      const rawPages: { canvas: HTMLCanvasElement; label: string }[] = [];
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        setFullAnalysisProgress(`Rendering page ${p} of ${pdfDoc.numPages}...`);
        const page = await pdfDoc.getPage(p);
        const baseViewport = page.getViewport({ scale: 1 });
        const longEdge = Math.max(baseViewport.width, baseViewport.height);
        const scale = Math.min(3.0, TARGET_LONG_EDGE / longEdge);
        const viewport = page.getViewport({ scale });
        const offscreen = document.createElement("canvas");
        offscreen.width = viewport.width;
        offscreen.height = viewport.height;
        const ctx = offscreen.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas: offscreen } as any).promise;
        rawPages.push({ canvas: offscreen, label: `Page ${p}` });
      }

      // Encode with a quality that keeps total payload under the limit.
      let quality = 0.8;
      let totalBytes = 0;
      let encoded: { data: string; mediaType: string; label: string }[] = [];
      for (let pass = 0; pass < 4; pass++) {
        encoded = [];
        totalBytes = 0;
        for (const rp of rawPages) {
          const dataUrl = rp.canvas.toDataURL("image/jpeg", quality);
          const b64 = dataUrl.split(",")[1];
          totalBytes += b64.length;
          encoded.push({ data: b64, mediaType: "image/jpeg", label: rp.label });
        }
        if (totalBytes < MAX_TOTAL_BYTES) break;
        quality = Math.max(0.45, quality - 0.12);
      }
      pages.push(...encoded);

      setFullAnalysisProgress(`Analyzing ${pages.length} pages with AI...`);

      const res = await fetch("/api/takeoff-full-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages,
          filename,
          drawingText,
          scopeOfWork,
          projectId: propProjectId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Analysis failed");
      }

      const result: FullAnalysisResult = await res.json();
      // Backfill stable IDs on every scope item — Claude/server don't always
      // preserve them across the merge pipeline.
      if (result.scopeByTrade && typeof result.scopeByTrade === "object") {
        for (const k of Object.keys(result.scopeByTrade)) {
          result.scopeByTrade[k] = (result.scopeByTrade[k] || []).map((it, i) => ({
            ...it,
            id: it.id && String(it.id).trim() ? String(it.id) : `${k}_${i}_${uid()}`,
          }));
        }
      }
      setFullAnalysis(result);
      setConfirmedQuantityIds(new Set());
      setProjectDims(result.projectDimensions || {});

      // Summary: trades covered vs. trades needing quotes only
      const tradeOrder = result.tradeOrder || [];
      let tradesWithRealQty = 0;
      let tradesAllStub = 0;
      let totalItems = 0;
      for (const key of tradeOrder) {
        const items = result.scopeByTrade?.[key] || [];
        totalItems += items.length;
        if (items.some(i => i.quantity != null && i.quantity > 0)) tradesWithRealQty++;
        else tradesAllStub++;
      }

      // Push scope to estimate (upsert one line per trade) — then seed/link chats.
      // One click = analyze drawings + upsert estimate line items + link each
      // chat to its line item ID. Existing line item IDs and pricing are preserved.
      let lineItemsByTrade: Record<string, string> = {};
      if (propProjectId && tradeOrder.length > 0) {
        setFullAnalysisProgress(`Pricing ${tradeOrder.length} trades...`);
        try {
          const estRes = await fetch("/api/takeoff-scope-to-estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: propProjectId,
              scopeByTrade: result.scopeByTrade,
              tradeOrder,
              tradeLabels: result.tradeLabels,
            }),
          });
          if (estRes.ok) {
            const estData = await estRes.json();
            lineItemsByTrade = estData.lineItemsByTrade || {};
          }
        } catch { /* non-critical — still seed chats below */ }

        setFullAnalysisProgress(`Creating ${tradeOrder.length} trade chats...`);
        try {
          await fetch("/api/takeoff-chat/seed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: propProjectId,
              scopeByTrade: result.scopeByTrade,
              tradeOrder,
              tradeLabels: result.tradeLabels,
              lineItemsByTrade,
            }),
          });
          // Refresh the trade conversations list
          const convRes = await fetch(`/api/takeoff-chat/history?projectId=${propProjectId}&listAll=true`);
          if (convRes.ok) {
            const convData = await convRes.json();
            setActiveTradeConvs(convData.conversations || []);
          }
          // Clear the cache so switching loads fresh seeded data
          tradeConvCache.current = {};
        } catch { /* non-critical */ }
      }

      const winCount = result.schedules?.windows?.reduce((s, w) => s + (w.count || 0), 0) || 0;
      const doorCount = result.schedules?.doors?.reduce((s, d) => s + (d.count || 0), 0) || 0;
      setToastMessage(
        `${tradeOrder.length} trade chats created — ${totalItems} scope items across ${tradeOrder.length} trades. ${winCount} windows, ${doorCount} doors.`
      );
      setTimeout(() => setToastMessage(null), 6000);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Analysis failed");
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setFullAnalysisLoading(false);
      setFullAnalysisProgress("");
    }
  }

  // ---- Confirm scope items into the takeoff --------------------------------
  function unitToType(unit: string | null | undefined): "linear" | "area" | "count" {
    const u = (unit || "").toLowerCase().trim();
    if (u === "sf" || u === "sqft" || u === "sq ft" || u === "sq" || u === "square feet" || u === "cuft" || u === "cy") return "area";
    if (u === "ea" || u === "each" || u === "count" || u === "ct" || u === "pcs" || u === "pc" || u === "sheets") return "count";
    return "linear";
  }

  /** Compute qty and unit for a scope item that has a derivedFrom formula. */
  function deriveScopeQty(item: ScopeItem, dims: ProjectDimensions): { quantity: number | null; unit: string | null; formula?: string } {
    const f = item.derivedFrom;
    if (!f) return { quantity: item.quantity, unit: item.unit };
    const foot = dims.footprintSF?.value;
    const perim = dims.perimeterLF?.value;
    const wh = dims.wallHeight?.value || 9;
    const pitch = dims.roofPitchFactor?.value || 1.118;
    const windows = dims.exteriorWindowCount?.value || 0;
    const doors = dims.exteriorDoorCount?.value || 0;

    switch (f) {
      case "footprint":
        return foot ? { quantity: Math.round(foot * 100) / 100, unit: "sqft", formula: `footprint ${foot} sqft` } : { quantity: null, unit: null };
      case "perimeter":
        return perim ? { quantity: Math.round(perim * 100) / 100, unit: "LF", formula: `perimeter ${perim} LF` } : { quantity: null, unit: null };
      case "wall_area":
        return perim ? { quantity: Math.round(perim * wh * 100) / 100, unit: "sqft", formula: `${perim} LF × ${wh} ft wall = ${Math.round(perim * wh)} sqft` } : { quantity: null, unit: null };
      case "wall_area_minus_openings":
        if (!perim) return { quantity: null, unit: null };
        // Typical opening sizes: window ~15 sqft, door ~20 sqft
        const openings = windows * 15 + doors * 20;
        const area = Math.max(0, perim * wh - openings);
        return { quantity: Math.round(area * 100) / 100, unit: "sqft", formula: `${perim} × ${wh} − ${openings} sqft openings = ${Math.round(area)} sqft` };
      case "roof_area":
        return foot ? { quantity: Math.round(foot * pitch * 100) / 100, unit: "sqft", formula: `footprint ${foot} × pitch ${pitch} = ${Math.round(foot * pitch)} sqft` } : { quantity: null, unit: null };
      case "count_windows":
        return { quantity: windows, unit: "ea", formula: `${windows} windows` };
      case "count_doors":
        return { quantity: doors, unit: "ea", formula: `${doors} doors` };
      default:
        return { quantity: item.quantity, unit: item.unit };
    }
  }

  function updateProjectDim(key: keyof ProjectDimensions, value: number) {
    setProjectDims(prev => ({
      ...prev,
      [key]: { value, source: "User override", confidence: "high" },
    }));
  }

  // Shared helper: create a checklist block keyed to a scope item.
  // Block label = the scope item's description (one block per item), so
  // drawn measurements flow back into THAT specific item, not a generic
  // trade bucket.
  function ensureScopeBlock(item: ScopeItem, tradeLabel: string): {
    blockLabel: string;
    type: "linear" | "area" | "count";
    color: string;
  } {
    const rawLabel = (item.description && item.description.trim().length > 2)
      ? item.description.trim()
      : `${tradeLabel} — ${item.trade}`;
    // Cap label length so UI stays readable
    const blockLabel = rawLabel.length > 80 ? rawLabel.slice(0, 77) + "..." : rawLabel;
    const type = unitToType(item.unit);

    const colorIdx = Math.abs(
      Array.from(blockLabel).reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)
    ) % GUIDE_COLORS.length;
    const color = GUIDE_COLORS[colorIdx];

    setChecklist(prev => {
      if (prev.find(c => c.label === blockLabel)) return prev;
      return [...prev, {
        label: blockLabel,
        type,
        trade: item.trade || tradeLabel,
        description: tradeLabel,
        done: false,
      }];
    });

    return { blockLabel, type, color };
  }

  // "Use AI qty" — add the AI-suggested quantity as a measurement with no
  // drawn points. Fast for items where AI read a clean number (e.g., a
  // window schedule count).
  function confirmScopeItem(item: ScopeItem, tradeLabel: string) {
    try {
      if (!item || !item.id || confirmedQuantityIds.has(item.id)) return;
      const { blockLabel, type, color } = ensureScopeBlock(item, tradeLabel);

      const subLabel = (item.needsQuote || item.quantity == null)
        ? `qty TBD`
        : `AI: ${item.quantity} ${item.unit || ""}`;

      const measurement: SavedMeasurement = {
        id: uid(),
        type,
        label: buildCompositeLabel(blockLabel, subLabel),
        guideItemLabel: blockLabel,
        points: [],
        value: typeof item.quantity === "number" && !isNaN(item.quantity) ? item.quantity : 0,
        unit: item.unit || "ea",
        color,
        pageNumber: 1,
        saved: false,
      };
      setMeasurements(prev => [...prev, measurement]);
      setChecklist(prev => prev.map(c => c.label === blockLabel ? { ...c, done: true } : c));
      setConfirmedQuantityIds(prev => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    } catch (err) {
      console.error("confirmScopeItem error:", err, item, tradeLabel);
      setToastMessage(`Failed to add "${item?.description || "item"}" — ${err instanceof Error ? err.message : "unknown error"}`);
      setTimeout(() => setToastMessage(null), 4000);
    }
  }

  // "Measure on drawing" — close the overlay, activate the scope item's
  // block, switch to the correct tool. User draws on the PDF and the
  // measurement becomes the real quantity for that scope item.
  function measureScopeItem(item: ScopeItem, tradeLabel: string) {
    try {
      if (!item || !item.id) return;
      const { blockLabel, type, color } = ensureScopeBlock(item, tradeLabel);

      setActiveBlock({ label: blockLabel, color });

      if (type === "count") {
        setCountLabel(blockLabel);
        setTool("count");
      } else if (type === "area") {
        setTool("area");
      } else {
        setTool("measure");
      }

      setConfirmedQuantityIds(prev => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      setShowAnalysisResults(false);

      const instructions = type === "count"
        ? `Click each instance of "${blockLabel}" to drop count markers. Press Enter when done.`
        : type === "area"
          ? `Click around "${blockLabel}" to trace the area. Double-click or press Enter to close the polygon.`
          : `Click the endpoints of "${blockLabel}" on the drawing. Double-click or press Enter to finish.`;
      const scaleHint = !pixelsPerFoot && type !== "count"
        ? " (Scale not set — set scale first via the Scaling tool, or measurements will be in pixels.)"
        : "";
      setToastMessage(instructions + scaleHint);
      setTimeout(() => setToastMessage(null), 8000);
    } catch (err) {
      console.error("measureScopeItem error:", err, item, tradeLabel);
      setToastMessage("Failed to open measure mode");
      setTimeout(() => setToastMessage(null), 3000);
    }
  }

  function confirmAllInTrade(tradeKey: string) {
    if (!fullAnalysis) return;
    const label = fullAnalysis.tradeLabels?.[tradeKey] || tradeKey;
    (fullAnalysis.scopeByTrade?.[tradeKey] || [])
      .filter(it => !confirmedQuantityIds.has(it.id))
      .forEach(it => confirmScopeItem(it, label));
  }

  function confirmAllScope() {
    if (!fullAnalysis) return;
    for (const key of fullAnalysis.tradeOrder || []) {
      confirmAllInTrade(key);
    }
  }

  // ---- Push scope directly to the project's proposal (estimate_line_items) ---
  const [pushingToEstimate, setPushingToEstimate] = useState(false);

  /**
   * Build a scopeByTrade structure from the manually-built checklist + drawn
   * measurements. Used when user pushes WITHOUT having run AI Analyze (they
   * built blocks by hand instead).
   */
  function buildScopeFromChecklist(): {
    scopeByTrade: Record<string, ScopeItem[]>;
    tradeOrder: string[];
    tradeLabels: Record<string, string>;
  } {
    const scopeByTrade: Record<string, ScopeItem[]> = {};
    const tradeLabels: Record<string, string> = {};
    const tradeOrder: string[] = [];
    for (const ci of checklist) {
      const tradeKey = (ci.trade || "other").toLowerCase().replace(/[^a-z0-9_]/g, "_") || "other";
      if (!scopeByTrade[tradeKey]) {
        scopeByTrade[tradeKey] = [];
        tradeOrder.push(tradeKey);
        tradeLabels[tradeKey] = ci.trade || "Other";
      }
      const drawn = measurements.filter(m =>
        m.guideItemLabel === ci.label && m.points && m.points.length > 0
      );
      const fallback = measurements.filter(m =>
        m.guideItemLabel === ci.label
      );
      const total = drawn.length > 0
        ? drawn.reduce((s, m) => s + (Number(m.value) || 0), 0)
        : fallback.reduce((s, m) => s + (Number(m.value) || 0), 0);
      const firstUnit = (drawn[0] || fallback[0])?.unit || (ci.type === "area" ? "sqft" : ci.type === "count" ? "ea" : "LF");
      scopeByTrade[tradeKey].push({
        id: `manual_${tradeKey}_${scopeByTrade[tradeKey].length}`,
        trade: tradeKey,
        description: ci.label,
        quantity: total > 0 ? total : null,
        unit: total > 0 ? firstUnit : null,
        confidence: "medium",
        needsQuote: total <= 0,
      });
    }
    return { scopeByTrade, tradeOrder, tradeLabels };
  }

  async function pushScopeToEstimate() {
    if (!propProjectId || pushingToEstimate) return;
    // Nothing to push if user has no analysis AND no manual blocks
    if (!fullAnalysis && checklist.length === 0 && measurements.length === 0) {
      setToastMessage("Nothing to push — run AI Analyze or build blocks first.");
      setTimeout(() => setToastMessage(null), 3500);
      return;
    }
    setPushingToEstimate(true);
    try {
      // Save any unsaved measurements before pushing
      if (onSave && measurements.some(m => !m.saved)) {
        try {
          await onSave(measurements, pixelsPerFoot, checklist);
          setMeasurements(prev => prev.map(m => ({ ...m, saved: true })));
        } catch { /* non-fatal */ }
      }

      let scopeByTrade: Record<string, ScopeItem[]>;
      let tradeOrder: string[];
      let tradeLabels: Record<string, string>;

      if (fullAnalysis) {
        // Priority order for each scope line's quantity:
        // 1) User-drawn measurement (explicitly verified on the drawing)
        // 2) Derived from current projectDims (if derivedFrom tag set)
        // 3) AI's original quantity (fallback)
        scopeByTrade = {};
        for (const [tradeKey, items] of Object.entries(fullAnalysis.scopeByTrade || {})) {
          scopeByTrade[tradeKey] = (items || []).map(it => {
            const itemLabel = it.description?.trim();
            const cappedLabel = itemLabel && itemLabel.length > 80 ? itemLabel.slice(0, 77) + "..." : (itemLabel || "");
            const drawn = cappedLabel
              ? measurements.filter(m => m.guideItemLabel === cappedLabel && m.points && m.points.length > 0)
              : [];
            if (drawn.length > 0) {
              const totalDrawn = drawn.reduce((s, m) => s + (Number(m.value) || 0), 0);
              const unit = drawn[0].unit;
              return {
                ...it,
                quantity: totalDrawn,
                unit,
                needsQuote: false,
                confidence: "high",
                sourceType: "computed",
                sourceDetail: `User-measured on drawing (${drawn.length} measurement${drawn.length === 1 ? "" : "s"})`,
                computation: drawn.length === 1
                  ? `Drawn: ${drawn[0].value.toFixed(2)} ${unit}`
                  : `Sum of ${drawn.length} drawn measurements = ${totalDrawn.toFixed(2)} ${unit}`,
              };
            }
            if (it.derivedFrom) {
              const d = deriveScopeQty(it, projectDims);
              if (d.quantity != null && d.quantity > 0) {
                return {
                  ...it,
                  quantity: d.quantity,
                  unit: d.unit || it.unit,
                  needsQuote: false,
                  sourceType: "computed",
                  computation: d.formula,
                  confidence: "medium",
                };
              }
            }
            return it;
          });
        }
        tradeOrder = fullAnalysis.tradeOrder;
        tradeLabels = fullAnalysis.tradeLabels;
      } else {
        // No AI analysis — build scope straight from manual checklist + measurements
        const built = buildScopeFromChecklist();
        scopeByTrade = built.scopeByTrade;
        tradeOrder = built.tradeOrder;
        tradeLabels = built.tradeLabels;
      }

      const res = await fetch("/api/takeoff-scope-to-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: propProjectId,
          scopeByTrade,
          tradeOrder,
          tradeLabels,
          mode: "replace",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Push failed" }));
        throw new Error(err.error || "Push failed");
      }
      const data = await res.json();
      const priced = data.pricedCount ?? 0;
      const total = data.lineItemCount ?? 0;
      const unpriced = Math.max(0, total - priced);
      const totalPrice = typeof data.totalEstimatePrice === "number" ? data.totalEstimatePrice : 0;
      setToastMessage(
        `Estimator AI priced ${priced} of ${total} lines — total $${totalPrice.toLocaleString()}. ${unpriced} need sub quotes.`
      );
      setTimeout(() => setToastMessage(null), 4000);
      setShowAnalysisResults(false);
      router.push(`/projects/${propProjectId}/estimates/${data.estimateId}`);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Push failed");
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setPushingToEstimate(false);
    }
  }

  // ---- Derived page image --------------------------------------------------
  const pageImage = pageImages.get(currentPage) ?? null;
  const pageWidth = pageImage?.width ?? 1;
  const pageHeight = pageImage?.height ?? 1;

  // =========================================================================
  // PDF LOADING
  // =========================================================================

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      setLoading(true);
      setError(null);
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      } catch (err) {
        console.error("PDF load error:", err);
        if (!cancelled) setError("Failed to load PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Render current page to an offscreen canvas, store as ImageBitmap
  useEffect(() => {
    if (!pdfDoc) return;
    if (pageImages.has(currentPage)) return;
    let cancelled = false;
    async function renderPage() {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 2 }); // high-res
      const offscreen = document.createElement("canvas");
      offscreen.width = viewport.width;
      offscreen.height = viewport.height;
      const ctx = offscreen.getContext("2d")!;
      await page.render({
        canvasContext: ctx,
        viewport,
        canvas: offscreen,
      } as any).promise;
      if (cancelled) return;
      const bmp = await createImageBitmap(offscreen);
      setPageImages((prev) => new Map(prev).set(currentPage, bmp));
    }
    renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, pageImages]);

  // Fit to container on first load or page change
  useEffect(() => {
    if (!pageImage || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sx = rect.width / pageWidth;
    const sy = rect.height / pageHeight;
    const s = Math.min(sx, sy) * 0.95;
    const ox = (rect.width - pageWidth * s) / 2;
    const oy = (rect.height - pageHeight * s) / 2;
    const t = { offsetX: ox, offsetY: oy, scale: s };
    transformRef.current = t;
    setTransform(t);
  }, [pageImage, pageWidth, pageHeight]);

  // =========================================================================
  // COORDINATE CONVERSION
  // =========================================================================

  /** Screen coords -> PDF-page coords */
  const screenToPage = useCallback(
    (sx: number, sy: number) => {
      const t = transformRef.current;
      return {
        x: (sx - t.offsetX) / t.scale,
        y: (sy - t.offsetY) / t.scale,
      };
    },
    []
  );

  /** PDF-page coords -> screen coords */
  const pageToScreen = useCallback(
    (px: number, py: number) => {
      const t = transformRef.current;
      return {
        x: px * t.scale + t.offsetX,
        y: py * t.scale + t.offsetY,
      };
    },
    []
  );

  // =========================================================================
  // DRAW LOOP
  // =========================================================================

  const draw = useCallback(() => {
    try {
    // PDF canvas
    const pdfCtx = pdfCanvasRef.current?.getContext("2d");
    const ovCtx = overlayCanvasRef.current?.getContext("2d");
    if (!pdfCtx || !ovCtx || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    for (const cvs of [pdfCanvasRef.current!, overlayCanvasRef.current!]) {
      cvs.width = w * dpr;
      cvs.height = h * dpr;
      cvs.style.width = `${w}px`;
      cvs.style.height = `${h}px`;
    }

    const t = transformRef.current;

    // --- Draw PDF ---
    pdfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pdfCtx.clearRect(0, 0, w, h);
    pdfCtx.fillStyle = "#1a1a1a";
    pdfCtx.fillRect(0, 0, w, h);
    if (pageImage) {
      pdfCtx.drawImage(
        pageImage,
        t.offsetX,
        t.offsetY,
        pageWidth * t.scale,
        pageHeight * t.scale
      );
    }

    // --- Draw overlays ---
    ovCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ovCtx.clearRect(0, 0, w, h);

    // Helper to draw text with background
    function drawLabel(
      ctx: CanvasRenderingContext2D,
      text: string,
      sx: number,
      sy: number,
      fontSize: number = 12
    ) {
      ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
      const m = ctx.measureText(text);
      const pad = 4;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(
        sx - m.width / 2 - pad,
        sy - fontSize / 2 - pad,
        m.width + pad * 2,
        fontSize + pad * 2
      );
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, sx, sy);
    }

    // Draw completed measurements
    for (const m of measurements) {
      if (m.pageNumber !== currentPage) continue;
      // AI-extracted value-only measurements have no drawn points — they
      // live only in the block panel on the right, not on the canvas.
      if (!m.points || m.points.length === 0) continue;
      const color = m.color || GREEN;

      if (m.type === "linear") {
        // Polyline: draw all segments
        const screenPts = m.points.map(p => pageToScreen(p.x, p.y));
        if (screenPts.length >= 2) {
          ovCtx.strokeStyle = color;
          ovCtx.lineWidth = 2;
          ovCtx.beginPath();
          ovCtx.moveTo(screenPts[0].x, screenPts[0].y);
          for (let i = 1; i < screenPts.length; i++) {
            ovCtx.lineTo(screenPts[i].x, screenPts[i].y);
          }
          ovCtx.stroke();
        }
        // nodes
        for (const p of screenPts) {
          ovCtx.fillStyle = color;
          ovCtx.beginPath();
          ovCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ovCtx.fill();
        }
        // label at midpoint of the polyline
        const mid = screenPts[Math.floor(screenPts.length / 2)];
        const displayLabel = getSubLabel(m);
        const labelText = displayLabel
          ? `${displayLabel}: ${num(m.value).toFixed(2)} ${m.unit}`
          : `${num(m.value).toFixed(2)} ${m.unit}`;
        drawLabel(ovCtx, labelText, mid.x, mid.y - 14);
      }

      if (m.type === "area") {
        const screenPts = m.points.map((p) => pageToScreen(p.x, p.y));
        // fill
        ovCtx.fillStyle = hexToAreaFill(color);
        ovCtx.beginPath();
        screenPts.forEach((p, i) =>
          i === 0 ? ovCtx.moveTo(p.x, p.y) : ovCtx.lineTo(p.x, p.y)
        );
        ovCtx.closePath();
        ovCtx.fill();
        // stroke
        ovCtx.strokeStyle = color;
        ovCtx.lineWidth = 2;
        ovCtx.beginPath();
        screenPts.forEach((p, i) =>
          i === 0 ? ovCtx.moveTo(p.x, p.y) : ovCtx.lineTo(p.x, p.y)
        );
        ovCtx.closePath();
        ovCtx.stroke();
        // vertices
        for (const p of screenPts) {
          ovCtx.fillStyle = color;
          ovCtx.beginPath();
          ovCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ovCtx.fill();
        }
        // area label at centroid
        const c = centroid(screenPts);
        const areaDisplayLabel = getSubLabel(m);
        const labelText = areaDisplayLabel
          ? `${areaDisplayLabel}: ${num(m.value).toFixed(1)} ${m.unit}`
          : `${num(m.value).toFixed(1)} ${m.unit}`;
        drawLabel(ovCtx, labelText, c.x, c.y, 13);
      }

      if (m.type === "count") {
        for (let i = 0; i < m.points.length; i++) {
          const sp = pageToScreen(m.points[i].x, m.points[i].y);
          ovCtx.fillStyle = color;
          ovCtx.beginPath();
          ovCtx.arc(sp.x, sp.y, 12, 0, Math.PI * 2);
          ovCtx.fill();
          ovCtx.strokeStyle = "#fff";
          ovCtx.lineWidth = 2;
          ovCtx.stroke();
          ovCtx.fillStyle = "#fff";
          ovCtx.font = "bold 11px Inter, system-ui, sans-serif";
          ovCtx.textAlign = "center";
          ovCtx.textBaseline = "middle";
          ovCtx.fillText(String(i + 1), sp.x, sp.y);
        }
        // group label near first point
        if (m.points.length > 0) {
          const fp = pageToScreen(m.points[0].x, m.points[0].y);
          const countDisplayLabel = getSubLabel(m);
          drawLabel(
            ovCtx,
            `${countDisplayLabel}: ${m.points.length}`,
            fp.x,
            fp.y - 22
          );
        }
      }
    }

    // Draw scale reference line
    if (scalePoints.length > 0) {
      const sp = scalePoints.map((p) => pageToScreen(p.x, p.y));
      ovCtx.strokeStyle = "#3B82F6";
      ovCtx.lineWidth = 2;
      ovCtx.setLineDash([6, 4]);
      ovCtx.beginPath();
      ovCtx.moveTo(sp[0].x, sp[0].y);
      if (sp.length === 2) {
        ovCtx.lineTo(sp[1].x, sp[1].y);
      } else if (cursorPos) {
        ovCtx.lineTo(cursorPos.x, cursorPos.y);
      }
      ovCtx.stroke();
      ovCtx.setLineDash([]);
      for (const p of sp) {
        ovCtx.fillStyle = "#3B82F6";
        ovCtx.beginPath();
        ovCtx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ovCtx.fill();
      }
    }

    // Draw active (in-progress) measurement
    if (activePoints.length > 0) {
      const screenActive = activePoints.map((p) => pageToScreen(p.x, p.y));

      if (tool === "measure") {
        // Multi-point polyline: draw all placed segments
        const allScreenPts = [...screenActive];
        if (cursorPos) allScreenPts.push(cursorPos);

        // Draw segments
        ovCtx.strokeStyle = AMBER;
        ovCtx.lineWidth = 2;
        if (allScreenPts.length >= 2) {
          ovCtx.beginPath();
          ovCtx.moveTo(allScreenPts[0].x, allScreenPts[0].y);
          for (let i = 1; i < allScreenPts.length; i++) {
            ovCtx.lineTo(allScreenPts[i].x, allScreenPts[i].y);
          }
          ovCtx.stroke();
        }

        // Draw nodes
        for (const p of screenActive) {
          ovCtx.fillStyle = AMBER;
          ovCtx.beginPath();
          ovCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ovCtx.fill();
          ovCtx.strokeStyle = "rgba(0,0,0,0.5)";
          ovCtx.lineWidth = 1;
          ovCtx.stroke();
        }
        // Cursor node
        if (cursorPos) {
          ovCtx.fillStyle = "rgba(245,158,11,0.5)";
          ovCtx.beginPath();
          ovCtx.arc(cursorPos.x, cursorPos.y, 4, 0, Math.PI * 2);
          ovCtx.fill();
        }

        // Running total distance label near cursor
        if (pixelsPerFoot && activePoints.length >= 1) {
          let totalDist = 0;
          for (let i = 1; i < activePoints.length; i++) {
            totalDist += dist(activePoints[i - 1], activePoints[i]);
          }
          // Add distance from last placed point to cursor
          if (cursorPos) {
            const lastPt = activePoints[activePoints.length - 1];
            const cursorPage = screenToPage(cursorPos.x, cursorPos.y);
            totalDist += dist(lastPt, cursorPage);
          }
          const ft = totalDist / pixelsPerFoot;
          const labelPt = cursorPos ?? screenActive[screenActive.length - 1];
          drawLabel(ovCtx, `${ft.toFixed(2)} ft total`, labelPt.x + 15, labelPt.y - 15);

          // Also show last segment distance
          if (cursorPos && activePoints.length >= 1) {
            const lastPt = activePoints[activePoints.length - 1];
            const cursorPage = screenToPage(cursorPos.x, cursorPos.y);
            const segFt = dist(lastPt, cursorPage) / pixelsPerFoot;
            const lastScreen = screenActive[screenActive.length - 1];
            const mx = (lastScreen.x + cursorPos.x) / 2;
            const my = (lastScreen.y + cursorPos.y) / 2 - 14;
            drawLabel(ovCtx, `${segFt.toFixed(2)} ft`, mx, my, 10);
          }
        }

        // Hint text
        if (activePoints.length === 1) {
          drawLabel(ovCtx, "Click to add points, double-click or Enter to finish", w / 2, 20, 10);
        } else if (activePoints.length >= 2) {
          drawLabel(ovCtx, `${activePoints.length} points · double-click or Enter to finish`, w / 2, 20, 10);
        }
      }

      if (tool === "area") {
        // Polygon so far + cursor
        const allPts = [...screenActive];
        if (cursorPos) allPts.push(cursorPos);
        ovCtx.fillStyle = "rgba(245,158,11,0.12)";
        ovCtx.beginPath();
        allPts.forEach((p, i) =>
          i === 0 ? ovCtx.moveTo(p.x, p.y) : ovCtx.lineTo(p.x, p.y)
        );
        ovCtx.closePath();
        ovCtx.fill();
        ovCtx.strokeStyle = AMBER;
        ovCtx.lineWidth = 2;
        ovCtx.beginPath();
        allPts.forEach((p, i) =>
          i === 0 ? ovCtx.moveTo(p.x, p.y) : ovCtx.lineTo(p.x, p.y)
        );
        ovCtx.closePath();
        ovCtx.stroke();
        for (const p of screenActive) {
          ovCtx.fillStyle = AMBER;
          ovCtx.beginPath();
          ovCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ovCtx.fill();
        }
        // Live area
        if (pixelsPerFoot && activePoints.length >= 2) {
          const allPage = [
            ...activePoints,
            ...(cursorPos ? [screenToPage(cursorPos.x, cursorPos.y)] : []),
          ];
          const areaPx = polygonArea(allPage);
          const sqft = areaPx / pixelsPerFoot ** 2;
          const c = centroid(allPts);
          drawLabel(ovCtx, `${sqft.toFixed(1)} sqft`, c.x, c.y, 13);
        }
      }
    }

    // Scale indicator
    if (pixelsPerFoot) {
      const txt = `Scale: ${pixelsPerFoot.toFixed(1)} px/ft`;
      ovCtx.font = "bold 11px Inter, system-ui, sans-serif";
      const m = ovCtx.measureText(txt);
      ovCtx.fillStyle = "rgba(0,0,0,0.7)";
      ovCtx.fillRect(8, h - 30, m.width + 16, 22);
      ovCtx.fillStyle = "#3B82F6";
      ovCtx.textAlign = "left";
      ovCtx.textBaseline = "middle";
      ovCtx.fillText(txt, 16, h - 19);
    }
    } catch (err) {
      // Don't let a draw glitch crash the whole project-page error boundary.
      // Log it so we can see the real stack trace in the browser console.
      console.error("takeoff-viewer draw() threw:", err);
    }
  }, [
    pageImage,
    pageWidth,
    pageHeight,
    transform,
    measurements,
    activePoints,
    cursorPos,
    scalePoints,
    tool,
    pixelsPerFoot,
    currentPage,
    pageToScreen,
    screenToPage,
  ]);

  // Redraw on any relevant state change
  useEffect(() => {
    draw();
  }, [draw]);

  // Lock body scroll and block browser zoom while takeoff is open
  useEffect(() => {
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Block Ctrl+wheel browser zoom globally
    function blockBrowserZoom(e: WheelEvent) {
      if (e.ctrlKey) e.preventDefault();
    }
    document.addEventListener("wheel", blockBrowserZoom, { passive: false });

    return () => {
      document.body.style.overflow = origOverflow;
      document.removeEventListener("wheel", blockBrowserZoom);
    };
  }, []);

  // Attach non-passive wheel handler directly to the container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      const rect = el!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = { ...transformRef.current };
      const zoomFactor = e.deltaY < 0 ? 1.03 : 0.97;
      const newScale = Math.min(Math.max(t.scale * zoomFactor, 0.1), 20);
      t.offsetX = mx - ((mx - t.offsetX) / t.scale) * newScale;
      t.offsetY = my - ((my - t.offsetY) / t.scale) * newScale;
      t.scale = newScale;
      const clamped = clampTransform(t);
      transformRef.current = clamped;
      setTransform({ ...clamped });
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pageWidth, pageHeight]);

  // Redraw on resize
  useEffect(() => {
    function onResize() {
      draw();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // =========================================================================
  // KEYBOARD
  // =========================================================================

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space") {
        e.preventDefault();
        spaceHeldRef.current = true;
      }
      if (e.code === "Escape") {
        if (showScaleInput || editingMeasurementId) return;
        // Cancel in-progress measurement
        setActivePoints([]);
        setScalePoints([]);
        setCursorPos(null);
      }
      if (e.code === "Enter") {
        if (showScaleInput || editingMeasurementId) return;
        // Finalize polyline with Enter
        if (tool === "measure" && activePoints.length >= 2) {
          finalizePolyline();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        if (activePoints.length > 0) {
          // Undo last point in active polyline
          setActivePoints(prev => prev.slice(0, -1));
        } else {
          setMeasurements((prev) => prev.slice(0, -1));
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [showScaleInput, editingMeasurementId, tool, activePoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // MOUSE HANDLERS
  // =========================================================================

  function getCanvasPos(e: ReactMouseEvent): { x: number; y: number } {
    const rect = overlayCanvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e: ReactMouseEvent) {
    if (e.button === 1 || spaceHeldRef.current || tool === "pan") {
      // Pan
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const pos = getCanvasPos(e);
    const pagePt = screenToPage(pos.x, pos.y);

    if (tool === "scale") {
      if (scalePoints.length === 0) {
        setScalePoints([pagePt]);
      } else if (scalePoints.length === 1) {
        setScalePoints((prev) => [...prev, pagePt]);
        scalePixelDist.current = dist(scalePoints[0], pagePt);
        setShowScaleInput(true);
      }
      return;
    }

    if (tool === "measure") {
      // Multi-point polyline: each click adds a node
      setActivePoints(prev => [...prev, pagePt]);
      return;
    }

    if (tool === "area") {
      // Check if double-click-like close (within 15px of first point on screen)
      if (activePoints.length >= 3) {
        const firstScreen = pageToScreen(activePoints[0].x, activePoints[0].y);
        if (dist(firstScreen, pos) < 15) {
          // Close polygon
          const areaPx = polygonArea(activePoints);
          const sqft = pixelsPerFoot
            ? areaPx / pixelsPerFoot ** 2
            : areaPx;
          const areaUnit = pixelsPerFoot ? "sqft" : "px\u00B2";
          const guideLabel = pendingChecklistLabel.current || undefined;
          const guideColor = pendingChecklistColor.current || GREEN;
          let subLabel: string;
          if (guideLabel) {
            const existingCount = measurements.filter(m => m.guideItemLabel === guideLabel).length;
            subLabel = `Region ${existingCount + 1}`;
          } else {
            subLabel = `Area ${measurements.filter(m => m.type === "area" && !m.guideItemLabel).length + 1}`;
          }
          const compositeLabel = buildCompositeLabel(guideLabel, subLabel);
          const newId = uid();
          setMeasurements(prev => [...prev, {
            id: newId,
            type: "area" as const,
            label: compositeLabel,
            guideItemLabel: guideLabel,
            points: [...activePoints],
            value: sqft,
            unit: areaUnit,
            color: guideColor,
            pageNumber: currentPage,
            saved: false,
          }]);
          if (pendingChecklistLabel.current) {
            setChecklist(prev => prev.map(item =>
              item.label === pendingChecklistLabel.current ? { ...item, done: true } : item
            ));
          }
          // Open inline naming input for the sub-label
          setEditingMeasurementId(newId);
          setEditingLabelValue(subLabel);
          setActivePoints([]);
          setCursorPos(null);
          // activeBlock stays persistent — don't clear
          return;
        }
      }
      setActivePoints((prev) => [...prev, pagePt]);
      return;
    }

    if (tool === "count") {
      // Find existing count measurement for this label on this page, or start new
      const guideLabel = pendingChecklistLabel.current || undefined;
      const guideColor = pendingChecklistColor.current || GREEN;
      const compositeCountLabel = guideLabel ? buildCompositeLabel(guideLabel, countLabel) : countLabel;
      setMeasurements((prev) => {
        const idx = prev.findIndex(
          (m) =>
            m.type === "count" &&
            m.label === compositeCountLabel &&
            m.pageNumber === currentPage
        );
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            points: [...updated[idx].points, pagePt],
            value: updated[idx].points.length + 1,
            saved: false,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: uid(),
            type: "count" as const,
            label: compositeCountLabel,
            guideItemLabel: guideLabel,
            points: [pagePt],
            value: 1,
            unit: "count",
            color: guideColor,
            pageNumber: currentPage,
            saved: false,
          },
        ];
      });
      return;
    }
  }

  function clampTransform(t: ViewTransform): ViewTransform {
    // Keep at least 20% of the PDF visible on screen
    const container = containerRef.current;
    if (!container || !pageWidth || !pageHeight) return t;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const pw = pageWidth * t.scale;
    const ph = pageHeight * t.scale;
    const margin = 0.2;
    t.offsetX = Math.max(t.offsetX, -pw * (1 - margin));
    t.offsetX = Math.min(t.offsetX, cw * (1 - margin));
    t.offsetY = Math.max(t.offsetY, -ph * (1 - margin));
    t.offsetY = Math.min(t.offsetY, ch * (1 - margin));
    return t;
  }

  function handleMouseMove(e: ReactMouseEvent) {
    if (isPanningRef.current) {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      const t = clampTransform({ ...transformRef.current, offsetX: transformRef.current.offsetX + dx, offsetY: transformRef.current.offsetY + dy });
      transformRef.current = t;
      setTransform({ ...t });
      return;
    }

    const pos = getCanvasPos(e);
    if (
      tool === "measure" ||
      tool === "area" ||
      tool === "scale"
    ) {
      setCursorPos(pos);
    }
  }

  function handleMouseUp() {
    isPanningRef.current = false;
  }

  function finalizePolyline() {
    if (tool !== "measure" || activePoints.length < 2) return;
    // Sum all segment lengths in page coordinates
    let totalDist = 0;
    for (let i = 1; i < activePoints.length; i++) {
      totalDist += dist(activePoints[i - 1], activePoints[i]);
    }
    const ft = pixelsPerFoot ? totalDist / pixelsPerFoot : totalDist;
    const unit = pixelsPerFoot ? "ft" : "px";
    const guideLabel = pendingChecklistLabel.current || undefined;
    const guideColor = pendingChecklistColor.current || GREEN;
    let subLabel: string;
    if (guideLabel) {
      const existingCount = measurements.filter(m => m.guideItemLabel === guideLabel).length;
      subLabel = `Segment ${existingCount + 1}`;
    } else {
      subLabel = `Line ${measurements.filter(m => m.type === "linear" && !m.guideItemLabel).length + 1}`;
    }
    const compositeLabel = buildCompositeLabel(guideLabel, subLabel);
    const newId = uid();
    setMeasurements(prev => [...prev, {
      id: newId,
      type: "linear" as const,
      label: compositeLabel,
      guideItemLabel: guideLabel,
      points: [...activePoints],
      value: ft,
      unit,
      color: guideColor,
      pageNumber: currentPage,
      saved: false,
    }]);
    if (pendingChecklistLabel.current) {
      setChecklist(prev => prev.map(item =>
        item.label === pendingChecklistLabel.current ? { ...item, done: true } : item
      ));
    }
    setEditingMeasurementId(newId);
    setEditingLabelValue(subLabel);
    pendingChecklistLabel.current = null;
    pendingChecklistColor.current = null;
    setActivePoints([]);
    setCursorPos(null);
  }

  function handleDoubleClick() {
    // Finalize polyline on double-click
    if (tool === "measure" && activePoints.length >= 2) {
      finalizePolyline();
      return;
    }
    if (tool === "area" && activePoints.length >= 3) {
      const areaPx = polygonArea(activePoints);
      const sqft = pixelsPerFoot ? areaPx / pixelsPerFoot ** 2 : areaPx;
      const areaUnit = pixelsPerFoot ? "sqft" : "px\u00B2";
      const guideLabel = pendingChecklistLabel.current || undefined;
      const guideColor = pendingChecklistColor.current || GREEN;
      let subLabel: string;
      if (guideLabel) {
        const existingCount = measurements.filter(m => m.guideItemLabel === guideLabel).length;
        subLabel = `Region ${existingCount + 1}`;
      } else {
        subLabel = `Area ${measurements.filter(m => m.type === "area" && !m.guideItemLabel).length + 1}`;
      }
      const compositeLabel = buildCompositeLabel(guideLabel, subLabel);
      const newId = uid();
      setMeasurements(prev => [...prev, {
        id: newId,
        type: "area" as const,
        label: compositeLabel,
        guideItemLabel: guideLabel,
        points: [...activePoints],
        value: sqft,
        unit: areaUnit,
        color: guideColor,
        pageNumber: currentPage,
        saved: false,
      }]);
      if (pendingChecklistLabel.current) {
        setChecklist(prev => prev.map(item =>
          item.label === pendingChecklistLabel.current ? { ...item, done: true } : item
        ));
      }
      // Open inline naming input for the sub-label
      setEditingMeasurementId(newId);
      setEditingLabelValue(subLabel);
      pendingChecklistLabel.current = null;
      pendingChecklistColor.current = null;
      setActivePoints([]);
      setCursorPos(null);
    }
  }

  // =========================================================================
  // TOUCH HANDLERS
  // =========================================================================

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchStartDist.current = Math.hypot(
        t1.clientX - t2.clientX,
        t1.clientY - t2.clientY
      );
      touchStartScale.current = transformRef.current.scale;
      touchStartCenter.current = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
      touchStartOffset.current = {
        x: transformRef.current.offsetX,
        y: transformRef.current.offsetY,
      };
    } else if (e.touches.length === 1 && tool === "pan") {
      isPanningRef.current = true;
      lastMouseRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(
        t1.clientX - t2.clientX,
        t1.clientY - t2.clientY
      );
      const ratio = currentDist / touchStartDist.current;
      const newScale = Math.min(
        Math.max(touchStartScale.current * ratio, 0.1),
        20
      );

      const rect = containerRef.current!.getBoundingClientRect();
      const cx = (t1.clientX + t2.clientX) / 2 - rect.left;
      const cy = (t1.clientY + t2.clientY) / 2 - rect.top;

      const scx = touchStartCenter.current.x - rect.left;
      const scy = touchStartCenter.current.y - rect.top;

      const t = { ...transformRef.current };
      t.scale = newScale;
      t.offsetX =
        cx -
        ((scx - touchStartOffset.current.x) / touchStartScale.current) *
          newScale +
        (cx - scx);
      t.offsetY =
        cy -
        ((scy - touchStartOffset.current.y) / touchStartScale.current) *
          newScale +
        (cy - scy);
      transformRef.current = t;
      setTransform({ ...t });
    } else if (e.touches.length === 1 && isPanningRef.current) {
      const dx = e.touches[0].clientX - lastMouseRef.current.x;
      const dy = e.touches[0].clientY - lastMouseRef.current.y;
      lastMouseRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      const t = { ...transformRef.current };
      t.offsetX += dx;
      t.offsetY += dy;
      transformRef.current = t;
      setTransform({ ...t });
    }
  }

  function handleTouchEnd() {
    isPanningRef.current = false;
  }

  // =========================================================================
  // SCALE INPUT
  // =========================================================================

  function confirmScale() {
    const feet = parseFloat(scaleInputValue);
    if (!feet || feet <= 0 || scalePixelDist.current <= 0) return;
    setPixelsPerFoot(scalePixelDist.current / feet);
    setShowScaleInput(false);
    setScaleInputValue("");
    setScalePoints([]);
    setTool("measure");
  }

  // =========================================================================
  // INLINE LABEL CONFIRM (after completing a measurement)
  // =========================================================================

  function confirmInlineLabel() {
    if (!editingMeasurementId) return;
    const subLabel = editingLabelValue.trim() || "Measurement";
    setMeasurements(prev => prev.map(m => {
      if (m.id !== editingMeasurementId) return m;
      // Rebuild composite label from guideItemLabel + new sub-label
      const compositeLabel = buildCompositeLabel(m.guideItemLabel, subLabel);
      return { ...m, label: compositeLabel };
    }));
    // Mark matching checklist item as done (case-insensitive)
    if (subLabel) {
      setChecklist(prev => prev.map(item =>
        item.label.toLowerCase() === subLabel.toLowerCase() ? { ...item, done: true } : item
      ));
    }
    setEditingMeasurementId(null);
    setEditingLabelValue("");
  }

  // =========================================================================
  // UNDO
  // =========================================================================

  function undo() {
    if (activePoints.length > 0) {
      setActivePoints((prev) => prev.slice(0, -1));
    } else {
      setMeasurements((prev) => prev.slice(0, -1));
    }
  }

  // =========================================================================
  // PAGE NAVIGATION
  // =========================================================================

  function goPage(dir: number) {
    const next = currentPage + dir;
    if (next >= 1 && next <= totalPages) {
      setCurrentPage(next);
      setActivePoints([]);
      setCursorPos(null);
    }
  }

  // =========================================================================
  // DELETE MEASUREMENT
  // =========================================================================

  function deleteMeasurement(id: string) {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
  }

  // =========================================================================
  // ACTIVE BLOCK (persistent selection — click block, measurements go there)
  // =========================================================================

  const [activeBlock, setActiveBlock] = useState<{ label: string; color: string } | null>(null);

  // Keep refs in sync for measurement creation code that reads .current
  const pendingChecklistLabel = useRef<string | null>(null);
  const pendingChecklistColor = useRef<string | null>(null);
  useEffect(() => {
    pendingChecklistLabel.current = activeBlock?.label ?? null;
    pendingChecklistColor.current = activeBlock?.color ?? null;
  }, [activeBlock]);

  // ---- Drag state for measurements between blocks -------------------------
  const [dragMeasurementId, setDragMeasurementId] = useState<string | null>(null);
  const [dragOverBlock, setDragOverBlock] = useState<string | null>(null);

  function getBlockColor(label: string): string {
    const idx = checklist.findIndex(ci => ci.label === label);
    return idx >= 0 ? GUIDE_COLORS[idx % GUIDE_COLORS.length] : GREEN;
  }

  function toggleBlock(item: TakeoffChecklistItem) {
    const color = getBlockColor(item.label);
    if (activeBlock?.label === item.label) {
      // Deactivate
      setActiveBlock(null);
      return;
    }
    // Activate this block
    setActiveBlock({ label: item.label, color });
    // Set appropriate tool
    if (item.type === "count") {
      setCountLabel(item.label);
      setTool("count");
    } else if (item.type === "area") {
      setTool("area");
    } else {
      setTool("measure");
    }
  }

  function startFromChecklist(item: TakeoffChecklistItem) {
    toggleBlock(item);
  }

  function handleDropOnBlock(targetLabel: string | null) {
    if (!dragMeasurementId) return;
    const targetColor = targetLabel ? getBlockColor(targetLabel) : GREEN;
    setMeasurements(prev => prev.map(m => {
      if (m.id !== dragMeasurementId) return m;
      const oldSubLabel = getSubLabel(m);
      const newLabel = targetLabel ? buildCompositeLabel(targetLabel, oldSubLabel) : oldSubLabel;
      return { ...m, label: newLabel, guideItemLabel: targetLabel || undefined, color: targetColor, saved: false };
    }));
    setDragMeasurementId(null);
    setDragOverBlock(null);
  }

  // =========================================================================
  // AI CHAT — speech transcript sync + auto-scroll
  // =========================================================================

  useEffect(() => {
    if (transcript) setAiInput(transcript);
  }, [transcript]);

  // Chat history is now loaded per-trade via switchTrade(). No global load needed.

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages, aiLoading]);

  async function handleApproveAction(msgIndex: number, actionId: string, overrideData?: Record<string, unknown>) {
    const msg = aiMessages[msgIndex];
    const action = msg?.actions?.find(a => a.id === actionId);
    if (!action) return;
    const dataToSend = overrideData || action.data;

    // Mark executing
    setAiMessages(prev => prev.map((m, i) => i !== msgIndex || !m.actions ? m : {
      ...m, actions: m.actions.map(a => a.id === actionId ? { ...a, status: "executing" as const } : a),
    }));

    try {
      const res = await fetch("/api/chat/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: action.type, data: dataToSend }),
      });
      const result = await res.json();

      // Auto-open document downloads
      if (result.success && result.result?.documents) {
        const docs = result.result.documents as Array<{ url: string }>;
        if (docs.length > 0) window.open(docs[0].url, "_blank");
      } else if (result.success && result.result?.document_url) {
        window.open(String(result.result.document_url), "_blank");
      }

      setAiMessages(prev => prev.map((m, i) => i !== msgIndex || !m.actions ? m : {
        ...m, actions: m.actions.map(a => a.id === actionId ? { ...a, status: result.success ? "approved" as const : "error" as const } : a),
      }));
    } catch {
      setAiMessages(prev => prev.map((m, i) => i !== msgIndex || !m.actions ? m : {
        ...m, actions: m.actions.map(a => a.id === actionId ? { ...a, status: "error" as const } : a),
      }));
    }
  }

  function handleImageUpload(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setAiPendingImages(prev => [...prev, { base64, mediaType: file.type, preview: dataUrl }]);
      };
      reader.readAsDataURL(file);
    }
  }
  // =========================================================================

  async function sendAiMessage() {
    const text = aiInput.trim();
    const pendingImgs = [...aiPendingImages];
    if ((!text && pendingImgs.length === 0) || aiLoading) return;
    setAiInput("");
    setAiPendingImages([]);

    const measurementSummary = measurements.length > 0
      ? measurements.map(m => {
          if (m.type === "linear") return `- ${m.label || "Line"}: ${num(m.value).toFixed(2)} ${m.unit || "ft"}`;
          if (m.type === "area") return `- ${m.label || "Area"}: ${num(m.value).toFixed(1)} ${m.unit || "sqft"}`;
          return `- ${m.label || "Count"}: ${num(m.value)} items`;
        }).join("\n")
      : "No measurements yet.";

    const userDisplay = pendingImgs.length > 0
      ? (text || `[${pendingImgs.length} screenshot${pendingImgs.length > 1 ? "s" : ""}]`) + (pendingImgs.length > 0 ? ` 📎${pendingImgs.length}` : "")
      : text;
    setAiMessages(prev => [...prev, { role: "user", content: userDisplay }]);
    setAiLoading(true);
    setAiToolStatus(null);

    try {
      const res = await fetch("/api/takeoff-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          projectId: propProjectId,
          conversationId: takeoffConvId,
          trade: activeTrade || undefined,
          tradeLabel: activeTradeLabel || undefined,
          drawingContext: drawingText || "",
          measurementSummary,
          images: pendingImgs.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
        }),
      });
      if (!res.ok) throw new Error("Failed");

      // Stream SSE response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let fullContent = "";
      const pendingActions: Array<{ id: string; type: string; label: string; data: Record<string, unknown>; status: "pending" | "executing" | "approved" | "error" }> = [];
      const pendingDocuments: Array<{ url: string; filename: string; type?: string }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.substring(6));
            if (event.type === "conversation_id") {
              setTakeoffConvId(event.id);
            } else if (event.type === "text") {
              fullContent += event.content;
              setAiMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [...prev.slice(0, -1), { role: "assistant" as const, content: fullContent }];
                }
                return [...prev, { role: "assistant" as const, content: fullContent }];
              });
            } else if (event.type === "tool_status") {
              setAiToolStatus(event.label || "Working...");
            } else if (event.type === "documents_ready") {
              const docs = event.documents as Array<{ url: string; filename: string; type?: string }>;
              pendingDocuments.push(...docs);
            } else if (event.type === "proposed_action") {
              pendingActions.push({
                id: event.action_id,
                type: event.action_type,
                label: event.label || event.action_type,
                data: event.data,
                status: "pending" as const,
              });
            } else if (event.type === "estimate_updated") {
              setAiToolStatus(null);
            } else if (event.type === "done" || event.type === "error") {
              setAiToolStatus(null);
              if (event.type === "error" && !fullContent) {
                setAiMessages(prev => [...prev, { role: "assistant", content: `Error: ${event.message}` }]);
              }
            }
          } catch { /* skip malformed JSON */ }
        }
      }

      // Build action cards for documents + proposed actions
      const allActions = [
        ...pendingDocuments.map((d, idx) => ({
          id: `doc-${Date.now()}-${idx}`,
          type: "download" as const,
          label: d.type === "xlsx" ? `Download Excel` : `Download PDF`,
          data: { url: d.url, filename: d.filename } as Record<string, unknown>,
          status: "approved" as const,
        })),
        ...pendingActions,
      ];

      // Auto-open first document
      if (pendingDocuments.length > 0) {
        window.open(pendingDocuments[0].url, "_blank");
      }

      if (allActions.length > 0) {
        setAiMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = { ...updated[lastIdx], actions: allActions };
          } else {
            updated.push({ role: "assistant", content: fullContent || "Here you go:", actions: allActions });
          }
          return updated;
        });
      } else if (!fullContent) {
        setAiMessages(prev => [...prev, { role: "assistant", content: "Done — check the estimate." }]);
      }
    } catch {
      setAiMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    } finally {
      setAiLoading(false);
      setAiToolStatus(null);
      // Refresh trade conversations list so blocks show updated message counts
      if (propProjectId) {
        fetch(`/api/takeoff-chat/history?projectId=${propProjectId}&listAll=true`)
          .then(r => r.json())
          .then(data => setActiveTradeConvs(data.conversations || []))
          .catch(() => {});
      }
    }
  }

  // =========================================================================
  // ZOOM BUTTONS
  // =========================================================================

  function zoomBy(factor: number) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const t = { ...transformRef.current };
    const newScale = Math.min(Math.max(t.scale * factor, 0.1), 20);
    t.offsetX = cx - ((cx - t.offsetX) / t.scale) * newScale;
    t.offsetY = cy - ((cy - t.offsetY) / t.scale) * newScale;
    t.scale = newScale;
    transformRef.current = t;
    setTransform({ ...t });
  }

  // =========================================================================
  // CURSOR STYLE
  // =========================================================================

  function getCursorClass(): string {
    if (tool === "pan") return "cursor-grab";
    if (tool === "scale") return "cursor-crosshair";
    if (tool === "measure") return "cursor-crosshair";
    if (tool === "area") return "cursor-crosshair";
    if (tool === "count") return "cursor-cell";
    return "cursor-default";
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================

  const pageMeasurements = measurements.filter(
    (m) => m.pageNumber === currentPage
  );
  const linearTotal = measurements
    .filter((m) => m.type === "linear")
    .reduce((s, m) => s + m.value, 0);
  const areaTotal = measurements
    .filter((m) => m.type === "area")
    .reduce((s, m) => s + m.value, 0);
  const countTotal = measurements
    .filter((m) => m.type === "count")
    .reduce((s, m) => s + m.value, 0);

  // =========================================================================
  // RENDER
  // =========================================================================

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-[#111] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading {filename}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-[#111] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <p>{error}</p>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#111] flex flex-col overflow-hidden" style={{ touchAction: "none" }}>
      {/* ====================== TOOLBAR ====================== */}
      <div className="h-12 bg-[#1a1a1a] border-b border-white/10 flex items-center px-2 gap-1 shrink-0 z-20">
        {/* Close */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="text-white/70 hover:text-white mr-1"
        >
          <X className="h-4 w-4" />
        </Button>

        {/* Filename */}
        <span className="text-xs text-white/60 truncate max-w-[140px] mr-2">
          {filename}
        </span>

        <div className="w-px h-6 bg-white/10" />

        {/* Tool buttons */}
        {(
          [
            { mode: "pan" as ToolMode, icon: Move, tip: "Pan" },
            { mode: "scale" as ToolMode, icon: Scaling, tip: "Set Scale" },
            { mode: "measure" as ToolMode, icon: Ruler, tip: "Measure" },
            { mode: "area" as ToolMode, icon: Pentagon, tip: "Area" },
            { mode: "count" as ToolMode, icon: Hash, tip: "Count" },
          ] as const
        ).map(({ mode, icon: Icon, tip }) => (
          <Button
            key={mode}
            variant="ghost"
            size="icon-sm"
            title={tip}
            onClick={() => {
              setTool(mode);
              setActivePoints([]);
              setCursorPos(null);
            }}
            className={`${
              tool === mode
                ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}

        <div className="w-px h-6 bg-white/10" />

        {/* Undo */}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Undo (Ctrl+Z)"
          onClick={undo}
          className="text-white/60 hover:text-white"
        >
          <Undo className="h-4 w-4" />
        </Button>

        {/* Zoom */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => zoomBy(1.25)}
          className="text-white/60 hover:text-white"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <span className="text-[10px] text-white/40 min-w-[3ch] text-center tabular-nums">
          {Math.round(transform.scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => zoomBy(0.8)}
          className="text-white/60 hover:text-white"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-white/10" />

        {/* Page nav */}
        {totalPages > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => goPage(-1)}
              disabled={currentPage <= 1}
              className="text-white/60 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-[10px] text-white/50 tabular-nums">
              {currentPage}/{totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => goPage(1)}
              disabled={currentPage >= totalPages}
              className="text-white/60 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="w-px h-6 bg-white/10" />
          </>
        )}

        {/* Count label (when count tool active) */}
        {tool === "count" && (
          <div className="flex items-center gap-1 ml-1">
            <span className="text-[10px] text-white/40">Label:</span>
            <Input
              value={countLabel}
              onChange={(e) => setCountLabel(e.target.value)}
              className="h-7 w-28 text-xs bg-white/5 border-white/10 text-white"
              placeholder="e.g. Windows"
            />
          </div>
        )}

        {/* Scale status */}
        {pixelsPerFoot && tool !== "count" && (
          <Badge
            variant="secondary"
            className="ml-auto text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/30"
          >
            Scale: {pixelsPerFoot.toFixed(1)} px/ft
          </Badge>
        )}

        {/* spacer to push scale badge to far right if present */}
        <div className="ml-auto" />
      </div>

      {/* ====================== MAIN AREA ====================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas area */}
        <div
          ref={containerRef}
          className={`flex-1 relative overflow-hidden ${getCursorClass()}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          <canvas
            ref={pdfCanvasRef}
            className="absolute inset-0"
            style={{ touchAction: "none" }}
          />
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0"
            style={{ touchAction: "none" }}
          />

          {/* Tool hint */}
          {tool === "scale" && !pixelsPerFoot && scalePoints.length === 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-blue-500/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              Click two points on a known dimension to set scale
            </div>
          )}
          {tool === "measure" && !pixelsPerFoot && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-500/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              Set scale first for accurate measurements
            </div>
          )}
          {tool === "area" && activePoints.length === 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-500/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              Click to place polygon vertices, double-click to close
            </div>
          )}

          {/* Scale input dialog */}
          {showScaleInput && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
              <div className="bg-[#222] border border-white/10 rounded-lg p-4 w-72 shadow-2xl">
                <h3 className="text-sm font-semibold text-white mb-1">
                  Set Scale
                </h3>
                <p className="text-xs text-white/50 mb-3">
                  What is this distance in feet?
                  <br />
                  <span className="text-white/30">
                    (Pixel distance: {scalePixelDist.current.toFixed(0)}px)
                  </span>
                </p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={scaleInputValue}
                    onChange={(e) => setScaleInputValue(e.target.value)}
                    placeholder="e.g. 20"
                    className="h-8 text-sm bg-white/5 border-white/10 text-white"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmScale();
                      if (e.key === "Escape") {
                        setShowScaleInput(false);
                        setScalePoints([]);
                      }
                    }}
                  />
                  <span className="text-white/50 text-sm self-center">ft</span>
                  <Button size="sm" onClick={confirmScale} className="shrink-0">
                    Set
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowScaleInput(false);
                    setScalePoints([]);
                  }}
                  className="text-white/30 mt-2 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

        </div>

        {/* ====================== TRADE CHATS PANEL ====================== */}
        <div className="w-72 bg-[#1a1a1a] border-l border-white/10 flex flex-col shrink-0 overflow-hidden">

          {/* ---- Header ---- */}
          <div className="p-3 border-b border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                Trade Chats
              </h3>
              {fullAnalysis && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-blue-400 hover:text-blue-300 gap-1 px-2" onClick={() => setShowAnalysisResults(true)}>
                  <Eye className="h-3 w-3" /> Results
                </Button>
              )}
            </div>

            {/* AI Full Analysis button */}
            {!fullAnalysisLoading && pdfDoc && (
              <Button
                className="w-full mt-2 gap-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-medium"
                size="sm"
                onClick={runFullAnalysis}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {fullAnalysis ? "Re-Analyze All Pages" : `AI Analyze All ${totalPages} Pages`}
              </Button>
            )}

            {fullAnalysisLoading && (
              <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 text-amber-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  <span className="text-[11px] font-medium">Analyzing drawings...</span>
                </div>
                {fullAnalysisProgress && (
                  <p className="text-[10px] text-amber-400/60 mt-1 ml-5.5">{fullAnalysisProgress}</p>
                )}
              </div>
            )}

            <p className="mt-2 text-[10px] text-white/30">
              One chat per trade. Gather scope + screenshots, then send a bid package.
            </p>
          </div>

          {/* ---- Trade blocks scrollable area ---- */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {availableTrades.map((t) => {
              const isActive = activeTrade === t.key;
              const conv = activeTradeConvs.find(c => c.title === `Takeoff - ${t.label}`);
              const hasConv = !!conv;
              const msgCount = conv?.messageCount || 0;
              const li = conv?.lineItem;
              const quotes = conv?.quotesCount || 0;

              return (
                <div
                  key={t.key}
                  className={`group rounded-lg border transition-all ${
                    isActive
                      ? "border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/30"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                  }`}
                >
                  <button
                    onClick={() => switchTrade(t.key, t.label)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <div className="p-1 rounded bg-white/5 shrink-0">
                        <MessageSquare className={`h-3.5 w-3.5 ${isActive ? "text-amber-400" : hasConv ? "text-amber-400/60" : "text-white/25"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-white/90 font-medium truncate">{t.label}</div>
                        <div className="text-[9px] text-white/40 flex items-center gap-1.5">
                          <span>{hasConv ? `${msgCount} msg${msgCount !== 1 ? "s" : ""}` : "No chat yet"}</span>
                          {quotes > 0 && (
                            <span className="text-white/60">· {quotes} quote{quotes !== 1 ? "s" : ""}</span>
                          )}
                        </div>
                      </div>
                      {li && (
                        <div className="text-right shrink-0 mr-1">
                          <div className={`text-[11px] font-semibold ${li.needs_sub_quote ? "text-amber-400/70" : "text-amber-300"}`}>
                            {li.total_price > 0
                              ? `$${li.total_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              : "TBD"}
                          </div>
                          {li.total_cost > 0 && li.total_price > 0 && (
                            <div className="text-[8px] text-white/40">
                              cost ${li.total_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                          )}
                        </div>
                      )}
                      {isActive && (
                        <Badge className="text-[8px] bg-amber-500/20 text-amber-400 border-amber-500/30 px-1.5 py-0">
                          OPEN
                        </Badge>
                      )}
                      {!isActive && hasConv && !li && (
                        <span className="w-2 h-2 rounded-full bg-amber-400/60 shrink-0" />
                      )}
                      {hasConv && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteTradeChat(t.key, t.label); }}
                          className="p-1 text-white/0 group-hover:text-red-400/60 hover:!text-red-400 transition-colors shrink-0"
                          title="Delete chat"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}

            {/* Empty state */}
            {availableTrades.length === 0 && !fullAnalysisLoading && (
              <div className="text-center py-8 px-4">
                <Sparkles className="h-8 w-8 text-amber-500/20 mx-auto mb-2" />
                <p className="text-[11px] text-white/30">
                  Click <strong className="text-amber-400/60">AI Analyze All Pages</strong> to detect trades from the drawings
                </p>
              </div>
            )}
          </div>

          {/* ---- Measurements summary ---- */}
          {measurements.length > 0 && (
            <div className="px-3 py-2 border-t border-white/5">
              <div className="flex gap-3 text-[10px] text-white/40">
                {linearTotal > 0 && <span>{num(linearTotal).toFixed(1)} {pixelsPerFoot ? "ft" : "px"}</span>}
                {areaTotal > 0 && <span>{num(areaTotal).toFixed(1)} {pixelsPerFoot ? "sqft" : "px\u00B2"}</span>}
                {countTotal > 0 && <span>{countTotal} ct</span>}
              </div>
            </div>
          )}

          {/* ---- Toast ---- */}
          {toastMessage && (
            <div className="mx-3 mb-1 px-3 py-1.5 bg-green-600/90 text-white text-xs rounded text-center animate-in fade-in duration-200">
              {toastMessage}
            </div>
          )}

          {/* ---- Save measurements button ---- */}
          {onSave && measurements.length > 0 && (
            <div className="p-3 border-t border-white/10">
              <Button
                className="w-full gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                size="sm"
                disabled={saveStatus === "saving" || measurements.length === 0}
                onClick={async () => {
                  setSaveStatus("saving");
                  try {
                    await onSave(measurements, pixelsPerFoot, checklist);
                    setMeasurements(prev => prev.map(m => ({ ...m, saved: true })));
                    setSaveStatus("saved");
                    setToastMessage(`${measurements.length} measurement${measurements.length === 1 ? "" : "s"} saved \u2713`);
                    setTimeout(() => setToastMessage(null), 2000);
                    setTimeout(() => setSaveStatus("idle"), 2000);
                  } catch {
                    setSaveStatus("idle");
                  }
                }}
              >
                {saveStatus === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveStatus === "saved" ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved \u2713" : `Save (${measurements.length})`}
              </Button>
            </div>
          )}

          {/* ---- Create Estimate button ---- */}
          {propProjectId && (measurements.length > 0 || (fullAnalysis && (fullAnalysis.tradeOrder?.length || 0) > 0)) && (
            <div className="px-3 pb-3">
              <Button
                className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                size="sm"
                disabled={pushingToEstimate}
                onClick={pushScopeToEstimate}
              >
                {pushingToEstimate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                {pushingToEstimate ? "Estimator AI pricing..." : "Create Estimate from Takeoff"}
              </Button>
            </div>
          )}
        </div>

        {/* ====================== ESTIMATING AI CHAT PANEL ====================== */}
        {showChatPanel && activeTrade && (
          <div className="w-96 bg-[#1a1a1a] border-l border-white/10 flex flex-col shrink-0">
            {/* Header */}
            <div className="p-3 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="p-1.5 rounded-lg bg-amber-500/20 shrink-0">
                  <Bot className="h-4 w-4 text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-white truncate">{activeTradeLabel}</h3>
                  <p className="text-[10px] text-white/40">Scope + screenshots + bid package</p>
                </div>
              </div>
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-white/40 hover:text-white shrink-0"
                onClick={() => { setShowChatPanel(false); setActiveTrade(null); setActiveTradeLabel(null); }}
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>

            {/* Pricing card — the line item's numbers, editable inline.
                Keyed to estimate_line_item_id so changes flow straight to
                the estimate and proposal for this trade. */}
            {tradeLineItem && (
              <div className="px-3 py-2.5 border-b border-white/10 bg-zinc-900/40 shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-white/40">Line Item Pricing</span>
                  {priceSaving && <Loader2 className="h-3 w-3 animate-spin text-amber-400" />}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <label className="col-span-2 space-y-0.5">
                    <span className="text-[9px] uppercase text-white/40">Unit Cost</span>
                    <div className="flex items-center gap-1 bg-zinc-800 rounded px-1.5 py-1">
                      <span className="text-[10px] text-white/40">$</span>
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={tradeLineItem.unit_cost}
                        key={`uc-${tradeLineItem.id}-${tradeLineItem.unit_cost}`}
                        className="bg-transparent text-xs text-white w-full outline-none"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== tradeLineItem.unit_cost) saveLineItemField("unit_cost", v);
                        }}
                      />
                    </div>
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[9px] uppercase text-white/40">Qty</span>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={tradeLineItem.quantity}
                      key={`qty-${tradeLineItem.id}-${tradeLineItem.quantity}`}
                      className="bg-zinc-800 rounded px-1.5 py-1 text-xs text-white w-full outline-none"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== tradeLineItem.quantity) saveLineItemField("quantity", v);
                      }}
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[9px] uppercase text-white/40">Unit</span>
                    <input
                      type="text"
                      defaultValue={tradeLineItem.unit}
                      key={`unit-${tradeLineItem.id}-${tradeLineItem.unit}`}
                      className="bg-zinc-800 rounded px-1.5 py-1 text-xs text-white w-full outline-none"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== tradeLineItem.unit) saveLineItemField("unit", v);
                      }}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-1.5 items-end">
                  <label className="space-y-0.5">
                    <span className="text-[9px] uppercase text-white/40">Markup %</span>
                    <input
                      type="number"
                      step="1"
                      defaultValue={tradeLineItem.markup_percentage}
                      key={`mk-${tradeLineItem.id}-${tradeLineItem.markup_percentage}`}
                      className="bg-zinc-800 rounded px-1.5 py-1 text-xs text-white w-full outline-none"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== tradeLineItem.markup_percentage) saveLineItemField("markup_percentage", v);
                      }}
                    />
                  </label>
                  <div className="space-y-0.5">
                    <span className="text-[9px] uppercase text-white/40">Total Cost</span>
                    <div className="bg-zinc-900 rounded px-1.5 py-1 text-xs text-white/90">
                      ${tradeLineItem.total_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[9px] uppercase text-amber-400/70">Client Price</span>
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-1 text-xs font-semibold text-amber-300">
                      ${tradeLineItem.total_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
                {tradeLineItem.needs_sub_quote && (
                  <div className="text-[10px] text-amber-400/80 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Needs sub quote
                  </div>
                )}
              </div>
            )}

            {/* Screenshots for this line item — drawings clippings, site
                photos, anything saved or pasted in this chat. */}
            {tradeScreenshots.length > 0 && (
              <div className="px-3 py-2 border-b border-white/10 bg-zinc-900/20 shrink-0">
                <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">
                  Screenshots ({tradeScreenshots.length})
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {tradeScreenshots.map(s => (
                    <div key={s.path} className="relative group shrink-0">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                        title={s.name}
                      >
                        <img
                          src={s.url}
                          alt={s.name}
                          className="h-16 w-16 object-cover rounded border border-white/10 group-hover:border-amber-500/50 transition-colors"
                        />
                      </a>
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!confirm("Delete this screenshot?")) return;
                          const res = await fetch("/api/takeoff-screenshot", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ path: s.path }),
                          });
                          if (res.ok) {
                            setTradeScreenshots(prev => prev.filter(x => x.path !== s.path));
                          } else {
                            const err = await res.json().catch(() => ({}));
                            alert(err.error || "Failed to delete screenshot");
                          }
                        }}
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600"
                        title="Delete screenshot"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quotes received for this line item */}
            {tradeQuotes.length > 0 && (
              <div className="px-3 py-2 border-b border-white/10 bg-zinc-900/20 shrink-0">
                <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Quotes In ({tradeQuotes.length})</div>
                <div className="space-y-1">
                  {tradeQuotes.map(q => (
                    <div key={q.id} className="flex items-center justify-between text-[11px]">
                      <span className="text-white/70 truncate">{q.subcontractor_name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-white/90">
                          {q.amount != null ? `$${q.amount.toLocaleString()}` : "—"}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                          q.status === "approved" || q.status === "accepted"
                            ? "bg-green-500/20 text-green-300"
                            : q.status === "declined"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-white/10 text-white/60"
                        }`}>{q.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              {aiMessages.length === 0 && (
                <div className="text-center py-8 space-y-3">
                  <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-amber-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-white/50">Working on <strong className="text-amber-400">{activeTradeLabel}</strong></p>
                    <p className="text-[11px] text-white/30">Describe scope, paste screenshots, or use the mic. When done, I&apos;ll build the bid package.</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-center pt-2">
                    {[`Describe ${activeTradeLabel} scope`, "Paste a screenshot", "Generate bid package"].map(hint => (
                      <button
                        key={hint}
                        className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors"
                        onClick={() => { setAiInput(hint); }}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {aiMessages.map((msg, i) => (
                <div key={i}>
                  <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-amber-600 text-white rounded-br-md"
                        : "bg-zinc-800 text-white/80 rounded-bl-md"
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                  {/* Action cards */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="space-y-1.5 mt-2 ml-1">
                      {msg.actions.map(action => (
                        <div key={action.id} className="border border-white/10 rounded-lg bg-zinc-900/50">
                          {/* Email action — full editor */}
                          {action.type === "send_email" && action.status === "pending" ? (
                            <TakeoffEmailCard action={action} onApprove={(data) => handleApproveAction(i, action.id, data)} />
                          ) : (
                          <div className="p-2.5 flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-white/80 truncate">{action.label}</p>
                            {action.status === "pending" && (
                              <Button size="sm" className="h-7 text-[10px] px-3 bg-amber-600 hover:bg-amber-700 text-white shrink-0" onClick={() => handleApproveAction(i, action.id)}>
                                Approve
                              </Button>
                            )}
                          {action.status === "executing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />}
                          {action.status === "approved" && action.type === "download" && (
                            <Button
                              size="sm" variant="outline"
                              className="h-7 text-[10px] px-3 border-green-600 text-green-400 hover:bg-green-500/10 shrink-0"
                              onClick={() => window.open(String(action.data.url), "_blank")}
                            >
                              Download
                            </Button>
                          )}
                          {action.status === "approved" && action.type !== "download" && <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />}
                          {action.status === "error" && <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                          </div>)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {aiLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-800 rounded-2xl rounded-bl-md px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-amber-400/70">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {aiToolStatus || "Thinking..."}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Image previews */}
            {aiPendingImages.length > 0 && (
              <div className="flex gap-2 px-3 py-2 border-t border-white/10 overflow-x-auto shrink-0">
                {aiPendingImages.map((img, i) => (
                  <div key={i} className="relative shrink-0">
                    <img src={img.preview} alt="screenshot" className="h-16 rounded-lg border border-white/20 object-cover" />
                    <button
                      onClick={() => setAiPendingImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center hover:bg-red-600 shadow-lg"
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Input area */}
            <div className="p-3 border-t border-white/10 space-y-2 shrink-0">
              <div className="flex gap-2">
                <Input
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  placeholder={isListening ? "Listening..." : aiPendingImages.length > 0 ? "Describe this screenshot..." : `${activeTradeLabel} — scope, qty, materials...`}
                  className={`h-9 text-sm bg-white/5 border-white/10 text-white flex-1 ${isListening ? "border-red-500/50 bg-red-500/5" : ""}`}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (isListening) stopListening(); sendAiMessage(); } }}
                  onPaste={e => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const item of Array.from(items)) {
                      if (item.type.startsWith("image/")) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (!file) continue;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = reader.result as string;
                          const base64 = dataUrl.split(",")[1];
                          setAiPendingImages(prev => [...prev, { base64, mediaType: item.type, preview: dataUrl }]);
                        };
                        reader.readAsDataURL(file);
                      }
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-9 w-9 p-0 bg-amber-600 hover:bg-amber-700 shrink-0"
                  onClick={() => { if (isListening) stopListening(); sendAiMessage(); }}
                  disabled={aiLoading || (!aiInput.trim() && aiPendingImages.length === 0)}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-1.5">
                {micSupported && (
                  <Button
                    size="sm"
                    variant={isListening ? "destructive" : "outline"}
                    className={`h-7 text-[10px] gap-1.5 flex-1 ${isListening ? "bg-red-600 hover:bg-red-700 text-white animate-pulse" : "border-white/10 text-white/50 hover:text-white"}`}
                    onClick={() => isListening ? stopListening() : startListening()}
                  >
                    <Mic className="h-3 w-3" />
                    {isListening ? "Stop Listening" : "Voice"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1.5 flex-1 border-white/10 text-white/50 hover:text-white"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-3 w-3" />
                  Screenshot
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => { handleImageUpload(e.target.files); e.target.value = ""; }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====================== AI ANALYSIS RESULTS OVERLAY ====================== */}
      {showAnalysisResults && fullAnalysis && (() => {
        const scopeByTrade = fullAnalysis.scopeByTrade || {};
        const tradeOrder = fullAnalysis.tradeOrder || [];
        const tradeLabels = fullAnalysis.tradeLabels || {};
        const totalItems = tradeOrder.reduce((s, k) => s + (scopeByTrade[k]?.length || 0), 0);
        const totalUnconfirmed = tradeOrder.reduce((s, k) => {
          return s + (scopeByTrade[k] || []).filter(it => !confirmedQuantityIds.has(it.id)).length;
        }, 0);
        const schedules = fullAnalysis.schedules || {};

        const confidenceStyle = (c: string) =>
          c === "high" ? "text-green-400" : c === "medium" ? "text-amber-400" : c === "low" ? "text-orange-400/80" : "text-white/30";

        const tradeStatus = (items: ScopeItem[]): { color: string; label: string } => {
          if (!items || items.length === 0) return { color: "bg-red-500/15 text-red-300 border-red-500/30", label: "none" };
          const withQty = items.filter(i => i.quantity != null && i.quantity > 0).length;
          if (withQty === items.length) return { color: "bg-green-500/15 text-green-300 border-green-500/30", label: `${withQty} priced` };
          if (withQty > 0) return { color: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: `${withQty}/${items.length} priced` };
          return { color: "bg-orange-500/15 text-orange-300 border-orange-500/30", label: "needs quote" };
        };

        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl w-[94vw] max-w-4xl max-h-[88vh] flex flex-col shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="h-5 w-5 text-amber-400 shrink-0" />
                  <h2 className="text-sm font-semibold text-white shrink-0">AI Scope of Work</h2>
                  <Badge variant="secondary" className="text-[10px] bg-green-500/15 text-green-400 border-green-500/30 shrink-0">
                    {fullAnalysis.pagesAnalyzed || totalPages} pages
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] bg-white/5 text-white/60 border-white/10 shrink-0">
                    {totalItems} items · {tradeOrder.length} trades · {confirmedQuantityIds.size} added
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {totalUnconfirmed > 0 && (
                    <Button
                      size="sm"
                      className="h-7 text-[10px] bg-green-600/80 hover:bg-green-600 text-white gap-1"
                      onClick={confirmAllScope}
                    >
                      <Check className="h-3 w-3" />
                      Add all ({totalUnconfirmed})
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" onClick={() => setShowAnalysisResults(false)} className="text-white/60 hover:text-white">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* Project Dimensions — the key numbers that drive everything */}
                {(() => {
                  const dimRow = (
                    key: keyof ProjectDimensions,
                    label: string,
                    unit: string,
                    placeholder?: string
                  ) => {
                    const d = projectDims[key];
                    return (
                      <div key={key} className="flex items-center gap-2 text-[11px]">
                        <div className="w-32 shrink-0 text-white/60">{label}</div>
                        <Input
                          type="number"
                          step="0.1"
                          value={typeof d?.value === "number" ? d.value : ""}
                          placeholder={placeholder || "—"}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (isFinite(v) && v > 0) updateProjectDim(key, v);
                          }}
                          className="h-7 w-24 text-[11px] bg-white/5 border-white/10 text-white"
                        />
                        <div className="text-[10px] text-white/40 w-8">{unit}</div>
                        {d?.source && (
                          <div className="text-[10px] text-white/40 truncate flex-1">{d.source}</div>
                        )}
                        {d?.confidence && d.confidence !== "none" && (
                          <span
                            className={`text-[9px] font-semibold uppercase tracking-wider shrink-0 ${
                              d.confidence === "high" ? "text-green-400" :
                              d.confidence === "medium" ? "text-amber-400" : "text-orange-400"
                            }`}
                          >
                            {d.confidence}
                          </span>
                        )}
                      </div>
                    );
                  };
                  return (
                    <div className="rounded-lg bg-blue-500/5 border border-blue-500/30 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Ruler className="h-4 w-4 text-blue-400" />
                        <h3 className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
                          Project Dimensions — edit these and every derived line updates
                        </h3>
                      </div>
                      <div className="space-y-1.5">
                        {dimRow("footprintSF", "Addition footprint", "sqft", "946")}
                        {dimRow("perimeterLF", "Addition perimeter", "LF", "124")}
                        {dimRow("wallHeight", "Wall height", "ft", "9")}
                        {dimRow("roofPitchFactor", "Roof pitch multiplier", "×", "1.118 (6:12)")}
                        {dimRow("exteriorWindowCount", "Exterior windows", "ea")}
                        {dimRow("exteriorDoorCount", "Exterior doors", "ea")}
                      </div>
                      <p className="text-[10px] text-white/40 mt-2 italic">
                        Derived lines (foundation walls, slab, flooring, roofing, siding, drywall, insulation, gutters…) auto-compute from these five numbers. Edit any value and the quantities propagate.
                      </p>
                    </div>
                  );
                })()}

                {/* Sheet Index */}
                {fullAnalysis.sheetIndex && fullAnalysis.sheetIndex.length > 0 && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2">Sheet Index</h3>
                    <div className="space-y-1">
                      {fullAnalysis.sheetIndex.map((d, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <button
                            onClick={() => { setCurrentPage(d.page); setShowAnalysisResults(false); }}
                            className="shrink-0 text-amber-400 hover:text-amber-300 font-mono"
                          >
                            {d.sheetNumber ? d.sheetNumber : `P${d.page}`}
                          </button>
                          <span className="text-white/70 font-medium">{d.title}</span>
                          {d.purpose && <span className="text-white/40">— {d.purpose}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SCOPE BY TRADE */}
                <div className="rounded-lg bg-white/[0.03] border border-white/10">
                  <div className="flex items-center justify-between p-3 border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-amber-400" />
                      <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                        Scope of Work ({tradeOrder.length} trades, {totalItems} items)
                      </h3>
                    </div>
                  </div>
                  <div className="divide-y divide-white/5">
                    {tradeOrder.map(tradeKey => {
                      const items = scopeByTrade[tradeKey] || [];
                      const label = tradeLabels[tradeKey] || tradeKey;
                      const status = tradeStatus(items);
                      const allConfirmed = items.length > 0 && items.every(it => confirmedQuantityIds.has(it.id));
                      return (
                        <div key={tradeKey} className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-white">{label}</span>
                              <Badge className={`text-[9px] ${status.color} px-1.5 py-0.5`}>{status.label}</Badge>
                              <span className="text-[9px] text-white/30">· {items.length} line{items.length === 1 ? "" : "s"}</span>
                            </div>
                            {!allConfirmed && items.length > 0 && (
                              <Button
                                size="sm"
                                className="h-6 text-[10px] bg-amber-600/70 hover:bg-amber-600 text-white px-2 gap-1"
                                onClick={() => confirmAllInTrade(tradeKey)}
                              >
                                <Plus className="h-3 w-3" />
                                Add all
                              </Button>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            {items.map(it => {
                              const confirmed = confirmedQuantityIds.has(it.id);
                              return (
                                <div
                                  key={it.id}
                                  className={`grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 px-2.5 py-2 rounded text-[11px] ${
                                    confirmed ? "bg-green-500/10 border border-green-500/20" : "bg-white/[0.02] border border-white/5 hover:bg-white/[0.04]"
                                  }`}
                                >
                                  <div className="col-span-1 min-w-0">
                                    <div className="text-white/90 font-medium">{it.description}</div>
                                    {it.materialSpec && (
                                      <div className="text-[10px] text-blue-300/80 mt-0.5">{it.materialSpec}</div>
                                    )}
                                    {(it.sourceSheet || it.sourceDetail) && (
                                      <div className="text-[10px] text-white/40 mt-0.5">
                                        {it.sourceSheet && <span className="text-amber-400/80 font-mono">{it.sourceSheet}</span>}
                                        {it.sourceType && <span className="text-white/30"> · {String(it.sourceType).replace(/_/g, " ")}</span>}
                                        {it.sourceDetail && <span className="text-white/50"> — {it.sourceDetail}</span>}
                                      </div>
                                    )}
                                    {it.computation && (
                                      <div className="text-[10px] text-blue-300/70 mt-0.5 font-mono">{it.computation}</div>
                                    )}
                                    {it.notes && (
                                      <div className="text-[10px] text-white/40 mt-0.5 italic">{it.notes}</div>
                                    )}
                                  </div>
                                  <div className="shrink-0 text-right">
                                    {(() => {
                                      // Live-derive if this line has a derivedFrom formula
                                      const derived = it.derivedFrom ? deriveScopeQty(it, projectDims) : null;
                                      const effQty = derived?.quantity ?? it.quantity;
                                      const effUnit = derived?.unit ?? it.unit ?? "";
                                      if (effQty != null && effQty > 0) {
                                        return (
                                          <>
                                            <div className="text-white font-mono font-semibold">
                                              {effQty} <span className="text-white/40 text-[10px]">{effUnit}</span>
                                            </div>
                                            {it.derivedFrom && (
                                              <div className="text-[9px] text-blue-300/70 uppercase tracking-wider">derived</div>
                                            )}
                                            {!it.derivedFrom && (
                                              <div className={`text-[9px] uppercase tracking-wider ${confidenceStyle(it.confidence)}`}>
                                                {it.confidence}
                                              </div>
                                            )}
                                          </>
                                        );
                                      }
                                      return (
                                        <>
                                          <div className="text-orange-300 text-[10px] font-semibold uppercase tracking-wider">Needs quote</div>
                                          <div className={`text-[9px] uppercase tracking-wider ${confidenceStyle(it.confidence)}`}>
                                            {it.confidence}
                                          </div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                  <div className="shrink-0 self-center flex items-center gap-1">
                                    {confirmed ? (
                                      <Badge className="text-[9px] bg-green-500/20 text-green-300 border-green-500/30 px-1.5 py-0.5 gap-1">
                                        <Check className="h-3 w-3" /> done
                                      </Badge>
                                    ) : (
                                      <>
                                        <Button
                                          size="sm"
                                          className="h-6 text-[10px] bg-blue-600 hover:bg-blue-700 text-white px-2 gap-1"
                                          onClick={() => measureScopeItem(it, label)}
                                          title="Close this panel and measure this on the drawing"
                                        >
                                          <Ruler className="h-3 w-3" />
                                          Measure
                                        </Button>
                                        {it.quantity != null && it.quantity > 0 && (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 text-[9px] text-white/50 hover:text-white/80 hover:bg-white/5 px-1.5"
                                            onClick={() => confirmScopeItem(it, label)}
                                            title="Accept the AI-suggested quantity without drawing"
                                          >
                                            Use AI
                                          </Button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Schedules — Windows */}
                {schedules.windows && schedules.windows.length > 0 && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2">
                      Window Schedule ({schedules.windows.reduce((s, w) => s + (w.count || 0), 0)} units)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-white/40 text-[10px] uppercase tracking-wider">
                            <th className="pb-1.5 pr-3">Tag</th>
                            <th className="pb-1.5 pr-3">Manufacturer</th>
                            <th className="pb-1.5 pr-3">Model</th>
                            <th className="pb-1.5 pr-3">Size</th>
                            <th className="pb-1.5 pr-3 text-right">Qty</th>
                            <th className="pb-1.5">Sheet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedules.windows.map((w, i) => (
                            <tr key={i} className="text-white/70 border-t border-white/5">
                              <td className="py-1.5 pr-3 font-mono text-amber-400/80">{w.tag || "—"}</td>
                              <td className="py-1.5 pr-3">{w.manufacturer || "—"}</td>
                              <td className="py-1.5 pr-3">{w.model || "—"}</td>
                              <td className="py-1.5 pr-3 font-mono">{w.size || "—"}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-white">{w.count}</td>
                              <td className="py-1.5 text-[10px] text-amber-400/70 font-mono">{w.sourceSheet || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Schedules — Doors */}
                {schedules.doors && schedules.doors.length > 0 && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2">
                      Door Schedule ({schedules.doors.reduce((s, d) => s + (d.count || 0), 0)} units)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-white/40 text-[10px] uppercase tracking-wider">
                            <th className="pb-1.5 pr-3">Tag</th>
                            <th className="pb-1.5 pr-3">Type</th>
                            <th className="pb-1.5 pr-3">Size</th>
                            <th className="pb-1.5 pr-3 text-right">Qty</th>
                            <th className="pb-1.5">Sheet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedules.doors.map((d, i) => (
                            <tr key={i} className="text-white/70 border-t border-white/5">
                              <td className="py-1.5 pr-3 font-mono text-amber-400/80">{d.tag || "—"}</td>
                              <td className="py-1.5 pr-3">{d.type || "—"}</td>
                              <td className="py-1.5 pr-3 font-mono">{d.size || "—"}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-white">{d.count}</td>
                              <td className="py-1.5 text-[10px] text-amber-400/70 font-mono">{d.sourceSheet || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Schedules — Structural */}
                {schedules.structural && schedules.structural.length > 0 && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2">
                      Structural (LVL / Steel / Engineered)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-white/40 text-[10px] uppercase tracking-wider">
                            <th className="pb-1.5 pr-3">Tag</th>
                            <th className="pb-1.5 pr-3">Type</th>
                            <th className="pb-1.5 pr-3">Size</th>
                            <th className="pb-1.5 pr-3">Span</th>
                            <th className="pb-1.5 pr-3 text-right">Qty</th>
                            <th className="pb-1.5">Sheet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedules.structural.map((s, i) => (
                            <tr key={i} className="text-white/70 border-t border-white/5">
                              <td className="py-1.5 pr-3 font-mono text-amber-400/80">{s.tag || "—"}</td>
                              <td className="py-1.5 pr-3">{s.type}</td>
                              <td className="py-1.5 pr-3 font-mono">{s.size}</td>
                              <td className="py-1.5 pr-3 font-mono">{s.span || "—"}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-white">{s.count}</td>
                              <td className="py-1.5 text-[10px] text-amber-400/70 font-mono">{s.sourceSheet || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Finish Schedule */}
                {schedules.finishes && schedules.finishes.length > 0 && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2">Finish Schedule</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-white/40 text-[10px] uppercase tracking-wider">
                            <th className="pb-1.5 pr-3">Room</th>
                            <th className="pb-1.5 pr-3">Floor</th>
                            <th className="pb-1.5 pr-3">Walls</th>
                            <th className="pb-1.5 pr-3">Ceiling</th>
                            <th className="pb-1.5">Sheet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedules.finishes.map((f, i) => (
                            <tr key={i} className="text-white/70 border-t border-white/5">
                              <td className="py-1.5 pr-3 font-medium">{f.room || "—"}</td>
                              <td className="py-1.5 pr-3">{f.floor || "—"}</td>
                              <td className="py-1.5 pr-3">{f.walls || "—"}</td>
                              <td className="py-1.5 pr-3">{f.ceiling || "—"}</td>
                              <td className="py-1.5 text-[10px] text-amber-400/70 font-mono">{f.sourceSheet || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Missing Info */}
                {fullAnalysis.missingInfo && fullAnalysis.missingInfo.length > 0 && (
                  <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                        Missing from drawings ({fullAnalysis.missingInfo.length})
                      </h3>
                    </div>
                    <ul className="space-y-1.5">
                      {fullAnalysis.missingInfo.map((m, i) => (
                        <li key={i} className="text-[11px] text-white/70">
                          <div className="font-medium text-white/90">{m.item}</div>
                          <div className="text-[10px] text-white/50">{m.whyNeeded}{m.suggestedSource ? ` — ${m.suggestedSource}` : ""}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Material Notes */}
                {fullAnalysis.materialNotes && fullAnalysis.materialNotes.length > 0 && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2">Material Notes</h3>
                    <ul className="space-y-1">
                      {fullAnalysis.materialNotes.map((note, i) => (
                        <li key={i} className="text-[11px] text-white/60 flex items-start gap-1.5">
                          <span className="text-white/20 shrink-0">•</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-3 border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
                <p className="text-[10px] text-white/40 flex-1 min-w-0 truncate">
                  {confirmedQuantityIds.size} of {totalItems} added to takeoff blocks · {totalItems} total scope lines across {tradeOrder.length} trades
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-white/70 border-white/10 hover:bg-white/5"
                    onClick={() => setShowAnalysisResults(false)}
                  >
                    Close
                  </Button>
                  {propProjectId && (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                      disabled={pushingToEstimate || totalItems === 0}
                      onClick={pushScopeToEstimate}
                    >
                      {pushingToEstimate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                      {pushingToEstimate ? "Pushing..." : `Push ${totalItems} lines to Proposal`}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Inline email editor for takeoff chat ──────────────────

const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";

function TakeoffEmailCard({
  action,
  onApprove,
}: {
  action: { data: Record<string, unknown> };
  onApprove: (data: Record<string, unknown>) => void;
}) {
  const [to, setTo] = useState(String(action.data.to || ""));
  const [cc, setCc] = useState(String(action.data.cc || ""));
  const [subject, setSubject] = useState(String(action.data.subject || ""));
  const [body, setBody] = useState(String(action.data.body || ""));
  const attachments = (action.data.attachments || []) as Array<{ filename: string; url?: string; storage_path?: string }>;

  const ccHasRyan = cc.toLowerCase().includes(RYAN_EMAIL);
  const toggleRyan = () => {
    if (ccHasRyan) {
      // Remove Ryan from cc, clean up stray commas
      const next = cc
        .split(",")
        .map(s => s.trim())
        .filter(s => s && s.toLowerCase() !== RYAN_EMAIL)
        .join(", ");
      setCc(next);
    } else {
      setCc(cc ? `${cc}, ${RYAN_EMAIL}` : RYAN_EMAIL);
    }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-xs font-medium text-white/80">Email Draft</span>
        </div>
        <button
          onClick={toggleRyan}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
            ccHasRyan
              ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
              : "bg-transparent border-white/20 text-white/50 hover:text-white hover:border-white/30"
          }`}
          title={ccHasRyan ? "Ryan is on CC — click to remove" : "Add Ryan to CC"}
        >
          {ccHasRyan ? "✓ Ryan on CC" : "+ CC Ryan"}
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30 w-10 shrink-0">To:</span>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            className="flex-1 bg-zinc-800 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30 w-10 shrink-0">Cc:</span>
          <input
            value={cc}
            onChange={e => setCc(e.target.value)}
            placeholder="Optional — comma-separated"
            className="flex-1 bg-zinc-800 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30 w-10 shrink-0">Subj:</span>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="flex-1 bg-zinc-800 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50"
          />
        </div>
        {attachments.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Paperclip className="h-3 w-3 text-white/30 shrink-0" />
            {attachments.map((att, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400/70">{att.filename}</span>
            ))}
          </div>
        )}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          className="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white/80 min-h-[100px] resize-none focus:outline-none focus:border-amber-500/50"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          className="h-7 text-[10px] px-4 bg-blue-600 hover:bg-blue-700 text-white"
          onClick={() => onApprove({ ...action.data, to, cc: cc.trim() || undefined, subject, body })}
        >
          <Send className="h-3 w-3 mr-1" /> Send Email
        </Button>
      </div>
    </div>
  );
}
