"use client";

/**
 * The design studio: conversation on the left, live 3D on the right.
 *
 * The 3D viewer is behind a dynamic import with ssr:false. three.js and drei are
 * a large bundle and touch `window` at module scope, and none of that weight
 * should be reachable from any other route in an app that already has a slow
 * /projects page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  Loader2,
  ImagePlus,
  Send,
  Camera,
  Ruler,
  Layers,
  AlertTriangle,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatFeetInches, type RoomSpec } from "@/types/design";
import { computeTakeoff } from "@/lib/design/takeoff";
import { saveDesignSpec } from "@/lib/actions/design";
import { PlanEditor, type Selection } from "./plan-editor";
import { PlanPanel } from "./plan-panel";
import { MaterialPanel, type LibraryMaterial } from "./material-panel";
import { ElevationView } from "./elevation-view";
import {
  listLibraryMaterials,
  saveMaterialToLibrary,
  deleteLibraryMaterial,
} from "@/lib/actions/design";
import type { DesignMaterial } from "@/types/design";
import type { DesignTakeoff } from "@/lib/design/takeoff";
import type { DesignDetail } from "@/lib/actions/design";
import type { RoomViewerHandle } from "./room-viewer";

const RoomViewer = dynamic(
  () => import("./room-viewer").then((m) => m.RoomViewer),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full grid place-items-center bg-muted/40 text-sm text-muted-foreground">
        Loading the 3D view…
      </div>
    ),
  },
);

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrls: string[];
  pending?: boolean;
}

interface PendingImage {
  base64: string;
  mediaType: string;
  previewUrl: string;
}

export function DesignStudio({ design }: { design: DesignDetail }) {
  const [spec, setSpec] = useState<RoomSpec>(design.spec);
  const [messages, setMessages] = useState<ChatMessage[]>(
    design.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      imageUrls: m.imageUrls,
    })),
  );

  const [input, setInput] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [renderUrl, setRenderUrl] = useState<string | null>(design.latestRenderUrl);
  const [rendering, setRendering] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [panelTab, setPanelTab] = useState<"build" | "materials">("build");
  const [library, setLibrary] = useState<LibraryMaterial[]>([]);
  const [savingLibrary, setSavingLibrary] = useState(false);

  const viewerRef = useRef<RoomViewerHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tileFileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived, not stored: dragging a tub updates the tile SF in the same frame,
  // and the numbers can never fall out of step with what's drawn.
  const takeoff = useMemo(() => computeTakeoff(spec), [spec]);

  /**
   * Applies a hand edit.
   *
   * `commit` is false during a drag, so the plan re-renders every frame while
   * only the release hits the database. The save is debounced on top of that,
   * so a flurry of nudges collapses into one version rather than one per key.
   */
  const handleSpecChange = useCallback(
    (next: RoomSpec, commit: boolean) => {
      setSpec(next);
      if (!commit) return;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        setError(null);
        try {
          const res = await saveDesignSpec(design.id, next);
          // The server re-clamps geometry, so adopt its verdict rather than
          // leaving the screen showing something it rejected.
          setSpec((cur) => (cur === next ? { ...next, version: res.version } : cur));
          setProblems(res.adjusted);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't save that change.");
        } finally {
          setSaving(false);
        }
      }, 700);
    },
    [design.id],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const rows = await listLibraryMaterials();
      setLibrary(rows as LibraryMaterial[]);
    } catch {
      // A missing library is not worth interrupting the design for.
    }
  }, []);

  useEffect(() => {
    if (panelTab === "materials" && library.length === 0) void refreshLibrary();
  }, [panelTab, library.length, refreshLibrary]);

  const handleSaveToLibrary = useCallback(
    async (m: DesignMaterial) => {
      setSavingLibrary(true);
      try {
        await saveMaterialToLibrary(m);
        await refreshLibrary();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save that material.");
      } finally {
        setSavingLibrary(false);
      }
    },
    [refreshLibrary],
  );

  const handleDeleteFromLibrary = useCallback(
    async (libraryId: string) => {
      setLibrary((cur) => cur.filter((m) => m.libraryId !== libraryId));
      try {
        await deleteLibraryMaterial(libraryId);
      } catch {
        void refreshLibrary();
      }
    },
    [refreshLibrary],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── Image intake ───────────────────────────────────────────────────────────

  const readFiles = useCallback(async (files: FileList | null): Promise<PendingImage[]> => {
    if (!files?.length) return [];
    const out: PendingImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const base64 = await fileToBase64(file);
      out.push({
        base64,
        mediaType: file.type,
        previewUrl: URL.createObjectURL(file),
      });
    }
    return out;
  }, []);

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = await readFiles(e.target.files);
    e.target.value = "";
    setImages((prev) => [...prev, ...picked]);
  }

  // ── Conversation ───────────────────────────────────────────────────────────

  async function send() {
    if (busy) return;
    if (!input.trim() && images.length === 0) return;

    const text = input.trim();
    const attached = images;

    setInput("");
    setImages([]);
    setError(null);
    setBusy(true);

    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "user",
        content: text,
        imageUrls: attached.map((i) => i.previewUrl),
      },
      { id: `${tempId}-a`, role: "assistant", content: "", imageUrls: [], pending: true },
    ]);

    try {
      const res = await fetch("/api/design/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designId: design.id,
          message: text,
          images: attached.map(({ base64, mediaType }) => ({ base64, mediaType })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "That didn't go through.");

      setSpec(data.spec);
      setProblems(data.problems ?? []);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `${tempId}-a`
            ? { ...m, content: data.assistantText, pending: false }
            : m,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== `${tempId}-a`));
    } finally {
      setBusy(false);
    }
  }

  // ── Tile upload ────────────────────────────────────────────────────────────

  async function onPickTile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/design/material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designId: design.id, base64, mediaType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't read that tile.");

      setSpec(data.spec);
      setMessages((prev) => [
        ...prev,
        {
          id: `mat-${Date.now()}`,
          role: "assistant",
          content: data.sizeKnown
            ? `Added ${data.report?.name}. Tell me where you want it.`
            : `Added ${data.report?.name}. I couldn't tell the size from that photo (${data.sizeReasoning ?? "no scale reference"}). Give me the real size and I'll fix it before it drives any quantity.`,
          imageUrls: [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that tile.");
    } finally {
      setBusy(false);
    }
  }

  // ── Photoreal render ───────────────────────────────────────────────────────

  async function renderPhotoreal() {
    if (rendering) return;
    const capture = viewerRef.current?.capture();
    if (!capture) {
      setError("The 3D view isn't ready yet.");
      return;
    }

    setRendering(true);
    setError(null);
    try {
      const res = await fetch("/api/design/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designId: design.id, viewportBase64: capture }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || "The render failed.");
      setRenderUrl(data.renderUrl);
      if (data.warning) setError(data.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The render failed.");
    } finally {
      setRendering(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)] gap-3 p-3">
      {/* Conversation */}
      <div className="flex flex-col w-full lg:w-[380px] xl:w-[440px] shrink-0 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
          {messages.length === 0 && (
            <Card className="p-4 text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">Send me the room.</p>
              <p>
                A photo, a sketch with measurements, or just the numbers. I&apos;ll build it in 3D
                and we go from there.
              </p>
              <p>
                Tile photos go in through the tile button — I read the size and colour off the
                photo and apply it at real scale.
              </p>
            </Card>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[92%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm"
                  : "mr-auto max-w-[92%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
              }
            >
              {m.imageUrls.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {m.imageUrls.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt="Reference"
                      className="h-20 w-20 rounded object-cover"
                    />
                  ))}
                </div>
              )}
              {m.pending ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Working on the model…
                </span>
              ) : (
                m.content
              )}
            </div>
          ))}

          {problems.length > 0 && (
            <Card className="p-3 border-amber-500/50 bg-amber-500/5">
              <div className="flex items-center gap-2 text-amber-600 text-xs font-medium mb-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Adjusted to fit
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Card>
          )}

          {error && (
            <Card className="p-3 border-destructive/50 bg-destructive/5 text-xs text-destructive">
              {error}
            </Card>
          )}
        </div>

        {/* Composer */}
        <div className="pt-2 space-y-2">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.previewUrl} alt="" className="h-14 w-14 rounded object-cover" />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 rounded-full bg-background border p-0.5"
                    aria-label="Remove image"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="5 by 8, tub on the back wall, niche over the valve…"
            className="min-h-[72px] resize-none"
            disabled={busy}
          />

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onPickImages}
            />
            <input
              ref={tileFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onPickTile}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              title="Room photo or sketch"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => tileFileRef.current?.click()}
              disabled={busy}
              title="Tile photo"
            >
              <Layers className="h-4 w-4" />
              <span className="ml-1 text-xs">Tile</span>
            </Button>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              onClick={() => void send()}
              disabled={busy || (!input.trim() && images.length === 0)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Model + render */}
      <div className="flex-1 min-w-0 min-h-0">
        {/* Plan first: it's the editing surface, the 3D is the check. */}
        <Tabs defaultValue="plan" className="h-full flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            <TabsList>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="elevations">Elevations</TabsTrigger>
              <TabsTrigger value="model">3D model</TabsTrigger>
              <TabsTrigger value="render">Render</TabsTrigger>
              <TabsTrigger value="takeoff">Quantities</TabsTrigger>
            </TabsList>

            <Badge variant="secondary" className="ml-auto text-xs">
              {saving ? "Saving…" : `v${spec.version}`}
            </Badge>
            <Badge variant="outline" className="text-xs gap-1">
              <Ruler className="h-3 w-3" />
              {formatFeetInches(spec.room.widthIn)} x {formatFeetInches(spec.room.lengthIn)}
            </Badge>

            <Button size="sm" onClick={() => void renderPhotoreal()} disabled={rendering}>
              {rendering ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Rendering…
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4 mr-1" />
                  Render photoreal
                </>
              )}
            </Button>
          </div>

          <TabsContent value="plan" className="flex-1 min-h-0 mt-2">
            <div className="h-full flex flex-col lg:flex-row gap-3 min-h-0">
              <div className="flex-1 min-w-0 min-h-[320px] rounded-lg border overflow-hidden bg-background">
                <PlanEditor
                  spec={spec}
                  onSpecChange={handleSpecChange}
                  selection={selection}
                  onSelectionChange={setSelection}
                  className="h-full w-full"
                />
              </div>
              <div className="w-full lg:w-72 shrink-0 overflow-y-auto">
                <div className="flex gap-1 mb-2 sticky top-0 bg-background z-10 pb-1">
                  {(["build", "materials"] as const).map((tab) => (
                    <Button
                      key={tab}
                      size="sm"
                      variant={panelTab === tab ? "default" : "outline"}
                      className="h-7 text-[11px] flex-1 capitalize"
                      onClick={() => setPanelTab(tab)}
                    >
                      {tab}
                    </Button>
                  ))}
                </div>

                {panelTab === "build" ? (
                  <PlanPanel
                    spec={spec}
                    onSpecChange={handleSpecChange}
                    selection={selection}
                    onSelectionChange={setSelection}
                  />
                ) : (
                  <MaterialPanel
                    spec={spec}
                    onSpecChange={handleSpecChange}
                    library={library}
                    onSaveToLibrary={handleSaveToLibrary}
                    onDeleteFromLibrary={handleDeleteFromLibrary}
                    savingLibrary={savingLibrary}
                  />
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="elevations" className="flex-1 min-h-0 mt-2 overflow-y-auto">
            <ElevationView spec={spec} />
          </TabsContent>

          <TabsContent value="model" className="flex-1 min-h-0 mt-2">
            <div className="relative h-full w-full rounded-lg overflow-hidden border">
              <RoomViewer
                ref={viewerRef}
                spec={spec}
                className="h-full w-full"
                selectedFixtureId={selection?.kind === "fixture" ? selection.id : null}
                onSelectFixture={(id) => setSelection(id ? { kind: "fixture", id } : null)}
              />
              {spec.assumptions && spec.assumptions.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2 rounded-md bg-background/90 backdrop-blur border border-amber-500/40 p-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 mb-0.5">
                    <AlertTriangle className="h-3 w-3" />
                    Assumed, not measured
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5">
                    {spec.assumptions.slice(-3).map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="render" className="flex-1 min-h-0 mt-2">
            <div className="h-full w-full rounded-lg border grid place-items-center bg-muted/30 overflow-auto">
              {renderUrl ? (
                <Image
                  src={renderUrl}
                  alt="Photoreal render"
                  width={1536}
                  height={1024}
                  unoptimized
                  className="max-h-full w-auto object-contain"
                />
              ) : (
                <div className="text-center text-sm text-muted-foreground p-8 max-w-md space-y-2">
                  <Sparkles className="h-6 w-6 mx-auto opacity-60" />
                  <p className="font-medium text-foreground">No render yet</p>
                  <p>
                    Get the model right first, point the camera where you want it, then hit
                    Render photoreal. The render is built from that exact view, so it shows the
                    room you actually modelled.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="takeoff" className="flex-1 min-h-0 mt-2 overflow-y-auto">
            <TakeoffPanel takeoff={takeoff} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── Quantities ───────────────────────────────────────────────────────────────

function TakeoffPanel({ takeoff }: { takeoff: DesignTakeoff }) {
  return (
    <div className="space-y-3">
      <Card className="p-3">
        <p className="text-xs text-muted-foreground mb-2">
          Measured off the 3D model. Concept-stage only — nothing here writes to a job.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Floor" value={`${takeoff.floorAreaSf} SF`} />
          <Stat label="Perimeter" value={`${takeoff.perimeterLf} LF`} />
          <Stat label="Paint" value={`${takeoff.paintSf} SF`} />
          <Stat label="Edge trim" value={`${takeoff.edgeTrimLf} LF`} />
        </div>
      </Card>

      {takeoff.tile.map((t) => (
        <Card key={t.materialId} className="p-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="font-medium text-sm">{t.materialName}</span>
            <span className="text-sm">
              <strong>{t.orderSf} SF</strong>{" "}
              <span className="text-muted-foreground">
                to order ({t.netSf} net + {Math.round(t.wastePct * 100)}% waste
                {t.pieces ? `, ${t.pieces} pcs` : ""})
              </span>
            </span>
          </div>
          <ul className="mt-2 text-xs text-muted-foreground grid sm:grid-cols-2 gap-x-4">
            {t.breakdown.map((b, i) => (
              <li key={i} className="flex justify-between border-b border-dashed py-0.5">
                <span>{b.label}</span>
                <span>{b.sf} SF</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {takeoff.fixtureCounts.length > 0 && (
        <Card className="p-3">
          <p className="font-medium text-sm mb-2">Fixtures</p>
          <div className="flex flex-wrap gap-2">
            {takeoff.fixtureCounts.map((f) => (
              <Badge key={f.type} variant="secondary">
                {f.count} x {f.label}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {takeoff.warnings.length > 0 && (
        <Card className="p-3 border-amber-500/50 bg-amber-500/5">
          <div className="flex items-center gap-2 text-amber-600 text-xs font-medium mb-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Check these
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            {takeoff.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

// ── utils ────────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
