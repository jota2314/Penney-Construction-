const fs = require('fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const vm = require('vm');
const path = require('path');
const cache = {};
const offlineOnly = () => { throw new Error('Static warehouse preview cannot call live services'); };
function sourcePath(base) {
  const source = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!source) throw new Error(`Preview source not found: ${base}`);
  return source;
}
function load(p) {
  p = path.resolve(p);
  if (cache[p]) return cache[p];
  const m = { exports: {} }; cache[p] = m.exports;
  const source = ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports: m.exports, module: m, console, Intl, Date, Map, Set, require: n => {
    if (n === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
    if (n === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
    // Photo components render normally; upload and mutation dependencies never run in a fixture preview.
    if (n === '@/lib/supabase/client') return { createClient: offlineOnly };
    if (n === '@/lib/actions/warehouse') return { setWarehouseItemPhoto: offlineOnly, removeWarehouseItemPhoto: offlineOnly };
    if (n === '@/lib/image/compress') return { compressImage: offlineOnly };
    if (n === '@/components/ui/image-viewer') return { ImageViewer: () => null };
    if (n.startsWith('@/')) return load(sourcePath(path.join('src', n.slice(2))));
    if (n.startsWith('.')) return load(sourcePath(path.resolve(path.dirname(p), n)));
    return require(n);
  } });
  return m.exports;
}
async function main() {
  const C = load('src/components/warehouse/warehouse-intelligence.tsx').WarehouseIntelligence;
  const { ItemThumb, ItemPhotoCard } = load('src/components/warehouse/item-photo.tsx');
  const out = path.resolve('../outputs/warehouse-intelligence');
  fs.mkdirSync(path.join(out, 'fixtures'), { recursive: true });
  // A deliberately synthetic drawing for layout checks only, never a catalog upload.
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240"><rect width="480" height="240" fill="white"/><rect x="90" y="92" width="240" height="56" rx="8" fill="#a9b5c5" stroke="#475569" stroke-width="4"/><path d="M110 92v56m25-56v56m25-56v56m25-56v56m25-56v56m25-56v56m25-56v56m25-56v56" stroke="#64748b" stroke-width="5"/><path d="M330 80h42v80h-42z" fill="#64748b"/><text x="240" y="205" fill="#64748b" text-anchor="middle" font-size="20" font-family="Arial">LAYOUT FIXTURE ONLY</text></svg>';
  fs.writeFileSync(path.join(out, 'fixtures', 'catalogref20261002_preview.svg'), fixture);
  fs.writeFileSync(path.join(out, 'fixtures', 'staff-preview.svg'), fixture);
  const referenceUrl = './fixtures/catalogref20261002_preview.svg';
  const staffUrl = './fixtures/staff-preview.svg';
  const snapshot = { capturedAt: '2026-10-01T01:00:00Z', items: [
    { id: '1', name: 'Briscon insulated staples', sku: 'WH-0092', unit: 'box', quantity_on_hand: 0, reorder_point: 0, description: null },
    { id: '2', name: 'Bostitch pneumatic coil roofing nailer', unit: 'each', quantity_on_hand: 1, reorder_point: 0, description: null },
  ], orders: [], checkouts: [{ id: 'c', item_id: '1', item_name: 'Briscon insulated staples', quantity_outstanding: 1, unit: 'box', employee_name: 'Steven Riley', project_name: 'Conway Residence', checked_out_at: '2026-09-30T14:22:17Z', performed_by_name: 'Richard Donnelly' }], transactions: [], warnings: [] };
  const photoSamples = renderToStaticMarkup(React.createElement('section', { className: 'mb-6 space-y-3' },
    React.createElement('h2', { className: 'text-sm font-semibold' }, 'Photo layout fixtures'),
    React.createElement('div', { className: 'flex flex-wrap items-center gap-4 text-xs text-muted-foreground' },
      ...[[referenceUrl, 'Catalog reference'], [staffUrl, 'Staff photo'], [null, 'No photo']].map(([url, name]) => React.createElement('div', { key: name, className: 'flex items-center gap-2' }, React.createElement(ItemThumb, { url, name }), name))),
    React.createElement(ItemPhotoCard, { itemId: 'fixture', itemName: 'Layout fixture', photoUrl: referenceUrl, photoPath: 'items/fixture/catalogref20261002_preview.jpg', canManage: false })));
  const staffSample = renderToStaticMarkup(React.createElement(ItemPhotoCard, { itemId: 'staff-fixture', itemName: 'Staff fixture', photoUrl: staffUrl, canManage: false }));
  if (!photoSamples.includes('Catalog reference photo') || !photoSamples.includes('Use the item label to confirm size, finish and model.') || !photoSamples.includes('>Ref</span>')) throw Error('Reference photo label is missing');
  if (staffSample.includes('Catalog reference photo')) throw Error('Staff photo incorrectly labeled as a catalog reference');
  const html = photoSamples + renderToStaticMarkup(React.createElement(C, { snapshot, thumbUrls: { '1': referenceUrl, '2': staffUrl } }));
  const css = fs.readFileSync('src/app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/warehouse/warehouse-intelligence.tsx";\n@source "../components/warehouse/item-photo.tsx";\n@source "../components/ui";');
  const result = await require('postcss')([require('@tailwindcss/postcss')()]).process(css, { from: path.resolve('src/app/globals.css') });
  for (const theme of ['dark', 'light']) {
    fs.writeFileSync(path.join(out, theme === 'dark' ? 'preview.html' : 'preview-light.html'), `<!doctype html><html class="${theme === 'dark' ? 'dark' : ''}" style="color-scheme:${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${result.css}</style><body style="padding:24px;font-family:Arial;max-width:1200px;margin:auto"><p style="padding-bottom:12px;font-size:12px">PENNEY · WAREHOUSE UPGRADE · FIXTURE PREVIEW</p>${html}</body></html>`);
  }
  if (process.argv.includes('--render-only')) return;
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  for (const [label, width] of [['desktop', 1280], ['mobile', 390], ['desktop-light', 1280], ['mobile-light', 390]]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(require('url').pathToFileURL(path.join(out, label.endsWith('-light') ? 'preview-light.html' : 'preview.html')).href);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw Error(`${label} horizontally overflows`);
    console.log(`${label}: rendered without horizontal overflow`);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
