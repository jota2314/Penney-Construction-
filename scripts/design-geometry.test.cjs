const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const req = name => name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts') : require(name);
  new Function('module', 'exports', 'require', code)(mod, mod.exports, req);
  return mod.exports;
}
const { defaultRoomSpec } = load('src/types/design.ts');
const { addShowerFront } = load('src/lib/design/shower-front.ts');
const { sanitizeSpec } = load('src/lib/design/geometry.ts');
const { fixtureFootprint } = load('src/lib/design/plan.ts');
const { parseRoomSpec } = load('src/lib/design/spec-validation.ts');
const { computeTakeoff } = load('src/lib/design/takeoff.ts');
function room() {
  const spec = defaultRoomSpec();
  spec.room = { widthIn: 140, lengthIn: 133.6, ceilingHeightIn: 102 };
  spec.fixtures = [{ id: 'shower', type: 'shower', x: 27.7, z: 87.8, widthIn: 55.4, depthIn: 91.6, heightIn: 84, rotationDeg: 180, materialId: spec.floor.materialId }];
  return spec;
}
const settings = { side: 'right', openingIn: 30, wallHeightIn: 48, wallDepthIn: 5.5, glassTopIn: 80, curbHeightIn: 4 };
test('91.6 inch shower front has two 30.8 inch walls and one 30 inch opening', () => {
  const s = addShowerFront(room(), 'shower', settings);
  const walls = s.fixtures.filter(f => f.type === 'knee_wall');
  assert.equal(walls.length, 2);
  for (const f of walls) { assert.ok(Math.abs(f.widthIn - 30.8) < 1e-9); assert.equal(f.heightIn, 48); assert.ok(Math.abs(f.x - 58.15) < 1e-9); }
  assert.ok(Math.abs((walls[1].z - walls[1].widthIn / 2) - (walls[0].z + walls[0].widthIn / 2) - 30) < 1e-9);
  assert.equal(s.fixtures.filter(f => f.type === 'glass_door').length, 1);
  assert.equal(s.fixtures.filter(f => f.type === 'glass_panel' || f.type === 'tub').length, 0);
  const door = s.fixtures.find(f => f.type === 'glass_door');
  assert.equal(door.widthIn, 29.5); assert.equal(door.yIn + door.heightIn, 80);
  assert.ok(Math.abs(sanitizeSpec(s).spec.fixtures.at(-2).z - 87.8) < 1e-9);
});
test('changing enclosure regenerates only its own parts, without duplicate glass or curb', () => {
  const first = addShowerFront(room(), 'shower', settings);
  const s = addShowerFront(first, 'shower', { ...settings, openingIn: 32 });
  assert.equal(s.fixtures.length, first.fixtures.length);
  assert.equal(s.fixtures.find(f => f.type === 'glass_door').widthIn, 31.5);
  assert.equal(s.fixtures[0].options.curbHeightIn, 0);
  assert.equal(computeTakeoff(s).curbLf, 2.7);
});
test('enclosure rejects an opening wider than its run or a wall outside the room', () => {
  assert.throws(() => addShowerFront(room(), 'shower', { ...settings, openingIn: 100 }));
  assert.throws(() => addShowerFront(room(), 'shower', { ...settings, side: 'left' }));
});
test('rotated footprint and sanitizer agree at arbitrary angles', () => {
  const s = room(); s.fixtures[0] = { ...s.fixtures[0], widthIn: 40, depthIn: 20, rotationDeg: 45, x: 1, z: 1 };
  const fp = fixtureFootprint(s.fixtures[0]);
  assert.ok(Math.abs(fp.spanX - 60 / Math.sqrt(2)) < 1e-8);
  const f = sanitizeSpec(s).spec.fixtures[0];
  assert.equal(f.x, fp.spanX / 2); assert.equal(f.z, fp.spanZ / 2);
});
test('import preserves decimal dimensions and rejects invalid geometry and duplicate IDs', () => {
  const s = room(); assert.equal(parseRoomSpec(s).fixtures[0].depthIn, 91.6);
  assert.throws(() => parseRoomSpec({ ...s, room: { ...s.room, widthIn: NaN } }));
  assert.throws(() => parseRoomSpec({ ...s, fixtures: [...s.fixtures, s.fixtures[0]] }));
  assert.throws(() => parseRoomSpec({ ...s, fixtures: [{ ...s.fixtures[0], depthIn: -3 }] }));
});
test('shower pan remains counted after subtracting it from dry floor', () => {
  const s = room();
  const q = computeTakeoff(s);
  const tile = q.tile.find(t => t.materialId === s.floor.materialId);
  assert.ok(tile.breakdown.some(b => b.label.includes('pan') && b.sf === 35.2));
});
test('saved bathroom fixture round-trips without shifting either knee wall', () => {
  const fixture = JSON.parse(fs.readFileSync('scripts/fixtures/shower-room.json', 'utf8'));
  const parsed = parseRoomSpec(fixture);
  const clean = sanitizeSpec(parsed).spec;
  for (const f of clean.fixtures) {
    const original = fixture.fixtures.find(o => o.id === f.id);
    assert.ok(Math.abs(f.x - original.x) < 1e-8);
    assert.ok(Math.abs(f.z - original.z) < 1e-8);
  }
  const { checkClearances } = load('src/lib/design/plan.ts');
  assert.ok(!checkClearances(clean).some(i => i.message.includes('Overlaps the Marble curb')));
});
test('finish zones count the shower wall separately from painted toilet wall', () => {
  const s = room(); s.walls.forEach(w => { w.openings = []; w.finish = { materialId: 'paint' }; });
  s.materials.push({ id: 'paint', kind: 'paint', name: 'Paint', baseColor: '#fff' });
  s.walls.find(w => w.id === 'left').finishSections = [{ uIn: 0, widthIn: 91.6, materialId: s.floor.materialId }];
  const q = computeTakeoff(s);
  const wallArea = q.tile.find(t => t.materialId === s.floor.materialId).breakdown.filter(b => b.label.includes('left')).reduce((sum,b) => sum+b.sf, 0);
  assert.ok(Math.abs(wallArea - 91.6 * 102 / 144) < 0.1);
});

function saveHarness({ fail = false, conflict = false, authorized = true } = {}) {
  const stored = room(), filters = []; let writes = 0;
  const client = { from(table) {
    let mutation = false;
    const q = {
      select() { return q; },
      eq(k,v) { filters.push([k,v]); return q; },
      single: async () => ({ data: { spec: stored } }),
      update() { mutation = true; writes++; return q; },
      insert: async () => ({ error: null }),
      then(resolve) { return Promise.resolve({ data: mutation && !conflict ? [{ id:'design' }] : [], error: fail ? { message:'save failed' } : null }).then(resolve); },
    }; return q;
  } };
  const imports = {
    'next/cache': {}, 'next/navigation': { redirect() { throw new Error('unauthorized'); } },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/auth/get-user': { getUser: async () => ({id:'owner',email:'owner'}) },
    '@/lib/auth/role-access': { canViewDesignStudio: () => authorized },
    '@/lib/design/storage': { stripSignedUrls: s => s },
  };
  const mod = {exports:{}};
  const code = ts.transpileModule(fs.readFileSync('src/lib/actions/design.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('module','exports','require',code)(mod,mod.exports, name => imports[name] ?? load('src/' + name.slice(2) + '.ts'));
  return { save: mod.exports.saveDesignSpec, stored, filters, writes: () => writes };
}
test('save returns authoritative sanitized geometry and protects owner/version', async () => {
  const h = saveHarness(); const draft = structuredClone(h.stored); draft.fixtures[0].x = 0;
  const saved = await h.save('design', draft);
  assert.ok(saved.spec.fixtures[0].x > 0);
  assert.equal(saved.version, h.stored.version + 1);
  assert.ok(h.filters.some(([k,v]) => k === 'owner_id' && v === 'owner'));
  assert.ok(h.filters.some(([k,v]) => k === 'spec->>version' && v === String(h.stored.version)));
});
test('save rejects database failure, concurrent edit and unauthorized access', async () => {
  for (const opts of [{fail:true},{conflict:true},{authorized:false}]) {
    const h = saveHarness(opts); await assert.rejects(h.save('design', h.stored));
    if (opts.authorized === false) assert.equal(h.writes(),0);
  }
  const h = saveHarness(); await assert.rejects(h.save('design', {...h.stored,version:999})); assert.equal(h.writes(),0);
});
