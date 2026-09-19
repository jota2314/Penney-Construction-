import type { Fixture, RoomSpec } from '@/types/design';
import { fixtureFootprint } from './plan';

/** Finished dimensions. Door opening is between the two finished wall ends. */
export function addShowerFront(spec: RoomSpec, showerId: string, settings: {
  side: 'right' | 'left' | 'front' | 'back'; openingIn: number;
  wallHeightIn: number; wallDepthIn: number; glassTopIn: number;
  curbHeightIn: number; materialId?: string; stoneId?: string;
}): RoomSpec {
  const shower = spec.fixtures.find(f => f.id === showerId && f.type === 'shower');
  if (!shower) throw new Error('Select a shower first.');
  const { spanX, spanZ } = fixtureFootprint(shower);
  const vertical = settings.side === 'right' || settings.side === 'left';
  const run = vertical ? spanZ : spanX;
  const { openingIn, wallHeightIn, wallDepthIn, glassTopIn, curbHeightIn } = settings;
  if (![openingIn, wallHeightIn, wallDepthIn, glassTopIn, curbHeightIn].every(Number.isFinite) || openingIn <= 0 || openingIn >= run || wallHeightIn <= curbHeightIn || wallDepthIn <= 0 || curbHeightIn < 0 || glassTopIn <= wallHeightIn) throw new Error('Check the opening, wall and glass dimensions.');
  const end = (run - openingIn) / 2;
  const edge = vertical ? shower.x + (settings.side === 'right' ? 1 : -1) * (spanX + wallDepthIn) / 2
    : shower.z + (settings.side === 'front' ? 1 : -1) * (spanZ + wallDepthIn) / 2;
  const center = vertical ? shower.z : shower.x;
  const base = (key: string, type: Fixture['type'], widthIn: number, heightIn: number, along: number, depthIn = wallDepthIn): Fixture => ({
    id: `${showerId}-front-${key}`, type, widthIn, depthIn, heightIn,
    x: vertical ? edge : along, z: vertical ? along : edge, rotationDeg: vertical ? 90 : 0,
    options: { showerFrontId: showerId },
  });
  const walls: Fixture[] = [-1, 1].map((sign, i) => ({
    ...base(`wall-${i}`, 'knee_wall', end, wallHeightIn, center + sign * (openingIn + end) / 2),
    label: `Knee wall ${i + 1}`, materialId: settings.materialId, accentMaterialId: settings.stoneId,
    options: { showerFrontId: showerId, capThicknessIn: 1.25, finishedSides: 2, exposedEnds: 1 },
  }));
  const components: Fixture[] = [...walls,
    { ...base('curb', 'curb', openingIn, curbHeightIn, center), label: 'Marble door curb', materialId: settings.stoneId },
    { ...base('door', 'glass_door', openingIn - 0.5, glassTopIn - curbHeightIn - 0.25, center, 0.375), label: 'Single glass door', yIn: curbHeightIn + 0.25, options: { showerFrontId: showerId, hingeBottomIn: 8, hingeTopIn: wallHeightIn - curbHeightIn - 5.25 } },
  ].filter(f => f.heightIn > 0);
  const inside = components.every(f => { const p = fixtureFootprint(f); return f.x - p.spanX / 2 >= -0.001 && f.z - p.spanZ / 2 >= -0.001 && f.x + p.spanX / 2 <= spec.room.widthIn + 0.001 && f.z + p.spanZ / 2 <= spec.room.lengthIn + 0.001; });
  if (!inside) throw new Error('The enclosure would extend outside the room. Choose an open side or move the shower.');
  return { ...spec, fixtures: [...spec.fixtures.filter(f => f.options?.showerFrontId !== showerId).map(f => f.id === showerId ? { ...f, options: { ...f.options, enclosure: 'open', curbHeightIn: 0 } } : f), ...components] };
}
