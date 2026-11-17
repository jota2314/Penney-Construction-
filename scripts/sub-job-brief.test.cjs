/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Render the actual field components without starting a browser or a database.
function load(moduleName) {
  if (!moduleName.startsWith("@/")) return require(moduleName);
  const base = path.join(__dirname, "../src", moduleName.slice(2));
  const file = fs.existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts";
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, load);
  return exports;
}
const { JobBrief } = load("@/components/sub-portal/job-brief");
const { JobDrawings } = load("@/components/sub-portal/job-drawings");
const { TodayTab } = load("@/components/sub-portal/today-tab");
const { parseJobLink, jobLink } = load("@/lib/sub-portal/job-link");
const empty = {
  approved_scope: null, assignment_summary: null, scope: [], agreements: [], quotes: [],
  dates: [], files: [], files_unavailable: false, selections: [],
};
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const brief = (fields) => render(JobBrief, { data: { ...empty, ...fields }, onFiles() {} });

test("project-wide construction, assigned work and estimate reference retain their sources", () => {
  const markup = brief({
    approved_scope: {
      source: { status: "signed", date: "2026-11-02" },
      sections: [{ id: "general", label: "General", items: [{ title: "Second-floor addition", description: "Frame two bedrooms." }] }],
    },
    assignment_summary: "Rough plumbing",
    agreements: [
      { id: "wo", kind: "work_order", number: "WO-1", title: "Fixture install", status: "signed", scope_text: "Install 2 sinks. Fee $900." },
      { id: "old", status: "superseded", scope_text: "Previous arrangement" },
      { id: "pending", status: "sent", scope_text: "Unaccepted terms" },
    ],
    quotes: [
      { id: "a", source: "bid", stage: "awarded", title: "Supply lines", scope: "Run copper. Price $700." },
      { id: "b", source: "quote", stage: "under_review", scope: "Possible future work" },
    ],
    scope: [{ trade: "plumbing", description: "Valve layout", scope: "Coordinate the wall depth." }],
  });
  for (const expected of ["Signed project scope", "Nov 2, 2026", "Frame two bedrooms.", "Job assignment", "Rough plumbing",
    "Signed work order", "WO-1", "Install 2 sinks", "Awarded bid", "Run copper", "Estimate reference", "Valve layout"]) {
    assert.ok(markup.includes(expected), expected);
  }
  assert.doesNotMatch(markup, /900|700|Previous arrangement|Unaccepted terms|Possible future work/);
});

test("empty brief distinguishes unpublished work, missing records and an unavailable file list", () => {
  const markup = brief({ approved_scope: { sections: [], unavailableReason: "No approved scope published." } });
  assert.match(markup, /No approved scope published/);
  assert.match(markup, /Confirm|confirm/);
  assert.match(markup, /hasn’t posted plans/);
  assert.doesNotMatch(brief({ files_unavailable: true }), /hasn’t posted plans/);
  const broken = render(JobDrawings, { files: [], unavailable: true, onRetry() {} });
  assert.match(broken, /Try again/);
  assert.doesNotMatch(broken, /hasn’t posted/);
});

test("only actionable upcoming dates link to an answer", () => {
  const phase = { id: "first", name: "Rough-in", status: "not_started", bucket: "this_week", firm: true, needs_answer: true };
  const markup = render(JobBrief, { data: { ...empty, dates: [
    phase, { ...phase, id: "held", name: "Framing", status: "on_hold" },
    { ...phase, id: "past", name: "Inspection", bucket: "past" },
  ] }, onFiles() {}, onAnswerDates() {} });
  assert.match(markup, /Answer dates for Rough-in/);
  assert.doesNotMatch(markup, /Answer dates for (Framing|Inspection)/);
});

test("current drawings remain accessible when another file fails", () => {
  const files = [{ key: "drawings", label: "Drawings", docs: [
    { id: "plan", group: "drawings", title: "Construction-R3.pdf", subtitle: "Rev 3", date: "2026-11-15", url: "/current-plan.pdf" },
  ] }];
  const markup = brief({ files, files_unavailable: true });
  assert.match(markup, /href="\/current-plan.pdf"/);
  assert.match(markup, /Rev 3/);
  assert.match(markup, /Some files couldn’t load/);
  const documents = render(JobDrawings, { files, unavailable: true, onRetry() {} });
  assert.match(documents, /current-plan.pdf/);
  assert.match(documents, /Try again/);
});

test("ordinary jobs, QR photos, files and paperwork open on their intended section", () => {
  const id = "6056f3d5-7a77-4858-a776-068de4b296c3";
  const parse = (suffix) => parseJobLink(new URLSearchParams(`job=${id}${suffix}`));
  assert.equal(parse("").view, "info");
  assert.equal(parse("&view=unknown").view, "info");
  assert.deepEqual(parse("&compose=1&view=drawings"), { id, compose: true, view: "log" });
  assert.equal(parseJobLink(new URLSearchParams("job=missing")), null);
  const url = `https://example.test/sub/portal?ref=site&job=${id}&compose=1#dates`;
  for (const section of ["info", "drawings", "log", "paperwork"]) {
    const link = new URL(jobLink(url, id, section), url);
    assert.deepEqual(parseJobLink(link.searchParams), { id, compose: false, view: section });
    assert.equal(link.hash, "#dates");
    assert.equal(link.searchParams.get("ref"), "site");
  }
  assert.equal(jobLink(url, null, "drawings"), "/sub/portal?ref=site#dates");
});

test("Today finds an assigned job by site, type or phase and handles an empty list", () => {
  const one = { project_id: "a", project_number: "PC-111", name: "First floor", project_type: "kitchen",
    address: "8 Example Road", town: "Salem", summary: "Install cabinets", phase: { name: "Cabinets" } };
  const two = { ...one, project_id: "b", project_number: "PC-222", name: "Upper floor", project_type: "addition",
    address: "18 Sample Street", town: "Lynn", summary: "No dates yet", phase: null };
  function home(search, rows = [one, two]) {
    return render(TodayTab, { data: { today: "2026-11-17", flags: { office_phone: "5550100" },
      jobs: { today: rows.slice(0, 1), this_week: rows.slice(1), other: [] } }, needed: [], search,
      onSearch() {}, onOpenJob() {} });
  }
  assert.match(home(""), /Next 7 days/);
  assert.match(home(""), /Plans and files for Upper floor/);
  for (const query of ["example road", "Kitchen", " cabinets ", "Pc-111", "salem", "first floor"]) {
    assert.match(home(query), /Job brief for First floor/);
    assert.doesNotMatch(home(query), /Upper floor/);
  }
  assert.match(home("Unknown"), /Show all jobs/);
  assert.match(home("old query", [two]), /Job brief for Upper floor/);
  assert.match(home("", []), /No open jobs assigned/);
});
