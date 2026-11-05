// Non-UI regression checks for paging, refresh races, filters and lazy media.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; }, console, Date, Set, Map, Promise, setTimeout, clearTimeout, ...globals });
  return exports;
}
const model = load('src/components/field-feed/command-center-timeline-state.ts');
const masonry = load('src/components/field-feed/masonry-placements.ts');
const emptyPlacements = new Map();
const firstPlacements = masonry.updateMasonryPlacements(emptyPlacements, [{ key: 'one', height: 100 }, { key: 'two', height: 150 }]);
assert.equal(emptyPlacements.size, 0, 'masonry assignment never mutates prior state');
assert.equal(firstPlacements.get('one').column, 0);
assert.equal(firstPlacements.get('two').column, 1);
const refreshedPlacements = masonry.updateMasonryPlacements(firstPlacements, [null, { key: 'new', height: 700 }, { key: 'one', height: 600 }, { key: 'two', height: 150 }]);
assert.equal(refreshedPlacements.get('one').column, 0, 'refreshed head/media cannot move an existing card');
assert.equal(refreshedPlacements.get('two').column, 1);
assert.equal(firstPlacements.size, 2);
assert.equal(masonry.updateMasonryPlacements(refreshedPlacements, [{ key: 'two', height: 999 }]), refreshedPlacements, 'filtering does not reset saved columns');
const log = (id, minute = Number(id), text = id) => ({ type: 'logPost', log: { id: String(id), started_at: new Date(Date.UTC(2026, 10, 4, 12, minute)).toISOString(), text } });
const page = (items, nextCursor = 'next') => ({ items, nextCursor });
const ids = (state) => Array.from(state.items, (item) => item.log.id);

let state = model.initialTimeline(page([log(5), log(4), log(3)], 'after-3'));
state = model.appendTimeline(state, page([log(3), log(2), log(1)], 'after-1'), 'after-3');
assert.deepEqual(ids(state), ['5', '4', '3', '2', '1'], 'append deduplicates overlap');
state = model.refreshTimeline(state, page([log(6), log(5, 5, 'edited'), log(3)], 'new-head'));
assert.deepEqual(ids(state), ['6', '5', '3', '2', '1'], 'refresh removes deleted head but retains loaded history');
assert.equal(state.nextCursor, 'after-1', 'refresh retains tail cursor');
state = model.appendTimeline(state, page([log(4), log(0)], 'after-0'), 'after-1');
assert.deepEqual(ids(state), ['6', '5', '3', '2', '1', '0'], 'stale request cannot revive deleted head');
assert.equal(state.items[1].log.text, 'edited');

state = model.removeTimelineItem(state, log(1));
state = model.refreshTimeline(state, page([log(6), log(5), log(3)], 'head'));
state = model.appendTimeline(state, page([log(1), log(-1)], null), 'after-0');
assert.ok(!ids(state).includes('1'), 'cached deletion survives refresh and subsequent pages/filter remount');
assert.ok(state.deletedKeys.has('log-1'));

const original = model.initialTimeline(page([log(3), log(2)], 'old-head'));
const loaded = model.appendTimeline(original, page([log(1), log(0)], 'old-tail'), 'old-head');
let gap = model.refreshTimeline(loaded, page([log(30), log(29)], 'fresh-head'));
assert.equal(gap.nextCursor, 'fresh-head', 'disjoint refresh restarts from newest cursor to fill missing history');
assert.deepEqual(ids(gap), ['30', '29', '3', '2', '1', '0']);
assert.equal(gap.cursorVersion, 1);
assert.equal(model.appendTimeline(gap, page([log(-1)], 'stale-cursor'), 'old-tail', 0), gap, 'outdated request cannot advance reset cursor');
gap = model.appendTimeline(gap, page([log(28), log(27), log(3)], 'after-27'), 'fresh-head', 1);
assert.deepEqual(ids(gap), ['30', '29', '28', '27', '3', '2', '1', '0'], 'gap pages insert chronologically ahead of cached older cards');
assert.equal(gap.nextCursor, 'after-27');

const tie = model.refreshTimeline(model.initialTimeline(page([log('b', 2), log('a', 2)], 'tie')), page([log('c', 3), log('b', 2)], 'tie-new'));
assert.ok(ids(tie).includes('a'), 'older tuple at same timestamp stays available');
const removedTie = model.refreshTimeline(tie, page([log('c', 3), log('a', 2)], 'tie-new'));
assert.ok(!ids(removedTie).includes('b'), 'authoritative equal-time boundary removes remotely deleted newer tuple');
assert.ok(!ids(model.appendTimeline(removedTie, page([log('b', 2)], null), 'tie-new')).includes('b'), 'stale equal-time response cannot revive removed post');
assert.equal(model.refreshTimeline(state, null), state, 'transient initial refresh failure retains history');
assert.deepEqual(ids(model.refreshTimeline(state, page([log(6)], null))), ['6'], 'exhaustive fresh page is authoritative');
assert.equal(model.timelineHasMore(model.initialTimeline(null), 'all'), true);
assert.equal(model.timelineHasMore(model.initialTimeline(page([], null)), 'all'), false);
const yesterday = { ...log(1), log: { ...log(1).log, started_at: new Date(Date.now() - 3 * 86400000).toISOString() } };
assert.equal(model.timelineHasMore(model.initialTimeline(page([yesterday])), 'day'), false, 'day filter stops before hidden older history');
assert.equal(model.timelineHasMore(model.initialTimeline(page([yesterday])), 'all'), true);
const media = load('src/components/field-feed/punch-media-state.ts');
const localPunch = { id: 'punch', status: 'done', photo_storage_paths: ['creation'], photo_signed_urls: ['signed:creation'], photo_thumb_urls: ['thumb:creation'], completion_photo_path: 'new-completion', completion_photo_url: 'signed:new-completion' };
assert.deepEqual(JSON.parse(JSON.stringify(media.mergePunchMedia(localPunch, { ...localPunch, photo_signed_urls: [], completion_photo_path: null, completion_photo_url: null }))), localPunch, 'stale unsigned props do not erase local punch photos or completion state');
assert.equal(media.mergePunchMedia({ ...localPunch, photo_signed_urls: [] }, localPunch).photo_signed_urls[0], 'signed:creation', 'resolved matching paths hydrate punch media');
const changedServerPhoto = { ...localPunch, photo_storage_paths: ['new-creation'], photo_signed_urls: ['signed:new-creation'] };
assert.equal(media.mergePunchMedia(localPunch, changedServerPhoto, localPunch).photo_signed_urls[0], 'signed:new-creation', 'unchanged local media follows a new server photo');
assert.equal(media.mergePunchMedia(localPunch, { ...localPunch, completion_photo_path: null, completion_photo_url: null }, { ...localPunch, completion_photo_path: 'old-completion' }).completion_photo_url, 'signed:new-completion', 'locally newer completion remains intact across stale server source');

let frame;
const hooks = {
  useState(initial) { const c = frame, i = c.index++; if (!(i in c.values)) c.values[i] = typeof initial === 'function' ? initial() : initial; return [c.values[i], (next) => { c.values[i] = typeof next === 'function' ? next(c.values[i]) : next; }]; },
  useRef(initial) { const c = frame, i = c.index++; if (!(i in c.values)) c.values[i] = { current: initial }; return c.values[i]; },
  useCallback(fn, deps) { const c = frame, i = c.index++, old = c.values[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) c.values[i] = { fn, deps }; return c.values[i].fn; },
  useEffect(effect, deps) { const c = frame, i = c.index++, old = c.effects[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) c.pending.push(() => { old?.cleanup?.(); c.effects[i] = { deps, cleanup: effect() }; }); },
};
function mount(fn) {
  const current = { values: [], effects: [], pending: [], index: 0 };
  return { render() { current.index = 0; frame = current; const result = fn(); current.pending.splice(0).forEach((effect) => effect()); return result; }, refs: current.values, unmount() { current.effects.forEach((effect) => effect?.cleanup?.()); } };
}
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const requests = [];
const hook = load('src/components/field-feed/use-command-center-timeline.ts', {
  react: hooks, './command-center-timeline-state': model,
  '@/lib/actions/command-center-updates': { getCommandCenterUpdatesPage: (cursor) => { const request = defer(); requests.push({ cursor, ...request }); return request.promise; } },
});

async function main() {
  let initial = page([log(5), log(4)], 'head');
  const mounted = mount(() => hook.useCommandCenterTimeline(initial, 'all'));
  let timeline = mounted.render(); timeline = mounted.render();
  const first = timeline.loadMore();
  void timeline.loadMore();
  assert.equal(requests.length, 1, 'repeated observer callbacks have one request in flight');
  initial = page([log(6), log(5)], 'refreshed-head');
  mounted.render(); mounted.render();
  requests[0].resolve(page([log(3), log(2)], 'tail'));
  await first;
  timeline = mounted.render();
  assert.deepEqual(Array.from(timeline.items, (entry) => entry.log.id), ['6', '5', '4', '3', '2'], 'refresh during pagination preserves both results');
  const failed = timeline.loadMore(); requests[1].reject(new Error('offline')); await failed;
  timeline = mounted.render(); assert.equal(timeline.error, true);
  const retry = timeline.loadMore(); requests[2].resolve(page([log(1)], null)); await retry;
  timeline = mounted.render(); assert.equal(timeline.error, false); assert.equal(timeline.hasMore, false);
  mounted.unmount();

  let observer, props = { hasMore: true, loading: false, error: false, filtered: false, loadMore: async () => { props.calls++; }, calls: 0 };
  class Observer { constructor(callback, options) { this.callback = callback; this.options = options; observer = this; } observe(target) { this.target = target; } disconnect() { this.disconnected = true; } }
  const pagination = load('src/components/field-feed/timeline-pagination.tsx', { react: hooks, 'react/jsx-runtime': jsx }, { IntersectionObserver: Observer });
  const sentinel = mount(() => pagination.TimelinePagination(props));
  sentinel.render();
  sentinel.refs[0].current = { id: 'sentinel' };
  props = { ...props, hasMore: false }; sentinel.render();
  props = { ...props, hasMore: true }; sentinel.render();
  assert.equal(observer.options.rootMargin, '600px 0px');
  observer.callback([{ isIntersecting: false }]); assert.equal(props.calls, 0);
  observer.callback([{ isIntersecting: true }]); assert.equal(props.calls, 1);
  props = { ...props, error: true }; sentinel.render(); assert.equal(observer.disconnected, true, 'errors disable auto retry loops');
  sentinel.unmount();

  const signing = [];
  const photos = load('src/components/field-feed/feed-photo-requests.ts', {
    '@/lib/actions/daily-logs': { signDailyLogPhotos: async (paths) => { signing.push({ bucket: 'logs', paths }); return Object.fromEntries(paths.map((path) => [path, { full: `full:${path}`, thumb: `thumb:${path}` }])); } },
    '@/lib/actions/company-feed': { signCompanyFeedPhotos: async (paths) => { signing.push({ bucket: 'project', paths }); return Object.fromEntries(paths.map((path) => [path, { full: `full:${path}`, thumb: `thumb:${path}` }])); } },
  });
  const [one, two] = await Promise.all([photos.requestFeedPhotos('logs', ['a', 'b']), photos.requestFeedPhotos('logs', ['b', 'c'])]);
  assert.equal(signing.length, 1, 'near-visible cards share a signing request');
  assert.deepEqual(Array.from(signing[0].paths), ['a', 'b', 'c']);
  assert.deepEqual(Object.keys(one), ['a', 'b']); assert.deepEqual(Object.keys(two), ['b', 'c']);
  await photos.requestFeedPhotos('project', Array.from({ length: 55 }, (_, index) => `p${index}`));
  assert.deepEqual(signing.slice(1).map((entry) => entry.paths.length), [24, 24, 7], 'large groups stay inside signing batch limits');
  console.log('Command Center timeline UI checks passed: refresh races, gap recovery, deletion retention, date bounds, retry, observer and media batching.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
