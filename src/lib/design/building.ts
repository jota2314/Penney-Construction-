import type { Fixture, RoomSpec } from '@/types/design';

export type BuildingView = 'exterior' | 'first' | 'upper';

/** Building assemblies overlap by design; do not apply single-room takeoffs. */
export function buildingFixtureVisible(f: Fixture, view: BuildingView): boolean {
  if (view === 'exterior') return true;
  if (f.options?.buildingLayer === 'roof') return false;
  const upper = f.options?.buildingLayer === 'upper';
  return view === 'upper' ? upper : !upper;
}

/** Triangles for an actual pitched roof, in fixture-local inches, Y up. */
export function roofTriangles(w: number, d: number, h: number, kind: string): number[] {
  const a=[-w/2,0,-d/2], b=[w/2,0,-d/2], c=[w/2,0,d/2], e=[-w/2,0,d/2];
  const faces: number[][][]=[];
  if (kind === 'hip') {
    const inset=Math.min(w,d)*0.35;
    const r=[0,h,-d/2+inset], s=[0,h,d/2-inset];
    faces.push([a,b,r],[b,c,s],[b,s,r],[c,e,s],[e,a,r],[e,r,s]);
  } else if (kind === 'shed') {
    const r=[-w/2,h,d/2],s=[w/2,h,d/2];
    faces.push([a,b,s],[a,s,r],[a,r,e],[b,c,s],[e,r,s],[e,s,c]);
  } else {
    const r=[0,h,-d/2],s=[0,h,d/2];
    faces.push([a,b,r],[e,s,c],[a,r,s],[a,s,e],[b,c,s],[b,s,r]);
  }
  faces.push([a,e,c],[a,c,b]);
  return faces.flat(2);
}

export function isBuilding(spec: RoomSpec): boolean { return spec.modelKind === 'building'; }
