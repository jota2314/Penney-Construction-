"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
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
} from "lucide-react";
import { useRouter } from "next/navigation";

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
  const [creatingEstimate, setCreatingEstimate] = useState(false);

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
  const [aiMessages, setAiMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [checklist, setChecklist] = useState<TakeoffChecklistItem[]>(initialChecklist ?? []);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const checklistGenerated = useRef(!!(initialChecklist && initialChecklist.length > 0));

  // ---- Full AI Analysis state ----------------------------------------------
  const [fullAnalysis, setFullAnalysis] = useState<FullAnalysisResult | null>(null);
  const [fullAnalysisLoading, setFullAnalysisLoading] = useState(false);
  const [fullAnalysisProgress, setFullAnalysisProgress] = useState("");
  const [showAnalysisResults, setShowAnalysisResults] = useState(false);
  const [confirmedQuantityIds, setConfirmedQuantityIds] = useState<Set<string>>(new Set());


  // ---- Touch state ---------------------------------------------------------
  const touchStartDist = useRef(0);
  const touchStartScale = useRef(1);
  const touchStartCenter = useRef({ x: 0, y: 0 });
  const touchStartOffset = useRef({ x: 0, y: 0 });

  // ---- Derived: count unsaved measurements ---------------------------------
  const unsavedCount = measurements.filter(m => !m.saved).length;

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
      setShowAnalysisResults(true);

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
      const winCount = result.schedules?.windows?.reduce((s, w) => s + (w.count || 0), 0) || 0;
      const doorCount = result.schedules?.doors?.reduce((s, d) => s + (d.count || 0), 0) || 0;
      setToastMessage(
        `AI scope — ${totalItems} line items across ${tradeOrder.length} trades (${tradesWithRealQty} with qtys, ${tradesAllStub} need sub quote). ${winCount} windows, ${doorCount} doors.`
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

  function confirmScopeItem(item: ScopeItem, tradeLabel: string) {
    try {
      if (!item || !item.id || confirmedQuantityIds.has(item.id)) return;

      const type = unitToType(item.unit);
      const checklistLabel = tradeLabel || item.trade || "Scope";

      // Stable color from the trade label — independent of checklist state,
      // so rapid clicks don't race on findIndex against a stale snapshot.
      const colorIdx = Math.abs(
        Array.from(checklistLabel).reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)
      ) % GUIDE_COLORS.length;
      const color = GUIDE_COLORS[colorIdx];

      // Use functional setChecklist so we never read stale state.
      setChecklist(prev => {
        const existing = prev.find(c => c.label === checklistLabel);
        if (existing) {
          return existing.done
            ? prev
            : prev.map(c => c.label === checklistLabel ? { ...c, done: true } : c);
        }
        return [...prev, {
          label: checklistLabel,
          type,
          trade: item.trade || "",
          description: "",
          done: true,
        }];
      });

      const subLabel = (item.needsQuote || item.quantity == null)
        ? `${item.description || "Scope item"} (qty TBD)`
        : `${item.description || "Scope item"} — ${item.quantity} ${item.unit || ""}`;

      const measurement: SavedMeasurement = {
        id: uid(),
        type,
        label: buildCompositeLabel(checklistLabel, subLabel),
        guideItemLabel: checklistLabel,
        points: [],
        value: typeof item.quantity === "number" && !isNaN(item.quantity) ? item.quantity : 0,
        unit: item.unit || "ea",
        color,
        pageNumber: 1,
        saved: false,
      };
      setMeasurements(prev => [...prev, measurement]);
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
  async function pushScopeToEstimate() {
    if (!fullAnalysis || !propProjectId || pushingToEstimate) return;
    setPushingToEstimate(true);
    try {
      const res = await fetch("/api/takeoff-scope-to-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: propProjectId,
          scopeByTrade: fullAnalysis.scopeByTrade,
          tradeOrder: fullAnalysis.tradeOrder,
          tradeLabels: fullAnalysis.tradeLabels,
          mode: "replace",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Push failed" }));
        throw new Error(err.error || "Push failed");
      }
      const data = await res.json();
      setToastMessage(`Pushed ${data.lineItemCount} line items across ${data.tradeCount} trades to proposal.`);
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
  // AI CHAT
  // =========================================================================

  async function sendAiMessage() {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    setAiInput("");

    const measurementSummary = measurements.length > 0
      ? measurements.map(m => {
          if (m.type === "linear") return `- ${m.label || "Line"}: ${num(m.value).toFixed(2)} ${m.unit || "ft"}`;
          if (m.type === "area") return `- ${m.label || "Area"}: ${num(m.value).toFixed(1)} ${m.unit || "sqft"}`;
          return `- ${m.label || "Count"}: ${num(m.value)} items`;
        }).join("\n")
      : "No measurements yet.";

    const scaleInfo = pixelsPerFoot ? `Scale set: ${num(pixelsPerFoot).toFixed(1)} px/ft` : "Scale not set.";

    const fullQuestion = `${scaleInfo}\nCurrent measurements:\n${measurementSummary}\n\nUser question: ${text}`;

    setAiMessages(prev => [...prev, { role: "user", content: text }]);
    setAiLoading(true);

    try {
      const res = await fetch("/api/takeoff-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawingText, scopeOfWork, filename, question: fullQuestion }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setAiMessages(prev => [...prev, { role: "assistant", content: data.message || "No response." }]);
    } catch {
      setAiMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    } finally {
      setAiLoading(false);
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

        {/* ====================== MEASUREMENT PANEL ====================== */}
        <div className="w-72 bg-[#1a1a1a] border-l border-white/10 flex flex-col shrink-0 overflow-hidden">

          {/* ---- Header with totals ---- */}
          <div className="p-3 border-b border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                Takeoff Blocks
              </h3>
              {fullAnalysis && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-blue-400 hover:text-blue-300 gap-1 px-2" onClick={() => setShowAnalysisResults(true)}>
                  <Eye className="h-3 w-3" /> Results
                </Button>
              )}
            </div>

            {/* AI Full Analysis button — always visible */}
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

            {/* Loading state */}
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


            <div className="mt-2 flex gap-3 text-[10px] text-white/40">
              {linearTotal > 0 && <span>{num(linearTotal).toFixed(1)} {pixelsPerFoot ? "ft" : "px"}</span>}
              {areaTotal > 0 && <span>{num(areaTotal).toFixed(1)} {pixelsPerFoot ? "sqft" : "px²"}</span>}
              {countTotal > 0 && <span>{countTotal} ct</span>}
              {measurements.length === 0 && !fullAnalysisLoading && <span className="text-white/25">No measurements yet</span>}
            </div>
          </div>

          {/* ---- Blocks + Measurements scrollable area ---- */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {(() => {
              // Build measurement map by block label
              const blockMeasurements = new Map<string, SavedMeasurement[]>();
              const ungrouped: SavedMeasurement[] = [];
              for (const m of measurements) {
                if (m.guideItemLabel) {
                  if (!blockMeasurements.has(m.guideItemLabel)) blockMeasurements.set(m.guideItemLabel, []);
                  blockMeasurements.get(m.guideItemLabel)!.push(m);
                } else {
                  ungrouped.push(m);
                }
              }

              function renderMeasurementRow(m: SavedMeasurement) {
                const isEditing = editingMeasurementId === m.id;
                const displayLabel = getSubLabel(m);
                const isOnPage = m.pageNumber === currentPage;

                return (
                  <div
                    key={m.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragMeasurementId(m.id || null);
                    }}
                    onDragEnd={() => { setDragMeasurementId(null); setDragOverBlock(null); }}
                    className={`group flex items-start gap-1.5 rounded px-2 py-1.5 transition-colors ${
                      isOnPage ? "bg-white/5 hover:bg-white/[0.08]" : "bg-white/[0.02] opacity-50"
                    } ${dragMeasurementId === m.id ? "opacity-40" : ""} cursor-grab active:cursor-grabbing`}
                  >
                    <GripVertical className="h-3 w-3 text-white/15 mt-1 shrink-0 group-hover:text-white/30" />
                    <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: m.color }} />
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editingLabelValue}
                            onChange={(e) => setEditingLabelValue(e.target.value)}
                            placeholder="Name this measurement"
                            className="h-5 text-[10px] bg-white/5 border-white/10 text-white px-1.5"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") confirmInlineLabel(); }}
                          />
                          <button onClick={confirmInlineLabel} className="text-green-400 hover:text-green-300 p-0.5 shrink-0"><Check className="h-2.5 w-2.5" /></button>
                        </div>
                      ) : (
                        <div className="text-[10px] text-white/70 truncate">
                          {displayLabel || m.type}
                          {!isOnPage && <span className="text-white/20"> (p.{m.pageNumber})</span>}
                        </div>
                      )}
                      <div className="text-[9px] text-white/30">
                        {m.type === "count" ? `${m.value} items` : `${num(m.value).toFixed(m.type === "area" ? 1 : 2)} ${m.unit}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!isEditing && (
                        <button onClick={() => { if (m.id) { setEditingMeasurementId(m.id); setEditingLabelValue(getSubLabel(m)); } }} title="Rename" className="text-white/40 hover:text-white/70 p-0.5">
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                      )}
                      <button onClick={() => m.id && deleteMeasurement(m.id)} title="Delete" className="text-red-400/60 hover:text-red-400 p-0.5">
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <>
                  {/* Block cards from AI checklist */}
                  {checklist.map((item, idx) => {
                    const color = GUIDE_COLORS[idx % GUIDE_COLORS.length];
                    const blockEntries = blockMeasurements.get(item.label) || [];
                    const isActive = activeBlock?.label === item.label;
                    const isExpanded = !collapsedGroups.has(item.label);
                    const isDragOver = dragOverBlock === item.label;
                    const blockTotal = blockEntries.reduce((s, e) => s + e.value, 0);
                    const firstEntry = blockEntries[0];
                    const unit = firstEntry?.unit || (item.type === "area" ? "sqft" : item.type === "count" ? "ct" : "ft");

                    return (
                      <div
                        key={item.label}
                        onDragOver={(e) => { e.preventDefault(); setDragOverBlock(item.label); }}
                        onDragLeave={() => setDragOverBlock(null)}
                        onDrop={(e) => { e.preventDefault(); handleDropOnBlock(item.label); }}
                        className={`rounded-lg border transition-all ${
                          isActive
                            ? "border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/30"
                            : isDragOver
                            ? "border-blue-500/60 bg-blue-500/10"
                            : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                        }`}
                      >
                        {/* Block header — click to activate/deactivate */}
                        <button
                          onClick={() => toggleBlock(item)}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                        >
                          <div className="relative shrink-0">
                            {isActive ? (
                              <FolderOpen className="h-4 w-4" style={{ color }} />
                            ) : (
                              <Folder className="h-4 w-4" style={{ color }} />
                            )}
                            {blockEntries.length > 0 && (
                              <span className="absolute -top-1 -right-1.5 text-[8px] font-bold bg-white/10 text-white/60 rounded-full w-3.5 h-3.5 flex items-center justify-center">
                                {blockEntries.length}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-white/90 font-medium truncate">{item.label}</div>
                            <div className="text-[9px] text-white/40">
                              {item.trade} · {item.type}
                              {blockEntries.length > 0 && ` · ${blockTotal.toFixed(item.type === "area" ? 1 : item.type === "count" ? 0 : 2)} ${unit}`}
                            </div>
                          </div>
                          {isActive && (
                            <Badge className="text-[8px] bg-amber-500/20 text-amber-400 border-amber-500/30 px-1.5 py-0">
                              ACTIVE
                            </Badge>
                          )}
                          {blockEntries.length > 0 && (
                            <ChevronRight
                              className={`h-3 w-3 text-white/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              onClick={(e) => { e.stopPropagation(); setCollapsedGroups(prev => { const next = new Set(prev); if (next.has(item.label)) next.delete(item.label); else next.add(item.label); return next; }); }}
                            />
                          )}
                        </button>

                        {/* Measurements inside this block (when expanded) */}
                        {isExpanded && blockEntries.length > 0 && (
                          <div className="px-2 pb-2 space-y-0.5">
                            {blockEntries.map(m => renderMeasurementRow(m))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Unassigned measurements (no block) */}
                  {ungrouped.length > 0 && (
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOverBlock("__unassigned__"); }}
                      onDragLeave={() => setDragOverBlock(null)}
                      onDrop={(e) => { e.preventDefault(); handleDropOnBlock(null); }}
                      className={`rounded-lg border transition-all ${
                        dragOverBlock === "__unassigned__"
                          ? "border-blue-500/60 bg-blue-500/10"
                          : "border-white/5 bg-white/[0.02]"
                      }`}
                    >
                      <div className="px-3 py-2 flex items-center gap-2">
                        <Folder className="h-3.5 w-3.5 text-white/25" />
                        <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider">Unassigned</span>
                        <span className="text-[9px] text-white/20 ml-auto">{ungrouped.length}</span>
                      </div>
                      <div className="px-2 pb-2 space-y-0.5">
                        {ungrouped.map(m => renderMeasurementRow(m))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {checklist.length === 0 && ungrouped.length === 0 && !fullAnalysisLoading && (
                    <div className="text-center py-8 px-4">
                      <Sparkles className="h-8 w-8 text-amber-500/20 mx-auto mb-2" />
                      <p className="text-[11px] text-white/30">
                        Click <strong className="text-amber-400/60">AI Analyze All Pages</strong> to read the drawings and auto-generate measurements
                      </p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* ---- Clear unsaved ---- */}
          {unsavedCount > 0 && (
            <div className="px-3 py-1 border-t border-white/5">
              <button onClick={() => setMeasurements(prev => prev.filter(m => m.saved))} className="text-[10px] text-red-400 hover:text-red-500">
                Clear Unsaved ({unsavedCount})
              </button>
            </div>
          )}

          {/* ---- Toast ---- */}
          {toastMessage && (
            <div className="mx-3 mb-1 px-3 py-1.5 bg-green-600/90 text-white text-xs rounded text-center animate-in fade-in duration-200">
              {toastMessage}
            </div>
          )}

          {/* ---- Save button ---- */}
          {onSave && (
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
          {propProjectId && measurements.length > 0 && (
            <div className="px-3 pb-3">
              <Button
                className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                size="sm"
                disabled={creatingEstimate}
                onClick={async () => {
                  setCreatingEstimate(true);
                  try {
                    // First save measurements
                    if (onSave) {
                      await onSave(measurements, pixelsPerFoot, checklist);
                      setMeasurements(prev => prev.map(m => ({ ...m, saved: true })));
                    }
                    // Call API to convert measurements to line items
                    const res = await fetch("/api/takeoff-to-estimate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId: propProjectId,
                        measurements: measurements.map(m => ({
                          id: m.id,
                          label: m.label,
                          type: m.type,
                          value: m.value,
                          unit: m.unit,
                          guideItemLabel: m.guideItemLabel,
                          pageNumber: m.pageNumber,
                        })),
                        checklist,
                        scopeOfWork,
                      }),
                    });
                    const data = await res.json();
                    if (data.lineItems) {
                      // Store in sessionStorage for the estimate builder to pick up
                      sessionStorage.setItem("takeoff-line-items", JSON.stringify(data.lineItems));
                      sessionStorage.setItem("takeoff-source", filename);
                      // Navigate to estimate page
                      router.push(`/projects/${propProjectId}/estimates?from=takeoff`);
                    } else {
                      setToastMessage(data.error || "Failed to create estimate");
                      setTimeout(() => setToastMessage(null), 3000);
                    }
                  } catch {
                    setToastMessage("Failed to create estimate");
                    setTimeout(() => setToastMessage(null), 3000);
                  } finally {
                    setCreatingEstimate(false);
                  }
                }}
              >
                {creatingEstimate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                {creatingEstimate ? "Generating Estimate..." : "Create Estimate from Takeoff"}
              </Button>
            </div>
          )}

          {/* ---- AI Chat (collapsible at bottom) ---- */}
          <div className="border-t border-white/10 flex flex-col min-h-0" style={{ maxHeight: "40%" }}>
            <button
              onClick={() => setShowAiChat(prev => !prev)}
              className="w-full p-2.5 flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 transition-colors shrink-0"
            >
              <Bot className="h-3.5 w-3.5" />
              <span className="text-[10px]">AI Assistant</span>
              <span className="ml-auto text-[9px] text-white/30">{showAiChat ? "Hide" : "Show"}</span>
            </button>

            {showAiChat && (
              <div className="flex flex-col flex-1 min-h-0 border-t border-white/10">
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[60px]">
                  {aiMessages.length === 0 && (
                    <p className="text-[10px] text-white/30 p-2">Ask AI about this drawing — materials, quantities, pricing.</p>
                  )}
                  {aiMessages.map((msg, i) => (
                    <div key={i} className={`text-[11px] rounded-lg px-2.5 py-2 ${msg.role === "user" ? "bg-white/10 text-white/80 ml-4" : "bg-amber-500/10 text-white/70 mr-4"}`}>
                      {msg.content}
                    </div>
                  ))}
                  {aiLoading && (
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-400/60 px-2">
                      <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                    </div>
                  )}
                </div>
                <div className="p-2 border-t border-white/10 flex gap-1.5 shrink-0">
                  <Input
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    placeholder="Ask about this drawing..."
                    className="h-7 text-xs bg-white/5 border-white/10 text-white flex-1"
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiMessage(); } }}
                  />
                  <Button size="sm" className="h-7 w-7 p-0 bg-amber-600 hover:bg-amber-700" onClick={sendAiMessage} disabled={aiLoading || !aiInput.trim()}>
                    <Send className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
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
                                    {it.quantity != null && it.quantity > 0 ? (
                                      <div className="text-white font-mono font-semibold">
                                        {it.quantity} <span className="text-white/40 text-[10px]">{it.unit || ""}</span>
                                      </div>
                                    ) : (
                                      <div className="text-orange-300 text-[10px] font-semibold uppercase tracking-wider">Needs quote</div>
                                    )}
                                    <div className={`text-[9px] uppercase tracking-wider ${confidenceStyle(it.confidence)}`}>
                                      {it.confidence}
                                    </div>
                                  </div>
                                  <div className="shrink-0 self-center">
                                    {confirmed ? (
                                      <Badge className="text-[9px] bg-green-500/20 text-green-300 border-green-500/30 px-1.5 py-0.5 gap-1">
                                        <Check className="h-3 w-3" /> added
                                      </Badge>
                                    ) : (
                                      <Button
                                        size="sm"
                                        className="h-6 text-[10px] bg-amber-600/80 hover:bg-amber-600 text-white px-2 gap-1"
                                        onClick={() => confirmScopeItem(it, label)}
                                      >
                                        <Plus className="h-3 w-3" />
                                        Add
                                      </Button>
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
