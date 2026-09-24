"use client";

/**
 * The 3D viewport.
 *
 * Loaded only through a dynamic import (see design-studio.tsx). three.js plus
 * drei is a large bundle and this app already has a slow /projects route — none
 * of that weight should be reachable from any page other than this one.
 *
 * Navigation follows SketchUp / 2020 Design conventions rather than a fixed
 * orbit: the model turns around the point you grab, the wheel zooms toward the
 * cursor, and there are Orbit / Pan / Zoom / Walk tools plus standard views.
 * Built on `camera-controls` (already bundled through drei).
 *
 * `preserveDrawingBuffer` is on because the photoreal render step needs to read
 * the canvas back as an image. It costs some GPU memory, which is an acceptable
 * trade for a single-viewport tool.
 */

import {
  forwardRef,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl, Text } from "@react-three/drei";
import * as THREE from "three";
import { Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { type RoomSpec, inToFt, formatFeetInches } from "@/types/design";
import { defaultCamera } from "@/lib/design/geometry";
import { RoomScene } from "./room-scene";

type CameraView = "overview" | "top" | "inside" | "shower" | "rear";
type NavTool = "orbit" | "pan" | "zoom" | "walk";
type StandardView = "iso" | "front" | "back" | "left" | "right" | "top";

const EYE_HEIGHT_FT = 5.5;
const WALK_STEP_FT = 2;
const WALK_TURN_RAD = Math.PI / 12;
const { ACTION } = CameraControlsImpl;

/** Bounds of the model itself: walls, floors, fixtures — no lights or helpers. */
function modelBounds(root: THREE.Object3D | null, room: RoomSpec["room"]): THREE.Box3 {
  const box = new THREE.Box3();
  if (root) box.setFromObject(root);
  if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
    box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(inToFt(room.widthIn), inToFt(room.ceilingHeightIn), inToFt(room.lengthIn)));
  }
  return box;
}

/**
 * Applies the tool's mouse / touch mapping and the section presets to the
 * camera-controls instance, and adds the SketchUp behaviours camera-controls
 * doesn't do by itself: orbit around the grabbed point, double-click to
 * centre, Shift-drag to pan, and keyboard walking.
 */
function Navigation({
  controlsRef,
  sceneRef,
  tool,
  view,
  room,
  building,
  preset,
  standard,
  fitRequest,
}: {
  controlsRef: React.RefObject<CameraControlsImpl | null>;
  sceneRef: React.RefObject<THREE.Group | null>;
  tool: NavTool;
  view: CameraView;
  room: RoomSpec["room"];
  building: boolean;
  /** Bumped whenever a section button is pressed (or Reset). */
  preset: number;
  standard: { view: StandardView; n: number } | null;
  fitRequest: number;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const shiftHeld = useRef(false);
  const lastTool = useRef<NavTool | null>(null);

  // Tool → button mapping.
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const wasWalking = lastTool.current === "walk";
    lastTool.current = tool;

    c.dollyToCursor = true;
    c.infinityDolly = false;
    c.smoothTime = 0.12;
    c.draggingSmoothTime = 0.06;
    c.touches.one = tool === "walk" ? ACTION.TOUCH_ROTATE : tool === "pan" ? ACTION.TOUCH_TRUCK : tool === "zoom" ? ACTION.DOLLY : ACTION.TOUCH_ROTATE;
    c.touches.two = ACTION.TOUCH_DOLLY_TRUCK;
    c.touches.three = ACTION.TOUCH_TRUCK;

    if (tool === "walk") {
      // First person: a tiny fixed orbit radius so drag turns the head, and the
      // camera stays at eye height while walking.
      const pos = new THREE.Vector3();
      c.getPosition(pos, true);
      const tgt = new THREE.Vector3();
      c.getTarget(tgt, true);
      const w = inToFt(room.widthIn), l = inToFt(room.lengthIn);
      const inside = pos.x > 0.5 && pos.x < w - 0.5 && pos.z > 0.5 && pos.z < l - 0.5;
      // Already inside: keep standing where the camera is. Otherwise start on
      // the front walk, facing the house, so the first steps go in the door.
      const start = inside ? pos.clone() : new THREE.Vector3(w * 0.5, 0, l + Math.max(8, l * 0.35));
      start.y = EYE_HEIGHT_FT;
      const dir = inside ? new THREE.Vector3().subVectors(tgt, pos) : new THREE.Vector3(0, 0, -1);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      c.minDistance = c.maxDistance = 1;
      c.minPolarAngle = 0.35;
      c.maxPolarAngle = Math.PI - 0.35;
      // Drag left looks left, drag down looks down (SketchUp Look Around).
      c.azimuthRotateSpeed = 0.35;
      c.polarRotateSpeed = 0.35;
      c.truckSpeed = 4;
      c.mouseButtons.left = ACTION.ROTATE;
      c.mouseButtons.middle = ACTION.ROTATE;
      c.mouseButtons.right = ACTION.TRUCK;
      c.mouseButtons.wheel = ACTION.NONE;
      c.setLookAt(start.x, start.y, start.z, start.x + dir.x, start.y, start.z + dir.z, false);
    } else {
      c.minDistance = 0.5;
      c.maxDistance = Math.max(80, Math.max(room.widthIn, room.lengthIn) / 12 * 10);
      c.minPolarAngle = 0.001;
      // Stop the camera dropping below the floor, which is disorienting.
      c.maxPolarAngle = Math.PI / 2 - 0.02;
      c.azimuthRotateSpeed = 1;
      c.polarRotateSpeed = 1;
      c.truckSpeed = 2;
      c.mouseButtons.left = tool === "pan" ? ACTION.TRUCK : tool === "zoom" ? ACTION.DOLLY : ACTION.ROTATE;
      c.mouseButtons.middle = ACTION.ROTATE; // SketchUp: middle drag orbits
      c.mouseButtons.right = ACTION.TRUCK;
      c.mouseButtons.wheel = ACTION.DOLLY;
      c.dollyDragInverted = true; // drag up = zoom in, like SketchUp
      if (wasWalking) {
        // Step back out of the building so the next orbit has something to see.
        const pos = new THREE.Vector3();
        c.getPosition(pos, true);
        const tgt = new THREE.Vector3();
        c.getTarget(tgt, true);
        const back = new THREE.Vector3().subVectors(pos, tgt).setY(0).normalize();
        if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
        const box = modelBounds(sceneRef.current, room);
        const centre = box.getCenter(new THREE.Vector3());
        const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
        const to = centre.clone().addScaledVector(back, radius * 1.4).setY(radius * 0.9);
        c.setLookAt(to.x, to.y, to.z, centre.x, centre.y, centre.z, true);
      }
    }
    invalidate();
  }, [tool, controlsRef, room, sceneRef, invalidate]);

  // Section presets: the buttons that also change cutaways (Front exterior,
  // First floor, …). These re-frame the model the way the old viewer did.
  useEffect(() => {
    const c = controlsRef.current;
    if (!c || !(camera instanceof THREE.PerspectiveCamera)) return;
    const w = inToFt(room.widthIn), l = inToFt(room.lengthIn), h = inToFt(room.ceilingHeightIn);
    camera.setFocalLength(0.5 * camera.getFilmHeight() / Math.tan(THREE.MathUtils.degToRad((view === "shower" && !building ? 70 : 55) / 2)));
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3(w / 2, view === "top" ? 0 : h * 0.32, l / 2);
    if (building && view === "inside") target.y = Math.min(3, h * 0.15);
    if (building && view === "shower") target.y = h * 0.48;
    const pos = new THREE.Vector3();
    if (view === "shower" && !building) {
      pos.set(w * 0.81, Math.min(5.5, h * 0.7), l * 0.86);
      target.set(w * 0.22, Math.min(3.5, h * 0.45), l * 0.65);
    } else if (view === "inside" && !building) {
      pos.set(w * 0.85, Math.min(5.2, h * 0.7), l * 0.9);
      target.set(w * 0.4, h * 0.4, l * 0.25);
    } else {
      // Fit a bounding sphere using the narrower field of view, including portrait phones.
      const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontal = Math.atan(Math.tan(vertical) * size.width / Math.max(size.height, 1));
      const radius = Math.hypot(w, l, view === "top" ? 0 : h) / 2 + 0.8;
      const distance = radius / Math.sin(Math.min(vertical, horizontal)) * (building ? 0.85 : 1);
      const direction = view === "top" ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(view === "rear" ? -0.85 : 0.85, building ? 0.85 : 1.05, view === "rear" ? -1.25 : 1.25).normalize();
      pos.copy(target).addScaledVector(direction, distance);
    }
    c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, preset > 0);
    invalidate();
  }, [camera, controlsRef, view, room.widthIn, room.lengthIn, room.ceilingHeightIn, size.width, size.height, preset, building, invalidate]);

  // Standard views (Iso / Front / Back / Left / Right / Top) fit the whole model.
  useEffect(() => {
    const c = controlsRef.current;
    if (!c || !standard) return;
    const box = modelBounds(sceneRef.current, room);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const azimuth = { iso: Math.atan2(0.85, 1.25), front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2, top: 0 }[standard.view];
    const polar = standard.view === "top" ? 0.001 : standard.view === "iso" ? THREE.MathUtils.degToRad(55) : THREE.MathUtils.degToRad(80);
    void c.rotateTo(azimuth, polar, true);
    void c.fitToSphere(sphere, true);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standard]);

  // Zoom extents.
  useEffect(() => {
    const c = controlsRef.current;
    if (!c || fitRequest === 0) return;
    void c.fitToSphere(modelBounds(sceneRef.current, room).getBoundingSphere(new THREE.Sphere()), true);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  // Orbit around the grabbed point, double-click to centre, Shift to pan,
  // wheel walks forward in Walk mode.
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const hit = (ev: PointerEvent | MouseEvent): THREE.Vector3 | null => {
      const root = sceneRef.current;
      if (!root) return null;
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(root.children, true).filter(h => h.object.visible && (h.object as THREE.Mesh).isMesh);
      return hits[0]?.point ?? null;
    };

    // Camera offset from the target as it was before the first click of a
    // sequence. A double-click's own grabs re-target onto the clicked point, so
    // centring has to use the framing from before the grab.
    const framing = new THREE.Vector3();
    const onPointerDown = (ev: PointerEvent) => {
      const c = controlsRef.current;
      if (!c || tool === "walk") return;
      if (ev.detail <= 1) {
        const pos = c.getPosition(new THREE.Vector3(), true);
        const tgt = c.getTarget(new THREE.Vector3(), true);
        framing.subVectors(pos, tgt);
      }
      const orbiting = (ev.button === 0 && tool === "orbit" && !shiftHeld.current) || ev.button === 1;
      if (!orbiting) return;
      const p = hit(ev);
      if (p) c.setOrbitPoint(p.x, p.y, p.z);
    };
    const onDblClick = (ev: MouseEvent) => {
      const c = controlsRef.current;
      if (!c || tool === "walk") return;
      const p = hit(ev);
      if (!p) return;
      const to = p.clone().add(framing);
      void c.setLookAt(to.x, to.y, to.z, p.x, p.y, p.z, true);
    };
    const onWheel = (ev: WheelEvent) => {
      const c = controlsRef.current;
      if (!c) return;
      if (tool === "walk") {
        ev.preventDefault();
        void c.forward(-Math.sign(ev.deltaY) * WALK_STEP_FT * 0.5, true);
        return;
      }
      // Runs before camera-controls' own wheel handler (capture phase).
      c.dollyToCursor = hit(ev) !== null;
      const trackpad = ev.deltaMode === 0 && Math.abs(ev.deltaY) < 50;
      c.dollySpeed = trackpad ? 3.5 : 1.2;
    };
    const onKey = (ev: KeyboardEvent) => {
      const c = controlsRef.current;
      if (!c || ev.key !== "Shift" || tool === "walk") return;
      shiftHeld.current = ev.type === "keydown";
      c.mouseButtons.left = shiftHeld.current ? ACTION.TRUCK : tool === "pan" ? ACTION.TRUCK : tool === "zoom" ? ACTION.DOLLY : ACTION.ROTATE;
    };

    el.addEventListener("pointerdown", onPointerDown, { capture: true });
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [gl, camera, controlsRef, sceneRef, tool]);

  return null;
}

export interface RoomViewerHandle {
  /** Restore an interior camera and all enclosing walls before an AI render. */
  prepareRender: () => Promise<void>;
  /** PNG data URL of the current viewport, or null if the canvas isn't ready. */
  capture: () => string | null;
}

/**
 * Exposes the WebGL canvas to the parent.
 *
 * R3F owns the canvas, so a capture has to happen inside the tree: force a
 * synchronous render first, because with the default on-demand loop the buffer
 * may hold a stale frame at the moment the button is clicked.
 */
function CaptureBridge({ innerRef }: { innerRef: React.RefObject<(() => string | null) | null> }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    innerRef.current = () => {
      try {
        gl.render(scene, camera);
        return gl.domElement.toDataURL("image/png");
      } catch {
        return null;
      }
    };
    return () => {
      innerRef.current = null;
    };
  }, [innerRef, gl, scene, camera]);

  return null;
}

/** Room dimension callouts along the floor edges. */
function Dimensions({ spec }: { spec: RoomSpec }) {
  const w = inToFt(spec.room.widthIn);
  const l = inToFt(spec.room.lengthIn);

  const widthPts = useMemo(
    () => [new THREE.Vector3(0, 0.02, l + 0.4), new THREE.Vector3(w, 0.02, l + 0.4)],
    [w, l],
  );
  const lengthPts = useMemo(
    () => [new THREE.Vector3(-0.4, 0.02, 0), new THREE.Vector3(-0.4, 0.02, l)],
    [l],
  );

  return (
    <group>
      <primitive object={makeLine(widthPts)} />
      <primitive object={makeLine(lengthPts)} />
      <Text
        position={[w / 2, 0.05, l + 0.75]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.28}
        color="#b45309"
        anchorX="center"
      >
        {formatFeetInches(spec.room.widthIn)}
      </Text>
      <Text
        position={[-0.75, 0.05, l / 2]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        fontSize={0.28}
        color="#b45309"
        anchorX="center"
      >
        {formatFeetInches(spec.room.lengthIn)}
      </Text>
      <Text
        position={[w + 0.6, inToFt(spec.room.ceilingHeightIn) / 2, l + 0.3]}
        fontSize={0.24}
        color="#b45309"
        anchorX="center"
      >
        {`${formatFeetInches(spec.room.ceilingHeightIn)} clg`}
      </Text>
    </group>
  );
}

function makeLine(points: THREE.Vector3[]): THREE.Line {
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: "#b45309" });
  return new THREE.Line(geom, mat);
}

const TOOLS: { value: NavTool; label: string; key: string; title: string }[] = [
  { value: "orbit", label: "Orbit", key: "O", title: "Orbit (O) — drag to turn the model around the point you grab. Middle drag also orbits." },
  { value: "pan", label: "Pan", key: "H", title: "Pan (H) — drag to slide the view. Shift-drag or right-drag pans in any tool." },
  { value: "zoom", label: "Zoom", key: "Z", title: "Zoom (Z) — drag up/down to zoom. The wheel always zooms toward the cursor." },
  { value: "walk", label: "Walk", key: "W", title: "Walk (W) — first person at eye height. Drag to look, arrows or W/A/S/D to move, wheel to step." },
];

const STANDARD_VIEWS: { value: StandardView; label: string }[] = [
  { value: "iso", label: "Iso" },
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "top", label: "Top" },
];

const chip = (active: boolean) =>
  `min-h-10 shrink-0 rounded-md px-3 text-xs font-medium transition-colors sm:min-h-9 sm:px-2.5 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"}`;

/** A toolbar row: one horizontal scroll strip on phones, wraps on wider screens. */
const strip = "flex items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible";
const stripStyle = { scrollbarWidth: "none" } as const;

export const RoomViewer = forwardRef<RoomViewerHandle, {
  spec: RoomSpec;
  showDimensions?: boolean;
  selectedFixtureId?: string | null;
  onSelectFixture?: (id: string | null) => void;
  className?: string;
}>(function RoomViewer(
  { spec, showDimensions = true, selectedFixtureId, onSelectFixture, className },
  ref,
) {
  const captureFn = useRef<(() => string | null) | null>(null);
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const sceneRef = useRef<THREE.Group | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<CameraView>("overview");
  const [tool, setTool] = useState<NavTool>("orbit");
  const [preset, setPreset] = useState(0);
  const [standard, setStandard] = useState<{ view: StandardView; n: number } | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const building = spec.modelKind === "building";

  // Full screen: the viewer takes the whole window (phone included). Esc
  // leaves, the page behind stops scrolling, and the canvas simply resizes —
  // it is the same element, so nothing remounts and the view is kept.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  useImperativeHandle(ref, () => ({
    capture: () => captureFn.current?.() ?? null,
    prepareRender: async () => {
      setTool("orbit");
      if (!building) setView(spec.fixtures.some(f => f.type === "shower") ? "shower" : "inside");
      setPreset(n => n + 1);
      // Let React restore the complete room and the camera transition settle.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise(resolve => setTimeout(resolve, 700));
    },
  }));

  const cam = useMemo(() => defaultCamera(spec.room), [spec.room]);

  const walk = useCallback((action: "forward" | "back" | "left" | "right" | "turnLeft" | "turnRight" | "up" | "down") => {
    const c = controlsRef.current;
    if (!c) return;
    switch (action) {
      case "forward": void c.forward(WALK_STEP_FT, true); break;
      case "back": void c.forward(-WALK_STEP_FT, true); break;
      case "left": void c.truck(-WALK_STEP_FT * 0.6, 0, true); break;
      case "right": void c.truck(WALK_STEP_FT * 0.6, 0, true); break;
      case "turnLeft": void c.rotate(WALK_TURN_RAD, 0, true); break;
      case "turnRight": void c.rotate(-WALK_TURN_RAD, 0, true); break;
      case "up": void c.elevate(1, true); break;
      case "down": void c.elevate(-1, true); break;
    }
  }, []);

  /** One zoom step in or out: a walker steps forward, an orbiter gets 35% closer. */
  const zoomStep = useCallback((direction: 1 | -1) => {
    const c = controlsRef.current;
    if (!c) return;
    if (tool === "walk") { void c.forward(direction * WALK_STEP_FT, true); return; }
    void c.dollyTo(direction > 0 ? c.distance * 0.65 : c.distance / 0.65, true);
  }, [tool]);

  // Keyboard only while the viewport itself has focus, so the chat box keeps its keys.
  const onKeyDown = useCallback((ev: React.KeyboardEvent<HTMLDivElement>) => {
    const c = controlsRef.current;
    if (!c) return;
    const k = ev.key.toLowerCase();
    if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      if (k === "o") { setTool("orbit"); ev.preventDefault(); return; }
      if (k === "h") { setTool("pan"); ev.preventDefault(); return; }
      if (k === "z") { setTool("zoom"); ev.preventDefault(); return; }
      if (k === "escape" && tool === "walk") { setTool("orbit"); ev.preventDefault(); return; }
      if (k === "f") { setFullscreen(f => !f); ev.preventDefault(); return; }
    }
    if (tool === "walk") {
      const map: Record<string, Parameters<typeof walk>[0]> = {
        arrowup: "forward", w: "forward", arrowdown: "back", s: "back",
        arrowleft: ev.shiftKey ? "left" : "turnLeft", arrowright: ev.shiftKey ? "right" : "turnRight",
        a: "left", d: "right", q: "up", e: "down", pageup: "up", pagedown: "down",
      };
      const a = map[k];
      if (a) { walk(a); ev.preventDefault(); }
      return;
    }
    if (k === "w") { setTool("walk"); ev.preventDefault(); return; }
    const step = Math.PI / 24;
    if (k === "arrowleft") { void c.rotate(-step, 0, true); ev.preventDefault(); }
    else if (k === "arrowright") { void c.rotate(step, 0, true); ev.preventDefault(); }
    else if (k === "arrowup") { void c.rotate(0, -step, true); ev.preventDefault(); }
    else if (k === "arrowdown") { void c.rotate(0, step, true); ev.preventDefault(); }
    else if (k === "+" || k === "=") { zoomStep(1); ev.preventDefault(); }
    else if (k === "-" || k === "_") { zoomStep(-1); ev.preventDefault(); }
  }, [tool, walk, zoomStep]);

  const hint = tool === "walk"
    ? "Drag to look around · Arrows / W A S D to walk · Wheel steps forward · Q/E up and down · Esc to leave"
    : tool === "pan"
      ? "Drag to slide the view · Wheel zooms toward the cursor · Double-click to centre on a point"
      : tool === "zoom"
        ? "Drag up / down to zoom · Wheel zooms toward the cursor · Double-click to centre on a point"
        : "Drag to orbit around the point you grab · Wheel zooms toward the cursor · Right-drag or Shift-drag to pan · Double-click to centre";
  const touchHint = tool === "walk"
    ? "Drag to look around · Use the arrows to walk"
    : tool === "pan"
      ? "One finger slides · Pinch to zoom"
      : tool === "zoom"
        ? "Drag up / down to zoom · Pinch to zoom"
        : "One finger orbits · Pinch to zoom · Two fingers slide";

  const sections = building
    ? ([["overview", "Front exterior"], ["rear", "Rear exterior"], ["inside", "First floor"], ["shower", "Upper floor"], ["top", "Roof plan"]] as const)
    : ([["overview", "Overview"], ["top", "Top view"], ["inside", "Inside"], ["shower", "Shower"]] as const);

  return (
    <div className={fullscreen ? "fixed inset-0 z-[100] flex flex-col bg-background" : `relative flex flex-col ${className ?? ""}`}>
      <div className="flex shrink-0 flex-col gap-1.5 border-b bg-background p-2">
        <div className={strip} style={stripStyle}>
          <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Show</span>
          {sections.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => { setTool("orbit"); setView(value); setPreset(n => n + 1); }} className={chip(view === value)}>{label}</button>
          ))}
          <button type="button" onClick={() => { setTool("orbit"); setPreset(n => n + 1); }} className="ml-auto min-h-10 shrink-0 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground sm:min-h-9 sm:px-2.5">Reset view</button>
          <button
            type="button"
            aria-pressed={fullscreen}
            title={fullscreen ? "Exit full screen (F or Esc)" : "Full screen (F)"}
            onClick={() => setFullscreen(f => !f)}
            className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium sm:min-h-9 sm:px-2.5 ${fullscreen ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"}`}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {fullscreen ? "Exit" : "Full screen"}
          </button>
        </div>
        <div className={strip} style={stripStyle}>
          <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tool</span>
          {TOOLS.map(t => (
            <button key={t.value} type="button" title={t.title} aria-pressed={tool === t.value} onClick={() => { setTool(t.value); viewportRef.current?.focus(); }} className={chip(tool === t.value)}>
              {t.label}<span className="ml-1 hidden text-[10px] opacity-60 sm:inline">{t.key}</span>
            </button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
          <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">View</span>
          {STANDARD_VIEWS.map(v => (
            <button key={v.value} type="button" onClick={() => { if (tool === "walk") setTool("orbit"); setStandard(s => ({ view: v.value, n: (s?.n ?? 0) + 1 })); }} className={chip(false)}>{v.label}</button>
          ))}
          <button type="button" title="Zoom extents — fit the whole model in view" onClick={() => { if (tool === "walk") setTool("orbit"); setFitRequest(n => n + 1); }} className={chip(false)}>Fit</button>
        </div>
      </div>
      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={() => viewportRef.current?.focus({ preventScroll: true })}
        className={`relative min-h-0 flex-1 touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring ${fullscreen ? "" : "min-h-[320px]"} ${tool === "pan" ? "cursor-grab active:cursor-grabbing" : tool === "zoom" ? "cursor-ns-resize" : tool === "walk" ? "cursor-crosshair" : "cursor-move"}`}
      >
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          // Required so the render pass can read the frame back.
          preserveDrawingBuffer: true,
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ position: cam.position, fov: 55, near: 0.1, far: Math.max(200, Math.max(spec.room.widthIn, spec.room.lengthIn) / 12 * 12) }}
        onCreated={() => setReady(true)}
        onPointerMissed={() => onSelectFixture?.(null)}
      >
        <color attach="background" args={["#eef1f4"]} />
        <CaptureBridge innerRef={captureFn} />
        <group ref={sceneRef}>
          <RoomScene
            spec={spec}
            buildingView={view === "inside" ? "first" : view === "shower" ? "upper" : "exterior"}
            cutaway={view === "overview" || view === "top"}
            selectedFixtureId={selectedFixtureId}
            onSelectFixture={(id) => onSelectFixture?.(id)}
          />
        </group>
        {showDimensions && !building && (view === "overview" || view === "top") && <Suspense fallback={null}><Dimensions spec={spec} /></Suspense>}
        <CameraControls ref={controlsRef} makeDefault />
        <Navigation
          controlsRef={controlsRef}
          sceneRef={sceneRef}
          tool={tool}
          view={view}
          room={spec.room}
          building={building}
          preset={preset}
          standard={standard}
          fitRequest={fitRequest}
        />
      </Canvas>
      <button
        type="button"
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        title={fullscreen ? "Exit full screen (Esc)" : "Full screen (F)"}
        onClick={() => setFullscreen(f => !f)}
        className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-background/90 text-foreground shadow-md backdrop-blur hover:bg-background"
      >
        {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
      </button>
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col overflow-hidden rounded-full bg-background/90 shadow-md backdrop-blur">
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomStep(1)} className="grid h-12 w-12 place-items-center text-foreground hover:bg-muted active:bg-primary active:text-primary-foreground">
          <Plus className="h-6 w-6" />
        </button>
        <span className="mx-2 h-px bg-border" aria-hidden />
        <button type="button" aria-label="Zoom out" title="Zoom out (-)" onClick={() => zoomStep(-1)} className="grid h-12 w-12 place-items-center text-foreground hover:bg-muted active:bg-primary active:text-primary-foreground">
          <Minus className="h-6 w-6" />
        </button>
      </div>
      {tool === "walk" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto grid grid-cols-3 gap-1.5 rounded-xl bg-background/85 p-2 shadow backdrop-blur">
            <span />
            <button type="button" aria-label="Walk forward" onClick={() => walk("forward")} className="h-12 w-12 rounded-lg bg-muted text-lg active:bg-primary active:text-primary-foreground">↑</button>
            <span />
            <button type="button" aria-label="Turn left" onClick={() => walk("turnLeft")} className="h-12 w-12 rounded-lg bg-muted text-lg active:bg-primary active:text-primary-foreground">↶</button>
            <button type="button" aria-label="Walk back" onClick={() => walk("back")} className="h-12 w-12 rounded-lg bg-muted text-lg active:bg-primary active:text-primary-foreground">↓</button>
            <button type="button" aria-label="Turn right" onClick={() => walk("turnRight")} className="h-12 w-12 rounded-lg bg-muted text-lg active:bg-primary active:text-primary-foreground">↷</button>
          </div>
        </div>
      )}
      </div>
      <p className="shrink-0 border-t bg-background px-3 py-2 text-[11px] text-muted-foreground"><span className="sm:hidden">{touchHint}</span><span className="hidden sm:inline">{hint}</span>{building ? " · Exterior / floor cutaways" : view === "overview" || view === "top" ? " · Ceiling and front walls hidden" : ""}</p>
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Starting the 3D view…
        </div>
      )}
    </div>
  );
});
