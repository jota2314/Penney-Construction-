/* eslint-disable @typescript-eslint/no-require-imports */
// Compile scripts/fixtures/gantt-move.tsx to .gantt-preview/move.js with esbuild first.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
(async () => {
  const css = (
    await require("postcss")([require("@tailwindcss/postcss")()]).process(
      fs
        .readFileSync("src/app/globals.css", "utf8")
        .replace(
          '@import "tailwindcss";',
          '@import "tailwindcss" source(none);\n@source "../components/schedule";\n@source "../components/ui/bottom-sheet.tsx";'
        ),
      { from: path.resolve("src/app/globals.css") }
    )
  ).css;
  const server = http.createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/move.js" ? "text/javascript" : "text/html"
    );
    res.end(
      req.url === "/move.js"
        ? fs.readFileSync(".gantt-preview/move.js")
        : `<html class="dark"><style>${css}</style><div id="root"></div><script src="/move.js"></script></html>`
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    for (const type of [chromium, webkit]) {
      const browser = await type.launch();
      try {
        for (const width of [390, 1440]) {
          const page = await browser.newPage({
            viewport: { width, height: 844 },
          });
          await page.clock.setFixedTime(new Date("2026-09-06T12:00:00Z"));
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(`http://127.0.0.1:${server.address().port}`);
          await page
            .getByRole("button", { name: "Move phases", exact: true })
            .click();
          const timelineBar = page
            .locator("#gantt-row-floor")
            .locator("..")
            .locator("div.relative button")
            .first();
          async function position() {
            return page.evaluate(() => {
              const label = document.getElementById("gantt-row-floor");
              const bar =
                label.parentElement.children[1].querySelector("button");
              const scroll = document.querySelector("[role=region]");
              scroll.scrollLeft =
                bar.offsetLeft +
                bar.offsetWidth / 2 -
                (scroll.clientWidth - label.offsetWidth) / 2;
              const r = bar.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            });
          }
          async function drag(pixels, cancel = false) {
            const p = await position();
            await page.mouse.move(p.x, p.y);
            await page.mouse.down();
            await page.mouse.move(p.x + pixels, p.y);
            if (cancel) await page.keyboard.press("Escape");
            await page.mouse.up();
          }
          await timelineBar.waitFor();
          const original = await timelineBar.getAttribute("title");
          assert(
            original.includes("2026-09-15"),
            "fixture must start with projected dates"
          );
          await drag(60);
          await expect(page.locator("p[role=status]")).toContainText(
            "Dates saved."
          );
          await expect(timelineBar).toHaveAttribute(
            "title",
            /2026-09-17.*2026-09-24/s
          );
          assert.equal(
            await page.getByRole("dialog").count(),
            0,
            "drop must not open details"
          );
          assert.equal(
            await page.locator("[data-testid=count]").innerText(),
            "1"
          );
          await page.reload();
          await page
            .getByRole("button", { name: "Move phases", exact: true })
            .click();
          await expect(timelineBar).toHaveAttribute("title", /2026-09-17/);
          await drag(-30);
          await expect(timelineBar).toHaveAttribute("title", /2026-09-16/);
          const beforeCancel = await timelineBar.getAttribute("title");
          const count = await page.locator("[data-testid=count]").innerText();
          await drag(60, true);
          assert.equal(await timelineBar.getAttribute("title"), beforeCancel);
          assert.equal(
            await page.locator("[data-testid=count]").innerText(),
            count
          );
          await page.getByRole("button", { name: "Fail saves: false" }).click();
          await drag(30);
          await expect(page.locator("p[role=status]")).toContainText(
            "could not be saved"
          );
          assert.equal(await timelineBar.getAttribute("title"), beforeCancel);
          assert.equal(
            await timelineBar.evaluate((e) => e.style.transform),
            ""
          );
          if (type.name() === "chromium" && width === 390) {
            await page
              .getByRole("button", { name: "Fail saves: true" })
              .click();
            const point = await position();
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Emulation.setTouchEmulationEnabled", {
              enabled: true,
            });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [{ x: point.x, y: point.y }],
            });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: point.x + 30, y: point.y }],
            });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchEnd",
              touchPoints: [],
            });
            await expect(timelineBar).toHaveAttribute("title", /2026-09-17/);
            await expect(page.locator("p[role=status]")).toContainText(
              "Dates saved."
            );
            console.log(
              "Touch dragging saves a one-day move without opening a popup."
            );
            assert.equal(await page.getByRole("dialog").count(), 0);
            await cdp.detach();
          }
          await page
            .getByRole("button", { name: "Done moving", exact: true })
            .click();
          await expect(timelineBar).toHaveCSS("touch-action", "auto");
          assert.deepEqual(errors, []);
          console.log(
            type.name(),
            width,
            "drag right/left, day snapping, duration, reload persistence, Escape, failed-save rollback, scroll mode passed"
          );
          await page.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
