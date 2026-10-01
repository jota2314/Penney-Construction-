const fs = require('fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const vm = require('vm');
const path = require('path');
const cache = {};
function load(p) {
  p = path.resolve(p);
  if (cache[p]) return cache[p];
  const m = { exports: {} }; cache[p] = m.exports;
  const source = ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports: m.exports, module: m, console, Intl, Date, Map, Set, require: n => {
    if (n === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
    if (n === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (n.startsWith('@/')) { const base = path.join('src', n.slice(2)); return load(base + ['.ts', '.tsx'].find(e => fs.existsSync(base + e))); }
    return require(n);
  } });
  return m.exports;
}
async function main() {
  const C = load('src/components/warehouse/warehouse-intelligence.tsx').WarehouseIntelligence;
  const snapshot = { capturedAt: '2026-10-01T01:00:00Z', items: [
    { id: '1', name: 'Briscon insulated staples', sku: 'WH-0092', unit: 'box', quantity_on_hand: 0, reorder_point: 0, description: null },
    { id: '2', name: 'Bostitch pneumatic coil roofing nailer', unit: 'each', quantity_on_hand: 1, reorder_point: 0, description: null },
  ], orders: [], checkouts: [{ id: 'c', item_id: '1', item_name: 'Briscon insulated staples', quantity_outstanding: 1, unit: 'box', employee_name: 'Steven Riley', project_name: 'Conway Residence', checked_out_at: '2026-09-30T14:22:17Z', performed_by_name: 'Richard Donnelly' }], transactions: [], warnings: [] };
  const html = renderToStaticMarkup(React.createElement(C, { snapshot }));
  const css = fs.readFileSync('src/app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/warehouse/warehouse-intelligence.tsx";\n@source "../components/ui";');
  const result = await require('postcss')([require('@tailwindcss/postcss')()]).process(css, { from: path.resolve('src/app/globals.css') });
  const out = path.resolve('../outputs/warehouse-intelligence');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'preview.html'), `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${result.css}</style><body style="padding:24px;font-family:Arial;max-width:1200px;margin:auto"><p style="padding-bottom:12px;font-size:12px">PENNEY · WAREHOUSE UPGRADE · FIXTURE PREVIEW</p>${html}</body></html>`);
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  for (const [label, width] of [['desktop', 1280], ['mobile', 390]]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(require('url').pathToFileURL(path.join(out, 'preview.html')).href);
    await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw Error(`${label} horizontally overflows`);
    console.log(`${label}: rendered without horizontal overflow`);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
