"use client";

/**
 * The room itself: walls, openings, floor, ceiling and lighting.
 *
 * Walls are built as THREE.Shape with holes rather than as split panels. Two
 * reasons: an arbitrary number of openings per wall works without any splitting
 * logic, and ShapeGeometry emits UVs equal to the shape's own coordinates — so
 * because shapes are authored in FEET, a texture repeat of (12 / tileInches)
 * lands the tile at exact real-world scale with no per-wall fudging.
 */

import { useMemo } from "react";
import * as THREE from "three";
import {
  type RoomSpec,
  type WallSpec,
  type DesignMaterial,
  findMaterial,
  inToFt,
  wallRunIn,
} from "@/types/design";
import { wallFrames, openingRects, type WallFrame, type LocalRect } from "@/lib/design/geometry";
import { Environment, Lightformer } from "@react-three/drei";
import { SurfaceMaterial, SolidMaterial } from "./design-materials";
import { FixtureMesh } from "./fixtures";

/** Doors and windows are voids; niches are recesses that keep a back panel. */
const VOID_TYPES = new Set(["door", "window", "cased_opening"]);

// ── Wall ─────────────────────────────────────────────────────────────────────

/**
 * Builds the wall face as a rectangle with the openings punched out.
 *
 * Shape coordinates are centred on the wall so the mesh can sit at the frame
 * position without an offset, which keeps the UV origin at the wall's centre —
 * consistent across walls, so a tile pattern doesn't jump at the corners.
 */
function useWallGeometry(frame: WallFrame, rects: LocalRect[]) {
  return useMemo(() => {
    const hw = frame.widthFt / 2;
    const hh = frame.heightFt / 2;

    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();

    for (const r of rects) {
      const hole = new THREE.Path();
      const x0 = r.cx - r.widthFt / 2;
      const x1 = r.cx + r.widthFt / 2;
      const y0 = r.cy - r.heightFt / 2;
      const y1 = r.cy + r.heightFt / 2;
      hole.moveTo(x0, y0);
      hole.lineTo(x1, y0);
      hole.lineTo(x1, y1);
      hole.lineTo(x0, y1);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geom = new THREE.ShapeGeometry(shape);
    geom.computeVertexNormals();
    return geom;
  }, [frame.widthFt, frame.heightFt, rects]);
}

function Wall({
  wall,
  frame,
  spec,
}: {
  wall: WallSpec;
  frame: WallFrame;
  spec: RoomSpec;
}) {
  const rects = useMemo(() => openingRects(wall.openings, frame), [wall.openings, frame]);
  const allHoles = rects; // every opening punches the face; niches get a back panel

  const hasSplit =
    wall.finish.upperMaterialId != null && (wall.finish.splitHeightIn ?? 0) > 0;

  const runIn = wallRunIn(wall.id, spec.room);
  const ceilingIn = spec.room.ceilingHeightIn;
  const splitIn = hasSplit
    ? Math.min(wall.finish.splitHeightIn as number, ceilingIn)
    : ceilingIn;

  const lowerMat = findMaterial(spec, wall.finish.materialId);
  const upperMat = findMaterial(spec, wall.finish.upperMaterialId);

  // A split wall is two stacked faces, each with its own frame and holes so the
  // openings stay punched through both bands.
  if (hasSplit && splitIn < ceilingIn) {
    return (
      <group>
        <WallBand
          frame={frame}
          rects={allHoles}
          bottomIn={0}
          topIn={splitIn}
          runIn={runIn}
          material={lowerMat}
          ceilingIn={ceilingIn}
        />
        <WallBand
          frame={frame}
          rects={allHoles}
          bottomIn={splitIn}
          topIn={ceilingIn}
          runIn={runIn}
          material={upperMat}
          ceilingIn={ceilingIn}
        />
        <Niches wall={wall} frame={frame} spec={spec} />
      </group>
    );
  }

  return (
    <group>
      <WallBand
        frame={frame}
        rects={allHoles}
        bottomIn={0}
        topIn={ceilingIn}
        runIn={runIn}
        material={lowerMat}
        ceilingIn={ceilingIn}
      />
      <Niches wall={wall} frame={frame} spec={spec} />
    </group>
  );
}

/** One horizontal band of a wall face, with the openings that fall in it. */
function WallBand({
  frame,
  rects,
  bottomIn,
  topIn,
  runIn,
  material,
  ceilingIn,
}: {
  frame: WallFrame;
  rects: LocalRect[];
  bottomIn: number;
  topIn: number;
  runIn: number;
  material: DesignMaterial | undefined;
  ceilingIn: number;
}) {
  const heightFt = inToFt(topIn - bottomIn);
  // Band centre relative to the wall's own centre.
  const yOffset = inToFt((bottomIn + topIn) / 2) - inToFt(ceilingIn) / 2;

  const bandFrame: WallFrame = useMemo(
    () => ({ ...frame, heightFt }),
    [frame, heightFt],
  );

  // Re-express the openings in the band's frame.
  const bandRects = useMemo(
    () => rects.map((r) => ({ ...r, cy: r.cy - yOffset })),
    [rects, yOffset],
  );

  const geometry = useWallGeometry(bandFrame, bandRects);

  const [px, py, pz] = frame.position;

  return (
    <mesh
      geometry={geometry}
      position={[px, py + yOffset, pz]}
      rotation={[0, frame.rotationY, 0]}
      receiveShadow
    >
      <SurfaceMaterial material={material} widthIn={runIn} heightIn={topIn - bottomIn} />
    </mesh>
  );
}

/**
 * The recessed box behind each niche opening.
 *
 * Five inward-facing faces: back, two jambs, head and sill. Built in the wall's
 * local frame and then pushed away from the room along the wall normal.
 */
function Niches({
  wall,
  frame,
  spec,
}: {
  wall: WallSpec;
  frame: WallFrame;
  spec: RoomSpec;
}) {
  const rects = useMemo(
    () => openingRects(wall.openings.filter((o) => o.type === "niche"), frame),
    [wall.openings, frame],
  );

  if (rects.length === 0) return null;

  const [px, py, pz] = frame.position;

  return (
    <group position={[px, py, pz]} rotation={[0, frame.rotationY, 0]}>
      {rects.map((r) => {
        const mat =
          findMaterial(spec, r.materialId) ?? findMaterial(spec, wall.finish.materialId);
        const d = r.depthFt;
        return (
          <group key={r.id} position={[r.cx, r.cy, 0]}>
            {/* Back */}
            <mesh position={[0, 0, -d]} receiveShadow>
              <planeGeometry args={[r.widthFt, r.heightFt]} />
              <SurfaceMaterial
                material={mat}
                widthIn={r.widthFt * 12}
                heightIn={r.heightFt * 12}
              />
            </mesh>
            {/* Jambs */}
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * (r.widthFt / 2), 0, -d / 2]}
                rotation={[0, -s * Math.PI / 2, 0]}
                receiveShadow
              >
                <planeGeometry args={[d, r.heightFt]} />
                <SurfaceMaterial material={mat} widthIn={d * 12} heightIn={r.heightFt * 12} />
              </mesh>
            ))}
            {/* Head and sill */}
            {[-1, 1].map((s) => (
              <mesh
                key={`h${s}`}
                position={[0, s * (r.heightFt / 2), -d / 2]}
                rotation={[s * Math.PI / 2, 0, 0]}
                receiveShadow
              >
                <planeGeometry args={[r.widthFt, d]} />
                <SurfaceMaterial material={mat} widthIn={r.widthFt * 12} heightIn={d * 12} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Casing and glass for doors and windows.
 *
 * A punched hole with nothing in it reads as a black void and makes the whole
 * room look unfinished, so every void gets a jamb return and windows get glass.
 */
function OpeningTrim({
  wall,
  frame,
}: {
  wall: WallSpec;
  frame: WallFrame;
}) {
  const rects = useMemo(
    () => openingRects(wall.openings.filter((o) => VOID_TYPES.has(o.type)), frame),
    [wall.openings, frame],
  );

  if (rects.length === 0) return null;

  const [px, py, pz] = frame.position;
  const jamb = inToFt(4.5);

  return (
    <group position={[px, py, pz]} rotation={[0, frame.rotationY, 0]}>
      {rects.map((r) => (
        <group key={r.id} position={[r.cx, r.cy, 0]}>
          {/* Jamb return so the wall reads as having thickness */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (r.widthFt / 2), 0, -jamb / 2]} rotation={[0, -s * Math.PI / 2, 0]}>
              <planeGeometry args={[jamb, r.heightFt]} />
              <SolidMaterial color="#f4f2ee" roughness={0.85} />
            </mesh>
          ))}
          <mesh position={[0, r.heightFt / 2, -jamb / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[r.widthFt, jamb]} />
            <SolidMaterial color="#f4f2ee" roughness={0.85} />
          </mesh>

          {r.type === "window" ? (
            <>
              <mesh position={[0, 0, -jamb]}>
                <planeGeometry args={[r.widthFt, r.heightFt]} />
                <meshStandardMaterial
                  color="#eaf3f7"
                  emissive="#dceaf2"
                  emissiveIntensity={0.9}
                  roughness={0.1}
                />
              </mesh>
              {/* Daylight through the opening does most of the work in a render */}
              <pointLight
                position={[0, 0, jamb * 2]}
                intensity={8}
                distance={22}
                color="#eaf2ff"
              />
            </>
          ) : (
            /* Whatever is beyond a doorway — kept dim, never pure black */
            <mesh position={[0, 0, -jamb]}>
              <planeGeometry args={[r.widthFt, r.heightFt]} />
              <SolidMaterial color="#4a4640" roughness={1} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

// ── Room ─────────────────────────────────────────────────────────────────────

export function RoomScene({
  spec,
  selectedFixtureId,
  onSelectFixture,
}: {
  spec: RoomSpec;
  selectedFixtureId?: string | null;
  onSelectFixture?: (id: string) => void;
}) {
  const frames = useMemo(() => wallFrames(spec.room), [spec.room]);
  const w = inToFt(spec.room.widthIn);
  const l = inToFt(spec.room.lengthIn);
  const h = inToFt(spec.room.ceilingHeightIn);

  const floorMat = findMaterial(spec, spec.floor.materialId);
  const ceilingMat = findMaterial(spec, spec.ceiling.materialId);

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, l / 2]} receiveShadow>
        <planeGeometry args={[w, l]} />
        <SurfaceMaterial
          material={floorMat}
          widthIn={spec.room.widthIn}
          heightIn={spec.room.lengthIn}
          rotationDeg={spec.floor.rotationDeg ?? 0}
        />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[w / 2, h, l / 2]} receiveShadow>
        <planeGeometry args={[w, l]} />
        <SurfaceMaterial
          material={ceilingMat}
          widthIn={spec.room.widthIn}
          heightIn={spec.room.lengthIn}
        />
      </mesh>

      {frames.map((frame) => {
        const wall = spec.walls.find((x) => x.id === frame.id);
        if (!wall) return null;
        return (
          <group key={frame.id}>
            <Wall wall={wall} frame={frame} spec={spec} />
            <OpeningTrim wall={wall} frame={frame} />
          </group>
        );
      })}

      {spec.fixtures.map((f) => (
        <FixtureMesh
          key={f.id}
          fixture={f}
          spec={spec}
          selected={selectedFixtureId === f.id}
          onSelect={onSelectFixture}
        />
      ))}

      <RoomLighting room={{ w, l, h }} />
    </group>
  );
}

/**
 * Lighting.
 *
 * Entirely procedural — no HDR fetch. Two reasons: the app must render offline
 * and behind auth, and a fetched environment map is a hard dependency on a CDN
 * that can disappear. A soft overhead key plus cool fill from the front reads
 * like a real bathroom, which also gives the AI render pass a sane starting
 * point since its reference image is a capture of this scene.
 */
function RoomLighting({ room }: { room: { w: number; l: number; h: number } }) {
  const { w, l, h } = room;
  return (
    <>
      {/*
        A mirror, a chrome tap and a glass panel are all defined by what they
        REFLECT. With lights but no environment there is nothing to reflect, so
        they resolve to black — which is exactly how the first build looked.
        This builds a small environment map from flat emissive panels: entirely
        procedural, no HDR fetch, so it still works offline and behind auth.
      */}
      <Environment resolution={128} frames={1}>
        {/* Bright ceiling plane — the main thing a bathroom mirror sees */}
        <Lightformer intensity={1.6} color="#ffffff" form="rect" scale={[12, 12, 1]}
          position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} />
        {/* Cool daylight from the open side */}
        <Lightformer intensity={1.1} color="#dfe9f5" form="rect" scale={[10, 8, 1]}
          position={[0, 3, 9]} rotation={[0, 0, 0]} />
        {/* Warm bounce from the opposite side so metal isn't flat grey */}
        <Lightformer intensity={0.7} color="#fff0dd" form="rect" scale={[10, 8, 1]}
          position={[0, 3, -9]} rotation={[0, Math.PI, 0]} />
        {/* Floor bounce */}
        <Lightformer intensity={0.5} color="#cfc8bd" form="rect" scale={[12, 12, 1]}
          position={[0, -4, 0]} rotation={[-Math.PI / 2, 0, 0]} />
        {[-1, 1].map((s) => (
          <Lightformer key={s} intensity={0.6} color="#ffffff" form="rect" scale={[6, 8, 1]}
            position={[s * 9, 3, 0]} rotation={[0, (s * Math.PI) / 2, 0]} />
        ))}
      </Environment>

      <ambientLight intensity={0.45} color="#f4f6f8" />
      {/* Overhead key */}
      <directionalLight
        position={[w * 0.6, h * 1.8, l * 0.7]}
        intensity={1.5}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      {/* Cool fill from the open (front) side so back corners don't go black */}
      <directionalLight
        position={[w * 0.5, h * 0.8, l * 2.5]}
        intensity={0.55}
        color="#dce8f5"
      />
      {/* Bounce off the floor */}
      <hemisphereLight args={["#ffffff", "#c9c2b6", 0.45]} />
    </>
  );
}
