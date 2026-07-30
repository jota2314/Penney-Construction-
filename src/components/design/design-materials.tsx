"use client";

/**
 * three.js materials built from a design's palette.
 *
 * The tile path is the interesting one: it generates a true-scale repeating
 * module (see lib/design/tile-texture) and then sets the repeat from the actual
 * surface size in inches, so a wall of 3x12 subway shows the number of courses
 * it would really show. Everything else is a plain PBR material.
 *
 * Textures are cached per material id + swatch, because rebuilding a canvas
 * texture on every React render would stall the viewer on each conversational
 * edit.
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { DesignMaterial } from "@/types/design";
import {
  buildTileTexture,
  loadSwatch,
  type TileTextureResult,
} from "@/lib/design/tile-texture";

/** Keyed by material id + swatch url so a re-uploaded tile invalidates. */
const textureCache = new Map<string, TileTextureResult | null>();

function cacheKey(m: DesignMaterial): string {
  return [
    m.id,
    m.textureUrl ?? "",
    m.tileWidthIn ?? "",
    m.tileHeightIn ?? "",
    m.pattern ?? "",
    m.groutWidthIn ?? "",
    m.groutColor ?? "",
    m.baseColor,
    m.finish ?? "",
  ].join("|");
}

/**
 * Builds (and caches) the repeating tile module for a material.
 * Returns null for continuous finishes like paint — those need no texture.
 */
export function useTileTexture(material: DesignMaterial | undefined): TileTextureResult | null {
  const [, forceRender] = useState(0);

  const key = material ? cacheKey(material) : "";
  const cached = key ? textureCache.get(key) : undefined;

  useEffect(() => {
    if (!material || !key) return;
    if (textureCache.has(key)) return;

    let cancelled = false;
    // Reserve the slot so concurrent surfaces sharing a material build once.
    textureCache.set(key, null);

    loadSwatch(material.textureUrl ?? material.sourcePhotoUrl).then((swatch) => {
      if (cancelled) return;
      const built = buildTileTexture(material, swatch);
      textureCache.set(key, built);
      forceRender((n) => n + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [material, key]);

  return cached ?? null;
}

/**
 * Material for a flat surface of a known real size.
 *
 * `widthIn` / `heightIn` are the surface's true dimensions and drive the texture
 * repeat — pass the wall's run and height, or the floor's width and length.
 */
export function SurfaceMaterial({
  material,
  widthIn,
  heightIn,
  rotationDeg = 0,
}: {
  material: DesignMaterial | undefined;
  widthIn: number;
  heightIn: number;
  rotationDeg?: number;
}) {
  const tile = useTileTexture(material);

  const map = useMemo(() => {
    if (!tile) return null;
    // Clone so two surfaces sharing one tile can carry different repeats.
    const t = tile.map.clone();
    t.needsUpdate = true;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(
      widthIn / tile.moduleWidthIn,
      heightIn / tile.moduleHeightIn,
    );
    if (rotationDeg) {
      t.center.set(0.5, 0.5);
      t.rotation = (rotationDeg * Math.PI) / 180;
    }
    return t;
  }, [tile, widthIn, heightIn, rotationDeg]);

  useEffect(() => {
    return () => {
      map?.dispose();
    };
  }, [map]);

  const color = material?.baseColor ?? "#dddddd";
  const roughness = material?.roughness ?? 0.7;
  const metalness = material?.metalness ?? 0;

  return (
    <meshStandardMaterial
      map={map ?? undefined}
      // With a texture the map carries the colour; tinting it again would
      // double-darken the swatch.
      color={map ? "#ffffff" : color}
      roughness={roughness}
      metalness={metalness}
    />
  );
}

/** Plain material for fixture bodies, trim and glass. */
export function SolidMaterial({
  color = "#cccccc",
  roughness = 0.6,
  metalness = 0,
  transparent = false,
  opacity = 1,
}: {
  color?: string;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
}) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={roughness}
      metalness={metalness}
      transparent={transparent}
      opacity={opacity}
      side={transparent ? THREE.DoubleSide : THREE.FrontSide}
    />
  );
}

/** Shower and partition glass — slightly green, like real low-iron glass isn't. */
export function GlassMaterial() {
  return (
    <meshPhysicalMaterial
      color="#dfeae6"
      roughness={0.03}
      metalness={0}
      transmission={0.92}
      thickness={0.02}
      transparent
      opacity={0.32}
      side={THREE.DoubleSide}
    />
  );
}
