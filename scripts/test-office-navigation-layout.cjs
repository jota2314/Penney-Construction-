/* eslint-disable @typescript-eslint/no-require-imports */
// Run with node scripts/test-office-navigation-layout.cjs. Uses synthetic data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { once } = require("node:events");

const root = path.resolve(__dirname, "..");
const mobile = { width: 440, height: 894 };
const fixtureName = "office-mobile-page.tsx";

async function checkLayout(page, height) {
  const { expect } = require("@playwright/test");
  // Checking only nav.bottom misses the original error: the footer was in
  // exactly the same place in the broken and healthy screenshots.
  await expect.poll(() => page.evaluate((height) => {
    const list = document.querySelector('[data-testid="project-scroll"]').getBoundingClientRect();
    const nav = document.querySelector("nav").getBoundingClientRect();
    const navVisible = nav.height > 0;
    return Math.max(
      Math.abs(list.bottom - (navVisible ? nav.top : height)),
      navVisible ? Math.abs(nav.bottom - height) : 0,
    );
  }, height)).toBeLessThanOrEqual(1);
}

async function verify(engine, url) {
  const { expect } = require("@playwright/test");
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: mobile });
    // Replace viewport inputs inside the actual compiled declarations, keeping
    // their selectors, media rules and specificity. Desktop WebKit cannot
    // reproduce the physical phone's safe area or stale 100svh on request.
    await page.route(/\.css(?:[?#].*)?$/, async (route) => {
      const response = await route.fetch();
      const css = (await response.text())
        .replace(/\b100svh\b/g, "var(--fixture-small-height, 100svh)")
        .replace(/env\(\s*safe-area-inset-bottom\s*(?:,[^()]*)?\)/g, "var(--fixture-bottom-inset, 0px)");
      await route.fulfill({ response, body: css });
    });
    await page.goto(url);
    const list = page.getByTestId("project-scroll");
    const nav = page.getByRole("navigation", { name: "Main navigation", includeHidden: true });
    await expect(nav).toBeVisible();
    await checkLayout(page, mobile.height);

    await page.evaluate(() => document.documentElement.style.setProperty("--fixture-small-height", "758px"));
    await expect(page.getByTestId("small-viewport-probe")).toHaveCSS("height", "758px");
    await checkLayout(page, mobile.height);
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
    assert(await list.evaluate((el) => el.scrollTop > 0), "fixture must actually scroll");
    await checkLayout(page, mobile.height);
    await page.evaluate(() => document.documentElement.style.setProperty("--fixture-bottom-inset", "34px"));
    await expect(nav).toHaveCSS("padding-bottom", "34px");
    await checkLayout(page, mobile.height);
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const lastCard = await list.getByRole("article").last().boundingBox();
    const footer = await nav.boundingBox();
    assert(lastCard.y + lastCard.height <= footer.y + 1, "the final card must clear the navigation");

    await page.getByRole("button", { name: "Change list length" }).click();
    await expect(list.getByRole("article")).toHaveCount(1);
    await checkLayout(page, mobile.height);
    await page.getByRole("button", { name: "More navigation" }).click();
    await expect(page.locator("#mobile-more-navigation")).toBeVisible();
    await page.locator("#mobile-more-navigation").locator("..").click({ position: { x: 2, y: 2 } });
    await expect(page.locator("#mobile-more-navigation")).toBeHidden();

    await page.getByRole("textbox").focus();
    await page.setViewportSize({ width: mobile.width, height: 600 });
    await expect(nav).toBeHidden();
    await checkLayout(page, 600);
    // A keyboard can close while the field keeps focus.
    await page.setViewportSize(mobile);
    await expect(nav).toBeVisible();
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await checkLayout(page, mobile.height);
    await page.evaluate(() => {
      document.activeElement.blur();
      document.documentElement.style.removeProperty("--fixture-small-height");
      document.documentElement.style.removeProperty("--fixture-bottom-inset");
    });
    await page.setViewportSize({ width: 767, height: 600 });
    await expect(nav).toBeVisible();
    await checkLayout(page, 600);
    await page.setViewportSize({ width: 768, height: 600 });
    await expect(nav).toBeHidden();
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    const sidebar = await page.getByTestId("desktop-sidebar").boundingBox();
    const listBox = await list.boundingBox();
    assert(listBox.x >= sidebar.x + sidebar.width - 1, "desktop sidebar and content must be side by side");
    await checkLayout(page, 600);
    console.log(engine.name() + ": office layout checks passed");
  } finally {
    await browser.close();
  }
}

async function main() {
  const layout = fs.readFileSync(path.join(root, "src/app/(app)/layout.tsx"), "utf8");
  assert.match(layout, /<SidebarProvider\b[^>]*\bdata-browser-safe-viewport\b/);
  assert.match(layout, /<\/SidebarInset>[\s\S]*?<MobileBottomNav\b[\s\S]*?<\/SidebarProvider>/);
  if (process.argv.includes("--check-routing")) {
    console.log("Office route includes the scoped sidebar shell and footer.");
    return;
  }
  const next = require("next");
  const { chromium, webkit } = require("@playwright/test");

  // Own a unique preview folder below the same ignored area used by crew QA.
  const previews = path.join(root, ".crew-preview");
  fs.mkdirSync(previews, { recursive: true });
  const dir = fs.mkdtempSync(path.join(previews, "office-"));
  const appDir = path.join(dir, "app");
  let app;
  const server = http.createServer((req, res) => app.getRequestHandler()(req, res));
  try {
    fs.mkdirSync(appDir);
    fs.copyFileSync(path.join(__dirname, "fixtures", fixtureName), path.join(appDir, "page.tsx"));
    fs.copyFileSync(path.join(root, "postcss.config.mjs"), path.join(dir, "postcss.config.mjs"));
    fs.writeFileSync(path.join(appDir, "layout.tsx"), [
      'import "./fixture.css";',
      'export const viewport = {width:"device-width", initialScale:1, viewportFit:"auto"};',
      'export default function Layout({children}: {children: React.ReactNode}) {',
      '  return <html lang="en" className="dark"><body>{children}</body></html>;',
      '}',
    ].join("\n"));
    fs.writeFileSync(path.join(appDir, "fixture.css"), [
      '@import "../../../src/app/globals.css";',
      '@source "../../../src";',
      '@source "./page.tsx";',
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
      extends: "../../tsconfig.json",
      compilerOptions: { paths: { "@/*": ["../../src/*"] } },
      include: ["app/**/*.tsx", ".next/types/**/*.ts"],
    }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    app = next({ dir, dev: true, webpack: true, hostname: "127.0.0.1", port, httpServer: server });
    await app.prepare();
    for (const engine of [chromium, webkit]) await verify(engine, "http://127.0.0.1:" + port);
  } finally {
    if (app) await app.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    const realDir = fs.realpathSync(dir);
    assert.equal(path.dirname(realDir), fs.realpathSync(previews));
    fs.rmSync(realDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
