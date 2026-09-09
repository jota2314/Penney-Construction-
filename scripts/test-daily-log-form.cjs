/* eslint-disable @typescript-eslint/no-require-imports -- Standalone rendering regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const progressModule = { exports: {}, require };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/crew/report-progress.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, progressModule);
const schema = progressModule.exports.reportProgressSchema;
assert.equal(schema.safeParse({status:'remaining',remaining:'Two rooms',timeNeeded:'',blockers:'None'}).success, false);
assert.equal(schema.safeParse({status:'remaining',remaining:'',timeNeeded:'2 hours',blockers:'None'}).success, false);
assert.equal(schema.safeParse({status:'finished',remaining:'',timeNeeded:'',blockers:''}).success, false);
assert.equal(schema.safeParse({status:'finished',remaining:'',timeNeeded:'',blockers:'None'}).success, true);
assert.equal(schema.safeParse({status:'remaining',remaining:'Two rooms',timeNeeded:'2 hours',blockers:'None'}).success, true);
assert.equal(schema.safeParse({mode:'narrative'}).success, true);
assert.equal(progressModule.exports.formatReportProgress({mode:'narrative'}), '');
assert.equal(schema.safeParse({mode:'narrative',status:'finished'}).success, false);
// Render the actual composer body without a browser portal or network actions.
const wrapper = ({ children }) => React.createElement('div', null, children);
const context = { exports: {}, require: name => {
  if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  if (name.includes('crew/report-progress')) return progressModule.exports;
  if (name.includes('crew/schedule-dates')) return { scheduleDateLabel: (date, options) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { ...options, timeZone: 'America/New_York' }) };
  if (name.includes('ui/bottom-sheet')) return new Proxy({}, { get: () => wrapper });
  if (name.includes('ui/button')) return { Button: ({ children, disabled }) => React.createElement('button', { disabled }, children) };
  if (name.includes('use-speech-recognition')) return { useSpeechRecognition: () => ({ transcript: '', sessionId: 0, isSupported: true }) };
  if (name.includes('use-visible-sheet-input')) return { useVisibleSheetInput() {} };
  if (name.startsWith('@/')) return {};
  return require(name);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/schedule/daily-log-composer.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
const render = report => renderToStaticMarkup(React.createElement(context.exports.DailyLogComposer, {
  open: true, onOpenChange() {}, projectId: 'job', projectName: 'Test job', report,
}));
for (const html of [render(), render({ logId: 'shift', projectId: 'job', workDate: '2026-09-05', minutes: 30, firstClockIn: '2026-09-05T17:44:00Z', lastClockOut: '2026-09-05T18:14:00Z' })]) {
  assert.ok(html.includes('What did you finish?'));
  assert.ok(html.includes('What is left, and how much more time?'));
  assert.ok(html.includes('Anything blocking the next visit?'));
  assert.ok(!html.includes('Assigned task status'));
  assert.ok(!html.includes('Choose a status'));
  assert.ok(html.includes('Voice note') && html.includes('Take photo') && html.includes('Library'));
}
const linked = render({ logId: 'shift', projectId: 'job', workDate: '2026-09-05', minutes: 30, firstClockIn: '2026-09-05T17:44:00Z', lastClockOut: '2026-09-05T18:14:00Z' });
assert.ok(linked.includes('1:44 PM') && linked.includes('2:14 PM'));
assert.ok(linked.includes('Linked to your time'));
assert.match(linked, /<button disabled="">(?:(?!<\/button>)[\s\S])*Submit daily log<\/button>/);
console.log('Daily-log rendering passed: questions with or without linked time, Eastern clock times, voice/photos and required-report submit.');
