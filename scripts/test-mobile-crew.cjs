/* eslint-disable @typescript-eslint/no-require-imports -- Standalone regression harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const events = new Map();
const surface = prefix => ({ addEventListener: (name, fn) => events.set(prefix + name, fn), removeEventListener: name => events.delete(prefix + name) });
const viewport = { ...surface('vv:'), width: 390, height: 800, scale: 1 };
class Element {}
class Textarea extends Element { readOnly = false; disabled = false; }
class Input extends Element {}
const doc = { ...surface('doc:'), activeElement: null, visibilityState: 'visible' };
let hidden = false;
let cleanup;
const context = { exports: {}, window: { ...surface('win:'), visualViewport: viewport }, document: doc,
  HTMLElement: Element, HTMLTextAreaElement: Textarea, HTMLInputElement: Input,
  setTimeout: () => 1, clearTimeout() {},
  require: name => name === 'react' ? { useState: () => [false, value => { hidden = value; }], useEffect: fn => { cleanup = fn(); } } : require(name),
};
vm.runInNewContext(transpile('src/hooks/use-keyboard-inset.ts'), context);
context.exports.useKeyboardOpen();
viewport.height = 500;
events.get('vv:resize')();
assert.equal(hidden, false, 'Scrolling/browser resize must not hide navigation');
doc.activeElement = new Textarea();
events.get('win:focusin')();
assert.equal(hidden, true, 'Text focus plus a smaller viewport means keyboard');
doc.activeElement = null;
events.get('win:focusout')();
assert.equal(hidden, false, 'Navigation returns when typing ends');
doc.activeElement = new Textarea();
viewport.height = 400; viewport.scale = 2;
events.get('vv:resize')();
assert.equal(hidden, false, 'Pinch zoom must not count as a keyboard');
cleanup();
assert.equal(events.size, 0);

const listContext = { exports: {}, require };
vm.runInNewContext(transpile('src/components/crew/time-entry-list.tsx'), listContext);
const html = renderToStaticMarkup(React.createElement(listContext.exports.TimeEntryList, { entries: [
  { id: 'short', clock_in: '2026-09-05T01:00:00Z', clock_out: '2026-09-05T01:00:30Z', break_minutes: 0 },
  { id: 'break', clock_in: '2026-09-05T02:00:00Z', clock_out: '2026-09-05T02:01:00Z', break_minutes: 5 },
] }));
assert.ok(html.includes('&lt;1 min'));
assert.ok(html.includes('Fri, Sep 4'));
assert.ok(!html.includes('-1h'));
const rows = [
  { id: 'shift', started_at: '2026-09-05T12:00Z', ended_at: '2026-09-05T12:00:30Z', status: 'completed' },
  { id: 'photo', started_at: '2026-09-05T12:00Z', ended_at: '2026-09-05T12:00Z', status: 'completed' },
  { id: 'open', started_at: '2026-09-05T12:00Z', ended_at: null, status: 'in_progress' },
];
const query = { select() { return this; }, eq() { return this; }, gte() { return this; }, order: async () => ({ data: rows }) };
const actions = { exports: {}, require: name => {
  if (name === '@/lib/supabase/server') return { createClient: async () => ({ from: () => query }) };
  if (name === '@/lib/auth/get-user') return { getUser: async () => ({ id: 'worker' }) };
  if (name === 'zod') return require('zod');
  return {};
}};
vm.runInNewContext(transpile('src/lib/actions/daily-logs.ts'), actions);
actions.exports.getMyTimeLog().then(entries => {
  assert.equal(entries.map(e => e.id).join(','), 'shift,open', 'Keep real shifts, exclude zero-duration posts');
  console.log('Mobile crew checks passed: keyboard resize/focus/zoom, cleanup, Eastern dates, short shifts and photo-post exclusion.');
}).catch(error => { console.error(error); process.exitCode = 1; });
