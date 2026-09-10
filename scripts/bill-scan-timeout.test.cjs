const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function harness(respond) {
  let now = 0;
  const calls = [], logs = [];
  const module = { exports: {} };
  const source = fs.readFileSync('src/lib/bills/model.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports,
    Date: { now: () => now }, AbortSignal,
    console: { warn: (...args) => logs.push(args) },
    require: name => name === '@/lib/ai/claude' ? {
      CLAUDE_FALLBACK_MODELS: ['primary', 'fallback'],
      getAnthropicClient: async () => ({ messages: { create: async (body, options) => {
        calls.push({ body, options });
        return respond(calls.length, options, ms => { now += ms; });
      } } }),
    } : {},
  });
  return { ask: module.exports.askClaude, calls, logs, duration: module.exports.maxDuration };
}

test('slow primary falls back without SDK retries and shares time with allocation', async () => {
  const h = harness((attempt, options, advance) => {
    assert.equal(options.maxRetries, 0);
    assert.ok(options.signal instanceof AbortSignal);
    if (attempt === 1) {
      advance(45000);
      throw Object.assign(new Error('private provider body'), { name: 'APIConnectionTimeoutError' });
    }
    advance(attempt === 2 ? 40000 : 1000);
    return { content: [{ type: 'text', text: '{"amount":1019.73}' }] };
  });
  assert.equal((await h.ask([], 6000, 105000)).amount, 1019.73);
  await h.ask([], 1500, 105000);
  assert.deepEqual(h.calls.map(c => c.options.timeout), [45000, 45000, 20000]);

  assert.doesNotMatch(JSON.stringify(h.logs), /private provider body/);
});

test('exhausted budget skips optional allocation rather than losing the extraction', async () => {
  const h = harness(() => { throw new Error('must not call'); });
  assert.equal(await h.ask([], 1500, 500), null);
  assert.equal(h.calls.length, 0);
});

test('all provider failures return a recoverable failure and record safe diagnostics', async () => {
  const h = harness((_attempt, options, advance) => {
    advance(options.timeout);
    throw Object.assign(new Error('secret'), { name: 'APIError', status: 503 });
  });
  assert.equal(await h.ask([], 6000, 105000), null);
  assert.equal(h.calls.length, 2);
  assert.equal(h.logs.length, 2);
  assert.doesNotMatch(JSON.stringify(h.logs), /secret/);
});
