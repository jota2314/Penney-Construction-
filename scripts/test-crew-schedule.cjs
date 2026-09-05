/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness, matching the repository's standalone checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const context = { exports: {}, require: (name) => {
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
    if (name.includes('actions/daily-logs') || name.includes('job-docs-sheet')) return {};
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
      return load(fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts');
    }
    return require(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, context, { filename: file });
  cache.set(file, context.exports);
  return context.exports;
}
const { crewToday, scheduleDays, workOnDate } = load('src/lib/crew/schedule-dates.ts');
assert.equal(crewToday(new Date('2026-09-06T02:00:00Z')), '2026-09-05');
assert.equal(scheduleDays('2026-12-28').at(-1), '2027-01-10');
assert.equal(scheduleDays('2026-10-30')[3], '2026-11-02');
assert.equal(new Set(scheduleDays('2026-03-06')).size, 14);
const phase = { id: 'example', name: 'Kitchen framing', project_name: 'Example renovation', project_number: 'DEMO',
  start_date: '2026-09-08', end_date: '2026-09-09', crew: [], status: 'not_started' };
assert.equal(workOnDate([phase], '2026-09-07').length, 0);
assert.equal(workOnDate([phase], '2026-09-08').length, 1);
assert.equal(workOnDate([phase], '2026-09-09').length, 1);
assert.equal(workOnDate([phase], '2026-09-10').length, 0);
const { CrewSchedule } = load('src/components/crew/crew-schedule.tsx');
const { TodaysWorkCard } = load('src/components/field-feed/todays-work-card.tsx');
const schedule = renderToStaticMarkup(React.createElement(CrewSchedule, { phases: [phase], today: '2026-09-05' }));
assert.equal((schedule.match(/aria-pressed=/g) || []).length, 14);
assert.match(schedule, /Tuesday, September 8, 1 assignments/);
assert.match(schedule, /Nothing scheduled for you today/);
const future = renderToStaticMarkup(React.createElement(TodaysWorkCard, { phases: [phase], selectedDate: '2026-09-08', isToday: false }));
assert.doesNotMatch(future, />Clock in<|Today only|Today’s task/);
assert.match(future, /Scheduled task/);
assert.match(future, /Day 1 of 2/);
assert.match(future, /Plans/);
const today = renderToStaticMarkup(React.createElement(TodaysWorkCard, { phases: [phase], selectedDate: '2026-09-08' }));
assert.match(today, />Clock in</);
const error = renderToStaticMarkup(React.createElement(CrewSchedule, { phases: [], today: '2026-09-05', unavailable: true }));
assert.match(error, /Try again/);
assert.doesNotMatch(error, /Nothing scheduled/);
console.log('18 crew schedule checks passed: calendar boundaries, multi-day work, date strip, empty/error states and future clock controls.');

if (process.argv.includes('--preview')) {
  const { PCC_TOKENS } = load('src/components/field-feed/tokens.ts');
  const style = Object.entries(PCC_TOKENS).map(([key, value]) => `${key}:${value}`).join(';');
  const postcss = require('postcss');
  postcss([require('@tailwindcss/postcss')({ base: process.cwd() })]).process('@import "tailwindcss";', { from: path.resolve('preview.css') }).then(result => {
    fs.mkdirSync('.crew-preview', { recursive: true });
    fs.writeFileSync('.crew-preview/index.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${result.css}</style></head><body style="margin:0;background:#100e0b;color:#eee;font-family:Arial, sans-serif;${style}"><main class="max-w-[460px] mx-auto p-4 flex flex-col gap-4"><p class="text-xs">LOCAL PREVIEW · SAMPLE ASSIGNMENT</p><h1 class="text-3xl font-semibold">Morning, Dylan.</h1>${schedule}<hr><p class="text-xs">SELECTED TUESDAY — DETAIL PREVIEW</p>${future}</main></body></html>`);
  });
}
