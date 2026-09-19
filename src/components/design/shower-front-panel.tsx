'use client';
import { useState } from 'react';
import type { RoomSpec, Fixture } from '@/types/design';
import { addShowerFront } from '@/lib/design/shower-front';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ShowerFrontPanel({ spec, shower, onChange }: { spec: RoomSpec; shower: Fixture; onChange: (spec: RoomSpec) => void }) {
  const [side, setSide] = useState<'right'|'left'|'front'|'back'>('right');
  const [opening, setOpening] = useState(30);
  const [height, setHeight] = useState(48);
  const [error, setError] = useState('');
  return <div className="border rounded p-2 space-y-2">
    <p className="text-xs font-medium">Two knee walls + one glass door</p>
    <label className="text-xs">Shower side<select aria-label="Shower front side" className="block w-full border rounded p-1 bg-background" value={side} onChange={e => setSide(e.target.value as typeof side)}>{(['right','left','front','back'] as const).map(s => <option key={s}>{s}</option>)}</select></label>
    <label className="text-xs">Finished opening (in)<Input type="number" value={opening} onChange={e => setOpening(Number(e.target.value))} /></label>
    <label className="text-xs">Knee wall top (in)<Input type="number" value={height} onChange={e => setHeight(Number(e.target.value))} /></label>
    <p className="text-[11px] text-muted-foreground">Equal wall lengths; 5½″ thick, 1¼″ caps, 4″ curb, glass top 80″. Proposed dimensions; select each part to adjust. Glass fabrication gaps require verification.</p>
    <Button size="sm" variant="outline" onClick={() => { try { onChange(addShowerFront(spec, shower.id, { side, openingIn: opening, wallHeightIn: height, wallDepthIn: 5.5, glassTopIn: 80, curbHeightIn: 4, materialId: spec.walls.find(w => w.isWet)?.finish.materialId, stoneId: spec.materials.find(m => m.kind === 'stone')?.id ?? spec.floor.materialId })); setError(''); } catch (e) { setError(String(e)); } }}>Build shower front</Button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
