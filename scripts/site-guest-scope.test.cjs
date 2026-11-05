/* eslint-disable @typescript-eslint/no-require-imports */
// Scope projection and real server-loader queries with fixture rows; no production writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
function load(file, mocks = {}) {
  const result = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", code)(id => {
    if (id === "server-only") return {};
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith("@/")) throw new Error(`Unexpected import ${id}`);
    return require(id);
  }, result, result.exports);
  return result.exports;
}
const text = load("src/lib/site-qr/scope-text.ts");
const { priceFreeScopeText: scrub } = text;
const visibility = load("src/lib/crew/crew-visibility.ts");
const statuses = load("src/lib/sub-portal/statuses.ts");
const site = load("src/lib/sub-portal/site-code.ts", {
  "@/lib/crew/crew-visibility": visibility,
  "@/lib/sub-portal/statuses": statuses,
});
const { projectGuestScope, loadGuestJobScope } = load("src/lib/site-qr/guest-scope.ts", {
  "@/lib/supabase/admin": { createAdminClient() { throw new Error("No production client in tests"); } },
  "@/lib/sub-portal/site-code": site,
  "@/lib/site-qr/scope-text": text,
});

const mixed = [
  ["Install 30 LF of 2-inch copper; allowance $500 for fixtures.", "Install 30 LF of 2-inch copper"],
  ["Install 2 valves ($450) with 3/4-inch PEX.", "Install 2 valves with 3/4-inch PEX."],
  ["Install 2 sinks for $2,500.", "Install 2 sinks"],
  ["Install 12.5 LF copper. Price: 2,500.", "Install 12.5 LF copper."],
  ["Install 4 outlets. Markup 15%.", "Install 4 outlets."],
  ["Tile allowance includes 30 SF of tile up to $10/SF.", "Tile includes 30 SF of tile"],
  ["Use a bracket supporting 50 pounds.", "Use a bracket supporting 50 pounds."],
  ["Install 2 fixtures selected within owner allowance.", "Install 2 fixtures selected within owner allowance."],
  ["Install 2 fixtures (within owner allowance) at 16 inches on center.", "Install 2 fixtures (within owner allowance) at 16 inches on center."],
  ["Install 1/2-inch pipe with 2% slope.", "Install 1/2-inch pipe with 2% slope."],
  ["Use a shower valve with a flow rate of 2.5 GPM.", "Use a shower valve with a flow rate of 2.5 GPM."],
  ["Install a total of 2 fixtures.", "Install a total of 2 fixtures."],
  ["Provide balanced ventilation at 120 CFM.", "Provide balanced ventilation at 120 CFM."],
  ["Due to clearance, keep a 36-inch opening.", "Due to clearance, keep a 36-inch opening."],
  ["Install vanity for 2,500 plus tax.", "Install vanity."],
  ["Plumbing - 2500.00", "Plumbing"],
  ["Install 2 sinks. $500 each.", "Install 2 sinks."],
  ["Plumbing &#36;2,500", "Plumbing"],
  ["Ｐｌｕｍｂｉｎｇ ＄２５００", "Plumbing"],
];
for (const [input, expected] of mixed) assert.equal(scrub(input), expected, input);
for (const money of ["$2,500", "USD 2,500", "2,500 USD", "2500 dollars", "five thousand dollars", "£200", "€200", "₹2500", "Price 2500", "Retail 2500", "Budget: 2500", "Total 2500", "Rate of 2500", "15% profit", "20% down", "Compensation 2500", "Price: negotiable 2500 USD", "USD unknown amount", "Fixture selection: MSRP 999.99", "Materials: 1200, labor: 800", "Faucet allowance: five hundred", "Contractor fee of ten percent"]) {
  const result = scrub(`Install 2 sinks. ${money}.`);
  assert.ok(result.includes("Install 2 sinks."));
  assert.doesNotMatch(result, /2500|2,500|5000|200|800|999|15%|20%|thousand|hundred|ten percent|\$|USD|€|£|₹/, money);
  assert.equal(scrub(result), result, `idempotent: ${money}`);
}

const project = { id: "job-a", name: "Kitchen $5000", project_number: "PC-123", city: "Peabody", status: "in_progress", is_overhead: false, contract_estimate_id: "estimate-a", contract_client_signed_at: "2026-10-01T12:00:00Z", contract_locked_at: "2026-10-01T12:01:00Z" };
const estimate = { id: "estimate-a", project_id: "job-a", status: "sent", is_option: false, version: 2, updated_at: "2026-10-01T12:00:00Z", created_at: "2026-09-01T12:00:00Z" };
const line = { id: "line-1", description: "Water supply", proposal_description: "Install 30 LF of 3/4-inch PEX; budget $500.", scope_text: null, trade: "Plumbing $1200", sort_order: 1, is_section_header: false, is_visible_on_proposal: true, change_order_id: null };
const change = { id: "co-approved", title: "Add 2 valves $1000", description: "Install 2 shutoffs. Total cost 1000.", status: "approved", approved_at: "2026-10-05T12:00:00Z", created_at: "2026-10-04T12:00:00Z" };

function harness(options = {}) {
  const state = { project, pointer: estimate, fallback: null, lines: [line], changes: [], links: [], reads: [], errorTable: null, ...options };
  const admin = { from(table) {
    const q = { table, fields: "", filters: [], orders: [], page: null,
      select(fields, options = {}) { this.fields = fields; this.options = options; return this; },
      eq(key, val) { this.filters.push(["eq", key, val]); return this; },
      is(key, val) { this.filters.push(["is", key, val]); return this; },
      in(key, val) { this.filters.push(["in", key, val]); return this; },
      or(value) { this.filters.push(["or", value]); return this; },
      order(key, value) { this.orders.push([key, value]); return this; },
      limit(n) { this.limitValue = n; return this; },
      range(from, to) { this.page = [from, to]; return this; },
      result() {
        state.reads.push({ table, fields: this.fields, filters: this.filters, orders: this.orders, page: this.page });
        assert.doesNotMatch(this.fields, /(?:^|,\s*)(?:total_price|client_price|unit_cost|total_cost|cost|markup|profit|contract_value|contract_locked_amount|price_impact|cost_impact|notes)(?:,|$)/);
        if (state.errorTable === table) return { data: null, error: { message: "Unavailable" } };
        if (table === "projects") { assert.deepEqual(this.filters, [["eq", "site_code", "ABCDEFGH"]]); return { data: state.project, error: null }; }
        if (table === "estimates") {
          assert.ok(this.filters.some(f => f[0] === "eq" && f[1] === "project_id" && f[2] === "job-a"));
          if (this.filters.some(f => f[1] === "id")) return { data: state.pointer, error: null };
          assert.ok(this.filters.some(f => f[0] === "in" && f[1] === "status" && JSON.stringify(f[2]) === '["approved","accepted"]'));
          assert.ok(this.filters.some(f => f[0] === "or" && f[1] === "is_option.is.null,is_option.eq.false"));
          return { data: state.fallback, error: null };
        }
        let rows;
        if (table === "change_orders") {
          assert.ok(this.filters.some(f => f[1] === "project_id" && f[2] === "job-a"));
          assert.ok(this.filters.some(f => f[1] === "status" && f[2] === "approved"));
          rows = state.changes;
        } else if (table === "estimate_line_items" && this.fields.includes("estimates!inner")) {
          assert.ok(this.filters.some(f => f[1] === "estimates.project_id" && f[2] === "job-a"));
          assert.ok(this.filters.some(f => f[1] === "estimate_id"));
          assert.deepEqual(this.filters.find(f => f[0] === "in")[2], state.changes.map(c => c.id));
          assert.ok(this.filters.some(f => f[0] === "or" && f[1].includes("is_visible_on_proposal")));
          rows = state.links;
        } else {
          assert.equal(table, "estimate_line_items");
          assert.ok(this.filters.some(f => f[1] === "estimate_id"));
          assert.ok(this.filters.some(f => f[0] === "is" && f[1] === "change_order_id" && f[2] === null));
          assert.ok(this.filters.some(f => f[0] === "or" && f[1].includes("is_visible_on_proposal")));
          rows = state.lines;
        }
        assert.deepEqual(this.options, { count: "exact" });
        return { data: rows.slice(this.page[0], Math.min(this.page[1] + 1, this.page[0] + (state.serverCap || 500))), error: null, count: rows.length };
      },
      async maybeSingle() { return this.result(); },
      then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
    };
    return q;
  } };
  return { state, admin };
}

(async () => {
  const { admin, state } = harness();
  const scope = await loadGuestJobScope(admin, "abcdefgh");
  assert.equal(scope.project.name, "Kitchen");
  assert.equal(scope.source.status, "signed");
  assert.equal(scope.source.date, "2026-10-01");
  assert.equal(scope.sections[0].label, "Plumbing");
  assert.match(scope.sections[0].items[0].description, /30 LF of 3\/4-inch PEX/);
  assert.doesNotMatch(JSON.stringify(scope), /500|1200|job-a|estimate-a|line-1|\$/);
  assert.equal(state.reads.filter(r => r.table === "estimates").length, 1);

  for (const invalid of ["", "00000000", "too-long-ABCDEFGH", "12345678-1234-1234-1234-123456789012"]) {
    const h = harness(); assert.equal(await loadGuestJobScope(h.admin, invalid), null); assert.equal(h.state.reads.length, 0);
  }
  for (const blocked of [{ status: "completed" }, { is_overhead: true }, { name: "Warehouse" }, { project_number: "PC-2026-162" }]) {
    const h = harness({ project: { ...project, ...blocked } });
    assert.equal(await loadGuestJobScope(h.admin, "ABCDEFGH"), null);
    assert.equal(h.state.reads.length, 1);
  }
  for (const rejected of [{ status: "draft" }, { status: "review" }, { status: "sent" }, { status: "approved", is_option: true }, { status: "rejected" }, { status: "superseded" }, { project_id: "job-b" }]) {
    const h = harness({ project: { ...project, contract_client_signed_at: null, contract_locked_at: null }, pointer: { ...estimate, ...rejected } });
    const unavailable = await loadGuestJobScope(h.admin, "ABCDEFGH");
    assert.equal(unavailable.source, null); assert.equal(unavailable.sections.length, 0); assert.ok(unavailable.unavailableReason);
    assert.ok(h.state.reads.every(r => ["projects", "estimates"].includes(r.table)));
  }
  for (const status of ["draft", "sent", "review"]) {
    const h = harness({ pointer: { ...estimate, status } });
    assert.ok((await loadGuestJobScope(h.admin, "ABCDEFGH")).sections.length, `signed pointer ${status}`);
  }
  const chosenOption = harness({ pointer: { ...estimate, is_option: true } });
  assert.ok((await loadGuestJobScope(chosenOption.admin, "ABCDEFGH")).sections.length);
  const unsignedOption = harness({ project: { ...project, contract_client_signed_at: null, contract_locked_at: null }, pointer: { ...estimate, is_option: true, status: "approved" } });
  assert.equal((await loadGuestJobScope(unsignedOption.admin, "ABCDEFGH")).source, null);
  const fallback = harness({ pointer: { ...estimate, status: "superseded" }, fallback: { ...estimate, id: "estimate-b", status: "accepted" } });
  assert.equal((await loadGuestJobScope(fallback.admin, "ABCDEFGH")).source.status, "approved");
  assert.ok(fallback.state.reads.find(r => r.table === "estimate_line_items").filters.some(f => f[1] === "estimate_id" && f[2] === "estimate-b"));

  const grouped = projectGuestScope(project, estimate, [
    { ...line, id: "header", is_section_header: true, description: "Kitchen $9900" },
    line,
    { ...line, id: "hidden", description: "Secret internal", is_visible_on_proposal: false },
    { ...line, id: "draft-co", description: "Unapproved addition", change_order_id: "draft-co" },
    { ...line, id: "general", description: "Coordinate access", trade: null, proposal_description: "", scope_text: "Keep a 36-inch clear route." },
  ], [change, { ...change, id: "draft-co", status: "draft", title: "Unapproved change" }], new Map([[change.id, ["Plumbing"]]]),
  new Map([[change.id, [{ title: "Valve detail", description: "Use full-port brass valves at 18 inches." }, { title: "Duplicate", description: change.description }]]]));
  assert.equal(grouped.sections[0].id, "general");
  assert.match(JSON.stringify(grouped), /36-inch clear route/);
  assert.match(JSON.stringify(grouped), /full-port brass valves at 18 inches/);
  assert.doesNotMatch(JSON.stringify(grouped), /Secret|Unapproved|9900|1000|1200|\$/);
  assert.equal(grouped.sections.find(s => s.label === "Plumbing").items.length, 3);

  const many = harness({ lines: Array.from({ length: 1001 }, (_, i) => ({ ...line, id: `line-${i}` })), changes: [change], links: [{ change_order_id: change.id, trade: "Plumbing", description: "Valves", proposal_description: "Install full-port valves at 18 inches. Cost USD 1000.", scope_text: null, is_section_header: false }] });
  const paged = await loadGuestJobScope(many.admin, "ABCDEFGH");
  assert.equal(many.state.reads.filter(r => r.table === "estimate_line_items" && !r.fields.includes("estimates!inner")).length, 3);
  assert.equal(paged.sections.reduce((n, s) => n + s.items.length, 0), 1003);
  assert.match(JSON.stringify(paged), /full-port valves at 18 inches/);
  assert.doesNotMatch(JSON.stringify(paged), /USD|1000|\$/);
  const capped = harness({ lines: Array.from({ length: 37 }, (_, i) => ({ ...line, id: `line-${i}` })), serverCap: 10 });
  assert.equal((await loadGuestJobScope(capped.admin, "ABCDEFGH")).sections[0].items.length, 37);
  assert.equal(capped.state.reads.filter(r => r.table === "estimate_line_items").length, 4);
  const hiddenDetail = harness({ changes: [change], links: [{ change_order_id: change.id, trade: "Plumbing", description: "Private", proposal_description: "Internal instruction", is_visible_on_proposal: false }] });
  assert.doesNotMatch(JSON.stringify(await loadGuestJobScope(hiddenDetail.admin, "ABCDEFGH")), /Private|Internal instruction/);
  for (const table of ["projects", "estimates", "estimate_line_items", "change_orders"]) {
    const h = harness({ errorTable: table });
    await assert.rejects(loadGuestJobScope(h.admin, "ABCDEFGH"), /Couldn't/);
  }
  console.log("Guest scope checks passed: approval gates, project isolation, pagination, approved-change details, money-free prose, dimensions and weights.");
})().catch(error => { console.error(error); process.exitCode = 1; });
