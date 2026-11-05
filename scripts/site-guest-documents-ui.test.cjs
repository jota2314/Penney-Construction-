/* eslint-disable @typescript-eslint/no-require-imports */
// Server-render the public documents page without accounts, live reads or a browser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const jsx = require("react/jsx-runtime");
const project = { name: "Test job", number: "PC-TEST", town: "Salem" };
let docs, scope, failDocuments, failScope;
const reads = [];
const imports = {
  "react/jsx-runtime": jsx,
  "lucide-react": Object.fromEntries(["ArrowLeft", "Download", "FileText", "Phone"].map(name => [name, name])),
  "@/components/portal-kit": { HeaderAction: "HeaderAction", PortalHeader: "PortalHeader", PortalTheme: "PortalTheme" },
  "@/lib/site-qr/guest-documents": { getGuestJobDocuments: async code => { reads.push(code); if (failDocuments) throw failDocuments; return docs; } },
  "@/lib/site-qr/guest-scope": { getGuestJobScope: async code => { reads.push(code); if (failScope) throw failScope; return scope; } },
  "@/lib/sub-portal/site-code": { normalizeSiteCode: code => code.trim().toUpperCase() },
};
const loaded = {};
const compiled = ts.transpileModule(fs.readFileSync("src/app/sub/j/[code]/documents/page.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function("exports", "require", compiled)(loaded, name => {
  assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name];
});
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
function words(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(words).join(" ");
  if (typeof tree !== "object") return String(tree);
  return words(typeof tree.type === "function" ? tree.type(tree.props) : tree.props?.children);
}
const render = () => loaded.default({ params: Promise.resolve({ code: "  abcd2345  " }) });
const links = tree => nodes(tree).filter(node => node.type === "a");
(async () => {
  docs = { project, drawings: [{ id: "drawing-id", filename: "Current drawings.pdf", category: "plans" }], specs: [{ id: "spec-id", filename: "Plumbing cut sheet.pdf", category: "specs" }] };
  scope = { project, source: { label: "Current approved job scope" }, sections: [{ id: "general", label: "General", items: [] }, { id: "trade-plumbing-2", label: "Plumbing", items: [] }], unavailableReason: null };
  let tree = await render();
  assert.deepEqual(reads, ["ABCD2345", "ABCD2345"]);
  assert.equal(loaded.metadata.referrer, "no-referrer");
  assert.deepEqual(loaded.metadata.robots, { index: false, follow: false });
  assert.match(words(tree), /No account or PIN needed/);
  assert.match(words(tree), /Current drawings.pdf/);
  assert.match(words(tree), /Plumbing cut sheet.pdf/);
  const hrefs = links(tree).map(node => node.props.href);
  assert.ok(hrefs.includes("/sub/j/ABCD2345"));
  assert.ok(hrefs.includes("/api/site-scope/ABCD2345"));
  assert.ok(hrefs.includes("/api/site-scope/ABCD2345?trade=trade-plumbing-2"));
  assert.ok(!hrefs.some(href => href.includes("trade=general")));
  assert.ok(hrefs.includes("/api/site-documents/ABCD2345/drawing-id"));
  assert.ok(hrefs.includes("/api/site-documents/ABCD2345/spec-id"));
  for (const node of links(tree).filter(node => node.props.target === "_blank")) assert.equal(node.props.rel, "noreferrer");
  failDocuments = new Error("private backend details");
  tree = await render();
  assert.ok(links(tree).some(node => node.props.href === "/api/site-scope/ABCD2345"), "scope stays available when file listing fails");
  assert.match(words(tree), /Couldn't load the files/);
  assert.doesNotMatch(words(tree), /private backend details/);
  failDocuments = null; failScope = new Error("private scope details");
  tree = await render();
  assert.match(words(tree), /Plumbing cut sheet.pdf/);
  assert.match(words(tree), /Couldn't load the scope/);
  assert.ok(!links(tree).some(node => node.props.href.startsWith("/api/site-scope/")));
  failScope = null;
  scope = { project, source: null, sections: [], unavailableReason: "The approved scope has not been published for this job yet." };
  docs = { project, drawings: [], specs: [] };
  tree = await render();
  assert.match(words(tree), /No\s+drawings\s+are available here yet/);
  assert.match(words(tree), /No\s+specs\s+are available here yet/);
  assert.match(words(tree), /approved scope has not been published/);
  failDocuments = { status: 404 }; scope = null;
  tree = await render();
  assert.match(words(tree), /This job isn't available/);
  assert.ok(!links(tree).some(node => node.props.href.startsWith("/api/site-")));
  console.log("Passed: QR documents navigation, full/trade scope links, document links, no-referrer, independent failures and unpublished/closed states.");
})().catch(error => { console.error(error); process.exitCode = 1; });
