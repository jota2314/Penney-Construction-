/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated real crew components: no login, shifts or production records.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium, webkit, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const preview = path.join(root, '.crew-preview');
fs.mkdirSync(path.join(preview, 'app'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fixtures/crew-mobile-page.tsx'), path.join(preview, 'app/page.tsx'));
fs.writeFileSync(path.join(preview, 'app/layout.tsx'), `import '../../src/app/globals.css';
export const viewport = {width:'device-width', initialScale:1, viewportFit:'cover'};
export const metadata = {appleWebApp:{capable:true,statusBarStyle:'black'}};
export default function Layout({children}: {children: React.ReactNode}) {return <html className="dark"><body>{children}</body></html>}`);
fs.writeFileSync(path.join(preview, 'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2017',lib:['dom','esnext'],skipLibCheck:true,strict:true,noEmit:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',jsx:'react-jsx',paths:{'@/*':['../src/*']}},exclude:['node_modules']}));
fs.copyFileSync(path.join(root,'postcss.config.mjs'),path.join(preview,'postcss.config.mjs'));
const server = spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev',preview,'--webpack','-p','3122'],{cwd:root,windowsHide:true,stdio:'pipe'});
let output = '';
server.stdout.on('data', x => output += x);
server.stderr.on('data', x => output += x);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const url = 'http://localhost:3122';
async function check(type, appleStandalone = false) {
  const browser = await type.launch();
  try {
    for (const [width,height] of [[320,568],[360,800],[393,852],[412,915],[852,393],[768,1024],[1440,900]]) {
      const page = await browser.newPage({viewport:{width,height}});
      if (appleStandalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value:true}));
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      const nav = page.getByRole('navigation', {name:'Crew navigation'});
      await expect(nav).toBeVisible();
      await expect.poll(() => page.locator('[data-crew-viewport]').evaluate(el => el.style.height)).not.toBe('');
      await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black');
      async function bottomFits() {
        await expect.poll(async () => page.evaluate(() => {
          const rect = document.querySelector('nav[aria-label="Crew navigation"]').getBoundingClientRect();
          return Math.abs(rect.bottom - innerHeight);
        })).toBeLessThanOrEqual(1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
        const box = await nav.boundingBox();
        assert(box.height <= 100, `navigation too tall: ${box.height}`);
        for (const label of await nav.locator('a span').all()) {
          const rect = await label.boundingBox();
          assert(rect && rect.y >= box.y && rect.y + rect.height <= box.y + box.height,
            'navigation label clipped outside the bar');
          assert(rect.y + rect.height <= await page.evaluate(() => innerHeight),
            'navigation label below the usable window');
        }
      }
      await bottomFits();
      const before = await nav.boundingBox();
      await page.locator('main').evaluate(el => el.scrollTop = el.scrollHeight);
      assert.deepEqual(await nav.boundingBox(), before, 'scroll moved the navigation');
      await page.locator('main').evaluate(el => el.scrollTop = 0);
      await page.getByRole('textbox').focus();
      await page.setViewportSize({width,height:height-200});
      await expect(nav).toBeHidden();
      // Android Back can dismiss the keyboard while the input stays focused.
      await page.setViewportSize({width,height});
      await expect(nav).toBeVisible();
      await bottomFits();
      await page.getByRole('textbox').evaluate(el => el.blur());
      await page.setViewportSize({width:height,height:width});
      await bottomFits();
      await page.setViewportSize({width,height});
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      await bottomFits();
      await page.screenshot({path:path.join(preview,`${type.name()}-${appleStandalone ? 'standalone-' : ''}${width}x${height}.png`)});
      assert.deepEqual(errors, [], 'runtime errors');
      console.log(`${type.name()} ${appleStandalone ? 'standalone branch' : 'browser'} ${width}x${height}: scroll, bottom alignment, keyboard dismissal, rotation and restore passed`);
      await page.close();
    }
  } finally { await browser.close(); }
}
(async () => {
  for (let i=0;i<90;i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if(i===89) throw new Error(output);
    await delay(1000);
  }
  await check(chromium);
  await check(webkit);
  await check(webkit, true);
})().catch(e => {console.error(e);process.exitCode=1;}).finally(() => server.kill());
