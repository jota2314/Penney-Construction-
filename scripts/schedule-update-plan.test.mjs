import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(readFileSync("src/lib/schedule/update-plan.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(compiled, compiled.exports);
const { planScheduleUpdate, shiftDay, dayDiff } = compiled.exports;

const TODAY = "2026-11-11";
const step = (id, start, end, o = {}) => ({ id, name: id, status: "not_started", start_date: start, end_date: end, ...o });
const plan = (rows, answers, o = {}) =>
  planScheduleUpdate({ rows, answers, pushLater: true, today: TODAY, canPush: (r) => !/dumpster/i.test(r.name), ...o });

test("date helpers cross a month and a DST change cleanly", () => {
  assert.equal(shiftDay("2026-10-30", 3), "2026-11-02");
  assert.equal(shiftDay("2026-11-01", -1), "2026-10-31");
  assert.equal(dayDiff("2026-10-30", "2026-11-02"), 3);
});

test("done only sets the status", () => {
  const p = plan([step("tile", "2026-11-05", "2026-11-10")], [{ id: "tile", kind: "done" }]);
  assert.equal(p.error, null);
  assert.deepEqual(p.writes, [{ id: "tile", patch: { status: "completed" } }]);
  assert.deepEqual(p.tail, []);
});

test("still going keeps the start, takes the new end, and pushes nothing", () => {
  const p = plan(
    [step("tile", "2026-11-05", "2026-11-10"), step("paint", "2026-11-17", "2026-11-18")],
    [{ id: "tile", kind: "going", end: "2026-11-13" }],
  );
  assert.equal(p.error, null);
  assert.deepEqual(p.writes, [
    { id: "tile", patch: { status: "in_progress", start_date: "2026-11-05", end_date: "2026-11-13" } },
  ]);
  assert.deepEqual(p.tail, []);
});

test("still going cannot end in the past", () => {
  const p = plan([step("tile", "2026-11-05", "2026-11-10")], [{ id: "tile", kind: "going", end: "2026-11-10" }]);
  assert.match(p.error, /end date of today or later/);
  assert.deepEqual(p.writes, []);
});

test("not started moves the step whole and resets its status", () => {
  const p = plan(
    [step("tile", "2026-11-05", "2026-11-10", { status: "in_progress" })],
    [{ id: "tile", kind: "not_started", start: "2026-11-23" }],
    { pushLater: false },
  );
  assert.equal(p.error, null);
  assert.deepEqual(p.writes, [
    { id: "tile", patch: { status: "not_started", start_date: "2026-11-23", end_date: "2026-11-28" } },
  ]);
});

test("not started cannot start in the past", () => {
  const p = plan([step("tile", "2026-11-05", "2026-11-10")], [{ id: "tile", kind: "not_started", start: "2026-11-09" }]);
  assert.match(p.error, /start date of today or later/);
});

test("a step past its date with no answer blocks the confirm", () => {
  const p = plan(
    [step("demo", "2026-11-02", "2026-11-03"), step("tile", "2026-11-05", "2026-11-10")],
    [{ id: "tile", kind: "done" }],
  );
  assert.match(p.error, /1 step is past the end date/);
});

test("finished and cancelled steps never need an answer", () => {
  const p = plan(
    [step("demo", "2026-11-02", "2026-11-03", { status: "completed" }), step("old", "2026-10-01", "2026-10-02", { status: "cancelled" })],
    [],
  );
  assert.equal(p.error, null);
  assert.deepEqual(p.writes, []);
});

test("push later slides open work after the moved step by the same days", () => {
  const rows = [
    step("demo", "2026-11-02", "2026-11-03", { status: "completed" }),
    step("Dumpster on site", "2026-11-06", "2026-11-25"),
    step("tile", "2026-11-05", "2026-11-10"),
    step("glass", "2026-11-13", "2026-11-13"),
    step("paint", "2026-11-17", "2026-11-18"),
    step("early", "2026-11-04", "2026-11-12", { status: "in_progress" }),
  ];
  const p = plan(rows, [{ id: "tile", kind: "not_started", start: "2026-11-23" }]);
  assert.equal(p.error, null);
  assert.deepEqual(p.tail, [
    { id: "glass", patch: { start_date: "2026-12-01", end_date: "2026-12-01" } },
    { id: "paint", patch: { start_date: "2026-12-05", end_date: "2026-12-06" } },
  ]);
});

test("push later off leaves the later steps alone", () => {
  const p = plan(
    [step("tile", "2026-11-05", "2026-11-10"), step("glass", "2026-11-13", "2026-11-13")],
    [{ id: "tile", kind: "not_started", start: "2026-11-23" }],
    { pushLater: false },
  );
  assert.deepEqual(p.tail, []);
});

test("with two moves the earliest one sets the push, and answered steps keep their own dates", () => {
  const rows = [
    step("tile", "2026-11-05", "2026-11-10"),
    step("glass", "2026-11-13", "2026-11-13"),
    step("paint", "2026-11-17", "2026-11-18"),
  ];
  const p = plan(rows, [
    { id: "glass", kind: "move", start: "2026-11-30" },
    { id: "tile", kind: "not_started", start: "2026-11-12" },
  ]);
  assert.equal(p.error, null);
  assert.deepEqual(p.writes[0], { id: "glass", patch: { start_date: "2026-11-30", end_date: "2026-11-30" } });
  assert.deepEqual(p.tail, [{ id: "paint", patch: { start_date: "2026-11-24", end_date: "2026-11-25" } }]);
});

test("moving a step earlier pushes nothing", () => {
  const p = plan(
    [step("glass", "2026-11-20", "2026-11-20"), step("paint", "2026-11-24", "2026-11-25")],
    [{ id: "glass", kind: "move", start: "2026-11-16" }],
  );
  assert.equal(p.error, null);
  assert.deepEqual(p.writes, [{ id: "glass", patch: { start_date: "2026-11-16", end_date: "2026-11-16" } }]);
  assert.deepEqual(p.tail, []);
});

test("the same step answered twice is refused", () => {
  const p = plan([step("tile", "2026-11-05", "2026-11-10")], [
    { id: "tile", kind: "done" },
    { id: "tile", kind: "going", end: "2026-11-13" },
  ]);
  assert.match(p.error, /answered twice/);
});

test("an answer for a step that is gone is refused", () => {
  const p = plan([step("tile", "2026-11-12", "2026-11-13")], [{ id: "ghost", kind: "done" }]);
  assert.match(p.error, /no longer on this job/);
});
