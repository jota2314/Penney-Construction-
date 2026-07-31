"use client";

/**
 * Fixture geometry.
 *
 * Built from primitives rather than imported models on purpose. Every fixture is
 * driven by its real width/depth/height, so a 48" vanity is drawn 48" wide and
 * the room reads correctly against the tile — a downloaded model would be a
 * fixed size and would quietly lie about the fit, which is exactly the mistake
 * this tool exists to avoid. It also means no asset pipeline and no network
 * fetches in the viewer.
 *
 * ── LOCAL FRAME ──────────────────────────────────────────────────────────────
 * Origin at the centre of the footprint, y = 0 at the fixture's base. Width runs
 * along local X, depth along local Z, height along Y. The FRONT face is at +z,
 * so a fixture at rotation 0 has its back against the room's back wall.
 */

import { Fragment } from "react";
import * as THREE from "three";
import type { Fixture, RoomSpec } from "@/types/design";
import { findMaterial, inToFt } from "@/types/design";
import { fixtureTransform } from "@/lib/design/geometry";
import { wallFixtureHeightIn, partitionDoorway } from "@/lib/design/plan";
import { metalFor } from "@/lib/design/hardware";
import { SolidMaterial, GlassMaterial, SurfaceMaterial } from "./design-materials";

const PORCELAIN = { color: "#fbfbf9", roughness: 0.12, metalness: 0.02 };

/** Box helper. All args in FEET, positioned by centre. */
function Box({
  size,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  children,
}: {
  size: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  children: React.ReactNode;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {children}
    </mesh>
  );
}

// ── Vanity ───────────────────────────────────────────────────────────────────

function Vanity({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const metal = metalFor(spec, f);
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);

  const cabinetMat = findMaterial(spec, f.materialId);
  const counterMat = findMaterial(spec, f.accentMaterialId);

  const counterT = inToFt(1.25);
  const toeH = inToFt(3.5);
  const toeInset = inToFt(3);
  const floating = String(f.options?.style ?? "") === "floating";
  const sinks = Number(f.options?.sinks ?? 1);

  const cabinetTop = h - counterT;
  const cabinetBottom = floating ? inToFt(10) : toeH;
  const cabinetH = Math.max(0.1, cabinetTop - cabinetBottom);

  const cabinetColor = cabinetMat?.baseColor ?? f.color ?? "#3f4a4d";
  const cabinetRough = cabinetMat?.roughness ?? 0.5;

  // Sink centres: one centred, two split across the width.
  const sinkXs = sinks >= 2 ? [-w / 4, w / 4] : [0];

  return (
    <group>
      {/* Toe kick — only on a floor-standing cabinet */}
      {!floating && (
        <Box size={[w - inToFt(1), toeH, d - toeInset]} position={[0, toeH / 2, -toeInset / 2]}>
          <SolidMaterial color="#2b3234" roughness={0.8} />
        </Box>
      )}

      {/* Cabinet body */}
      <Box
        size={[w - inToFt(1), cabinetH, d - inToFt(1)]}
        position={[0, cabinetBottom + cabinetH / 2, 0]}
      >
        <SolidMaterial color={cabinetColor} roughness={cabinetRough} />
      </Box>

      {/* Door reveal lines, proud of the face so they catch light */}
      {[-1, 1].map((side) => (
        <Box
          key={side}
          size={[inToFt(0.35), cabinetH - inToFt(2), inToFt(0.3)]}
          position={[side * (w / 6), cabinetBottom + cabinetH / 2, d / 2 - inToFt(0.4)]}
        >
          <SolidMaterial color="#1d2224" roughness={0.9} />
        </Box>
      ))}

      {/* Pulls */}
      {[-1, 1].map((side) => (
        <mesh
          key={`pull-${side}`}
          position={[side * (w / 4), cabinetTop - inToFt(4), d / 2 - inToFt(0.2)]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[inToFt(0.3), inToFt(0.3), inToFt(4), 12]} />
          <SolidMaterial {...metal} />
        </mesh>
      ))}

      {/* Countertop, overhanging the box slightly */}
      <Box size={[w, counterT, d]} position={[0, cabinetTop + counterT / 2, 0]}>
        <SolidMaterial
          color={counterMat?.baseColor ?? "#e8e6e1"}
          roughness={counterMat?.roughness ?? 0.25}
          metalness={counterMat?.metalness ?? 0}
        />
      </Box>

      {/* Backsplash */}
      <Box
        size={[w, inToFt(4), inToFt(0.75)]}
        position={[0, cabinetTop + counterT + inToFt(2), -d / 2 + inToFt(0.4)]}
      >
        <SolidMaterial
          color={counterMat?.baseColor ?? "#e8e6e1"}
          roughness={counterMat?.roughness ?? 0.25}
        />
      </Box>

      {sinkXs.map((sx, i) => (
        <Fragment key={i}>
          {/* Undermount basin. The hemisphere has to open UPWARD (phiStart at
              the equator, sweeping down) or it renders as a dome sitting on the
              counter instead of a bowl sunk into it. */}
          <mesh
            position={[sx, cabinetTop + counterT - inToFt(0.5), 0]}
            scale={[1, 0.55, 0.75]}
          >
            <sphereGeometry
              args={[inToFt(7.5), 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]}
            />
            <meshStandardMaterial
              color="#fbfbf9"
              roughness={0.12}
              metalness={0.02}
              side={THREE.BackSide}
            />
          </mesh>
          {/* Faucet body */}
          <mesh
            position={[sx, cabinetTop + counterT + inToFt(4), -d / 2 + inToFt(3)]}
            castShadow
          >
            <cylinderGeometry args={[inToFt(0.6), inToFt(0.7), inToFt(8), 14]} />
            <SolidMaterial {...metal} />
          </mesh>
          {/* Spout */}
          <mesh
            position={[sx, cabinetTop + counterT + inToFt(7.5), -d / 2 + inToFt(5)]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[inToFt(0.45), inToFt(0.45), inToFt(4.5), 12]} />
            <SolidMaterial {...metal} />
          </mesh>
        </Fragment>
      ))}
    </group>
  );
}

// ── Toilet ───────────────────────────────────────────────────────────────────

function Toilet({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const metal = metalFor(spec, f);
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);
  const wallHung = String(f.options?.style ?? "") === "wall_hung";

  const tankH = h * 0.55;
  const bowlTop = wallHung ? inToFt(15) : inToFt(15.5);

  return (
    <group>
      {/* Tank against the back */}
      <Box
        size={[w * 0.85, tankH, d * 0.26]}
        position={[0, h - tankH / 2, -d / 2 + d * 0.13]}
      >
        <SolidMaterial {...PORCELAIN} />
      </Box>
      {/* Tank lid */}
      <Box
        size={[w * 0.9, inToFt(1.2), d * 0.3]}
        position={[0, h + inToFt(0.6), -d / 2 + d * 0.15]}
      >
        <SolidMaterial {...PORCELAIN} />
      </Box>
      {/* Flush lever */}
      <mesh
        position={[w * 0.3, h - inToFt(3), -d / 2 + d * 0.28]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[inToFt(0.35), inToFt(0.35), inToFt(1.6), 10]} />
        <SolidMaterial {...metal} />
      </mesh>

      {/* Bowl — an ellipsoid reads as elongated porcelain far better than a box */}
      <mesh
        position={[0, bowlTop - inToFt(3), d * 0.12]}
        scale={[w / 2 / inToFt(8), 0.55, d * 0.72 / 2 / inToFt(8)]}
        castShadow
      >
        <sphereGeometry args={[inToFt(8), 24, 18]} />
        <SolidMaterial {...PORCELAIN} />
      </mesh>

      {/* Seat */}
      <mesh position={[0, bowlTop, d * 0.12]} scale={[w / 2 / inToFt(8), 1, d * 0.74 / 2 / inToFt(8)]}>
        <cylinderGeometry args={[inToFt(8), inToFt(8), inToFt(1.4), 28]} />
        <SolidMaterial color="#ffffff" roughness={0.25} />
      </mesh>

      {/* Pedestal, or the gap under a wall-hung */}
      {!wallHung && (
        <mesh position={[0, inToFt(5), d * 0.05]} castShadow>
          <cylinderGeometry args={[inToFt(4.5), inToFt(5.5), inToFt(11), 20]} />
          <SolidMaterial {...PORCELAIN} />
        </mesh>
      )}
    </group>
  );
}

// ── Tub ──────────────────────────────────────────────────────────────────────

function Tub({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const metal = metalFor(spec, f);
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);
  const style = String(f.options?.style ?? "alcove");
  const mat = findMaterial(spec, f.materialId);
  const shell = {
    color: mat?.baseColor ?? "#fbfbf9",
    roughness: mat?.roughness ?? 0.12,
    metalness: 0.02,
  };

  if (style === "freestanding") {
    return (
      <group>
        {/* Outer shell */}
        <mesh position={[0, h / 2, 0]} scale={[w / 2 / 1, 1, d / 2 / 1]} castShadow receiveShadow>
          <cylinderGeometry args={[1, 0.86, h, 40]} />
          <SolidMaterial {...shell} />
        </mesh>
        {/* Basin recess */}
        <mesh position={[0, h - inToFt(1.5), 0]} scale={[(w - inToFt(6)) / 2, 1, (d - inToFt(6)) / 2]}>
          <cylinderGeometry args={[1, 0.9, inToFt(3), 40]} />
          <SolidMaterial color="#e9eeef" roughness={0.2} />
        </mesh>
        {/* Floor-mount filler */}
        <mesh position={[w / 2 + inToFt(4), h * 0.55, 0]} castShadow>
          <cylinderGeometry args={[inToFt(0.9), inToFt(1.1), h * 1.1, 14]} />
          <SolidMaterial {...metal} />
        </mesh>
      </group>
    );
  }

  // Alcove / drop-in: a rim around a recessed basin.
  const rail = inToFt(2.75);
  const floorT = inToFt(2);

  return (
    <group>
      {/* Basin floor */}
      <Box size={[w, floorT, d]} position={[0, floorT / 2, 0]}>
        <SolidMaterial {...shell} />
      </Box>
      {/* Four rails forming the tub walls */}
      <Box size={[w, h - floorT, rail]} position={[0, floorT + (h - floorT) / 2, -d / 2 + rail / 2]}>
        <SolidMaterial {...shell} />
      </Box>
      <Box size={[w, h - floorT, rail]} position={[0, floorT + (h - floorT) / 2, d / 2 - rail / 2]}>
        <SolidMaterial {...shell} />
      </Box>
      <Box
        size={[rail, h - floorT, d - rail * 2]}
        position={[-w / 2 + rail / 2, floorT + (h - floorT) / 2, 0]}
      >
        <SolidMaterial {...shell} />
      </Box>
      <Box
        size={[rail, h - floorT, d - rail * 2]}
        position={[w / 2 - rail / 2, floorT + (h - floorT) / 2, 0]}
      >
        <SolidMaterial {...shell} />
      </Box>
      {/* Interior wash — slightly cooler so the basin reads as recessed */}
      <Box
        size={[w - rail * 2, inToFt(0.2), d - rail * 2]}
        position={[0, floorT + inToFt(0.1), 0]}
      >
        <SolidMaterial color="#eaf0f1" roughness={0.18} />
      </Box>
      {/* Tub filler and valve on the left end */}
      <mesh
        position={[-w / 2 + inToFt(5), h - inToFt(2), -d / 2 + inToFt(3)]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[inToFt(0.5), inToFt(0.5), inToFt(5), 12]} />
        <SolidMaterial {...metal} />
      </mesh>
    </group>
  );
}

// ── Shower ───────────────────────────────────────────────────────────────────

/**
 * Custom tile shower.
 *
 * Penney builds these site-tiled, not as a prefab base-and-surround, so the pan
 * and curb are TILED in the wall material rather than moulded acrylic, and the
 * default enclosure is open — no glass unless it's asked for.
 *
 * When glass is on it's frameless: a single panel with a slim edge, not the
 * chrome-posted box the first version drew, which read as a black frame around
 * a black slab.
 */
function Shower({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const metal = metalFor(spec, f);
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const enclosure = String(f.options?.enclosure ?? "open");
  const curbH = inToFt(Number(f.options?.curbHeightIn ?? 4));
  const hasBench = Boolean(f.options?.hasBench);

  // Tiled by the shower's own material, falling back to the room's wall tile —
  // a custom shower is finished in the same tile as the walls around it.
  const tileMat =
    findMaterial(spec, f.materialId) ??
    findMaterial(spec, spec.walls.find((x) => x.isWet)?.finish.materialId) ??
    findMaterial(spec, spec.walls[0]?.finish.materialId);

  const panT = inToFt(2);
  const glassTop = inToFt(Number(f.options?.glassHeightIn ?? 76));

  return (
    <group>
      {/* Tiled pan, sloped to the drain */}
      <mesh position={[0, panT, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <SurfaceMaterial material={tileMat} widthIn={f.widthIn} heightIn={f.depthIn} />
      </mesh>
      <Box size={[w, panT, d]} position={[0, panT / 2, 0]}>
        <SolidMaterial color={tileMat?.baseColor ?? "#e8e5df"} roughness={0.6} />
      </Box>

      {/* Drain */}
      <mesh position={[0, panT + inToFt(0.15), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[inToFt(2), 20]} />
        <SolidMaterial {...metal} />
      </mesh>

      {/* Tiled curb along the open side */}
      {curbH > 0 && (
        <group position={[0, 0, d / 2 - inToFt(2)]}>
          <Box size={[w, curbH, inToFt(4)]} position={[0, curbH / 2, 0]}>
            <SolidMaterial color={tileMat?.baseColor ?? "#e8e5df"} roughness={0.6} />
          </Box>
          {/* Curb top, tiled */}
          <mesh position={[0, curbH, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w, inToFt(4)]} />
            <SurfaceMaterial material={tileMat} widthIn={f.widthIn} heightIn={4} />
          </mesh>
          {/* Outer face, tiled */}
          <mesh position={[0, curbH / 2, inToFt(2)]}>
            <planeGeometry args={[w, curbH]} />
            <SurfaceMaterial material={tileMat} widthIn={f.widthIn} heightIn={curbH * 12} />
          </mesh>
        </group>
      )}

      {/* Frameless glass, only when asked for */}
      {(enclosure === "glass_panel" || enclosure === "glass_door") && (
        <group position={[0, 0, d / 2 - inToFt(2)]}>
          <mesh position={[0, curbH + (glassTop - curbH) / 2, 0]}>
            <boxGeometry args={[w, glassTop - curbH, inToFt(0.5)]} />
            <GlassMaterial />
          </mesh>
          {/* Slim polished edge so the panel has an outline without a frame */}
          <mesh position={[0, glassTop, 0]}>
            <boxGeometry args={[w, inToFt(0.5), inToFt(0.6)]} />
            <SolidMaterial {...metal} roughness={0.25} />
          </mesh>
        </group>
      )}

      {enclosure === "curtain" && (
        <mesh position={[0, inToFt(38), d / 2 - inToFt(2)]}>
          <planeGeometry args={[w, inToFt(72)]} />
          <SolidMaterial color="#f2f1ee" roughness={0.9} />
        </mesh>
      )}

      {/* Valve and head on the back wall of the enclosure */}
      <mesh position={[0, inToFt(78), -d / 2 + inToFt(2)]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[inToFt(0.4), inToFt(0.4), inToFt(6), 10]} />
        <SolidMaterial {...metal} />
      </mesh>
      <mesh position={[0, inToFt(77), -d / 2 + inToFt(5)]} rotation={[Math.PI / 2.6, 0, 0]} castShadow>
        <cylinderGeometry args={[inToFt(4), inToFt(4), inToFt(0.8), 24]} />
        <SolidMaterial {...metal} />
      </mesh>
      <mesh position={[0, inToFt(46), -d / 2 + inToFt(1.5)]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[inToFt(2.2), inToFt(2.2), inToFt(1.5), 20]} />
        <SolidMaterial {...metal} />
      </mesh>

      {/* Tiled bench */}
      {hasBench && (
        <group position={[-w / 2 + w * 0.225, 0, -d / 2 + inToFt(7.5)]}>
          <Box size={[w * 0.45, inToFt(18), inToFt(15)]} position={[0, inToFt(9), 0]}>
            <SolidMaterial color={tileMat?.baseColor ?? "#e8e5df"} roughness={0.6} />
          </Box>
          <mesh position={[0, inToFt(18), 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w * 0.45, inToFt(15)]} />
            <SurfaceMaterial material={tileMat} widthIn={f.widthIn * 0.45} heightIn={15} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ── Small stuff ──────────────────────────────────────────────────────────────

function Mirror({ f }: { f: Fixture }) {
  const w = inToFt(f.widthIn);
  const h = inToFt(f.heightIn);
  const round = String(f.options?.shape ?? "rect") === "round";
  const frame = String(f.options?.frame ?? "none");

  return (
    <group>
      {round ? (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h / 2, 0]}>
          <cylinderGeometry args={[w / 2, w / 2, inToFt(0.8), 40]} />
          <SolidMaterial color="#dfe6e9" roughness={0.04} metalness={0.98} />
        </mesh>
      ) : (
        <Box size={[w, h, inToFt(0.8)]} position={[0, h / 2, 0]}>
          <SolidMaterial color="#dfe6e9" roughness={0.04} metalness={0.98} />
        </Box>
      )}
      {frame !== "none" && !round && (
        <Box size={[w + inToFt(1.5), h + inToFt(1.5), inToFt(0.6)]} position={[0, h / 2, -inToFt(0.3)]}>
          <SolidMaterial
            color={frame === "wood" ? "#7a5c3e" : "#2f3436"}
            roughness={frame === "wood" ? 0.7 : 0.35}
            metalness={frame === "metal" ? 0.8 : 0}
          />
        </Box>
      )}
    </group>
  );
}

function MedicineCabinet({ f }: { f: Fixture }) {
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);
  return (
    <group>
      <Box size={[w, h, d]} position={[0, h / 2, 0]}>
        <SolidMaterial color="#eceae6" roughness={0.6} />
      </Box>
      <Box size={[w - inToFt(0.6), h - inToFt(0.6), inToFt(0.5)]} position={[0, h / 2, d / 2]}>
        <SolidMaterial color="#dfe6e9" roughness={0.05} metalness={0.97} />
      </Box>
    </group>
  );
}

function LinenCabinet({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);
  const mat = findMaterial(spec, f.materialId);
  const color = mat?.baseColor ?? f.color ?? "#e9e6e0";
  return (
    <group>
      <Box size={[w, h, d]} position={[0, h / 2, 0]}>
        <SolidMaterial color={color} roughness={0.55} />
      </Box>
      <Box size={[inToFt(0.4), h * 0.9, inToFt(0.3)]} position={[0, h / 2, d / 2]}>
        <SolidMaterial color="#1d2224" roughness={0.9} />
      </Box>
    </group>
  );
}

function TowelBar({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const metal = metalFor(spec, f);
  const w = inToFt(f.widthIn);
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[inToFt(0.4), inToFt(0.4), w, 12]} />
        <SolidMaterial {...metal} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2), 0, -inToFt(1)]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[inToFt(0.7), inToFt(0.7), inToFt(2), 12]} />
          <SolidMaterial {...metal} />
        </mesh>
      ))}
    </group>
  );
}

function Sconce({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const metal = metalFor(spec, f);
  const h = inToFt(f.heightIn);
  return (
    <group>
      <mesh position={[0, 0, -inToFt(1)]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[inToFt(1.6), inToFt(1.6), inToFt(2), 16]} />
        <SolidMaterial {...metal} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[h / 2, 20, 16]} />
        <meshStandardMaterial
          color="#fff6e4"
          emissive="#ffd9a0"
          emissiveIntensity={1.4}
          roughness={0.4}
        />
      </mesh>
      <pointLight position={[0, 0, inToFt(2)]} intensity={2.2} distance={8} color="#ffe6c2" />
    </group>
  );
}

function CeilingLight({ f }: { f: Fixture }) {
  const w = inToFt(f.widthIn);
  return (
    <group>
      <mesh rotation={[0, 0, 0]}>
        <cylinderGeometry args={[w / 2, w / 2, inToFt(1.5), 28]} />
        <meshStandardMaterial
          color="#fffaf0"
          emissive="#fff1d6"
          emissiveIntensity={1.6}
          roughness={0.5}
        />
      </mesh>
      <pointLight position={[0, -inToFt(4), 0]} intensity={6} distance={16} color="#fff2dd" />
    </group>
  );
}

function Radiator({ f }: { f: Fixture }) {
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);
  return (
    <group>
      <Box size={[w, h, d]} position={[0, h / 2, 0]}>
        <SolidMaterial color="#e8e8e6" roughness={0.5} metalness={0.3} />
      </Box>
    </group>
  );
}

function Bench({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);
  const mat = findMaterial(spec, f.materialId);
  return (
    <Box size={[w, h, d]} position={[0, h / 2, 0]}>
      <SolidMaterial color={mat?.baseColor ?? "#e2ddd4"} roughness={mat?.roughness ?? 0.5} />
    </Box>
  );
}

/**
 * Knee wall — a real half-height partition.
 *
 * Uses SurfaceMaterial rather than a flat colour so the wall tile lands at true
 * scale on its faces, the same as the perimeter walls. The cap is drawn as a
 * separate slab because it is nearly always a different material (a stone or
 * bullnose cap on a tiled wall), and seeing that break is most of the point of
 * modelling the thing.
 */
function KneeWall({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);

  const faceMat = findMaterial(spec, f.materialId) ?? findMaterial(spec, spec.walls[0]?.finish.materialId);
  const capMat = findMaterial(spec, f.accentMaterialId) ?? faceMat;
  const capT = inToFt(Number(f.options?.capThicknessIn ?? 1.25));
  const bodyH = Math.max(0.05, h - capT);

  return (
    <group>
      {/* Long faces, tiled */}
      {[-1, 1].map((side) => (
        <mesh
          key={`face${side}`}
          position={[0, bodyH / 2, side * (d / 2)]}
          rotation={[0, side > 0 ? 0 : Math.PI, 0]}
          receiveShadow
          castShadow
        >
          <planeGeometry args={[w, bodyH]} />
          <SurfaceMaterial material={faceMat} widthIn={f.widthIn} heightIn={f.heightIn} />
        </mesh>
      ))}

      {/* Ends */}
      {[-1, 1].map((side) => (
        <mesh
          key={`end${side}`}
          position={[side * (w / 2), bodyH / 2, 0]}
          rotation={[0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
          receiveShadow
        >
          <planeGeometry args={[d, bodyH]} />
          <SurfaceMaterial material={faceMat} widthIn={f.depthIn} heightIn={f.heightIn} />
        </mesh>
      ))}

      {/* Solid core so the wall reads as thick, not as two floating planes */}
      <Box size={[w - 0.01, bodyH, d - 0.01]} position={[0, bodyH / 2, 0]}>
        <SolidMaterial color={faceMat?.baseColor ?? "#e8e5df"} roughness={0.8} />
      </Box>

      {/* Cap */}
      <Box size={[w, capT, d]} position={[0, bodyH + capT / 2, 0]}>
        <SolidMaterial
          color={capMat?.baseColor ?? "#e8e6e1"}
          roughness={capMat?.roughness ?? 0.3}
          metalness={capMat?.metalness ?? 0}
        />
      </Box>
    </group>
  );
}

/**
 * Full-height interior partition.
 *
 * Built as segments rather than one box so a doorway is a genuine hole you can
 * see through in the 3D view: a leg either side and a header over the opening.
 * Faking it with a dark rectangle would look right head-on and wrong from every
 * other angle, which is the angle you'd actually be checking it from.
 */
function Partition({ f, spec }: { f: Fixture; spec: RoomSpec }) {
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(wallFixtureHeightIn(f, spec.room));

  const mat = findMaterial(spec, f.materialId) ?? findMaterial(spec, spec.walls[0]?.finish.materialId);
  const color = mat?.baseColor ?? "#e8e5df";
  const doorway = partitionDoorway(f);

  const face = (
    key: string,
    width: number,
    height: number,
    cx: number,
    cy: number,
  ) => (
    <group key={key}>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[cx, cy, side * (d / 2 + 0.001)]}
          rotation={[0, side > 0 ? 0 : Math.PI, 0]}
          receiveShadow
        >
          <planeGeometry args={[width, height]} />
          <SurfaceMaterial
            material={mat}
            widthIn={width * 12}
            heightIn={height * 12}
          />
        </mesh>
      ))}
      <Box size={[width, height, d]} position={[cx, cy, 0]}>
        <SolidMaterial color={color} roughness={0.85} />
      </Box>
    </group>
  );

  if (!doorway) {
    return <group>{face("solid", w, h, 0, h / 2)}</group>;
  }

  const dW = inToFt(doorway.widthIn);
  const dH = inToFt(doorway.heightIn);
  const off = inToFt(doorway.offsetIn);

  // Legs measured from the wall's left end, then re-centred on the fixture.
  const leftW = off;
  const rightW = w - off - dW;
  const headerH = Math.max(0, h - dH);

  return (
    <group>
      {leftW > 0.01 && face("left", leftW, h, -w / 2 + leftW / 2, h / 2)}
      {rightW > 0.01 && face("right", rightW, h, w / 2 - rightW / 2, h / 2)}
      {headerH > 0.01 &&
        face("header", dW, headerH, -w / 2 + off + dW / 2, dH + headerH / 2)}

      {/* Jamb returns so the opening reads as having thickness */}
      {[-1, 1].map((side) => (
        <mesh
          key={`jamb${side}`}
          position={[-w / 2 + off + (side < 0 ? 0 : dW), dH / 2, 0]}
          rotation={[0, side < 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
        >
          <planeGeometry args={[d, dH]} />
          <SolidMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
      <mesh
        position={[-w / 2 + off + dW / 2, dH, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[dW, d]} />
        <SolidMaterial color={color} roughness={0.85} />
      </mesh>
    </group>
  );
}

/** Anything the model invents that has no dedicated mesh still gets a footprint. */
function GenericFixture({ f }: { f: Fixture }) {
  const w = inToFt(f.widthIn);
  const d = inToFt(f.depthIn);
  const h = inToFt(f.heightIn);
  return (
    <Box size={[w, h, d]} position={[0, h / 2, 0]}>
      <SolidMaterial color={f.color ?? "#b9b4ab"} roughness={0.7} />
    </Box>
  );
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export function FixtureMesh({
  fixture,
  spec,
  selected,
  onSelect,
}: {
  fixture: Fixture;
  spec: RoomSpec;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const { position, rotationY } = fixtureTransform(fixture);

  let body: React.ReactNode;
  switch (fixture.type) {
    case "vanity": body = <Vanity f={fixture} spec={spec} />; break;
    case "toilet": body = <Toilet f={fixture} spec={spec} />; break;
    case "tub": body = <Tub f={fixture} spec={spec} />; break;
    case "shower": body = <Shower f={fixture} spec={spec} />; break;
    case "mirror": body = <Mirror f={fixture} />; break;
    case "medicine_cabinet": body = <MedicineCabinet f={fixture} />; break;
    case "linen_cabinet": body = <LinenCabinet f={fixture} spec={spec} />; break;
    case "towel_bar": body = <TowelBar f={fixture} spec={spec} />; break;
    case "sconce": body = <Sconce f={fixture} spec={spec} />; break;
    case "ceiling_light": body = <CeilingLight f={fixture} />; break;
    case "radiator": body = <Radiator f={fixture} />; break;
    case "bench": body = <Bench f={fixture} spec={spec} />; break;
    case "knee_wall": body = <KneeWall f={fixture} spec={spec} />; break;
    case "partition": body = <Partition f={fixture} spec={spec} />; break;
    default: body = <GenericFixture f={fixture} />;
  }

  return (
    <group
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={(e) => {
        if (!onSelect) return;
        e.stopPropagation();
        onSelect(fixture.id);
      }}
    >
      {body}
      {selected && <SelectionBox fixture={fixture} />}
    </group>
  );
}

/** Wireframe cage around the selected fixture's true bounding box. */
function SelectionBox({ fixture }: { fixture: Fixture }) {
  const w = inToFt(fixture.widthIn);
  const d = inToFt(fixture.depthIn);
  const h = inToFt(fixture.heightIn);
  return (
    <mesh position={[0, h / 2, 0]}>
      <boxGeometry args={[w + 0.06, h + 0.06, d + 0.06]} />
      <meshBasicMaterial color="#f59e0b" wireframe transparent opacity={0.85} />
    </mesh>
  );
}
