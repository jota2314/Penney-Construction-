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

interface FullAnalysisResult {
  scopeOfWork: string;
  drawingIndex: { page: number; title: string; description: string }[];
  extractedDimensions: {
    label: string;
    value: number;
    unit: string;
    type: string;
    source: string;
    confidence: string;
  }[];
  takeoffItems: {
    label: string;
    type: "linear" | "area" | "count";
    trade: string;
    description: string;
    extractedValue?: number;
    extractedUnit?: string;
    needsManualMeasurement: boolean;
    confidence: string;
    page?: number;
  }[];
  materialNotes: string[];
  scaleInfo: {
    detected: boolean;
    description: string;
    suggestedReference: string;
  };
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

  // ---- Per-item AI measure state -------------------------------------------
  const [measuringItemLabel, setMeasuringItemLabel] = useState<string | null>(null);

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

      // Render each page to base64 JPEG. Cap the long edge so payload stays
      // under Vercel's 4.5 MB body limit even for big sheet sets.
      const MAX_LONG_EDGE = 1600; // px — plenty of resolution for Claude vision to read dimensions
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        setFullAnalysisProgress(`Rendering page ${p} of ${pdfDoc.numPages}...`);
        const page = await pdfDoc.getPage(p);
        const baseViewport = page.getViewport({ scale: 1 });
        const longEdge = Math.max(baseViewport.width, baseViewport.height);
        const scale = Math.min(1.5, MAX_LONG_EDGE / longEdge);
        const viewport = page.getViewport({ scale });
        const offscreen = document.createElement("canvas");
        offscreen.width = viewport.width;
        offscreen.height = viewport.height;
        const ctx = offscreen.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas: offscreen } as any).promise;

        // Convert to base64 JPEG (smaller than PNG)
        const dataUrl = offscreen.toDataURL("image/jpeg", 0.75);
        const base64 = dataUrl.split(",")[1];
        pages.push({ data: base64, mediaType: "image/jpeg", label: `Page ${p}` });
      }

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
      setFullAnalysis(result);
      setShowAnalysisResults(true);

      // Auto-populate checklist from takeoff items
      if (result.takeoffItems?.length) {
        const newChecklist: TakeoffChecklistItem[] = result.takeoffItems.map(item => ({
          label: item.label,
          type: (["linear", "area", "count"].includes(item.type) ? item.type : "linear") as "linear" | "area" | "count",
          trade: item.trade || "",
          description: item.description + (
            item.extractedValue && !item.needsManualMeasurement
              ? ` [AI: ${item.extractedValue} ${item.extractedUnit || ""}]`
              : item.needsManualMeasurement
              ? " [needs manual measurement]"
              : ""
          ),
          done: !!(item.extractedValue && !item.needsManualMeasurement),
        }));
        setChecklist(newChecklist);
        checklistGenerated.current = true;

        // Create measurements for items where AI extracted values
        const aiMeasurements: SavedMeasurement[] = [];
        for (const item of result.takeoffItems) {
          if (item.extractedValue && !item.needsManualMeasurement) {
            const idx = result.takeoffItems.indexOf(item);
            const color = GUIDE_COLORS[idx % GUIDE_COLORS.length];
            aiMeasurements.push({
              id: uid(),
              type: item.type,
              label: buildCompositeLabel(item.label, `AI: ${item.extractedValue} ${item.extractedUnit || item.type === "area" ? "sqft" : item.type === "count" ? "count" : "ft"}`),
              guideItemLabel: item.label,
              points: [], // No drawn points — AI-extracted
              value: item.extractedValue,
              unit: item.extractedUnit || (item.type === "area" ? "sqft" : item.type === "count" ? "count" : "ft"),
              color,
              pageNumber: item.page || 1,
              saved: false,
            });
          }
        }

        if (aiMeasurements.length > 0) {
          setMeasurements(prev => [...prev, ...aiMeasurements]);
        }

        // Save checklist + measurements to DB
        if (propProjectId && propStoragePath && onSave) {
          try {
            await onSave(
              [...measurements, ...aiMeasurements],
              pixelsPerFoot,
              newChecklist,
            );
          } catch { /* ignore save error */ }
        }
      }

      setToastMessage(`AI analyzed ${pages.length} pages — ${result.takeoffItems?.length || 0} items found`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Analysis failed");
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setFullAnalysisLoading(false);
      setFullAnalysisProgress("");
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
  // AI MEASURE ONE ITEM — draw directly on the drawing
  // =========================================================================

  async function measureItemWithAi(item: TakeoffChecklistItem) {
    if (!pdfDoc || measuringItemLabel) return;

    if (!pixelsPerFoot) {
      setToastMessage("Set scale first — click the Scale tool, mark a known dimension, and enter its length.");
      setTool("scale");
      setTimeout(() => setToastMessage(null), 4500);
      return;
    }

    const fullResBmp = pageImages.get(currentPage);
    if (!fullResBmp) {
      setToastMessage("Page still loading — try again in a moment.");
      setTimeout(() => setToastMessage(null), 2500);
      return;
    }

    setMeasuringItemLabel(item.label);
    try {
      // Render the current page to a smaller base64 JPEG for upload
      const page = await pdfDoc.getPage(currentPage);
      const baseViewport = page.getViewport({ scale: 1 });
      const longEdge = Math.max(baseViewport.width, baseViewport.height);
      const MAX_LONG_EDGE = 1800;
      const uploadScale = Math.min(1.5, MAX_LONG_EDGE / longEdge);
      const uploadVp = page.getViewport({ scale: uploadScale });
      const offscreen = document.createElement("canvas");
      offscreen.width = uploadVp.width;
      offscreen.height = uploadVp.height;
      const ctx = offscreen.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: uploadVp, canvas: offscreen } as any).promise;
      const dataUrl = offscreen.toDataURL("image/jpeg", 0.8);
      const base64 = dataUrl.split(",")[1];

      const res = await fetch("/api/takeoff-measure-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageImage: base64,
          pageMediaType: "image/jpeg",
          pageNumber: currentPage,
          pageImageWidth: uploadVp.width,
          pageImageHeight: uploadVp.height,
          item: {
            label: item.label,
            type: item.type,
            trade: item.trade,
            description: item.description,
          },
          pixelsPerFoot,
          projectId: propProjectId,
          scopeOfWork,
          drawingText,
          filename,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "AI measure failed");
      }

      const result = await res.json() as {
        method: "printed" | "polyline" | "polygons" | "counts" | "manual";
        value?: number;
        unit?: string;
        confidence?: string;
        reasoning?: string;
        geometry?: {
          polyline?: { x: number; y: number }[];
          polygons?: { x: number; y: number }[][];
          counts?: { x: number; y: number; label?: string }[];
        };
      };

      // Denormalize from 0-1 → full-resolution PDF image pixels (same space
      // the existing draw loop uses for all measurements).
      const W = fullResBmp.width;
      const H = fullResBmp.height;
      const denorm = (p: { x: number; y: number }) => ({
        x: Math.max(0, Math.min(1, p.x)) * W,
        y: Math.max(0, Math.min(1, p.y)) * H,
      });

      const guideColor = getBlockColor(item.label);
      const newMs: SavedMeasurement[] = [];

      if (result.method === "manual") {
        setToastMessage(
          `AI couldn't see "${item.label}" on this page. ${result.reasoning || "Draw it manually."}`
        );
        setActiveBlock({ label: item.label, color: guideColor });
        if (item.type === "count") { setCountLabel(item.label); setTool("count"); }
        else if (item.type === "area") setTool("area");
        else setTool("measure");
        setTimeout(() => setToastMessage(null), 4500);
        return;
      }

      if (result.method === "printed" && typeof result.value === "number") {
        // Value-only measurement — no drawn geometry. Same pattern as full analysis.
        newMs.push({
          id: uid(),
          type: item.type,
          label: buildCompositeLabel(item.label, `AI (printed): ${result.value} ${result.unit || ""}`),
          guideItemLabel: item.label,
          points: [],
          value: result.value,
          unit: result.unit || (item.type === "area" ? "sqft" : item.type === "count" ? "count" : "ft"),
          color: guideColor,
          pageNumber: currentPage,
          saved: false,
        });
      } else if (result.method === "polyline" && result.geometry?.polyline?.length && result.geometry.polyline.length >= 2) {
        const pts = result.geometry.polyline.map(denorm);
        let totalPx = 0;
        for (let i = 1; i < pts.length; i++) totalPx += dist(pts[i - 1], pts[i]);
        const ft = totalPx / pixelsPerFoot;
        newMs.push({
          id: uid(),
          type: "linear",
          label: buildCompositeLabel(item.label, `AI trace (${result.confidence || "med"})`),
          guideItemLabel: item.label,
          points: pts,
          value: ft,
          unit: "ft",
          color: guideColor,
          pageNumber: currentPage,
          saved: false,
        });
      } else if (result.method === "polygons" && result.geometry?.polygons?.length) {
        result.geometry.polygons.forEach((poly, i) => {
          if (!poly || poly.length < 3) return;
          const pts = poly.map(denorm);
          const areaPx = polygonArea(pts);
          const sqft = areaPx / (pixelsPerFoot * pixelsPerFoot);
          newMs.push({
            id: uid(),
            type: "area",
            label: buildCompositeLabel(item.label, `AI region ${i + 1} (${result.confidence || "med"})`),
            guideItemLabel: item.label,
            points: pts,
            value: sqft,
            unit: "sqft",
            color: guideColor,
            pageNumber: currentPage,
            saved: false,
          });
        });
      } else if (result.method === "counts" && result.geometry?.counts?.length) {
        const pts = result.geometry.counts.map(denorm);
        newMs.push({
          id: uid(),
          type: "count",
          label: buildCompositeLabel(item.label, `AI count (${result.confidence || "med"})`),
          guideItemLabel: item.label,
          points: pts,
          value: pts.length,
          unit: "count",
          color: guideColor,
          pageNumber: currentPage,
          saved: false,
        });
      }

      if (newMs.length === 0) {
        setToastMessage(`AI couldn't measure "${item.label}" — ${result.reasoning || "try manually."}`);
        setTimeout(() => setToastMessage(null), 4500);
        return;
      }

      setMeasurements(prev => [...prev, ...newMs]);
      setChecklist(prev => prev.map(ci =>
        ci.label === item.label ? { ...ci, done: true } : ci
      ));

      const totalText = newMs.length === 1
        ? `${newMs[0].value.toFixed(newMs[0].type === "count" ? 0 : newMs[0].type === "area" ? 1 : 2)} ${newMs[0].unit}`
        : `${newMs.length} measurements`;
      setToastMessage(
        `AI measured "${item.label}": ${totalText}${result.confidence === "low" ? " — low confidence, double-check" : ""}. Drag corners to adjust if needed.`
      );
      setTimeout(() => setToastMessage(null), 5000);
    } catch (err) {
      console.error("measureItemWithAi error:", err);
      setToastMessage(err instanceof Error ? err.message : "AI measure failed. Try again.");
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setMeasuringItemLabel(null);
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
                        <div className="flex items-stretch">
                          <button
                            onClick={() => toggleBlock(item)}
                            className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left min-w-0"
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
                          {/* AI measure button — draws the line directly on the drawing */}
                          <button
                            type="button"
                            disabled={!pdfDoc || measuringItemLabel === item.label}
                            onClick={(e) => { e.stopPropagation(); measureItemWithAi(item); }}
                            title={pixelsPerFoot ? `AI measure ${item.label} on this page` : "Set scale first, then AI can measure"}
                            className={`shrink-0 px-2.5 flex items-center gap-1 border-l border-white/10 transition-colors ${
                              measuringItemLabel === item.label
                                ? "bg-amber-500/20 text-amber-300"
                                : pixelsPerFoot
                                ? "text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-300"
                                : "text-white/30 hover:bg-white/5"
                            } disabled:opacity-40`}
                          >
                            {measuringItemLabel === item.label
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Sparkles className="h-3.5 w-3.5" />
                            }
                            <span className="text-[9px] font-semibold uppercase tracking-wide">AI</span>
                          </button>
                        </div>

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
      {showAnalysisResults && fullAnalysis && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-400" />
                <h2 className="text-sm font-semibold text-white">AI Drawing Analysis</h2>
                <Badge variant="secondary" className="text-[10px] bg-green-500/15 text-green-400 border-green-500/30">
                  {totalPages} pages analyzed
                </Badge>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setShowAnalysisResults(false)} className="text-white/60 hover:text-white">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Scope of Work */}
              {fullAnalysis.scopeOfWork && (
                <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-blue-400" />
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Scope of Work</h3>
                  </div>
                  <p className="text-[12px] text-white/70 leading-relaxed whitespace-pre-wrap">{fullAnalysis.scopeOfWork}</p>
                </div>
              )}

              {/* Drawing Index */}
              {fullAnalysis.drawingIndex?.length > 0 && (
                <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                  <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2">Drawing Index</h3>
                  <div className="space-y-1">
                    {fullAnalysis.drawingIndex.map((d, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <button
                          onClick={() => { setCurrentPage(d.page); setShowAnalysisResults(false); }}
                          className="shrink-0 text-amber-400 hover:text-amber-300 font-mono"
                        >
                          P{d.page}
                        </button>
                        <span className="text-white/70 font-medium">{d.title}</span>
                        <span className="text-white/40">— {d.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scale Info */}
              {fullAnalysis.scaleInfo?.detected && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Scaling className="h-4 w-4 text-blue-400" />
                    <h3 className="text-xs font-semibold text-blue-300">Scale Reference Found</h3>
                  </div>
                  <p className="text-[11px] text-white/60">{fullAnalysis.scaleInfo.description}</p>
                  {fullAnalysis.scaleInfo.suggestedReference && (
                    <p className="text-[11px] text-blue-400 mt-1">
                      Calibration tip: {fullAnalysis.scaleInfo.suggestedReference}
                    </p>
                  )}
                </div>
              )}

              {/* Extracted Dimensions */}
              {fullAnalysis.extractedDimensions?.length > 0 && (
                <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Ruler className="h-4 w-4 text-green-400" />
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                      Extracted Dimensions ({fullAnalysis.extractedDimensions.length})
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {fullAnalysis.extractedDimensions.map((d, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded bg-white/[0.03] text-[11px]">
                        <span className="text-white/70 truncate mr-2">{d.label}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-green-400 font-mono font-medium">{d.value}</span>
                          <span className="text-white/40">{d.unit}</span>
                          {d.confidence !== "high" && (
                            <span title={`${d.confidence} confidence`}><AlertTriangle className="h-3 w-3 text-amber-400/60" /></span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Takeoff Items Summary */}
              {fullAnalysis.takeoffItems?.length > 0 && (
                <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FolderOpen className="h-4 w-4 text-amber-400" />
                    <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                      Takeoff Items ({fullAnalysis.takeoffItems.length})
                    </h3>
                  </div>
                  <div className="space-y-1">
                    {fullAnalysis.takeoffItems.map((item, i) => {
                      const hasValue = item.extractedValue && !item.needsManualMeasurement;
                      return (
                        <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] ${hasValue ? "bg-green-500/5" : "bg-amber-500/5"}`}>
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: GUIDE_COLORS[i % GUIDE_COLORS.length] }} />
                          <span className="text-white/70 flex-1 truncate">{item.label}</span>
                          <Badge variant="secondary" className="text-[9px] bg-white/5 text-white/40 px-1.5">
                            {item.trade}
                          </Badge>
                          {hasValue ? (
                            <span className="text-green-400 font-mono text-[10px] shrink-0">
                              {item.extractedValue} {item.extractedUnit}
                            </span>
                          ) : (
                            <span className="text-amber-400/60 text-[10px] shrink-0 flex items-center gap-0.5">
                              <Ruler className="h-3 w-3" /> measure
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Material Notes */}
              {fullAnalysis.materialNotes?.length > 0 && (
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
            <div className="p-3 border-t border-white/10 flex items-center justify-between shrink-0">
              <p className="text-[10px] text-white/30">
                {fullAnalysis.takeoffItems?.filter(i => i.extractedValue && !i.needsManualMeasurement).length || 0} auto-filled
                {" · "}
                {fullAnalysis.takeoffItems?.filter(i => i.needsManualMeasurement).length || 0} need manual measurement
              </p>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
                onClick={() => setShowAnalysisResults(false)}
              >
                <Check className="h-3.5 w-3.5" />
                Start Measuring
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
