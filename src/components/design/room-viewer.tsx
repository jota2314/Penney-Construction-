"use client";

/**
 * The 3D viewport.
 *
 * Loaded only through a dynamic import (see design-studio.tsx). three.js plus
 * drei is a large bundle and this app already has a slow /projects route — none
 * of that weight should be reachable from any page other than this one.
 *
 * `preserveDrawingBuffer` is on because the photoreal render step needs to read
 * the canvas back as an image. It costs some GPU memory, which is an acceptable
 * trade for a single-viewport tool.
 */

import {
  forwardRef,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { type RoomSpec, inToFt, formatFeetInches } from "@/types/design";
import { defaultCamera } from "@/lib/design/geometry";
import { RoomScene } from "./room-scene";

type CameraView = "overview" | "top" | "inside" | "shower";

function ViewCamera({ view, room, reset }: { view: CameraView; room: RoomSpec["room"]; reset: number }) {
  const { camera, controls, size, invalidate } = useThree();
  useEffect(() => {
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!orbit || !(camera instanceof THREE.PerspectiveCamera)) return;
    const w = inToFt(room.widthIn), l = inToFt(room.lengthIn), h = inToFt(room.ceilingHeightIn);
    camera.setFocalLength(0.5 * camera.getFilmHeight() / Math.tan(THREE.MathUtils.degToRad((view === 'shower' ? 70 : 55) / 2)));
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3(w / 2, view === "top" ? 0 : h * 0.32, l / 2);
    if (view === "shower") {
      camera.position.set(w * 0.81, Math.min(5.5, h * 0.7), l * 0.86);
      target.set(w * 0.22, Math.min(3.5, h * 0.45), l * 0.65);
    } else if (view === "inside") {
      camera.position.set(w * 0.85, Math.min(5.2, h * 0.7), l * 0.9);
      target.set(w * 0.4, h * 0.4, l * 0.25);
    } else {
      // Fit a bounding sphere using the narrower field of view, including portrait phones.
      const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontal = Math.atan(Math.tan(vertical) * size.width / Math.max(size.height, 1));
      const radius = Math.hypot(w, l, view === "top" ? 0 : h) / 2 + 0.8;
      const distance = radius / Math.sin(Math.min(vertical, horizontal));
      const direction = view === "top" ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(0.85, 1.05, 1.25).normalize();
      camera.position.copy(target).addScaledVector(direction, distance);
    }
    orbit.target.copy(target);
    orbit.update();
    invalidate();
  }, [camera, controls, view, room.widthIn, room.lengthIn, room.ceilingHeightIn, size.width, size.height, reset, invalidate]);
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
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<CameraView>("overview");
  const [reset, setReset] = useState(0);

  useImperativeHandle(ref, () => ({
    capture: () => captureFn.current?.() ?? null,
    prepareRender: async () => {
      setView(spec.fixtures.some(f => f.type === 'shower') ? 'shower' : 'inside');
      setReset(n => n + 1);
      // Let React restore the complete room and the camera effect settle.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise(resolve => setTimeout(resolve, 500));
    },
  }));

  const cam = useMemo(() => defaultCamera(spec.room), [spec.room]);

  return (
    <div className={`relative flex flex-col ${className ?? ""}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-background p-2">
        {([['overview', 'Overview'], ['top', 'Top view'], ['inside', 'Inside'], ['shower', 'Shower']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value); setReset(n => n + 1); }} className={`min-h-10 rounded-md px-3 text-xs font-medium ${view === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>{label}</button>
        ))}
        <button type="button" onClick={() => setReset(n => n + 1)} className="ml-auto min-h-10 rounded-md px-3 text-xs">Reset view</button>
      </div>
      <div className="relative min-h-[320px] flex-1 touch-none">
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
        camera={{ position: cam.position, fov: 55, near: 0.1, far: 200 }}
        onCreated={() => setReady(true)}
        onPointerMissed={() => onSelectFixture?.(null)}
      >
        <color attach="background" args={["#eef1f4"]} />
        <CaptureBridge innerRef={captureFn} />
        <ViewCamera view={view} room={spec.room} reset={reset} />
        <RoomScene
          spec={spec}
          cutaway={view === "overview" || view === "top"}
          selectedFixtureId={selectedFixtureId}
          onSelectFixture={(id) => onSelectFixture?.(id)}
        />
        {showDimensions && (view === "overview" || view === "top") && <Suspense fallback={null}><Dimensions spec={spec} /></Suspense>}
        <OrbitControls
          target={cam.target}
          enableDamping
          dampingFactor={0.08}
          minDistance={1.5}
          maxDistance={Math.max(60, Math.max(spec.room.widthIn, spec.room.lengthIn) / 12 * 8)}
          // Stop the camera dropping below the floor, which is disorienting.
          maxPolarAngle={Math.PI / 2 - 0.02}
          makeDefault
        />
      </Canvas>
      </div>
      <p className="shrink-0 border-t bg-background px-3 py-2 text-[11px] text-muted-foreground">Drag to rotate · Pinch to zoom · Two fingers to pan{view === "overview" || view === "top" ? " · Ceiling and front walls hidden" : ""}</p>
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Starting the 3D view…
        </div>
      )}
    </div>
  );
});
