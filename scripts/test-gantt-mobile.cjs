/* eslint-disable @typescript-eslint/no-require-imports */
// Run: node scripts/test-gantt-mobile.cjs. Uses synthetic data; no app login or DB.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium, webkit, expect } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const preview = path.join(root, ".gantt-preview");
const port = process.env.GANTT_TEST_PORT || "3118";
if (!process.env.GANTT_TEST_URL) {
  fs.mkdirSync(path.join(preview, "app"), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "fixtures/gantt-mobile-page.tsx"),
    path.join(preview, "app/page.tsx")
  );
  fs.writeFileSync(
    path.join(preview, "app/layout.tsx"),
    'import "../../src/app/globals.css"; export default function Layout({children}: {children: React.ReactNode}) { return <html lang="en" className="dark"><body>{children}</body></html>; }'
  );
  fs.writeFileSync(
    path.join(preview, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "esnext"],
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        paths: { "@/*": ["../src/*"] },
      },
      exclude: ["node_modules"],
    })
  );
  fs.copyFileSync(
    path.join(root, "postcss.config.mjs"),
    path.join(preview, "postcss.config.mjs")
  );
}
const server = process.env.GANTT_TEST_URL
  ? null
  : spawn(
      process.execPath,
      [
        path.join(root, "node_modules/next/dist/bin/next"),
        "dev",
        preview,
        "--webpack",
        "-p",
        port,
      ],
      { cwd: root, windowsHide: true, stdio: "pipe" }
    );
let serverOutput = "";
server?.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server?.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});
const url = process.env.GANTT_TEST_URL || `http://localhost:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(browserType) {
  const browser = await browserType.launch();
  try {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      if (
        process.env.GANTT_TEST_WIDTH &&
        viewport.width !== Number(process.env.GANTT_TEST_WIDTH)
      )
        continue;
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      await page.clock.setFixedTime(new Date("2026-09-05T12:00:00Z"));
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page
        .getByRole("button", { name: "Focus flooring", exact: true })
        .waitFor();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        "page must not overflow horizontally"
      );
      const chart = page.getByRole("region", {
        name: "Project schedule timeline",
      });
      if (viewport.width < 1000)
        await expect
          .poll(() => chart.evaluate((el) => el.scrollLeft))
          .toBeGreaterThan(0);
      const before = await chart.evaluate(
        (el) =>
          (el.scrollLeft +
            (el.clientWidth - el.querySelector("button").offsetWidth) / 2) /
          12
      );
      await page.getByTitle("Zoom in", { exact: true }).click();
      const after = await chart.evaluate(
        (el) =>
          (el.scrollLeft +
            (el.clientWidth - el.querySelector("button").offsetWidth) / 2) /
          30
      );
      assert(
        Math.abs(before - after) < 1,
        `zoom must preserve the center date: ${before} -> ${after}`
      );
      await page.getByTitle("Jump to today").click();
      const scrolled = await chart.evaluate((el) => el.scrollLeft);
      await page.getByTitle("Forward a day").click();
      assert(
        (await chart.evaluate((el) => el.scrollLeft)) > scrolled,
        "pan must move the timeline"
      );
      await page
        .getByRole("button", { name: "Focus flooring", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await delay(400);
      const box = await dialog.boundingBox();
      assert(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width + 1 &&
          box.y + box.height <= viewport.height + 1,
        "details must fit the viewport"
      );
      if (viewport.width < 768)
        assert(box.y >= 48, "phone details must clear the status bar");
      assert(
        (await dialog.innerText()).includes("Oct 30"),
        "details must show effective cascade end date"
      );
      await dialog
        .getByRole("button", { name: /Interior Painting Finish floor/ })
        .click();
      await page
        .getByRole("dialog", { name: "Interior Painting", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .getByRole("button", { name: "Failure mode: false", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Focus flooring", exact: true })
        .click();
      await dialog.getByRole("button", { name: "Edit", exact: true }).click();
      if (viewport.width === 390) {
        await dialog.getByLabel("Phase name").focus();
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, "height", {
            configurable: true,
            value: 400,
          });
          Object.defineProperty(visualViewport, "offsetTop", {
            configurable: true,
            value: 100,
          });
          visualViewport.dispatchEvent(new Event("resize"));
        });
        await expect
          .poll(async () => (await dialog.boundingBox()).height)
          .toBeLessThanOrEqual(340);
        const keyboardBox = await dialog.boundingBox();
        assert(
          keyboardBox.y >= 148 && keyboardBox.y + keyboardBox.height <= 501,
          "sheet must clear status area and keyboard"
        );
        await dialog
          .getByRole("button", { name: "Save changes" })
          .scrollIntoViewIfNeeded();
        const saveBox = await dialog
          .getByRole("button", { name: "Save changes" })
          .boundingBox();
        assert(
          saveBox.y + saveBox.height <= 501,
          "save remains reachable above keyboard"
        );
        await page.evaluate(() => {
          delete visualViewport.height;
          delete visualViewport.offsetTop;
          visualViewport.dispatchEvent(new Event("resize"));
        });
      }
      await dialog.getByLabel("Phase name").fill("Retained unsaved name");
      await dialog.getByLabel("End", { exact: true }).fill("2026-10-01");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await dialog
        .getByRole("alert")
        .filter({ hasText: "End date must" })
        .waitFor();
      await dialog.getByLabel("End", { exact: true }).fill("2026-10-24");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await dialog
        .getByRole("alert")
        .filter({ hasText: "not saved" })
        .waitFor();
      assert.equal(
        await dialog.getByLabel("Phase name").inputValue(),
        "Retained unsaved name"
      );
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      page.once("dialog", (d) => d.dismiss());
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      assert(
        await dialog.isVisible(),
        "cancelled deletion must leave details open"
      );
      assert.equal(
        await dialog.getByRole("alert").count(),
        0,
        "cancellation is not a save error"
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Failure mode: true", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Focus flooring", exact: true })
        .click();
      await dialog.getByRole("button", { name: "Edit", exact: true }).click();
      await dialog.getByLabel("Phase name").fill("Updated flooring");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await page
        .getByRole("dialog", { name: "Updated flooring", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator("#gantt-row-8").click();
      await page
        .getByRole("dialog", { name: "Updated flooring", exact: true })
        .waitFor();
      await delay(400);
      await page.screenshot({
        path: path.join(preview, `${browserType.name()}-${viewport.width}.png`),
      });
      assert.deepEqual(errors, [], "no browser runtime errors");
      console.log(
        `${browserType.name()} ${viewport.width}x${
          viewport.height
        }: layout, zoom, pan, cascade, dependencies, validation, failed/successful save, cancel delete, reopen passed`
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      /* wait for dev server */
    }
    if (i === 89) throw new Error(`Preview did not start: ${serverOutput}`);
    await delay(1000);
  }
  if (process.env.GANTT_TEST_BROWSER !== "webkit") await check(chromium);
  if (fs.existsSync(webkit.executablePath())) {
    if (process.env.GANTT_TEST_BROWSER !== "chromium") await check(webkit);
  } else console.log("WebKit not installed; browser checks ran in Chromium.");
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server?.kill());
