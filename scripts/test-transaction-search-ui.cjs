/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression test. */
// Run: npm install --prefix finance-qa --no-save --package-lock=false esbuild
//      node scripts/test-transaction-search-ui.cjs
// All API responses are local synthetic fixtures. No account or financial writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require(process.env.ESBUILD_PATH || '../finance-qa/node_modules/esbuild');
const { chromium, expect } = require('@playwright/test');

const dir = path.resolve('finance-qa/transaction-search');
const expense = {
  id: 'expense:bill-1', kind: 'expense', name: 'Sample supply company',
  date: '2026-10-12', amount: 1250.25, description: 'Fixture framing lumber',
  reference: 'BILL-1250', status: 'Unpaid', review: false,
  projects: [{ id: 'job-1', label: 'DEMO-01 · Sample addition' }],
  href: '/finances?section=activity&panel=expense&id=bill-1&month=2026-10',
  source: 'office_entry', method: 'check',
};
const fixtures = [
  expense,
  { ...expense, id: 'income:payment-1', kind: 'income', name: 'Sample homeowner', amount: 5000,
    description: 'Fixture progress payment', reference: 'CHECK-456', status: 'Received',
    href: '/finances?section=activity&panel=income&id=payment-1&month=2026-10', source: 'manual' },
  { ...expense, id: 'client_invoice:invoice-1', kind: 'client_invoice', name: 'Sample client invoice',
    amount: 7500.75, description: 'Fixture client billing', reference: 'INV-900', status: 'Sent',
    href: '/api/generate-client-invoice?invoiceId=invoice-1', source: 'Penney client invoice', method: null },
  { ...expense, id: 'bank:bank-1', kind: 'bank', name: 'Sample bank purchase', amount: -45.12,
    description: 'Fixture bank transaction', reference: 'BANK-123', status: 'Unmatched', review: true,
    href: null, source: 'bank_feed', method: null, projects: [] },
];
const longVendor = 'MetropolitanArchitecturalRestorationAndSpecializedConstructionSupplyCompany'.repeat(3);
const stress = [{ ...expense, id: 'expense:stress', name: longVendor, amount: 12345678.90,
  reference: 'UNBROKEN-REFERENCE-'.repeat(16), description: 'LONGDESCRIPTION'.repeat(24),
  projects: [{ id: 'job-long', label: 'DEMO-LONG-01 · A very long waterfront addition and complete historic property restoration' }] },
  { ...expense, id: 'expense:missing', name: 'Review amount and date', amount: null, date: null,
    href: null, review: true, reference: null, source: 'office_entry', method: null },
];

main().catch(error => { console.error(error); process.exitCode = 1; });

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'entry.jsx'), `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { TransactionSearch } from '@/components/finances/transaction-search';
    createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-4"><h1 className="mb-4 text-2xl font-semibold">Financial</h1><TransactionSearch /></main>);
  `);
  fs.writeFileSync(path.join(dir, 'link.jsx'), `import React from 'react'; export default function Link({href,children,scroll,...props}) {return <a href={href} {...props}>{children}</a>}`);
  await esbuild.build({ entryPoints: [path.join(dir, 'entry.jsx')], bundle: true,
    outfile: path.join(dir, 'bundle.js'), jsx: 'automatic', alias: { '@': path.resolve('src') },
    plugins: [{ name: 'local-link', setup(build) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(dir, 'link.jsx') }));
    } }],
  });
  const css = await require('postcss')([require('@tailwindcss/postcss')()])
    .process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  fs.writeFileSync(path.join(dir, 'style.css'), css.css);

  const calls = [];
  const deferred = new Map();
  let errorAttempts = 0;
  const send = (res, body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/finances/search') {
      const q = url.searchParams.get('q');
      const page = Number(url.searchParams.get('page'));
      calls.push({ q, page, method: req.method });
      if (q === 'pending' || q === 'late') {
        deferred.set(q, () => send(res, { results: [expense], total: 1, page: 1, pageSize: 50 }));
      } else if (q === 'error' && errorAttempts++ === 0) {
        send(res, { error: 'Synthetic server failure' }, 500);
      } else if (q === 'expired' || q === 'forbidden') {
        send(res, {}, q === 'expired' ? 401 : 403);
      } else if (q === 'malformed') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('Synthetic invalid JSON: implementation details must not surface');
      } else if (q === 'network') {
        req.socket.destroy();
      } else if (q === 'pages') {
        send(res, { results: page === 1 ? fixtures : [{ ...expense, id: 'expense:last', name: 'Last page supplier' }], total: 5, page, pageSize: 4 });
      } else {
        const results = q === 'empty' ? [] : q === 'stress' ? stress : fixtures;
        send(res, { results, total: results.length, page: 1, pageSize: 50 });
      }
    } else if (url.pathname === '/bundle.js' || url.pathname === '/style.css') {
      res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript');
      res.end(fs.readFileSync(path.join(dir, url.pathname.slice(1))));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.searchRequests = [];
      window.fetch = async (input, options) => {
        const q = new URL(String(input), location.href).searchParams.get('q');
        const state = { q, aborted: false, complete: false };
        window.searchRequests.push(state);
        options?.signal?.addEventListener('abort', () => { state.aborted = true; });
        // One delayed fixture deliberately ignores transport cancellation to prove
        // a late parsed response still cannot restore a cleared search.
        const response = await originalFetch(input, q === 'late' ? { ...options, signal: undefined } : options);
        const json = response.json.bind(response);
        response.json = async () => { const body = await json(); state.complete = true; return body; };
        return response;
      };
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const input = page.getByRole('searchbox', { name: 'Search all transactions' });
    const submit = page.getByRole('button', { name: 'Search', exact: true });
    const clear = page.getByRole('button', { name: 'Clear transaction search' });
    const rows = page.getByRole('list', { name: 'Matching transactions' }).getByRole('listitem');
    const search = async (term, enter = false) => {
      await input.fill(term);
      if (enter) await input.press('Enter'); else await submit.click();
    };
    const noOverflow = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        `Search overflows at ${page.viewportSize().width}px`);
    };

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const before = calls.length;
      await page.goto(url);
      await expect(input).toBeVisible();
      await expect(submit).toBeDisabled();
      await expect(page.getByRole('status')).toHaveCount(0);
      await input.fill('  sample  ');
      assert.equal(calls.length, before, 'Typing must wait for explicit submit');
      await (width === 390 ? input.press('Enter') : submit.click());
      await expect(page.getByRole('status')).toHaveText('4 matches for “sample”');
      await expect(rows).toHaveCount(4);
      assert.deepEqual(calls.at(-1), { q: 'sample', page: 1, method: 'GET' });
      for (const [index, name] of ['Expense / bill', 'Payment received', 'Client invoice', 'Bank transaction'].entries()) {
        await expect(rows.nth(index)).toContainText(name);
        if (fixtures[index].href) {
          await expect(rows.nth(index).getByRole('link').first()).toHaveAttribute('href', fixtures[index].href);
          await expect(rows.nth(index).getByRole('link', { name: /^Open / })).toHaveAttribute('href', fixtures[index].href);
        } else {
          await expect(rows.nth(index).getByRole('link')).toHaveCount(0);
        }
      }
      const invoicePdf = rows.nth(2).getByRole('link', { name: /^Open invoice/ });
      await expect(invoicePdf).toHaveAccessibleName('Open invoice → (PDF, opens in a new tab)');
      await expect(invoicePdf).toHaveAttribute('target', '_blank');
      await expect(invoicePdf).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(rows.nth(0)).toContainText('$1,250.25');
      await expect(rows.nth(3)).toContainText('-$45.12');
      await expect(rows.nth(3)).toContainText('Needs review');
      await expect(page.getByText('1–4 of 4', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
      await noOverflow();
      await page.screenshot({ path: path.join(dir, `search-results-${width}.png`), fullPage: true });

      await search('stress', true);
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText(longVendor);
      await expect(rows.first()).toContainText('$12,345,678.90');
      await expect(rows.last()).toContainText('Date needed');
      await expect(rows.last()).toContainText('Amount needs review');
      await expect(rows.last().getByRole('link')).toHaveCount(0);
      await noOverflow();
      await page.screenshot({ path: path.join(dir, `search-stress-${width}.png`), fullPage: true });
      await clear.click();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('');
      await expect(rows).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await search('pages');
    await expect(page.getByRole('status')).toHaveText('5 matches for “pages”');
    await expect(rows).toHaveCount(4);
    await expect(page.getByText('1–4 of 5', { exact: true })).toBeVisible();
    await input.fill('unsent edit');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Last page supplier');
    await expect(page.getByText('5–5 of 5', { exact: true })).toBeVisible();
    assert.deepEqual(calls.at(-1), { q: 'pages', page: 2, method: 'GET' });
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(rows).toHaveCount(4);
    assert.deepEqual(calls.at(-1), { q: 'pages', page: 1, method: 'GET' });

    await search('empty', true);
    await expect(page.getByRole('status')).toHaveText('0 matches for “empty”');
    await expect(page.getByText('No matching transactions', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    await noOverflow();
    await page.screenshot({ path: path.join(dir, 'search-empty-390.png'), fullPage: true });

    await search('error');
    await expect(page.getByRole('alert')).toContainText('Transactions couldn’t load. Please try again.');
    await expect(rows).toHaveCount(0);
    await page.screenshot({ path: path.join(dir, 'search-error-390.png'), fullPage: true });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(rows).toHaveCount(4);
    assert.deepEqual(calls.at(-1), { q: 'error', page: 1, method: 'GET' });
    for (const [term, message] of [['expired', 'Your session expired.'], ['forbidden', 'Your account does not have access']]) {
      await search(term);
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(rows).toHaveCount(0);
    }
    for (const term of ['malformed', 'network']) {
      await search(term);
      await expect(page.getByRole('alert')).toContainText('Transactions couldn’t load. Please try again.');
      await expect(page.getByRole('alert')).not.toContainText('implementation details');
      await expect(rows).toHaveCount(0);
    }

    for (const term of ['pending', 'late']) {
      await search(term, true);
      await expect(page.getByRole('status')).toHaveText('Searching all dates…');
      await expect(submit).toBeDisabled();
      await expect.poll(() => deferred.has(term)).toBe(true);
      await clear.click();
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect.poll(() => page.evaluate(q => window.searchRequests.some(request => request.q === q && request.aborted), term)).toBe(true);
      deferred.get(term)();
      deferred.delete(term);
      if (term === 'late') {
        await expect.poll(() => page.evaluate(() => window.searchRequests.some(request => request.q === 'late' && request.complete))).toBe(true);
      }
      await expect(rows).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
    }
    await search('sample', true);
    await expect(rows).toHaveCount(4);
    assert.ok(calls.every(call => call.method === 'GET'));
    assert.deepEqual(pageErrors, []);
    console.log('PASS: real transaction search component; submit/Enter, all four record kinds and workflow links, counts/pagination, empty/error/retry/access errors, clear aborts and ignores late responses, null amounts/dates and 320/390/1280px long-content layout. Screenshots: finance-qa/transaction-search/');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
