/* eslint-disable @typescript-eslint/no-require-imports */
// Run the real component's effects with synthetic image/network primitives.
// This covers resource lifetime; real dialog interaction is checked separately.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/crew/crew-gas-card.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function mount() {
  const state = [], effects = [], requests = [], decodes = [], created = [], revoked = [];
  const timers = new Map();
  let cursor = 0, timerId = 0, tree, alive = true, scheduled = false, postUnmountUpdates = 0;
  let render;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (alive) render(); });
  }
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => {
        if (!alive) { postUnmountUpdates++; return; }
        const next = typeof value === 'function' ? value(state[slot]) : value;
        if (!Object.is(next, state[slot])) { state[slot] = next; schedule(); }
      }];
    },
    useEffect(create, deps) {
      const slot = cursor++;
      const previous = effects[slot];
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
        previous?.cleanup?.();
        effects[slot] = { deps, pending: create };
      }
    },
  };
  function component(name) { return name; }
  const context = {
    exports: {}, AbortController, Promise,
    fetch(url, options) {
      const task = deferred();
      const request = { url, options, task };
      requests.push(request);
      options.signal.addEventListener('abort', () => task.reject(new Error('aborted')), { once: true });
      return task.promise;
    },
    URL: {
      createObjectURL(blob) { assert.equal(blob.synthetic, true); const url = `blob:synthetic-card-${created.length}`; created.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    window: {
      setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
      Image: class {
        set src(value) {
          this.source = value;
          // HTMLImageElement.decode rejects if the image request changes.
          if (this.decoding && !value) this.decoding.reject(new Error('image request changed'));
        }
        get src() { return this.source; }
        decode() {
          const task = deferred();
          this.decoding = task;
          decodes.push({ src: this.src, task });
          return task.promise;
        }
      },
    },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'next/image') return { __esModule: true, default: component('Image') };
      if (name === 'lucide-react') return Object.fromEntries(['ChevronRight','Fuel','Loader2','Sun','X'].map(key => [key, component(key)]));
      if (name === '@/components/ui/button') return { Button: component('Button') };
      if (name === '@/components/ui/dialog') return Object.fromEntries(['Dialog','DialogClose','DialogContent','DialogDescription','DialogTitle','DialogTrigger'].map(key => [key, component(key)]));
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(compiled, context, { filename: 'crew-gas-card.tsx' });
  render = () => {
    cursor = 0;
    tree = context.exports.CrewGasCard();
    for (const effect of effects) {
      if (effect?.pending) { const create = effect.pending; delete effect.pending; effect.cleanup = create(); }
    }
    return tree;
  };
  render();
  return {
    requests, decodes, created, revoked, timers,
    render,
    find: predicate => nodes(tree).find(predicate),
    status: () => nodes(tree).some(node => node.props?.role === 'alert') ? 'error' : nodes(tree).some(node => node.props?.role === 'status') ? 'loading' : 'ready',
    respond(index = requests.length - 1, { ok = true, type = 'image/jpeg' } = {}) {
      requests[index].task.resolve({ ok, headers: { get: () => type }, blob: async () => ({ synthetic: true }) });
    },
    retry() { const button = nodes(tree).find(node => node.type === 'Button'); assert(button, 'retry button shown'); button.props.onClick(); },
    expire() { for (const timer of [...timers.values()]) { assert.equal(timer.ms, 15000); timer.callback(); } },
    unmount() { alive = false; for (const effect of effects) effect?.cleanup?.(); },
    updatesAfterUnmount: () => postUnmountUpdates,
  };
}

test('prefetch starts on mount, waits for decode and survives unrelated rerenders without a second fetch', async () => {
  const app = mount();
  assert.equal(app.requests.length, 1);
  assert.equal(app.status(), 'loading');
  assert.equal(app.requests[0].options.cache, 'no-store');
  assert.equal(app.requests[0].options.credentials, 'same-origin');
  assert.equal(app.find(node => node.type === 'Dialog').props.onOpenChange, undefined, 'opening/closing must not clear prepared state');
  app.respond(); await flush();
  assert.equal(app.status(), 'loading', 'wait for decoding before showing ready');
  app.decodes[0].task.resolve(); await flush();
  assert.equal(app.status(), 'ready');
  const imageSrc = app.find(node => node.type === 'Image').props.src;
  for (let i = 0; i < 4; i++) app.render();
  assert.equal(app.requests.length, 1);
  assert.equal(app.find(node => node.type === 'Image').props.src, imageSrc);
  assert.equal(app.timers.size, 0);
  app.unmount();
  assert.deepEqual(app.revoked, [imageSrc]);
});

test('invalid status, non-image content and decode failure show retry; a retry can recover', async () => {
  for (const failure of ['status', 'content', 'decode']) {
    const app = mount();
    app.respond(0, { ok: failure !== 'status', type: failure === 'content' ? 'text/html' : 'image/jpeg' });
    await flush();
    if (failure === 'decode') { app.decodes[0].task.reject(new Error('bad image')); await flush(); }
    assert.equal(app.status(), 'error');
    assert.equal(app.created.length, failure === 'decode' ? 1 : 0);
    assert.equal(app.revoked.length, failure === 'decode' ? 1 : 0);
    app.retry(); await flush();
    assert.equal(app.status(), 'loading');
    assert.equal(app.requests.length, 2);
    app.respond(); await flush();
    app.decodes.at(-1).task.resolve(); await flush();
    assert.equal(app.status(), 'ready');
    app.unmount();
  }
});

test('fetch timeout is bounded and retry works', async () => {
  const app = mount();
  app.expire(); await flush();
  assert.equal(app.requests[0].options.signal.aborted, true);
  assert.equal(app.status(), 'error');
  app.retry(); await flush();
  app.respond(); await flush();
  app.decodes[0].task.resolve(); await flush();
  assert.equal(app.status(), 'ready');
  app.unmount();
});

test('unmount aborts pending requests and revokes an in-progress decoded object without late state updates', async () => {
  const fetching = mount();
  fetching.unmount(); await flush();
  assert.equal(fetching.requests[0].options.signal.aborted, true);
  assert.equal(fetching.timers.size, 0);
  assert.equal(fetching.updatesAfterUnmount(), 0);
  const decoding = mount();
  decoding.respond(); await flush();
  decoding.unmount();
  assert.deepEqual(decoding.revoked, decoding.created);
  decoding.decodes[0].task.resolve(); await flush();
  assert.equal(decoding.updatesAfterUnmount(), 0);
  assert.equal(decoding.timers.size, 0);
});

test('timeout during decode also stops loading and frees its object URL', async () => {
  const app = mount();
  app.respond(); await flush();
  assert.equal(app.decodes.length, 1);
  app.expire(); await flush();
  assert.equal(app.status(), 'error', 'a stalled decoder must not leave an indefinite spinner');
  assert.deepEqual(app.revoked, app.created);
  app.unmount();
});
