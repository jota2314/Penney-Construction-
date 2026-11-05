export type MasonryPlacement = { column: number; height: number };
export type MasonryEntry = { key: string | number; height: number } | null;

/** Return an immutable assignment snapshot. Null separates independent runs;
 * existing cards keep their column even if newer entries or media arrive. */
export function updateMasonryPlacements(current: ReadonlyMap<string | number, MasonryPlacement>, entries: MasonryEntry[]): ReadonlyMap<string | number, MasonryPlacement> {
  let next: Map<string | number, MasonryPlacement> | null = null;
  let heights = [0, 0];
  for (const entry of entries) {
    if (!entry) { heights = [0, 0]; continue; }
    const existing = (next ?? current).get(entry.key);
    const column = existing?.column ?? (heights[1] < heights[0] ? 1 : 0);
    const height = existing?.height ?? entry.height;
    if (!existing) {
      next ??= new Map(current);
      next.set(entry.key, { column, height });
    }
    heights[column] += height;
  }
  return next ?? current;
}
