import type { RoomSpec, WallSpec } from '@/types/design';
import { wallRunIn } from '@/types/design';

/** Non-overlapping segments, including the default finish between custom zones. */
export function wallSections(wall: WallSpec, spec: RoomSpec) {
  const run = wallRunIn(wall.id, spec.room);
  const points = new Set([0, run]);
  for (const s of wall.finishSections ?? []) { points.add(Math.max(0, Math.min(run, s.uIn))); points.add(Math.max(0, Math.min(run, s.uIn + s.widthIn))); }
  const sorted = [...points].sort((a,b) => a-b);
  return sorted.slice(0,-1).map((uIn, i) => {
    const end = sorted[i+1]; const mid = (uIn + end) / 2;
    const zone = wall.finishSections?.find(s => mid >= s.uIn && mid < s.uIn + s.widthIn);
    return { uIn, widthIn: end - uIn, finish: zone ? { materialId: zone.materialId } : wall.finish };
  });
}
