// Exercise the review/confirmation handlers without a browser or any live sends.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (key) => {
    if (!(key in imports)) throw new Error(`Unexpected import: ${key}`);
    return imports[key];
  }, console, Date, Intl, crypto });
  return exports;
}

let frame;
const tasks = [];
const hooks = {
  useState(initial) {
    const current = frame, index = current.index++;
    if (!(index in current.values)) current.values[index] = typeof initial === 'function' ? initial() : initial;
    return [current.values[index], (next) => { current.values[index] = typeof next === 'function' ? next(current.values[index]) : next; }];
  },
  useRef(initial) {
    const current = frame, index = current.index++;
    if (!(index in current.values)) current.values[index] = { current: initial };
    return current.values[index];
  },
  useEffect(effect, deps) {
    const current = frame, index = current.index++;
    const old = current.values[index];
    if (!old || deps.some((value, i) => value !== old[i])) {
      current.values[index] = deps;
      current.effects.push(effect);
    }
  },
  useTransition() {
    return [false, (task) => { const pending = task(); tasks.push(Promise.resolve(pending)); }];
  },
};
function mount(component, props) {
  const current = { values: [], index: 0, effects: [] };
  return { render() {
    current.index = 0; frame = current;
    const tree = component(props);
    for (const effect of current.effects.splice(0)) effect();
    return tree;
  } };
}
function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function words(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(words).join('');
  if (typeof tree !== 'object') return String(tree);
  return words(tree.props?.children);
}
function button(tree, label) {
  const found = nodes(tree).find((node) => node.type === 'Button' && words(node) === label);
  assert.ok(found, `Missing button ${label}`);
  return found;
}
async function settle() {
  await Promise.all(tasks.splice(0));
  await new Promise((resolve) => setImmediate(resolve));
}

const days = load('src/lib/sub-portal/et-day.ts', {});
const model = load('src/lib/inquiries/model.ts', { '@/lib/sub-portal/et-day': days });
const templates = load('src/lib/inquiries/email-templates.ts', { './model': model });
const sends = [], deletions = [];
let sendResult = { success: true, messageId: 'mock-message' };
const ui = load('src/components/inquiries/inquiry-actions.tsx', {
  react: hooks, 'react/jsx-runtime': jsx,
  'next/navigation': { useRouter: () => ({ refresh() {}, replace() {} }) },
  'lucide-react': Object.fromEntries(['CalendarClock', 'Loader2', 'Mail', 'Phone', 'Send', 'Trash2'].map((name) => [name, name])),
  '@/components/ui/button': { Button: 'Button' },
  '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map((name) => [name, name])),
  '@/lib/actions/website-inquiries': {
    deleteWebsiteInquiry: async (input) => { deletions.push(input); return { error: null }; },
    updateWebsiteInquiry: async () => ({ error: null }),
  },
  '@/lib/actions/website-inquiry-email': {
    getWebsiteInquiryEmailSender: async () => ({ email: 'reviewer@example.com' }),
    listWebsiteInquiryEmails: async () => [],
    sendWebsiteInquiryEmail: async (input) => { sends.push(input); return sendResult; },
  },
  '@/lib/inquiries/model': model,
  '@/lib/inquiries/email-templates': templates,
});
const inquiry = { id: crypto.randomUUID(), updated_at: '2026-11-04T16:00:00Z', created_at: '2026-11-04T15:00:00Z', contact_name: 'Example Client', description: '', status: 'open', intake_status: 'new', assignee: 'Shannon', due_date: '2026-11-05T22:00:00Z', snooze_until: null, lead_id: null, website_inquiry: { name: 'Example Client', email: 'client@example.com', projectType: 'addition', town: 'Example Town', phone: '555-555-0100' } };
const props = { inquiry, assignees: ['Jorge', 'Ryan', 'Nicole', 'Shannon'], senderName: 'Jorge Betancur', readOnly: false, onMessage() {} };

(async () => {
  const actions = mount(ui.InquiryActions, props);
  let tree = actions.render();
  button(tree, 'Email client').props.onClick();
  tree = actions.render();
  const emailNode = nodes(tree).find((node) => typeof node.type === 'function');
  assert.ok(emailNode, 'Email button opens a review dialog');
  const dialog = mount(emailNode.type, emailNode.props);
  tree = dialog.render();
  assert.equal(button(tree, 'Send email').props.disabled, true, 'Cannot send before sender/history checks');
  await settle(); tree = dialog.render();
  assert.equal(sends.length, 0, 'Opening and preparing a draft never sends');
  assert.ok(words(tree).includes('client@example.com'));
  assert.ok(words(tree).includes('reviewer@example.com'));
  nodes(tree).find((node) => node.type === 'input').props.onChange({ target: { value: 'Reviewed subject' } });
  tree = dialog.render();
  nodes(tree).find((node) => node.type === 'textarea').props.onChange({ target: { value: 'Reviewed message only.' } });
  tree = dialog.render();
  const form = nodes(tree).find((node) => node.type === 'form');
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  await settle();
  assert.equal(sends.length, 1, 'Double-click is guarded before awaiting transport');
  assert.equal(sends[0].subject, 'Reviewed subject');
  assert.equal(sends[0].body, 'Reviewed message only.');
  assert.equal(sends[0].expectedRecipient, 'client@example.com');
  assert.equal(sends[0].expectedSender, 'reviewer@example.com');

  const uncertainActions = mount(ui.InquiryActions, props);
  button(uncertainActions.render(), 'Email client').props.onClick();
  const uncertainNode = nodes(uncertainActions.render()).find((node) => typeof node.type === 'function');
  const uncertainDialog = mount(uncertainNode.type, uncertainNode.props);
  uncertainDialog.render(); await settle();
  sendResult = { success: false, error: 'Check Sent before trying again.', deliveryUncertain: true };
  nodes(uncertainDialog.render()).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();
  assert.equal(button(uncertainDialog.render(), 'Send email').props.disabled, true, 'Ambiguous delivery cannot be retried blindly');

  const deleteActions = mount(ui.InquiryActions, props);
  button(deleteActions.render(), 'Delete').props.onClick();
  const deleteNode = nodes(deleteActions.render()).find((node) => typeof node.type === 'function');
  const confirmation = mount(deleteNode.type, deleteNode.props).render();
  assert.equal(deletions.length, 0, 'Delete first opens a confirmation');
  assert.ok(words(confirmation).includes('Example Client'));
  assert.ok(words(confirmation).includes('permanently'));
  button(confirmation, 'Delete inquiry').props.onClick(); await settle();
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].id, inquiry.id);
  assert.equal(deletions[0].expectedUpdatedAt, inquiry.updated_at);

  const readOnly = mount(ui.InquiryActions, { ...props, readOnly: true }).render();
  for (const label of ['Email client', 'Follow-up', 'Delete']) assert.equal(button(readOnly, label).props.disabled, true);
  assert.equal(ui.inquiryPhoneLink('javascript:alert(1)'), null);
  console.log('PASS: draft review before send, exact edited content/sender, double-click protection, uncertain-send block, named delete confirmation, and View as controls. No browser, live emails or real records used.');
})().catch((error) => { console.error(error); process.exit(1); });
