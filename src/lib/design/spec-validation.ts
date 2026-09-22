import { z } from 'zod';
import type { RoomSpec } from '@/types/design';
import { FIXTURE_DEFAULTS } from './ops';

const dimension = z.number().positive().max(10000);
const position = z.number().min(0).max(10000);
const id = z.string().min(1).max(200);
const finishSection = z.object({ uIn: position, widthIn: dimension, materialId: id });
const baseboard = finishSection.extend({ heightIn: dimension, depthIn: dimension });
const opening = z.object({
  id, type: z.enum(['door', 'window', 'niche', 'cased_opening']),
  uIn: position, vIn: position, widthIn: dimension, heightIn: dimension,
}).passthrough();
const schema = z.object({
  modelKind: z.enum(["room", "building"]).optional(),
  version: z.number().int().nonnegative(), name: z.string().min(1).max(500),
  room: z.object({ widthIn: dimension, lengthIn: dimension, ceilingHeightIn: dimension }),
  walls: z.array(z.object({ id: z.enum(['back', 'front', 'left', 'right']), finish: z.object({ materialId: id }).passthrough(), openings: z.array(opening).max(100), finishSections: z.array(finishSection).max(100).optional(), baseboards: z.array(baseboard).max(100).optional() }).passthrough()).length(4),
  floor: z.object({ materialId: id }).passthrough(), ceiling: z.object({ materialId: id }).passthrough(),
  fixtures: z.array(z.object({ id, type: z.string().refine(t => Object.hasOwn(FIXTURE_DEFAULTS, t), 'Unknown fixture type'), widthIn: dimension, depthIn: dimension, heightIn: dimension, x: position, z: position, yIn: position.optional(), rotationDeg: z.number().finite().optional(), options: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).optional() }).passthrough()).max(1000),
  materials: z.array(z.object({ id, name: z.string(), kind: z.enum(['tile','paint','stone','wood','metal','glass','other']), baseColor: z.string(), tileWidthIn: dimension.nullish(), tileHeightIn: dimension.nullish() }).passthrough()).max(300),
  notes: z.string().optional(), assumptions: z.array(z.string()).optional(),
}).passthrough();

/** Validate before either importing or saving; never let NaN/negative geometry reach Three. */
export function parseRoomSpec(value: unknown): RoomSpec {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid model: ${result.error.issues[0].path.join('.')} — ${result.error.issues[0].message}`);
  const spec = result.data as unknown as RoomSpec;
  if (spec.modelKind !== "building" && spec.fixtures.length > 300) throw new Error("Room models support at most 300 fixtures.");
  for (const [label, list] of [['walls', spec.walls], ['fixtures', spec.fixtures], ['materials', spec.materials]] as const) {
    if (new Set(list.map(x => x.id)).size !== list.length) throw new Error(`Duplicate IDs in ${label}.`);
  }
  return spec;
}
