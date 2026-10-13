import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file) {
  const compiled = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', js)(require, compiled, compiled.exports);
  return compiled.exports;
}
const { correctScannedYear, scanDatePromptNote } = load('src/lib/finance/document-date.ts');

test('wrong years from real receipts snap to the scan year', () => {
  // 405 Pub printed 2026-08-21 faintly, read 2025, scanned 8/24
  assert.deepEqual(correctScannedYear('2025-08-21', '2026-08-24'), { date: '2026-08-21', readAs: '2025-08-21' });
  // Aubuchon "09/04/26" read as 2023, scanned same day
  assert.deepEqual(correctScannedYear('2023-09-04', '2026-09-04'), { date: '2026-09-04', readAs: '2023-09-04' });
  // Shopify "Sep 13" with no year, read as 2024
  assert.deepEqual(correctScannedYear('2024-09-13', '2026-09-13'), { date: '2026-09-13', readAs: '2024-09-13' });
  // BCG "10/07/20" cut off, read as 2025
  assert.deepEqual(correctScannedYear('2025-10-07', '2026-10-07'), { date: '2026-10-07', readAs: '2025-10-07' });
});

test('a year in the future snaps back', () => {
  assert.deepEqual(correctScannedYear('2027-09-04', '2026-09-05'), { date: '2026-09-04', readAs: '2027-09-04' });
});

test('a December bill scanned in January keeps last year', () => {
  assert.deepEqual(correctScannedYear('2026-12-29', '2027-01-04'), { date: '2026-12-29', readAs: null });
  // read with the wrong year entirely → last December, not next December
  assert.deepEqual(correctScannedYear('2024-12-29', '2027-01-04'), { date: '2026-12-29', readAs: '2024-12-29' });
});

test('plausible dates are left alone', () => {
  assert.deepEqual(correctScannedYear('2026-10-13', '2026-10-13'), { date: '2026-10-13', readAs: null });
  assert.deepEqual(correctScannedYear('2026-03-02', '2026-10-13'), { date: '2026-03-02', readAs: null });
  assert.deepEqual(correctScannedYear('2026-10-16', '2026-10-13'), { date: '2026-10-16', readAs: null });
  // genuinely old bill whose month/day is nowhere near today: nothing fits, keep it
  assert.deepEqual(correctScannedYear('2025-04-10', '2026-10-13'), { date: '2025-04-10', readAs: null });
});

test('junk in, null out', () => {
  assert.deepEqual(correctScannedYear(null, '2026-10-13'), { date: null, readAs: null });
  assert.deepEqual(correctScannedYear('9/4/26', '2026-10-13'), { date: null, readAs: null });
  assert.deepEqual(correctScannedYear('2026-02-30', '2026-10-13'), { date: null, readAs: null });
});

test('Feb 29 read in a non-leap scan year does not crash or invent a date', () => {
  assert.deepEqual(correctScannedYear('2024-02-29', '2026-03-10'), { date: '2024-02-29', readAs: null });
});

test('prompt note names the year and the two-digit form', () => {
  const note = scanDatePromptNote('2026-10-13');
  assert.match(note, /Today is 2026-10-13/);
  assert.match(note, /"26" means 2026/);
});
