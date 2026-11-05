// Exercise the native review controls with mocked server actions: no browser or live writes.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

let frame;
const tasks = [];
const hooks = {
  useId() { return `field-${frame.index++}`; },
  useState(initial) {
    const current = frame, index = current.index++;
    if (!(index in current.values)) current.values[index] = typeof initial === 'function' ? initial() : initial;
    return [current.values[index], next => { current.values[index] = typeof next === 'function' ? next(current.values[index]) : next; }];
  },
  useRef(initial) {
    const current = frame, index = current.index++;
    if (!(index in current.values)) current.values[index] = { current: initial };
    return current.values[index];
  },
  useTransition() { return [false, task => { tasks.push(Promise.resolve(task())); }]; },
  useMemo(fn) { return fn(); },
  useEffect() {},
};
function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: key => {
    if (!(key in imports)) throw new Error(`Unexpected import: ${key}`);
    return imports[key];
  }, console, Date, Intl, Set, Map });
  return exports;
}
function mount(component, props) {
  const current = { values: [], index: 0 };
  return { render() { current.index = 0; frame = current; return component(props); } };
}
function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
function words(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(words).join('');
  return typeof tree === 'object' ? words(tree.props?.children) : String(tree);
}
function button(tree, label) {
  const node = nodes(tree).find(node => node.type === 'button' && words(node) === label);
  assert.ok(node, `Missing button: ${label}`); return node;
}
async function settle() { await Promise.all(tasks.splice(0)); }

const resolves = [], reopens = [], historyCalls = [];
let refreshes = 0, resolved = 0, result = {};
const ui = load('src/components/finances/non-job-spend.tsx', {
  react: hooks, 'react/jsx-runtime': jsx, 'next/link': { default: 'a' },
  'next/navigation': { useRouter: () => ({ refresh() { refreshes++; } }) },
  '@/lib/actions/non-job-spend': {
    resolveNonJobTransaction: async input => { resolves.push(input); return result; },
    reopenNonJobTransaction: async input => { reopens.push(input); return result; },
    getNonJobTransactionHistory: async id => { historyCalls.push(id); return [{
      id: 'audit-1', action: 'resolved', reason: 'owner_draw', note: 'Reviewed source', actor_name: 'Nicole', created_at: '2026-11-05T18:00:00Z',
    }]; },
  },
});
const version = '2026-11-05T17:00:00Z';
const row = {
  id: 'invoice-1', vendor_name: 'Example transfer', amount: 9000, invoice_number: null,
  invoice_date: '2026-11-04', payment_method: 'ach', updated_at: version,
  non_job_reason: 'owner_draw', non_job_note: 'Source checked', non_job_resolved_by_name: 'Nicole',
  non_job_resolved_at: '2026-11-05T18:00:00Z',
};

(async () => {
  const editor = mount(ui.ResolveNonJobEditor, {
    invoiceId: row.id, vendor: row.vendor_name, amount: row.amount, expectedUpdatedAt: version,
    onCancel() {}, onResolved() { resolved++; },
  });
  let tree = editor.render();
  assert.equal(nodes(tree).find(node => node.type === 'select').props.value, '', 'Never preselect a reason');
  assert.equal(button(tree, 'Confirm non-job transaction').props.disabled, true);
  button(tree, 'Confirm non-job transaction').props.onClick(); await settle();
  assert.equal(resolves.length, 0, 'No reason means no mutation even if the handler is invoked');
  assert.match(words(tree), /removes its job and budget-line assignment/);
  assert.match(words(tree), /payment records, attachments and change history are retained/);
  nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'card_payment_transfer' } });
  tree = editor.render();
  assert.equal(resolves.length, 0, 'Choosing a reason alone does not resolve');
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: '  Bank statement reference 123  ' } });
  tree = editor.render();
  const confirm = button(tree, 'Confirm non-job transaction');
  confirm.props.onClick(); confirm.props.onClick(); await settle();
  assert.equal(resolves.length, 1, 'Double click resolves only once');
  assert.equal(resolves[0].reason, 'card_payment_transfer');
  assert.equal(resolves[0].note, 'Bank statement reference 123');
  assert.equal(resolves[0].expectedUpdatedAt, version);
  assert.equal(resolved, 1);

  result = { error: 'Transaction changed. Refresh and review again.' };
  const stale = mount(ui.ResolveNonJobEditor, { invoiceId: row.id, vendor: row.vendor_name, amount: row.amount,
    expectedUpdatedAt: version, onCancel() {}, onResolved() { resolved++; } });
  tree = stale.render();
  nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'owner_draw' } });
  button(stale.render(), 'Confirm non-job transaction').props.onClick(); await settle();
  assert.match(words(stale.render()), /Transaction changed/);
  assert.equal(resolved, 1, 'Backend rejection must not remove the row');
  result = {};

  const list = mount(ui.NonJobTransactions, { rows: [row] });
  const rowNode = nodes(list.render()).find(node => typeof node.type === 'function');
  assert.ok(rowNode);
  const resolvedRow = mount(rowNode.type, rowNode.props);
  tree = resolvedRow.render();
  button(tree, 'Return to review').props.onClick();
  tree = resolvedRow.render();
  assert.equal(button(tree, 'Confirm return to review').props.disabled, true);
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: '   ' } });
  button(resolvedRow.render(), 'Confirm return to review').props.onClick(); await settle();
  assert.equal(reopens.length, 0, 'A blank reversal note cannot reopen');
  tree = resolvedRow.render();
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: ' Receipt shows a job material purchase. ' } });
  const reopen = button(resolvedRow.render(), 'Confirm return to review');
  reopen.props.onClick(); reopen.props.onClick(); await settle();
  assert.equal(reopens.length, 1);
  assert.equal(reopens[0].note, 'Receipt shows a job material purchase.');
  assert.equal(reopens[0].expectedUpdatedAt, version);
  assert.equal(refreshes, 1);

  const history = mount(ui.NonJobHistory, { invoiceId: row.id });
  tree = history.render();
  assert.equal(historyCalls.length, 0, 'History loads only on request');
  button(tree, 'View non-job history').props.onClick(); await settle();
  tree = history.render();
  assert.match(words(tree), /Resolved as non-job · Owner Draw/);
  assert.match(words(tree), /Nicole/);
  assert.match(words(tree), /Reviewed source/);
  assert.equal(historyCalls[0], row.id);

  const organizer = load('src/components/finances/spend-organizer.tsx', {
    react: hooks, 'react/jsx-runtime': jsx, 'react-dom': { createPortal() {} },
    'next/navigation': { useRouter: () => ({ refresh() {} }) }, 'next/link': { default: 'a' },
    'lucide-react': { FileText: 'FileText' }, '@/components/ui/pdf-viewer': { PdfViewer: 'PdfViewer' },
    '@/lib/attachments': { isPdfAttachment: () => false }, '@/lib/bills/scan-client': {}, '@/lib/receipts/save-upload': {},
    '@/lib/finance/review-invoice-groups': { pendingReviewAllocations: row => [row] }, '@/lib/actions/field-capture': {},
    '@/components/finances/budget-line-search-select': { BudgetLineSearchSelect: 'BudgetLineSearchSelect' },
    '@/components/finances/job-search-select': { JobSearchSelect: 'JobSearchSelect' }, '@/lib/money': {},
    '@/components/finances/non-job-spend': ui,
  });
  const capture = { ...row, budget_lines: [], created_at: version, non_job_block_reason: null };
  function organizerRow(capture) {
    const organizerTree = mount(organizer.SpendOrganizer, { rows: [capture], jobs: [] }).render();
    const node = nodes(organizerTree).find(node => typeof node.type === 'function' && node.type.name === 'OrganizerRow');
    return mount(node.type, node.props).render();
  }
  button(organizerRow(capture), 'Resolve as non-job transaction');
  for (const blocked of [{ ...capture, non_job_block_reason: 'Review the linked duplicate first' }, { ...capture, split_group_id: 'split-1' }, { ...capture, updated_at: null }]) {
    assert.equal(nodes(organizerRow(blocked)).some(node => node.type === 'button' && words(node) === 'Resolve as non-job transaction'), false,
      'Unsupported or stale records do not offer the action');
  }
  let detailRow = { ...row, non_job_resolved_at: '2026-11-05T18:00:00Z', payment_status: 'unpaid', paid_amount: 0,
    attachment_storage_path: 'receipt.pdf', quickbooks_id: 'QB-123', notes: 'Retained source note' };
  const detail = load('src/components/finances/bill-workspace.tsx', {
    'react/jsx-runtime': jsx, 'next/link': { default: 'a' }, 'next/navigation': { notFound() { throw new Error('Not found'); } },
    '@/components/layout/header': { Header: 'Header' }, '@/lib/auth/require-auth': { requireAuth: async () => ({ email: 'test@example.com' }) },
    '@/lib/auth/role-access': { canApproveBillPay: () => true },
    '@/lib/supabase/server': { createClient: async () => ({
      from(table) {
        const builder = { select() { return builder; }, eq() { return builder; },
          maybeSingle: async () => ({ data: detailRow }), order: async () => ({ data: table === 'projects' ? [] : null }) };
        return builder;
      },
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/receipt.pdf' } }) }) },
    }) },
    'lucide-react': { FileText: 'FileText', ExternalLink: 'ExternalLink' },
    '@/components/invoices/mark-paid-button': { MarkPaidButton: 'MarkPaidButton' },
    '@/components/invoices/approve-pay-button': { ApprovePayButton: 'ApprovePayButton' },
    '@/lib/finance/spend-category': { spendCategoryFor: () => ({ chip: '', label: 'Overhead', qbAccount: 'Operating expenses' }) },
    '@/lib/finance/pay-approval': { isPayApproved: () => false },
    '@/app/(app)/spent/[id]/line-item-picker': { LineItemPicker: 'LineItemPicker' },
    '@/app/(app)/spent/[id]/project-picker': { ProjectPicker: 'ProjectPicker' },
    '@/components/finances/non-job-spend': { NonJobHistory: 'NonJobHistory' },
  });
  tree = await detail.BillWorkspace({ id: row.id });
  for (const type of ['MarkPaidButton', 'ApprovePayButton', 'ProjectPicker', 'LineItemPicker']) {
    assert.equal(nodes(tree).some(node => node.type === type), false, `Non-job detail hides ${type}`);
  }
  assert.match(words(tree), /Resolved non-job transaction · Owner Draw/);
  assert.match(words(tree), /QB-123/);
  assert.match(words(tree), /Retained source note/);
  assert.match(words(tree), /Recorded payment status: unpaid/);
  assert.ok(nodes(tree).some(node => node.type === 'iframe' && node.props.src.endsWith('receipt.pdf')), 'Attachment remains accessible');
  assert.doesNotMatch(words(tree), /Books to .* in QuickBooks/);
  detailRow = { ...detailRow, non_job_reason: null, non_job_note: 'Receipt confirms an operating expense' };
  tree = await detail.BillWorkspace({ id: row.id });
  assert.match(words(tree), /Previous non-job review/);
  assert.ok(nodes(tree).some(node => node.type === 'NonJobHistory' && node.props.invoiceId === row.id), 'Reopened or reassigned records keep their history discoverable');
  assert.doesNotMatch(words(tree), /Resolved non-job transaction/);
  for (const type of ['MarkPaidButton', 'ApprovePayButton', 'ProjectPicker', 'LineItemPicker']) {
    assert.ok(nodes(tree).some(node => node.type === type), `Ordinary bill retains ${type}`);
  }
  console.log('Non-job spending UI checks passed: explicit reason/confirm, stale rejection, required reversal note, duplicate-click guard, history, eligibility.');
})().catch(error => { console.error(error); process.exitCode = 1; });
