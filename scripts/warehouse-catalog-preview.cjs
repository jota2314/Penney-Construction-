// Offline SSR only: node scripts/warehouse-catalog-preview.cjs --render-only
// Optional --local-photos embeds existing local product JPGs into output, never into source.
// All item, staff, project, stock and price records below are synthetic layout fixtures.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '../outputs/warehouse-catalog');
const cache = new Map();
const offlineOnly = () => { throw new Error('Catalog fixture preview cannot call live services'); };
const dialogModules = {
  'item-form-dialog': 'ItemFormDialog',
  'adjust-stock-dialog': 'AdjustStockDialog',
  'check-out-dialog': 'CheckOutDialog',
  'check-in-dialog': 'CheckInDialog',
};

function sourcePath(base) {
  const source = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
    .map(ext => base + ext).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!source) throw new Error(`Preview source not found: ${base}`);
  return source;
}

function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports: module.exports, module, console, Intl, Date, Map, Set,
    require: name => {
      const dialog = dialogModules[path.basename(name).replace(/\.(tsx?|jsx?)$/, '')];
      if (dialog) return { [dialog]: () => null };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh: offlineOnly, push: offlineOnly }) };
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
      if (name === '@/lib/supabase/client' || name === '@/lib/supabase/server') return { createClient: offlineOnly };
      if (name.startsWith('@/lib/actions/')) return new Proxy({}, { get: () => offlineOnly });
      if (name === '@/lib/image/compress') return { compressImage: offlineOnly };
      if (name === '@/components/ui/image-viewer') return { ImageViewer: () => null };
      if (name.startsWith('@/')) return load(sourcePath(path.join(root, 'src', name.slice(2))));
      if (name.startsWith('.')) return load(sourcePath(path.resolve(path.dirname(file), name)));
      return require(name);
    },
  }, { filename: file });
  return module.exports;
}

function fixturePhoto(index, reference) {
  const colors = ['#d97706', '#475569', '#2563eb', '#16a34a'];
  const color = colors[index % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="white"/><rect x="155" y="100" width="330" height="225" rx="22" fill="${color}"/><rect x="185" y="155" width="270" height="110" rx="7" fill="#f8fafc"/><path d="M205 180h230M205 205h185M205 230h210" stroke="${color}" stroke-width="8"/><text x="320" y="390" text-anchor="middle" font-family="Arial" font-size="23" fill="#64748b">SYNTHETIC PHOTO FIXTURE ${index + 1}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}${reference ? '#/catalogref-preview' : ''}`;
}

function localPhotos() {
  if (!process.argv.includes('--local-photos')) return [];
  const directory = path.resolve(root, '../catalog/warehouse/photos-2026-10-02/images');
  if (!fs.existsSync(directory)) {
    console.log('Optional local JPG folder is absent; using synthetic images.');
    return [];
  }
  return fs.readdirSync(directory).filter(name => /\.jpg$/i.test(name) && !/_thumb\.jpg$/i.test(name))
    .sort().slice(0, 8).map(name => `data:image/jpeg;base64,${fs.readFileSync(path.join(directory, name)).toString('base64')}`);
}

function fixtures() {
  const photos = localPhotos();
  const definitions = [
    ['Heavy-duty exterior structural wood screws with washer head — assorted lengths for framing and deck repairs', 'hardware', 'box', 18, 5, 'Rack A · Shelf 2', true],
    ['Cordless compact impact driver kit with two batteries and carrying case', 'tools', 'each', 2, 3, 'Tool cage · Bay 4', true],
    ['White interior wall primer and stain-blocking sealer', 'paint', 'gallon', 0, 2, 'Finishes · Shelf C', false],
    ['Electrical cable staples with insulated saddle', 'electrical', 'box', 6, 2, 'Small parts · Bin 08', true],
    ['Pressure-treated lumber 2 × 6 × 12 ft', 'lumber', 'each', 34, 10, 'Lumber rack · Lower bay', false],
    ['Flexible braided stainless-steel supply connector with extended-reach swivel fittings', 'plumbing', 'each', 1, 4, 'Plumbing · Bin 12', true],
    ['Lightweight joint compound — ready mixed', 'drywall', 'each', 8, 3, 'Drywall · Floor pallet', true],
    ['High-visibility protective work gloves', 'safety', 'pair', 0, 0, null, false],
    ['Foil-faced insulation roll with reinforced vapor barrier', 'insulation', 'roll', 4, 2, 'Insulation · Upper rack', true],
    ['Adjustable galvanized duct elbow', 'hvac', 'each', 15, 4, 'HVAC · Shelf B', true],
    ['Mixed finish hardware — confirm the package label before picking', 'other', 'bag', 3, 5, 'Unsorted · Review bin', false],
    ['Replacement saw blade set for wood and demolition work', 'tools', 'case', 7, 2, 'Tool cage · Drawer 3', true],
  ];
  const thumbUrls = {};
  let photoIndex = 0;
  const items = definitions.map(([name, category, unit, quantity, reorderPoint, location, hasPhoto], index) => {
    const id = `fixture-item-${index + 1}`;
    const reference = index % 2 === 0;
    if (hasPhoto) {
      const local = photos[photoIndex++ % (photos.length || 1)];
      thumbUrls[id] = local ? local + (reference ? '#/catalogref-preview' : '') : fixturePhoto(index, reference);
    }
    return {
      id, sku: `DEMO-${String(index + 1).padStart(4, '0')}`, name, category, unit,
      description: 'Synthetic catalog record for layout review. Not actual warehouse inventory.',
      quantity_on_hand: quantity, reorder_point: reorderPoint, reorder_quantity: 10,
      unit_cost: 10 + index * 2.5, location, vendor: index === 0 ? 'Example supplier with a deliberately extended business name' : 'Example supplier',
      barcode: null, is_active: true, notes: null, created_by: null,
      photo_path: hasPhoto ? `items/${id}/${reference ? 'catalogref20261002_' : 'staff_'}fixture.jpg` : null,
      photo_thumb_path: hasPhoto ? `items/${id}/${reference ? 'catalogref20261002_' : 'staff_'}fixture_thumb.jpg` : null,
      created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z',
    };
  });
  const checkouts = [0, 1, 5].map((index, ordinal) => ({
    id: `fixture-checkout-${ordinal + 1}`, item_id: items[index].id, item_name: items[index].name,
    sku: items[index].sku, unit: items[index].unit, location: items[index].location,
    barcode: null, photo_thumb_path: items[index].photo_thumb_path,
    project_id: 'fixture-project', project_name: 'Example renovation project', project_number: 'DEMO-JOB',
    employee_id: 'fixture-employee', employee_name: 'Example crew member',
    quantity_out: ordinal + 1, quantity_returned: 0, quantity_outstanding: ordinal + 1,
    checked_out_at: new Date(Date.now() - (ordinal === 0 ? 21 : 3) * 86400000).toISOString(),
    performed_by_name: 'Example warehouse staff', notes: 'Synthetic checkout for layout review.',
  }));
  return {
    items, checkouts, thumbUrls,
    summary: { activeItems: items.length, lowStockItems: items.filter(item => item.quantity_on_hand <= item.reorder_point).length, inventoryValue: items.reduce((sum, item) => sum + item.quantity_on_hand * item.unit_cost, 0), openOrders: 3, pendingOrders: 1 },
    projects: [{ id: 'fixture-project', name: 'Example renovation project', project_number: 'DEMO-JOB' }],
    employees: [{ id: 'fixture-employee', full_name: 'Example crew member' }],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--render-only', '--local-photos'].includes(arg))) throw new Error('Supported flags: --render-only, --local-photos');
  const { WarehouseDashboard } = load(path.join(root, 'src/components/warehouse/warehouse-dashboard.tsx'));
  const props = fixtures();
  const html = renderToStaticMarkup(React.createElement(WarehouseDashboard, props));
  if (!html.includes('DEMO-0001') || !html.includes('DEMO-0012')) throw new Error('Catalog fixture records did not render');
  const cssPath = path.join(root, 'src/app/globals.css');
  const css = fs.readFileSync(cssPath, 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/warehouse";\n@source "../components/ui";');
  const result = await require('postcss')([require('@tailwindcss/postcss')()]).process(css, { from: cssPath });
  fs.mkdirSync(output, { recursive: true });
  for (const theme of ['dark', 'light']) {
    const name = theme === 'dark' ? 'preview.html' : 'preview-light.html';
    const shellCss = '.catalog-preview-sidebar{display:none}.catalog-preview-content{min-width:0;width:100%;max-width:1440px;margin:auto;padding:clamp(16px,3vw,32px)}@media(min-width:768px){.catalog-preview-shell{display:grid;grid-template-columns:16rem minmax(0,1fr);min-height:100vh}.catalog-preview-sidebar{display:block;border-right:1px solid var(--border);padding:28px 20px;background:var(--sidebar)}}';
    const sidebar = '<aside class="catalog-preview-sidebar" aria-label="Desktop sidebar width simulation"><p style="font-size:20px;font-weight:700">PENNEY</p><p style="font-size:10px;opacity:.6;margin:8px 0 32px">PREVIEW SIDEBAR · 16 REM</p><p style="padding:10px 0;opacity:.6">Command Center</p><p style="padding:10px 0;opacity:.6">Projects</p><p style="padding:10px 0;opacity:.6">Schedule</p><p style="padding:10px 12px;border-radius:8px;background:var(--sidebar-accent);font-weight:600">Warehouse</p></aside>';
    const document = `<!doctype html><html lang="en" class="${theme === 'dark' ? 'dark' : ''}" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Warehouse catalog · synthetic preview</title><style>${result.css}\n${shellCss}</style></head><body style="font-family:Arial,sans-serif"><div class="catalog-preview-shell">${sidebar}<div class="catalog-preview-content"><header style="margin-bottom:24px"><h1 style="font-size:24px;font-weight:600">Warehouse catalog</h1><p style="margin-top:8px;font-size:12px;opacity:.7">READ-ONLY LAYOUT PREVIEW · SYNTHETIC RECORDS · Controls are static; no live services are connected.</p></header><main>${html}</main></div></div></body></html>`;
    fs.writeFileSync(path.join(output, name), document);
    console.log(`Rendered ${path.join(output, name)} (${props.items.length} synthetic items, ${Object.keys(props.thumbUrls).length} photos, ${props.checkouts.length} checkouts).`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
