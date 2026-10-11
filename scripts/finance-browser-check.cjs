const { chromium } = require("playwright");
const fs = require("fs");
const assert = require("assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/finance-audit", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        review: {
          run_id: "test-run",
          money: {
            contract: 8000000,
            recorded_cost: 3000000,
            known_unbilled_commitments: 500000,
          },
        },
        blockers: ["Verify source costs for framing."],
        files: [],
        head: null,
      }),
    }),
  );
  await page.goto("http://localhost:3127/finance-preview", {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page
    .getByRole("heading", { name: "Know where every job stands." })
    .waitFor();
  fs.mkdirSync("finance-qa", { recursive: true });
  await page.screenshot({ path: "finance-qa/desktop.png", fullPage: true });
  await page.getByLabel("Closing year").selectOption("2026");
  await page.getByLabel("Closing month").selectOption("10");
  await page.getByText("No final audits in this period.").waitFor();
  await page.getByLabel("Closing month").selectOption("09");
  await page
    .locator("summary")
    .filter({ hasText: "Sample completed kitchen" })
    .waitFor();
  await page.getByRole("button", { name: "Review & finalize" }).first().click();
  await page.getByRole("button", { name: "Check audit readiness" }).click();
  await page.getByText("Verify source costs for framing.").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Approve final audit & freeze P&L" })
      .isDisabled(),
    true,
  );
  await page.screenshot({ path: "finance-qa/audit.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "finance-qa/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile rendering, closing-period filters, blocked finalization, no horizontal page overflow, no browser errors. Synthetic data only; no saved sessions read.",
  );
  await browser.close();
})();
