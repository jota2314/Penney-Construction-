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

export interface RoomViewerHandle {
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

  useImperativeHandle(ref, () => ({
    capture: () => captureFn.current?.() ?? null,
  }));

  const cam = useMemo(() => defaultCamera(spec.room), [spec.room]);

  return (
    <div className={className}>
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
        <RoomScene
          spec={spec}
          selectedFixtureId={selectedFixtureId}
          onSelectFixture={(id) => onSelectFixture?.(id)}
        />
        {showDimensions && <Dimensions spec={spec} />}
        <OrbitControls
          target={cam.target}
          enableDamping
          dampingFactor={0.08}
          minDistance={1.5}
          maxDistance={60}
          // Stop the camera dropping below the floor, which is disorienting.
          maxPolarAngle={Math.PI / 2 - 0.02}
          makeDefault
        />
      </Canvas>
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Starting the 3D view…
        </div>
      )}
    </div>
  );
});
