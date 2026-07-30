/**
 * Tool schemas and system prompt for the bathroom design conversation.
 *
 * Split out from the route so the prompt can be read and edited on its own —
 * it is the part most likely to need tuning once real photos start coming in.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { WALL_IDS } from "@/types/design";

const WALL_ENUM = [...WALL_IDS];

const FIXTURE_ENUM = [
  "vanity",
  "toilet",
  "tub",
  "shower",
  "mirror",
  "medicine_cabinet",
  "linen_cabinet",
  "towel_bar",
  "sconce",
  "ceiling_light",
  "radiator",
  "bench",
];

const PATTERN_ENUM = [
  "stack",
  "running",
  "vertical_stack",
  "herringbone",
  "basketweave",
  "none",
];

export const DESIGN_TOOLS: Anthropic.Tool[] = [
  {
    name: "set_room",
    description:
      "Set the room name or overall dimensions. Use whenever measurements arrive — from a photo, a sketch, or spoken numbers.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name, e.g. 'Danti hall bath'." },
        widthIn: { type: "number", description: "Left-to-right, INCHES." },
        lengthIn: { type: "number", description: "Back-to-front, INCHES." },
        ceilingHeightIn: { type: "number", description: "Finished floor to ceiling, INCHES." },
      },
    },
  },
  {
    name: "define_material",
    description:
      "Create or update a material in the palette. Every finish must exist here before a surface or fixture can reference it. Use the REAL product size for tile — it drives both the render scale and the takeoff.",
    input_schema: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          description: "Stable slug, e.g. 'mat-shower-wall'. Reuse it to edit the same material.",
        },
        name: { type: "string", description: "What it is, e.g. 'Carrara 3x12 subway, polished'." },
        kind: {
          type: "string",
          enum: ["tile", "paint", "stone", "wood", "metal", "glass", "other"],
        },
        tileWidthIn: { type: "number", description: "Real tile width, INCHES. Omit for paint/slab." },
        tileHeightIn: { type: "number", description: "Real tile height, INCHES." },
        groutWidthIn: { type: "number", description: "Joint width, INCHES. 1/16 = 0.0625, 1/8 = 0.125." },
        groutColor: { type: "string", description: "Hex, e.g. '#d8d4cc'." },
        pattern: { type: "string", enum: PATTERN_ENUM },
        baseColor: {
          type: "string",
          description: "Hex. The dominant colour — used until a photo swatch is attached.",
        },
        roughness: { type: "number", description: "0 = mirror, 1 = flat matte." },
        metalness: { type: "number", description: "0 for tile/stone/paint, ~0.9 for metal." },
        finish: {
          type: "string",
          enum: ["matte", "polished", "honed", "satin", "textured"],
        },
      },
    },
  },
  {
    name: "set_finish",
    description:
      "Apply a material to the floor, the ceiling, or one wall. A wall can carry two materials with a split height — that is how tile wainscot with paint above is modelled.",
    input_schema: {
      type: "object",
      required: ["target", "materialId"],
      properties: {
        target: { type: "string", enum: ["floor", "ceiling", ...WALL_ENUM] },
        materialId: { type: "string", description: "Material id, from the floor up." },
        upperMaterialId: {
          type: "string",
          description: "Material above the split. Omit for a single-material wall.",
        },
        splitHeightIn: {
          type: "number",
          description: "Height of the lower band, INCHES. Only with upperMaterialId.",
        },
        pattern: { type: "string", enum: PATTERN_ENUM, description: "Floor only." },
        rotationDeg: { type: "number", description: "Floor only. 45 for a diagonal lay." },
        isWet: { type: "boolean", description: "Mark a shower/tub wall so tile is counted separately." },
      },
    },
  },
  {
    name: "place_opening",
    description:
      "Add or move a door, window, cased opening or niche. Position is in the wall's own frame: uIn is measured along the wall from its LEFT end as you stand in the room facing that wall, vIn is measured up from the finished floor.",
    input_schema: {
      type: "object",
      required: ["wall", "id"],
      properties: {
        wall: { type: "string", enum: WALL_ENUM },
        id: { type: "string", description: "Stable slug, e.g. 'op-window'. Reuse to move it." },
        type: { type: "string", enum: ["door", "window", "niche", "cased_opening"] },
        uIn: { type: "number", description: "Inches from the wall's left end to the opening's left edge." },
        vIn: { type: "number", description: "Inches from the floor to the opening's bottom edge." },
        widthIn: { type: "number" },
        heightIn: { type: "number" },
        depthIn: { type: "number", description: "Recess depth for a niche. Typically 3.5." },
        materialId: { type: "string", description: "Niche interior finish, often an accent." },
        label: { type: "string" },
      },
    },
  },
  {
    name: "remove_opening",
    description: "Delete a door, window or niche.",
    input_schema: {
      type: "object",
      required: ["wall", "id"],
      properties: {
        wall: { type: "string", enum: WALL_ENUM },
        id: { type: "string" },
      },
    },
  },
  {
    name: "place_fixture",
    description:
      "Add or move a fixture. x and z are the CENTRE of its footprint in inches from the room's back-left corner: x runs left to right, z runs from the back wall toward the front. rotationDeg 0 means the fixture's back is against the BACK wall; 90 puts its back on the LEFT wall; 180 the FRONT wall; 270 the RIGHT wall.",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Stable slug, e.g. 'fx-vanity'. Reuse to move it." },
        type: { type: "string", enum: FIXTURE_ENUM },
        label: { type: "string" },
        widthIn: { type: "number", description: "Across the face." },
        depthIn: { type: "number", description: "Front to back." },
        heightIn: { type: "number" },
        x: { type: "number", description: "Footprint centre, inches from the LEFT wall." },
        z: { type: "number", description: "Footprint centre, inches from the BACK wall." },
        yIn: { type: "number", description: "Inches off the floor. For wall-hung items only." },
        rotationDeg: { type: "number", enum: [0, 90, 180, 270] },
        materialId: { type: "string", description: "Main finish — cabinet colour, pan, tub shell." },
        accentMaterialId: { type: "string", description: "Secondary finish — e.g. a countertop." },
        color: { type: "string", description: "Hex override when no material fits." },
        options: {
          type: "object",
          description:
            "Type-specific detail. vanity: {sinks, style:'floating'|'freestanding'}. tub: {style:'alcove'|'freestanding'|'drop_in'}. shower: {enclosure:'glass_panel'|'glass_door'|'curtain'|'open', curbHeightIn, hasBench}. mirror: {shape:'rect'|'round', frame:'none'|'metal'|'wood'}. toilet: {style:'floor'|'wall_hung'}.",
        },
      },
    },
  },
  {
    name: "remove_fixture",
    description: "Delete a fixture.",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "note_assumption",
    description:
      "Record something you INFERRED rather than were told — a guessed dimension, an assumed fixture size. These are shown to the user flagged as assumptions. Use this instead of quietly guessing.",
    input_schema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" } },
    },
  },
  {
    name: "set_notes",
    description: "Replace the design's free-text notes — open questions, client preferences, decisions.",
    input_schema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" } },
    },
  },
];

export const DESIGN_SYSTEM_PROMPT = `You are a bathroom designer working alongside Jorge Betancur, the pre-construction manager and estimator at Penney Construction, a residential general contractor on the North Shore of Massachusetts.

This is his private design studio. It is a sandbox — nothing here reaches a client, the team, or a job's budget. Speak to him as a peer who builds bathrooms for a living, not as a salesperson.

## What you are doing
You maintain a 3D model of a bathroom. Every change you make happens through the tools. The model renders live in front of him as you work, and it also produces the tile quantities, so the geometry has to be right, not just pretty.

## Units and geometry — get these exactly right
- EVERY dimension is INCHES. Never centimetres, never feet. 8 feet is 96.
- The room's back-left corner is the origin. x runs left to right. z runs from the back wall toward the front wall. The FRONT wall is the one you walk in through.
- Fixture x/z is the CENTRE of its footprint.
- rotationDeg 0 = back against the BACK wall. 90 = back against the LEFT wall. 180 = FRONT. 270 = RIGHT.
- To put a 36" vanity flat against the back wall of a 60"-wide room: x = 30, z = depth/2, rotation 0.
- Opening uIn is measured along the wall from its LEFT end AS YOU STAND IN THE ROOM FACING THAT WALL.

## How to work
When he sends a photo or sketch:
1. Read every dimension you can actually see. Say what you read.
2. Build the room with set_room, then define_material for each finish, then set_finish, then place the openings and fixtures.
3. Anything you could not read, infer sensibly AND record it with note_assumption. Never present a guessed dimension as measured.

When he asks for a change, make only that change. The stored model persists between turns — you do not need to restate what you are not changing, and you must not re-place fixtures that are already correct.

## Judgement — you know this trade
Apply real code and real practice without being asked:
- 15" minimum from a toilet centreline to any wall or fixture; 21" clear in front, 24" is better.
- A 30x60 alcove tub is the default. A 32" door is the standard bathroom door, 30" in tight spaces.
- Shower niches go on a dry-ish wall at 40-48" to the sill, never on an exterior wall.
- Vanity height 34-36". Mirror bottom about 40". Sconces about 60-66".
- A 5x8 with the tub on the back wall is the standard hall bath layout on the North Shore.
If something he asks for will not physically fit or violates clearance, say so plainly in one line, then build the closest thing that does work and note what you changed. Do not silently "fix" it and do not lecture.

## Materials
When he sends a photo of tile, read it carefully: dominant colour, real size, finish, and whether it is a directional or veined product. Set tileWidthIn/tileHeightIn to the ACTUAL product size — this is what makes the render show the right number of courses and the takeoff produce a real square footage. If you cannot tell the size from the photo, ask; do not assume a 12x24 because it looks large.

Grout: 1/16" (0.0625) for rectified porcelain and most subway, 1/8" (0.125) for standard ceramic, 3/16" for handmade.

## How to talk
Short. Plain. No em dashes. No preamble, no "Great question", no summarising back what he just said. Lead with what you did or what you need. If you need one number to proceed, ask for that one number and nothing else.

Never invent a price, a product SKU, or a lead time. This tool models geometry and finishes; pricing lives in the estimating system.`;
