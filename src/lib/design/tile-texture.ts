/**
 * Turns a tile product into a true-scale repeating texture.
 *
 * The realism here comes from scale, not resolution. A 3x12 subway and a 12x24
 * porcelain rendered at the same texture repeat both just look like "tile
 * pattern" and the eye immediately reads the room as fake. So every texture is
 * built from the material's REAL inch dimensions and mapped so that one tile in
 * the image covers exactly one tile's worth of wall.
 *
 * The generated canvas holds one PATTERN MODULE — the smallest rectangle that
 * repeats seamlessly for the given bond. For a stack bond that is a single tile;
 * for a running bond it is two courses, because the half-tile offset only
 * repeats every second row. Getting the module right is what keeps the grout
 * lines continuous across a wall instead of showing a visible seam every repeat.
 *
 * Runs in the browser only (needs a canvas). The viewer is client-side anyway.
 */

import * as THREE from "three";
import type { DesignMaterial, TilePattern } from "@/types/design";

/**
 * Texture detail. 24 px/in puts a 3" subway at 72px wide — enough that grout
 * reads crisply at close orbit without generating multi-megabyte canvases for a
 * large-format tile.
 */
const PX_PER_INCH = 24;

/** Hard ceiling so a 24x48 slab tile can't allocate an enormous canvas. */
const MAX_CANVAS_PX = 2048;

export interface TileTextureResult {
  map: THREE.Texture;
  /** Module size in inches — callers use this to set texture.repeat per surface. */
  moduleWidthIn: number;
  moduleHeightIn: number;
}

/**
 * Builds the repeating module for a material.
 *
 * `swatch` is a flattened crop of the owner's tile photo. When absent the tile
 * is painted from `baseColor` with slight per-piece variation, which reads far
 * better than a flat fill — real tile is never perfectly uniform.
 */
export function buildTileTexture(
  material: DesignMaterial,
  swatch?: HTMLImageElement | null,
): TileTextureResult | null {
  const tw = material.tileWidthIn ?? 0;
  const th = material.tileHeightIn ?? 0;

  // Continuous finishes (paint, slab) have no module to repeat.
  if (tw <= 0 || th <= 0) return null;

  const pattern: TilePattern = material.pattern ?? "stack";
  const grout = material.groutWidthIn ?? 0.125;
  const groutColor = material.groutColor ?? "#cfcabf";

  const mod = moduleSizeIn(pattern, tw, th);

  const scale = Math.min(
    PX_PER_INCH,
    MAX_CANVAS_PX / Math.max(mod.w, mod.h),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(mod.w * scale));
  canvas.height = Math.max(2, Math.round(mod.h * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Grout first — every tile is then drawn inset, so the gaps are what's left.
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const draw = (xIn: number, yIn: number, wIn: number, hIn: number, seed: number) =>
    drawTile(ctx, swatch, material, {
      x: (xIn + grout / 2) * scale,
      y: (yIn + grout / 2) * scale,
      w: (wIn - grout) * scale,
      h: (hIn - grout) * scale,
      seed,
      canvasW: canvas.width,
      canvasH: canvas.height,
    });

  layOutModule(pattern, tw, th, mod, draw);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Grout lines alias badly at grazing angles without anisotropy.
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  return { map: texture, moduleWidthIn: mod.w, moduleHeightIn: mod.h };
}

/** The smallest seamlessly-repeating rectangle for a bond, in inches. */
function moduleSizeIn(pattern: TilePattern, tw: number, th: number) {
  switch (pattern) {
    // Half-tile horizontal offset repeats only every second course.
    case "running":
      return { w: tw, h: th * 2 };
    // Same idea rotated: tiles stand on end, offset vertically.
    case "vertical_stack":
      return { w: tw * 2, h: th };
    case "herringbone":
      return { w: (tw + th) , h: (tw + th) };
    case "basketweave":
      return { w: tw * 2, h: tw * 2 };
    case "stack":
    case "none":
    default:
      return { w: tw, h: th };
  }
}

type DrawFn = (xIn: number, yIn: number, wIn: number, hIn: number, seed: number) => void;

/**
 * Places tiles inside the module.
 *
 * Anything crossing a module edge is drawn twice — once on each side — so the
 * wrap is seamless. That is why the offset courses below are emitted as two
 * pieces rather than one shifted tile.
 */
function layOutModule(
  pattern: TilePattern,
  tw: number,
  th: number,
  mod: { w: number; h: number },
  draw: DrawFn,
) {
  switch (pattern) {
    case "running": {
      // Course 1 flush, course 2 offset half a tile and wrapped at both edges.
      draw(0, 0, tw, th, 1);
      draw(-tw / 2, th, tw, th, 2);
      draw(tw / 2, th, tw, th, 3);
      break;
    }

    case "vertical_stack": {
      draw(0, 0, tw, th, 1);
      draw(tw, -th / 2, tw, th, 2);
      draw(tw, th / 2, tw, th, 3);
      break;
    }

    case "basketweave": {
      // Pairs of tiles alternating horizontal / vertical in a 2x2 block.
      const half = tw;
      draw(0, 0, half, half / 2, 1);
      draw(0, half / 2, half, half / 2, 2);
      draw(half, 0, half / 2, half, 3);
      draw(half + half / 2, 0, half / 2, half, 4);
      draw(0, half, half / 2, half, 5);
      draw(half / 2, half, half / 2, half, 6);
      draw(half, half, half, half / 2, 7);
      draw(half, half + half / 2, half, half / 2, 8);
      break;
    }

    case "herringbone": {
      // A true herringbone module is an L of one horizontal and one vertical
      // piece; drawn at the module corners so the interlock wraps cleanly.
      draw(0, 0, tw, th, 1);
      draw(tw, 0, th, tw, 2);
      draw(0, th, th, tw, 3);
      draw(th, th + tw - th, tw, th, 4);
      break;
    }

    case "stack":
    case "none":
    default:
      draw(0, 0, mod.w, mod.h, 1);
      break;
  }
}

interface TileDrawArgs {
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  canvasW: number;
  canvasH: number;
}

/**
 * Paints one tile face.
 *
 * When a photo swatch exists it is drawn cover-fit and rotated per piece so a
 * directional stone or wood-look doesn't repeat identically across the wall —
 * that repetition is the single biggest tell that a render is fake. Without a
 * swatch, the tile gets a small deterministic lightness jitter for the same
 * reason.
 */
function drawTile(
  ctx: CanvasRenderingContext2D,
  swatch: HTMLImageElement | null | undefined,
  material: DesignMaterial,
  { x, y, w, h, seed }: TileDrawArgs,
) {
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (swatch && swatch.complete && swatch.naturalWidth > 0) {
    // Cover-fit the swatch into the tile face.
    const sAspect = swatch.naturalWidth / swatch.naturalHeight;
    const tAspect = w / h;
    let dw = w;
    let dh = h;
    if (sAspect > tAspect) {
      dh = h;
      dw = h * sAspect;
    } else {
      dw = w;
      dh = w / sAspect;
    }
    // Deterministic per-piece offset so adjacent tiles don't look cloned.
    const jitterX = (pseudoRandom(seed) - 0.5) * (dw - w);
    const jitterY = (pseudoRandom(seed + 97) - 0.5) * (dh - h);
    ctx.drawImage(
      swatch,
      x + (w - dw) / 2 + jitterX,
      y + (h - dh) / 2 + jitterY,
      dw,
      dh,
    );
  } else {
    ctx.fillStyle = material.baseColor;
    ctx.fillRect(x, y, w, h);
    // ±4% lightness keeps a flat colour from looking like plastic.
    const shift = (pseudoRandom(seed) - 0.5) * 0.08;
    ctx.fillStyle = shift > 0 ? "#ffffff" : "#000000";
    ctx.globalAlpha = Math.abs(shift);
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }

  // Polished tile catches a soft highlight toward its top edge.
  if (material.finish === "polished" || material.finish === "satin") {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, "rgba(255,255,255,0.18)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.03)");
    grad.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  // A hairline bevel at the grout edge reads as a real tile shoulder.
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.02);
  ctx.strokeRect(x, y, w, h);

  ctx.restore();
}

/** Deterministic 0..1 — the same tile must look the same on every re-render. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Sets `repeat` so one texture module covers its true physical size.
 *
 * This is the step that ties the picture to reality: give it the surface size in
 * inches and the tile lands at true scale, so an 8-foot wall of 3x12 subway
 * shows the number of courses it would actually show.
 */
export function applyRealWorldRepeat(
  texture: THREE.Texture,
  moduleWidthIn: number,
  moduleHeightIn: number,
  surfaceWidthIn: number,
  surfaceHeightIn: number,
) {
  texture.repeat.set(
    moduleWidthIn > 0 ? surfaceWidthIn / moduleWidthIn : 1,
    moduleHeightIn > 0 ? surfaceHeightIn / moduleHeightIn : 1,
  );
  texture.needsUpdate = true;
}

/** Loads a swatch for canvas use. Resolves null rather than throwing. */
export function loadSwatch(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
