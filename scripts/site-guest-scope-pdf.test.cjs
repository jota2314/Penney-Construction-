/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic documents only. No live project records or uploads.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { PDFParse } = require("pdf-parse");

function load(file, overrides = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const req = (name) => {
    if (name in overrides) return overrides[name];
    if (name === "server-only") return {};
    if (name.startsWith("@/")) return load(path.join("src", name.slice(2)) + ".ts", overrides);
    return require(name);
  };
  new Function("exports", "require", "Buffer", code)(exports, req, Buffer);
  return exports;
}

const pdf = load("src/lib/site-qr/guest-scope-pdf.ts");
const sample = {
  project: { name: "Sample Bath Renovation", number: "PC-SAMPLE", town: "Peabody" },
  source: { label: "Current approved job scope", date: "2026-11-05", status: "signed" },
  sections: [
    { id: "general", label: "General", items: [{ title: "Site preparation", description: "Protect access paths and adjacent finishes. Coordinate fixture locations before rough-in.\nKeep the 36-inch access route clear." }] },
    { id: "plumbing-0", label: "Plumbing - Fixture rough-ins, testing, and final connections coordinated with the selected equipment", items: Array.from({ length: 10 }, (_, i) => ({
      title: `${i + 1}. ${i === 1 ? "Shower valve installation, wall depth verification, service access and coordination with finish thickness" : "Supply and waste connections"}`,
      description: "Install 2 fixture supplies with 1/2-inch connections and keep supports at 16 inches on center. Verify the 12-inch toilet rough-in against the selected fixture.\n- Pressure-test the new connections before the wall is closed.\n- Protect trim during final installation and verify shutoff access.\nFixture allowance: $2,250.00.\nUnit cost USD 135.00.\nRetain the 3/4-inch connection specified for the test assembly.",
    })) },
    { id: "electrical-1", label: "Electrical", items: [{ title: "Lighting connections", description: "Install the 120V lighting connection and verify the specified GFCI protection." }] },
  ],
  unavailableReason: null,
  // These unexpected financial properties must never be serialized/rendered.
  contractTotal: "$987,654.32",
  internalNote: "Profit $67,890.12",
};

async function textOf(bytes) {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try { return await parser.getText(); } finally { await parser.destroy(); }
}

async function main() {
  assert.deepEqual(pdf.selectGuestScopeSections(sample, "plumbing-0").map(section => section.id), ["general", "plumbing-0"]);
  assert.deepEqual(pdf.selectGuestScopeSections(sample, "general").map(section => section.id), ["general"]);
  assert.throws(() => pdf.selectGuestScopeSections(sample, "missing"), error => error.status === 400);
  assert.throws(() => pdf.selectGuestScopeSections(sample, ""), error => error.status === 400);
  assert.throws(() => pdf.buildGuestScopePdf({ ...sample, source: null, sections: [] }), error => error.status === 409);

  const bytes = pdf.buildGuestScopePdf(sample, "plumbing-0");
  const result = await textOf(bytes);
  assert.ok(result.total >= 3, "Long scope must flow across multiple pages");
  assert.match(result.text, /Sample Bath Renovation/);
  assert.match(result.text, /General/);
  assert.match(result.text, /1\. Supply and waste connections/);
  assert.match(result.text, /12-inch toilet rough-in/);
  assert.match(result.text, /16 inches on center/);
  assert.match(result.text, /3\/4-inch connection/);
  assert.match(result.text, /Page 1 of/);
  assert.doesNotMatch(result.text, /Lighting connections|987,654|67,890|2,250|135\.00|\$|\bUSD\b/);
  assert.match(pdf.guestScopePdfFilename(sample, "plumbing-0"), /^PC-SAMPLE-Scope-of-Work-plumbing-0\.pdf$/);

  const metadataMoney = { ...sample, project: { name: "Test Job - $7,654.32", number: "PC-SAFE", town: "Salem" }, source: { ...sample.source, label: "Approved scope - $4,321.98" } };
  const metadataText = await textOf(pdf.buildGuestScopePdf(metadataMoney, "general"));
  assert.doesNotMatch(metadataText.text, /7,654|4,321|\$/);
  assert.doesNotMatch(pdf.guestScopePdfFilename({ ...sample, project: { ...sample.project, number: '\";\r\nInjected: bad' } }), /[\r\n\"]/);

  let currentScope = sample;
  let loads = 0;
  const scopeCodes = [];
  const route = load("src/app/api/site-scope/[code]/route.ts", {
    "@/lib/site-qr/guest-scope": { getGuestJobScope: async code => { loads++; scopeCodes.push(code); if (currentScope === "error") throw Error("Private database error"); return currentScope; } },
    "@/lib/site-qr/guest-scope-pdf": pdf,
  });
  const request = (query = "", headers = {}) => ({ nextUrl: new URL(`https://example.test/api/site-scope/ABCDEFGH${query}`), headers: new Headers(headers) });
  const context = { params: Promise.resolve({ code: "ABCDEFGH" }) };
  const valid = await route.GET(request("?trade=plumbing-0"), context);
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("content-type"), "application/pdf");
  assert.match(valid.headers.get("cache-control"), /no-store/);
  assert.equal(valid.headers.get("referrer-policy"), "no-referrer");
  assert.equal(scopeCodes[0], "ABCDEFGH");
  assert.equal((await route.GET(request("?trade=nope"), context)).status, 400);
  assert.equal((await route.GET(request("?trade="), context)).status, 400);
  assert.equal((await route.GET(request("?trade=general&trade=plumbing-0"), context)).status, 400);
  const beforeAction = loads;
  assert.equal((await route.GET(request("", { "next-action": "not-an-action" }), context)).status, 405);
  assert.equal(loads, beforeAction);
  currentScope = null;
  assert.equal((await route.GET(request(), context)).status, 404);
  currentScope = { ...sample, source: null, sections: [], unavailableReason: "No approved scope" };
  assert.equal((await route.GET(request(), context)).status, 409);
  currentScope = "error";
  const originalError = console.error;
  console.error = () => {};
  const failed = await route.GET(request(), context);
  console.error = originalError;
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /Private database/);

  if (process.argv[2]) {
    const output = path.resolve(process.argv[2]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
  }
  console.log(`Passed: price-free ${result.total}-page scope, trade plus General, dimensions preserved, metadata scrubbed, job-code routing, unavailable scope and no-action guards.`);
}

main().catch(error => { console.error(error); process.exit(1); });
