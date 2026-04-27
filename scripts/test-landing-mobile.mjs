import { chromium, devices } from "playwright";

const URL = process.argv[2] || "https://penney-construction-mf6m.vercel.app/";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14 Pro"] });
const page = await ctx.newPage();

const errors = [];
const pageErrors = [];
page.on("console", (msg) => msg.type() === "error" && errors.push(`[console.error] ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(`[pageerror] ${err.message}`));

console.log(`Loading ${URL} on iPhone 14 Pro viewport ...`);
await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: "scripts/landing-mobile-top.png", fullPage: false });

// Tap the hamburger to open the mobile menu
const burger = page.locator(".nav-toggle");
const burgerVisible = await burger.isVisible();
console.log(`Hamburger visible: ${burgerVisible}`);
if (burgerVisible) {
  await burger.tap();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "scripts/landing-mobile-menu-open.png", fullPage: false });
  await burger.tap();
  await page.waitForTimeout(300);
}

// Sign in pill in utility bar visible?
const signinPill = page.locator(".signin-pill");
const signinVisible = await signinPill.isVisible();
console.log(`Sign in pill visible (utility bar): ${signinVisible}`);

// Full page scroll screenshot
await page.screenshot({ path: "scripts/landing-mobile-full.png", fullPage: true });
const height = await page.evaluate(() => document.body.scrollHeight);
console.log(`Page height (mobile): ${height}px`);

// Check for horizontal overflow
const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
const winWidth = await page.evaluate(() => window.innerWidth);
console.log(`Document width: ${docWidth}, viewport width: ${winWidth}`);
if (docWidth > winWidth + 1) console.log(`⚠ Horizontal overflow: ${docWidth - winWidth}px`);

console.log("\n=== PAGE ERRORS ===");
console.log(pageErrors.length ? pageErrors.join("\n") : "(none)");
console.log("\n=== CONSOLE ERRORS ===");
console.log(errors.length ? errors.join("\n") : "(none)");

await browser.close();
process.exit(pageErrors.length || errors.length ? 1 : 0);
