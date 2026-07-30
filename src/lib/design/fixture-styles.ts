/**
 * Clickable styles for each fixture.
 *
 * The 3D viewer has always rendered these variants — an alcove tub differs from
 * a freestanding one, a vanity can float, a shower can have a curtain instead of
 * glass — but the only way to reach them was to ask the AI in words. This is the
 * same capability, exposed as buttons.
 *
 * Declared as data rather than hand-written JSX per fixture so adding a variant
 * is one line here plus its geometry, instead of another block of panel markup.
 */

import type { FixtureType } from "@/types/design";

export interface StyleChoice {
  value: string | number | boolean;
  label: string;
  /**
   * Dimensions that come WITH the choice. A freestanding tub is a different
   * object from an alcove tub, not the same box with a different shell, so
   * picking one should resize it rather than leaving a 60x30 freestanding tub
   * that doesn't exist.
   */
  dimensions?: { widthIn?: number; depthIn?: number; heightIn?: number };
}

export interface StyleControl {
  /** Key inside Fixture.options. */
  key: string;
  label: string;
  choices: StyleChoice[];
  fallback: string | number | boolean;
}

export const FIXTURE_STYLES: Partial<Record<FixtureType, StyleControl[]>> = {
  tub: [
    {
      key: "style",
      label: "Tub type",
      fallback: "alcove",
      choices: [
        // The default for a hall bath: three walls, one apron.
        { value: "alcove", label: "Alcove", dimensions: { widthIn: 60, depthIn: 30, heightIn: 20 } },
        { value: "freestanding", label: "Freestanding", dimensions: { widthIn: 66, depthIn: 32, heightIn: 24 } },
        { value: "drop_in", label: "Drop-in", dimensions: { widthIn: 66, depthIn: 36, heightIn: 22 } },
      ],
    },
  ],

  vanity: [
    {
      key: "style",
      label: "Vanity",
      fallback: "freestanding",
      choices: [
        { value: "freestanding", label: "Floor" },
        { value: "floating", label: "Floating" },
      ],
    },
    {
      key: "sinks",
      label: "Sinks",
      fallback: 1,
      choices: [
        { value: 1, label: "Single", dimensions: { widthIn: 36 } },
        // A double vanity needs the width or the bowls collide.
        { value: 2, label: "Double", dimensions: { widthIn: 60 } },
      ],
    },
  ],

  shower: [
    {
      key: "enclosure",
      label: "Enclosure",
      // Open tile is the default: these are site-built custom tile showers,
      // so glass is an addition rather than the starting point.
      fallback: "open",
      choices: [
        { value: "open", label: "Open tile" },
        { value: "glass_panel", label: "Glass panel" },
        { value: "glass_door", label: "Glass door" },
        { value: "curtain", label: "Curtain" },
      ],
    },
    {
      key: "hasBench",
      label: "Bench",
      fallback: false,
      choices: [
        { value: false, label: "None" },
        { value: true, label: "Built-in" },
      ],
    },
  ],

  toilet: [
    {
      key: "style",
      label: "Toilet",
      fallback: "floor",
      choices: [
        { value: "floor", label: "Floor mount", dimensions: { depthIn: 28, heightIn: 30 } },
        // Wall-hung hides the tank in the wall, so it projects less.
        { value: "wall_hung", label: "Wall hung", dimensions: { depthIn: 22, heightIn: 30 } },
      ],
    },
  ],

  mirror: [
    {
      key: "shape",
      label: "Shape",
      fallback: "rect",
      choices: [
        { value: "rect", label: "Rectangle" },
        { value: "round", label: "Round", dimensions: { widthIn: 30, heightIn: 30 } },
      ],
    },
    {
      key: "frame",
      label: "Frame",
      fallback: "none",
      choices: [
        { value: "none", label: "Frameless" },
        { value: "metal", label: "Metal" },
        { value: "wood", label: "Wood" },
      ],
    },
  ],
};

/** Which fixtures take a primary material (cabinet colour, tub shell, pan). */
export const FIXTURE_MATERIAL_SLOTS: Partial<
  Record<FixtureType, { materialLabel?: string; accentLabel?: string }>
> = {
  vanity: { materialLabel: "Cabinet", accentLabel: "Countertop" },
  tub: { materialLabel: "Tub shell" },
  shower: { materialLabel: "Pan & curb" },
  knee_wall: { materialLabel: "Faces", accentLabel: "Cap" },
  partition: { materialLabel: "Faces" },
  linen_cabinet: { materialLabel: "Cabinet" },
  bench: { materialLabel: "Bench" },
};
