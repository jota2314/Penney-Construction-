/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
// Run from the repository root. One-time fixture dependency:
// npm install --prefix .crew-preview --no-audit --no-fund esbuild
// Then: node scripts/test-daily-log-mobile.cjs
// Uses real React, Radix, the Post update entry point and daily-log component.
// Server actions/uploads are mocked: this never writes a production log.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('../.crew-preview/node_modules/esbuild');
const { chromium, devices, expect } = require('@playwright/test');

async function main() {
  const fixture = path.resolve('.crew-preview/daily-log-mobile');
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'entry.jsx'), `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { JobClockInSheet } from '@/components/field-feed/job-clock-in-sheet';
    function App() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Post update</button>{open &&
        <JobClockInSheet intent="update" onClose={() => setOpen(false)} />}</>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `);
  fs.writeFileSync(path.join(fixture, 'mocks.js'), `
    const job = { id: 'test-job', name: 'Test project', project_number: 'TEST', address: null, city: null, state: null, latitude: null, longitude: null };
    export const searchActiveJobs = async () => [job];
    export const getMyClockedInJob = async () => job;
    export const getMyPendingDailyReports = async () => [];
    export const getJobBudgetLines = async () => [];
    export const getCrewJobDocuments = async () => [];
    export const listActiveEmployees = async () => [];
    export const listActivityMentions = async () => [];
    export const clockInOnLineItem = async () => { throw Error('No live writes'); };
    export const clockInGeneral = clockInOnLineItem;
    export const switchClockTask = clockInOnLineItem;
    export const postDailyLog = async (...args) => { window.posted = args; return { logId: 'test-log' }; };
    export const enqueueDailyLogPhotos = async (id, files) => { window.uploaded = files.map(f => f.name); };
    export const getCurrentPosition = async () => null;
    export const ProjectMap = () => null;
    export const PunchListVoiceComposer = () => null;
    export const useRouter = () => ({ refresh() {}, push() {} });
  `);
  await esbuild.build({
    entryPoints: [path.join(fixture, 'entry.jsx')], bundle: true,
    outfile: path.join(fixture, 'bundle.js'), jsx: 'automatic',
    alias: { '@': path.resolve('src') },
    plugins: [{ name: 'local-actions', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|@\/lib\/actions\/|@\/lib\/upload\/daily-log-upload-queue|@\/lib\/geo\/current-position|@\/components\/crew\/project-map|@\/components\/projects\/punch-list-voice-composer)/ }, () => ({ path: path.join(fixture, 'mocks.js') }));
    } }],
  });
  const css = await require('postcss')([require('@tailwindcss/postcss')()])
    .process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  fs.writeFileSync(path.join(fixture, 'style.css'), css.css);
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    } else if (req.url === '/style.css' || req.url === '/bundle.js') {
      res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'application/javascript');
      res.end(fs.readFileSync(path.join(fixture, req.url.slice(1))));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ ...devices['Pixel 7'] });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button', { name: 'Post update', exact: true }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    const photo = { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD7sAAAAASUVORK5CYII=', 'base64') };
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Library', exact: true }).tap();
    await (await chooser).setFiles(photo);
    const answers = page.getByRole('textbox', { name: 'Daily log answers' });
    await answers.tap();
    // Desktop automation has no Android IME: exercise its viewport resize and
    // dismissal signals explicitly, rather than claiming a physical-phone test.
    await page.setViewportSize({ width: 393, height: 430 });
    await answers.fill('Finished framing. Nothing blocking tomorrow.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByAltText('Photo 1')).toHaveCount(1);
    await expect(answers).toHaveValue('Finished framing. Nothing blocking tomorrow.');

    for (const name of ['Close daily log', 'Cancel', 'Change job']) {
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('button', { name, exact: true }).tap();
      await expect(answers).toHaveValue('Finished framing. Nothing blocking tomorrow.');
      await expect(page.getByAltText('Photo 1')).toHaveCount(1);
    }
    await page.setViewportSize({ width: 393, height: 851 });
    await page.getByRole('button', { name: 'Post 1 photo', exact: true }).tap();
    await expect(page.getByText('Daily log posted. Ready for another.')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => ({ text: window.posted[1], photos: window.uploaded })), {
      text: 'Finished framing. Nothing blocking tomorrow.', photos: ['test.png'],
    });
    await expect(page.getByAltText('Photo 1')).toHaveCount(0);
    await page.getByRole('button', { name: 'Done', exact: true }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Post update', exact: true }).tap();
    await page.locator('input[type=file][multiple]').setInputFiles(photo);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Close daily log', exact: true }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: actual Post update flow preserves photos/text through keyboard resize and dismissal, protects Close/Cancel/Change job, posts both, and supports deliberate discard.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
