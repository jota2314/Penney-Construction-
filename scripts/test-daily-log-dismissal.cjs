/* eslint-disable @typescript-eslint/no-require-imports -- Standalone interaction regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

// Render the real job-folder element tree with a daily log open. Effects and
// server actions stay inert: this checks dismissal, without creating a log.
const job = { id: 'test-job', name: 'Test job', project_number: 'TEST' };
let stateIndex = 0;
let parentCloses = 0;
let composerOpen = true;
const Composer = () => null;
const context = { exports: {}, require: name => {
  if (name === 'react') return { ...React,
    useState(initial) {
      const index = stateIndex++;
      const value = index === 4 ? job : index === 6 ? composerOpen : initial;
      return [value, next => { if (index === 6) composerOpen = next; }];
    },
    useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
    useRef: current => ({ current }), useTransition: () => [false, fn => fn()],
  };
  if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  if (name === './tokens') return { v: name => name };
  if (name.includes('schedule/daily-log-composer')) return { DailyLogComposer: Composer };
  if (name.startsWith('@/')) return {};
  return require(name);
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/field-feed/job-clock-in-sheet.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
const tree = context.exports.JobClockInSheet({ onClose: () => { parentCloses++; } });
const composer = React.Children.toArray(tree.props.children).find(child => child.type === Composer);
assert.ok(composer?.props.open, 'Exercise the nested job-folder composer');
const backdrop = {};
// React portal clicks bubble to this handler with the original target, even
// though the portal content is mounted outside the backdrop in the DOM.
for (const control of ['textarea', 'library', 'camera', 'file-input', 'remove-photo', 'submit']) {
  tree.props.onClick({ target: { control }, currentTarget: backdrop });
  assert.equal(parentCloses, 0, `${control} must not unmount the draft`);
  assert.equal(composerOpen, true);
}
composer.props.onOpenChange(false);
assert.equal(composerOpen, false, 'Explicit close still closes the composer');
assert.equal(parentCloses, 0, 'Closing the composer returns to the job folder');
tree.props.onClick({ target: backdrop, currentTarget: backdrop });
assert.equal(parentCloses, 1, 'An actual backdrop click still closes the job folder');
console.log('PASS: daily-log portal interactions preserve the draft; explicit close and backdrop dismissal still work.');
