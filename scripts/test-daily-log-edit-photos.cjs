/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
let state, cursor, transition, edits, queued, failQueue;
const hooks = {
  ...React,
  useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => {state[i] = typeof value === 'function' ? value(state[i]) : value;}]; },
  useRef: initial => ({current: initial}), useEffect() {},
  useTransition: () => [false, fn => {transition = fn();}],
};
const context = {exports: {}, URL: {createObjectURL: () => 'blob:preview', revokeObjectURL() {}}, require: name => {
  if (name === 'react') return hooks;
  if (name === 'next/navigation') return {useRouter: () => ({refresh() {}})};
  if (name.includes('ui/dialog')) return new Proxy({}, {get: (_, key) => key});
  if (name.includes('ui/button')) return {Button: 'button'};
  if (name.includes('actions/daily-logs')) return {editDailyLog: async input => {edits.push(input); return {ok: true, text: input.text.trim()};}};
  if (name.includes('upload-queue')) return {enqueueDailyLogPhotos: async (id, files) => {if (failQueue) throw Error('Disk unavailable'); queued.push({id, files});}};
  if (name === './tokens') return {v: () => '#111'};
  return require(name);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/field-feed/daily-log-edit-button.tsx', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
}).outputText, context);
let text;
function render() {cursor = 0; return context.exports.DailyLogEditButton({logId: 'log', text, onSaved() {}});}
function all(node) {if (!node || typeof node !== 'object') return []; return [node, ...React.Children.toArray(node.props?.children).flatMap(all)];}
function find(test) {return all(render()).find(test);}
function reset(value) {state = []; edits = []; queued = []; failQueue = false; text = value; find(n => n.props?.['aria-label'] === 'Edit daily log').props.onClick();}
function add() {find(n => n.type === 'input' && n.props.multiple).props.onChange({target: {files: [{name: 'job.jpg'}], value: 'job.jpg'}});}
async function save() {find(n => n.type === 'form').props.onSubmit({preventDefault() {}}); await transition;}
(async () => {
  reset(null); add();
  assert.equal(find(n => n.props?.type === 'submit').props.disabled, false);
  await save(); assert.equal(edits.length, 0); assert.equal(queued[0].files.length, 1);
  reset('Old'); add();
  find(n => n.props?.['aria-label'] === 'Remove new photo 1').props.onClick();
  assert.equal(find(n => n.props?.type === 'submit').props.disabled, true);
  reset('Old'); add();
  find(n => n.type === 'textarea').props.onChange({target: {value: 'New'}});
  failQueue = true; await save();
  assert.equal(edits.length, 1); assert.ok(find(n => n.props?.role === 'alert'));
  assert.ok(find(n => n.props?.['aria-label'] === 'Remove new photo 1'));
  failQueue = false; await save();
  assert.equal(edits.length, 1); assert.equal(queued.length, 1);
  assert.equal(find(n => n.type === 'Dialog').props.open, false);
  console.log('PASS: photo-only saves, preview removal, text+photo save, failed enqueue preserves selection, retry does not re-save text.');
})().catch(error => {console.error(error); process.exitCode = 1;});
