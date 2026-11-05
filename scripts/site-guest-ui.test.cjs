/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the QR form and its route without a browser, account, or live writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const crypto = require("node:crypto");
const jsx = require("react/jsx-runtime");

function load(file, imports, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const req = (name) => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; };
  new Function("exports", "require", ...Object.keys(extra), code)(exports, req, ...Object.values(extra));
  return exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function words(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(words).join("");
  return typeof tree === "object" ? words(tree.props?.children) : String(tree);
}
const project = { id: "server-only-id", name: "Test site", project_number: "PC-TEST", city: "Salem", status: "in_progress" };
const portal = { PortalTheme: "PortalTheme", PortalHeader: "PortalHeader", HeaderAction: "HeaderAction" };

async function pageTests() {
  let authReads = 0, adminReads = 0;
  let row = project;
  const route = load("src/app/sub/j/[code]/page.tsx", {
    "react/jsx-runtime": jsx, "next/link": "Link",
    "@/components/sub-portal/site-join": { SiteJoin: "SiteJoin" },
    "@/components/crew/crew-job-folder": { CrewJobFolder: "CrewJobFolder" },
    "@/components/schedule/upload-queue-banner": { UploadQueueBanner: "UploadQueueBanner" },
    "@/components/site-qr/guest-site-photos": { GuestSitePhotos: "GuestSitePhotos" },
    "@/components/portal-kit": portal,
    "@/lib/site-qr/team-job": { getTeamSiteJob: async () => { authReads++; return { kind: "signed_out" }; } },
    "@/lib/supabase/admin": { createAdminClient: () => { adminReads++; return {}; } },
    "@/lib/sub-portal/site-code": {
      normalizeSiteCode: (code) => code.toUpperCase(), findProjectBySiteCode: async () => row,
      isSiteOpen: (p) => p.status === "in_progress",
    },
  }).default;
  let result = await route({ params: Promise.resolve({ code: "abcdefgh" }) });
  assert.equal(result.type, "GuestSitePhotos");
  assert.deepEqual(result.props, { code: "ABCDEFGH", project: { name: "Test site", number: "PC-TEST", town: "Salem" } });
  assert.equal(authReads, 0, "default photo flow never checks for a team login");
  for (const unavailable of [null, { ...project, status: "completed" }]) {
    row = unavailable;
    result = await route({ params: Promise.resolve({ code: "ABCDEFGH" }) });
    assert.equal(nodes(result).some((node) => node.type === "GuestSitePhotos"), false);
  }
  const before = adminReads;
  result = await route({ params: Promise.resolve({ code: "bad" }) });
  assert.equal(adminReads, before, "invalid code doesn't query the database");
  result = await route({ params: Promise.resolve({ code: "ABCDEFGH" }), searchParams: Promise.resolve({ tools: "1" }) });
  assert.equal(result.type, "SiteJoin", "only explicit project-tools choice opens legacy access");
  assert.equal(authReads, 1);
}

async function compressionTests() {
  const sizes = [900000, 700000, 300000], calls = [];
  const helper = load("src/lib/site-qr/prepare-photo.ts", {
    "@/lib/image/compress": { compressImage: async (file, dimension, quality) => {
      calls.push([dimension, quality]); return new Blob([new Uint8Array(sizes.shift())], { type: "image/jpeg" });
    } },
  });
  const photo = await helper.prepareGuestPhoto(new File(["image"], "test.jpg", { type: "image/jpeg" }));
  assert.equal(photo.size, 300000);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([dimension]) => dimension <= 1600));
  await assert.rejects(helper.prepareGuestPhoto(new File(["text"], "notes.txt", { type: "text/plain" })), /Choose a photo/);
}

async function formTests() {
  let frame;
  const hooks = {
    useState(initial) { const f = frame, i = f.index++; if (!(i in f.values)) f.values[i] = initial; return [f.values[i], (next) => { f.values[i] = typeof next === "function" ? next(f.values[i]) : next; }]; },
    useRef(initial) { const f = frame, i = f.index++; if (!(i in f.values)) f.values[i] = { current: initial }; return f.values[i]; },
    useEffect(fn) { const f = frame, i = f.index++; if (!(i in f.values)) { f.values[i] = true; f.effects.push(fn); } },
  };
  const requests = [], revoked = [];
  let outcome = "network", serial = 0;
  const component = load("src/components/site-qr/guest-site-photos.tsx", {
    react: hooks, "react/jsx-runtime": jsx, "lucide-react": Object.fromEntries(["Camera", "CheckCircle2", "Loader2", "X"].map((name) => [name, name])),
    "@/components/portal-kit": portal,
    "@/lib/site-qr/prepare-photo": { MAX_GUEST_PHOTOS: 6, MAX_GUEST_REQUEST_BYTES: 4 * 1024 * 1024, prepareGuestPhoto: async () => new Blob(["photo"], { type: "image/jpeg" }) },
  }, {
    crypto, URL: { createObjectURL: () => `blob:photo-${++serial}`, revokeObjectURL: (url) => revoked.push(url) },
    fetch: async (url, options) => {
      requests.push({ url, body: options.body });
      if (outcome === "network") throw new TypeError("Failed to fetch");
      if (typeof outcome === "number") return { ok: false, status: outcome, json: async () => ({ error: "Choose a different photo." }) };
      if (outcome === "invalid") return { ok: true, status: 200, json: async () => { throw new Error("Invalid JSON"); } };
      return { ok: true, status: 200, json: async () => ({ ok: true, logId: "saved" }) };
    },
  }).GuestSitePhotos;
  const state = { index: 0, values: [], effects: [] };
  function render() { frame = state; state.index = 0; const tree = component({ code: "ABCDEFGH", project: { name: "Test site", number: "PC-TEST", town: null } }); state.effects.splice(0).forEach((fn) => fn()); return tree; }
  const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve)); };
  let tree = render();
  const field = (name) => nodes(tree).find((node) => ["input", "textarea"].includes(node.type) && node.props.name === name);
  const fill = (name, value) => { field(name).props.onChange({ target: { value } }); tree = render(); };
  const submit = async () => {
    let prevented = false;
    nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    await settle(); tree = render();
  };
  assert.match(words(tree), /No account or PIN needed/);
  const documentsLink = nodes(tree).find((node) => node.type === "a" && node.props.href === "/sub/j/ABCDEFGH/documents");
  assert.ok(documentsLink, "QR visitors can open job documents without team sign-in");
  assert.match(words(documentsLink), /Drawings, specs & scope of work/);
  assert.ok(nodes(tree).indexOf(documentsLink) < nodes(tree).findIndex((node) => node.type === "input" && node.props.type === "file"), "documents remain available before photo selection");
  assert.equal(nodes(tree).some((node) => node.type === "GoogleSignInButton"), false);
  assert.equal(nodes(tree).some((node) => node.type === "details"), false, "work details are never hidden in a disclosure");
  for (const [name, limit] of [["name", 100], ["trade", 80], ["note", 2000]]) {
    assert.ok(field(name), `${name} is visible before choosing any photos`);
    assert.equal(field(name).props.required, true);
    assert.equal(field(name).props.maxLength, limit);
  }
  assert.equal(field("company").props.required, undefined, "company stays optional");
  assert.ok(nodes(tree).indexOf(field("note")) < nodes(tree).findIndex((node) => node.type === "input" && node.props.type === "file"), "work details precede photo selection");
  await submit();
  assert.equal(requests.length, 0);
  assert.equal(field("name").props["aria-invalid"], true);
  assert.match(words(tree), /Enter your name/);
  fill("name", "   ");
  await submit();
  assert.equal(requests.length, 0, "whitespace identity cannot post");
  fill("name", " Sam Electric ");
  await submit();
  assert.equal(field("trade").props["aria-invalid"], true);
  fill("trade", " Electrician ");
  await submit();
  assert.equal(field("note").props["aria-invalid"], true);
  fill("note", " Installed two kitchen circuits. ");
  await submit();
  assert.equal(requests.length, 0);
  assert.match(words(tree), /Add at least one photo/);
  fill("company", " Spark Works ");
  let input = nodes(tree).find((node) => node.type === "input" && node.props.type === "file");
  input.props.onChange({ target: { files: [new File(["one"], "one.jpg", { type: "image/jpeg" }), new File(["two"], "two.jpg", { type: "image/jpeg" })], value: "chosen" } });
  await settle(); tree = render();
  await submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/site-photos");
  assert.equal(requests[0].body.get("name"), "Sam Electric");
  assert.equal(requests[0].body.get("trade"), "Electrician");
  assert.equal(requests[0].body.get("company"), "Spark Works");
  assert.equal(requests[0].body.get("note"), "Installed two kitchen circuits.");
  assert.equal(requests[0].body.getAll("photos").length, 2);
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.type === "file").props.disabled, true);
  for (const name of ["name", "trade", "company", "note"]) assert.equal(field(name).props.disabled, true, `uncertain request freezes ${name}`);
  outcome = 429;
  assert.ok(nodes(tree).some((node) => node.type === "button" && words(node) === "Try again"));
  await submit();
  assert.equal(requests[1].body.get("submissionId"), requests[0].body.get("submissionId"), "uncertain retry uses the same ID");
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.type === "file").props.disabled, true, "429 after uncertainty must keep the original request frozen");
  outcome = "success";
  await submit();
  assert.equal(requests[2].body.get("submissionId"), requests[0].body.get("submissionId"));
  assert.match(words(tree), /Update posted/);
  assert.match(words(tree), /Test site's Daily Logs/);
  assert.equal(nodes(tree).filter((node) => node.type === "img").length, 0);
  assert.equal(revoked.length, 2);
  assert.equal(field("name").props.value, " Sam Electric ");
  assert.equal(field("trade").props.value, " Electrician ");
  assert.equal(field("company").props.value, " Spark Works ");
  assert.equal(field("note").props.value, "", "a new update needs its own description");
  input = nodes(tree).find((node) => node.type === "input" && node.props.type === "file");
  input.props.onChange({ target: { files: [new File(["more"], "more.jpg", { type: "image/jpeg" })], value: "chosen" } });
  await settle(); tree = render();
  await submit();
  assert.equal(requests.length, 3, "success clears description and won't repost the prior work");
  fill("note", "Checked outlets.");
  fill("company", "");
  outcome = 400;
  await submit();
  assert.equal(requests[3].body.get("company"), "", "worker can post without a company");
  assert.notEqual(requests[3].body.get("submissionId"), requests[2].body.get("submissionId"), "new post gets a fresh ID");
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.type === "file").props.disabled, false, "first definitive rejection allows corrections");
  outcome = 413;
  fill("trade", "Electrical");
  await submit();
  assert.equal(requests[4].body.get("trade"), "Electrical", "definitive rejection allows work details to be corrected");
  assert.notEqual(requests[4].body.get("submissionId"), requests[3].body.get("submissionId"), "corrected request after rejection gets a fresh ID");
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.type === "file").props.disabled, false, "definitive payload rejection allows removal");
  outcome = 503;
  await submit();
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.type === "file").props.disabled, true, "5xx makes save status uncertain");
  outcome = 400;
  await submit();
  assert.equal(requests[6].body.get("submissionId"), requests[5].body.get("submissionId"));
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.type === "file").props.disabled, true, "later 400 cannot clear earlier uncertainty");
  outcome = "invalid";
  await submit();
  assert.equal(requests[7].body.get("submissionId"), requests[5].body.get("submissionId"));
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.type === "file").props.disabled, true);
  outcome = "success";
  await submit();
  assert.equal(requests[8].body.get("submissionId"), requests[5].body.get("submissionId"));
  assert.match(words(tree), /Update posted/);
}

(async () => {
  await pageTests(); await compressionTests(); await formTests();
  console.log("Passed: no-login QR route, closed/invalid codes, compression bounds, visible work details, required name/trade/description, optional company, retained retry and fresh post IDs.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
