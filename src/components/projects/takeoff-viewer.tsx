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
} from "lucide-react";

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

  // ---- Touch state ---------------------------------------------------------
  const touchStartDist = useRef(0);
  const touchStartScale = useRef(1);
  const touchStartCenter = useRef({ x: 0, y: 0 });
  const touchStartOffset = useRef({ x: 0, y: 0 });

  // ---- Derived: count unsaved measurements ---------------------------------
  const unsavedCount = measurements.filter(m => !m.saved).length;

  // ---- Auto-generate takeoff checklist from drawing text -------------------
  useEffect(() => {
    if (!drawingText || checklistGenerated.current || checklist.length > 0) return;
    checklistGenerated.current = true;
    generateChecklist();
  }, [drawingText]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generateChecklist() {
    setChecklistLoading(true);
    try {
      const res = await fetch("/api/takeoff-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawingText, scopeOfWork, filename }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (data.checklist && Array.isArray(data.checklist)) {
        const items = data.checklist.map((item: { label: string; type: string; trade: string; description: string }) => ({
          ...item,
          type: (["linear", "area", "count"].includes(item.type) ? item.type : "linear") as "linear" | "area" | "count",
          done: false,
        }));
        setChecklist(items);
        // Save checklist to DB immediately
        if (propProjectId && propStoragePath) {
          try {
            await fetch("/api/save-takeoff", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: propProjectId,
                storagePath: propStoragePath,
                measurements: [],
                checklist: items,
              }),
            });
          } catch { /* ignore */ }
        }
      }
    } catch {
      // Checklist generation failed — not critical
    } finally {
      setChecklistLoading(false);
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
          pendingChecklistLabel.current = null;
          pendingChecklistColor.current = null;
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
  // CHECKLIST → START MEASUREMENT
  // =========================================================================

  const pendingChecklistLabel = useRef<string | null>(null);
  const pendingChecklistColor = useRef<string | null>(null);

  function startFromChecklist(item: TakeoffChecklistItem) {
    if (item.type === "count") {
      setCountLabel(item.label);
      setTool("count");
    } else if (item.type === "area") {
      setTool("area");
    } else {
      setTool("measure");
    }
    // Pre-fill the label for the next measurement
    pendingChecklistLabel.current = item.label;
    // Assign color based on checklist item index
    const idx = checklist.findIndex(ci => ci.label === item.label);
    pendingChecklistColor.current = idx >= 0 ? GUIDE_COLORS[idx % GUIDE_COLORS.length] : GREEN;
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
        <div className="w-64 bg-[#1a1a1a] border-l border-white/10 flex flex-col shrink-0 overflow-hidden">
          <div className="p-3 border-b border-white/10">
            <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              Measurements
            </h3>
            {/* Totals */}
            <div className="mt-2 space-y-1 text-[10px] text-white/40">
              {linearTotal > 0 && (
                <div className="flex justify-between">
                  <span>Total Linear</span>
                  <span className="text-white/70">
                    {num(linearTotal).toFixed(2)}{" "}
                    {pixelsPerFoot ? "ft" : "px"}
                  </span>
                </div>
              )}
              {areaTotal > 0 && (
                <div className="flex justify-between">
                  <span>Total Area</span>
                  <span className="text-white/70">
                    {num(areaTotal).toFixed(1)}{" "}
                    {pixelsPerFoot ? "sqft" : "px\u00B2"}
                  </span>
                </div>
              )}
              {countTotal > 0 && (
                <div className="flex justify-between">
                  <span>Total Count</span>
                  <span className="text-white/70">{countTotal}</span>
                </div>
              )}
              {measurements.length === 0 && (
                <span className="text-white/30">No measurements yet</span>
              )}
            </div>
          </div>

          {/* Clear Unsaved button */}
          {unsavedCount > 0 && (
            <div className="px-3 pt-1">
              <button
                onClick={() => setMeasurements(prev => prev.filter(m => m.saved))}
                className="text-xs text-red-400 hover:text-red-500 transition-colors"
              >
                Clear Unsaved ({unsavedCount})
              </button>
            </div>
          )}

          {/* Measurement list — grouped + ungrouped */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {(() => {
              // Compute groups
              const grouped = new Map<string, SavedMeasurement[]>();
              const ungrouped: SavedMeasurement[] = [];
              for (const m of pageMeasurements) {
                if (m.guideItemLabel) {
                  if (!grouped.has(m.guideItemLabel)) grouped.set(m.guideItemLabel, []);
                  grouped.get(m.guideItemLabel)!.push(m);
                } else {
                  ungrouped.push(m);
                }
              }

              function toggleGroup(label: string) {
                setCollapsedGroups(prev => {
                  const next = new Set(prev);
                  if (next.has(label)) next.delete(label);
                  else next.add(label);
                  return next;
                });
              }

              /** Render a single child measurement row (used in both grouped + ungrouped) */
              function renderChildRow(m: SavedMeasurement, indented: boolean) {
                const isEditing = editingMeasurementId === m.id;
                const matchingType = m.type === "linear" ? "linear" : m.type === "area" ? "area" : "count";
                const undoneChecklistSuggestions = !m.guideItemLabel ? checklist.filter(
                  item => !item.done && item.type === matchingType
                ) : [];
                const displayLabel = getSubLabel(m);

                return (
                  <div
                    key={m.id}
                    className={`group bg-white/5 rounded-md px-2.5 py-2 ${indented ? "" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Color dot + unsaved indicator */}
                      <div className="flex items-center gap-1 mt-1.5 shrink-0">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: m.color }}
                        />
                        {!m.saved && (
                          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" title="Unsaved" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editingLabelValue}
                              onChange={(e) => setEditingLabelValue(e.target.value)}
                              placeholder="Name this measurement"
                              className="h-6 text-[11px] bg-white/5 border-white/10 text-white px-1.5"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmInlineLabel();
                                if (e.key === "Escape") confirmInlineLabel();
                              }}
                            />
                            <button
                              onClick={confirmInlineLabel}
                              className="text-green-400 hover:text-green-300 p-0.5 shrink-0"
                              title="Confirm name"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="text-[11px] text-white/80 truncate">
                            {displayLabel || m.type}
                          </div>
                        )}
                        <div className="text-[10px] text-white/40">
                          {m.type === "count"
                            ? `${m.value} items`
                            : `${num(m.value).toFixed(m.type === "area" ? 1 : 2)} ${m.unit}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {!isEditing && (
                          <button
                            onClick={() => {
                              if (m.id) {
                                setEditingMeasurementId(m.id);
                                setEditingLabelValue(getSubLabel(m));
                              }
                            }}
                            title="Rename"
                            className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white/70 transition-opacity p-0.5"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={() => m.id && deleteMeasurement(m.id)}
                          title="Delete measurement"
                          className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-opacity p-0.5"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    {/* Checklist suggestions when editing an ungrouped measurement */}
                    {isEditing && undoneChecklistSuggestions.length > 0 && (
                      <div className="mt-1 ml-5 space-y-0.5">
                        <span className="text-[9px] text-white/30">Suggestions:</span>
                        {undoneChecklistSuggestions.map((item, si) => (
                          <button
                            key={si}
                            onClick={() => {
                              setEditingLabelValue(item.label);
                              // Also auto-confirm
                              setMeasurements(prev => prev.map(ms =>
                                ms.id === editingMeasurementId ? { ...ms, label: item.label } : ms
                              ));
                              setChecklist(prev => prev.map(ci =>
                                ci.label.toLowerCase() === item.label.toLowerCase() ? { ...ci, done: true } : ci
                              ));
                              setEditingMeasurementId(null);
                              setEditingLabelValue("");
                            }}
                            className="block w-full text-left text-[10px] text-amber-400/80 hover:text-amber-300 hover:bg-white/5 rounded px-1.5 py-0.5 truncate"
                          >
                            {item.label} <span className="text-white/20">({item.trade})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <>
                  {/* Grouped measurements */}
                  {Array.from(grouped.entries()).map(([groupLabel, entries]) => {
                    const isCollapsed = collapsedGroups.has(groupLabel);
                    const groupColor = entries[0]?.color || GREEN;
                    const groupTotal = entries.reduce((s, e) => s + e.value, 0);
                    const firstEntry = entries[0];
                    const unit = firstEntry?.unit || "";
                    const isAreaType = firstEntry?.type === "area";
                    // Find matching checklist item to allow adding more measurements
                    const matchingChecklistItem = checklist.find(ci => ci.label === groupLabel);

                    return (
                      <div key={groupLabel} className="space-y-0.5">
                        {/* Parent row */}
                        <button
                          onClick={() => toggleGroup(groupLabel)}
                          className="w-full flex items-center gap-2 bg-white/[0.07] rounded-md px-2.5 py-2 hover:bg-white/10 text-left"
                        >
                          <ChevronRight className={`h-3 w-3 text-white/40 transition-transform ${!isCollapsed ? "rotate-90" : ""}`} />
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: groupColor }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-white/90 font-medium truncate">{groupLabel}</div>
                            <div className="text-[10px] text-white/40">
                              {groupTotal.toFixed(isAreaType ? 1 : 2)} {unit} · {entries.length} {entries.length === 1 ? "entry" : "entries"}
                            </div>
                          </div>
                        </button>
                        {/* Children (when expanded) */}
                        {!isCollapsed && (
                          <div className="ml-5 space-y-0.5">
                            {entries.map(m => renderChildRow(m, true))}
                            {/* + Add button */}
                            {matchingChecklistItem && (
                              <button
                                onClick={() => startFromChecklist(matchingChecklistItem)}
                                className="text-[10px] text-amber-400/60 hover:text-amber-400 px-2 py-1 flex items-center gap-1"
                              >
                                <Plus className="h-3 w-3" /> Add measurement
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Ungrouped measurements */}
                  {ungrouped.map(m => renderChildRow(m, false))}
                </>
              );
            })()}

            {/* Measurements from other pages */}
            {measurements.filter((m) => m.pageNumber !== currentPage).length >
              0 && (
              <div className="pt-2 mt-2 border-t border-white/5">
                <span className="text-[9px] text-white/20 uppercase tracking-wider">
                  Other Pages
                </span>
                {measurements
                  .filter((m) => m.pageNumber !== currentPage)
                  .map((m) => (
                    <div
                      key={m.id}
                      className="group bg-white/[0.02] rounded-md px-2.5 py-1.5 mt-1"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex items-center gap-1 mt-1 shrink-0">
                          <div
                            className="w-2 h-2 rounded-full opacity-50"
                            style={{ backgroundColor: m.color }}
                          />
                          {!m.saved && (
                            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" title="Unsaved" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-white/40 truncate">
                            {getSubLabel(m) || m.type}{" "}
                            {m.guideItemLabel && (
                              <span className="text-white/20">
                                ({m.guideItemLabel})
                              </span>
                            )}
                            <span className="text-white/20">
                              {" "}(p.{m.pageNumber})
                            </span>
                          </div>
                          <div className="text-[9px] text-white/25">
                            {m.type === "count"
                              ? `${m.value} items`
                              : `${num(m.value).toFixed(m.type === "area" ? 1 : 2)} ${m.unit}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => {
                              if (m.id) {
                                setEditingMeasurementId(m.id);
                                setEditingLabelValue(getSubLabel(m));
                              }
                            }}
                            title="Rename"
                            className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white/70 transition-opacity p-0.5"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => m.id && deleteMeasurement(m.id)}
                            title="Delete measurement"
                            className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-opacity p-0.5"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Toast notification */}
          {toastMessage && (
            <div className="mx-3 mb-1 px-3 py-1.5 bg-green-600/90 text-white text-xs rounded text-center animate-in fade-in duration-200">
              {toastMessage}
            </div>
          )}

          {/* Save button */}
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
                    // Mark all measurements as saved
                    setMeasurements(prev => prev.map(m => ({ ...m, saved: true })));
                    setSaveStatus("saved");
                    // Show toast
                    setToastMessage(`${measurements.length} measurement${measurements.length === 1 ? "" : "s"} saved \u2713`);
                    setTimeout(() => setToastMessage(null), 2000);
                    setTimeout(() => setSaveStatus("idle"), 2000);
                  } catch {
                    setSaveStatus("idle");
                  }
                }}
              >
                {saveStatus === "saving" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : saveStatus === "saved" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "saved"
                  ? "Saved \u2713"
                  : `Save (${measurements.length})`}
              </Button>
            </div>
          )}

          {/* AI Takeoff Guide */}
          <div className="border-t border-white/10 flex flex-col min-h-0" style={{ maxHeight: "50%" }}>
            <button
              onClick={() => setShowAiChat(prev => !prev)}
              className="w-full p-3 flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 transition-colors shrink-0"
            >
              <Bot className="h-3.5 w-3.5" />
              AI Takeoff Guide
              {checklist.length > 0 && (
                <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-400">
                  {checklist.filter(i => i.done).length}/{checklist.length}
                </Badge>
              )}
              <span className="ml-auto text-[9px] text-white/30">{showAiChat ? "Hide" : "Show"}</span>
            </button>

            {showAiChat && (
              <div className="flex flex-col flex-1 min-h-0 border-t border-white/10">
                {/* Checklist */}
                {(checklist.length > 0 || checklistLoading) && (
                  <div className="overflow-y-auto p-2 space-y-1 border-b border-white/10" style={{ maxHeight: 200 }}>
                    <p className="text-[9px] text-white/30 uppercase tracking-wider px-1 mb-1">What to measure</p>
                    {checklistLoading && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-400/60 px-2 py-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Analyzing drawing...
                      </div>
                    )}
                    {!checklistLoading && checklist.length === 0 && drawingText && (
                      <Button
                        size="sm"
                        className="w-full text-xs bg-amber-600 hover:bg-amber-700 gap-1.5"
                        onClick={generateChecklist}
                      >
                        <Bot className="h-3 w-3" /> Analyze Drawing
                      </Button>
                    )}
                    {!checklistLoading && checklist.length === 0 && !drawingText && (
                      <p className="text-[10px] text-white/30 px-2">No drawing text available. Use OCR on the Files tab first.</p>
                    )}
                    {checklist.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => !item.done && startFromChecklist(item)}
                        className={`w-full text-left rounded-md px-2.5 py-2 flex items-start gap-2 transition-colors ${
                          item.done
                            ? "bg-green-500/10 opacity-60"
                            : "bg-white/5 hover:bg-amber-500/10 cursor-pointer"
                        }`}
                      >
                        <div className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          item.done ? "bg-green-500 border-green-500" : "border-white/20"
                        }`}>
                          {item.done && <span className="text-[8px] text-white">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-white/80 truncate">{item.label}</div>
                          <div className="text-[9px] text-white/40">
                            {item.trade} · {item.type === "count" ? "count" : item.type === "area" ? "area (sqft)" : "linear (ft)"}
                          </div>
                          {item.description && (
                            <div className="text-[9px] text-white/25 truncate">{item.description}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px]">
                  {aiMessages.length === 0 && checklist.length === 0 && !checklistLoading && (
                    <p className="text-[10px] text-white/30 p-2">
                      Ask AI about this drawing — materials, quantities, pricing.
                    </p>
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

                {/* Chat input */}
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
    </div>
  );
}
