/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs"),
  vm = require("vm"),
  ts = require("typescript"),
  assert = require("node:assert/strict");
function load(file, mocks = {}) {
  const c = {
    exports: {},
    require: (n) => (n in mocks ? mocks[n] : require(n)),
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    c
  );
  return c.exports;
}
const { cascadeSchedule } = load("src/lib/schedule/cascade.ts");
const anchor = {
  id: "anchor",
  sort_order: 0,
  status: "in_progress",
  is_confirmed: true,
  start_date: "2026-09-05",
  end_date: "2026-09-10",
  planned_start_date: "2026-09-01",
  planned_end_date: "2026-09-06",
};
const phase = {
  ...anchor,
  id: "floor",
  sort_order: 1,
  status: "not_started",
  is_confirmed: false,
  start_date: "2026-09-11",
  end_date: "2026-09-18",
  planned_start_date: "2026-09-11",
  planned_end_date: "2026-09-18",
};
assert.equal(
  cascadeSchedule([anchor, phase]).get("floor").start_date,
  "2026-09-15"
);
for (const start of ["2026-09-11", "2026-09-17"]) {
  const saved = {
    ...phase,
    start_date: start,
    end_date: "2026-09-24",
    is_manually_scheduled: true,
  };
  const result = cascadeSchedule(
    JSON.parse(JSON.stringify([anchor, saved]))
  ).get("floor");
  assert.equal(result.start_date, start);
  assert.equal(result.firm, false);
  assert.equal(saved.planned_start_date, "2026-09-11");
}
const { moveDate } = load("src/components/schedule/use-phase-drag.ts");
assert.equal(moveDate("2026-10-31", 2), "2026-11-02");
assert.equal(moveDate("2026-03-09", -2), "2026-03-07");
assert.equal(moveDate("2026-12-31", 1), "2027-01-01");
let patch,
  authenticated = true,
  dbError = null;
const builder = {
  select() {
    return this;
  },
  eq() {
    return this;
  },
  single: async () => ({
    data: {
      is_confirmed: false,
      start_date: "2026-09-11",
      end_date: "2026-09-18",
    },
  }),
  update(p) {
    patch = p;
    return this;
  },
  then(resolve) {
    resolve({ error: dbError });
  },
};
const mocks = new Proxy(
  {
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: authenticated ? { id: "actor" } : null },
          }),
        },
        from: () => builder,
      }),
    },
    "next/cache": { revalidatePath() {} },
    zod: require("zod"),
  },
  { has: () => true, get: (t, k) => t[k] ?? {} }
);
const { updateSchedulePhase } = load("src/lib/actions/schedule.ts", mocks);
(async () => {
  const input = {
    project_id: "11111111-1111-4111-8111-111111111111",
    start_date: "2026-09-17",
    end_date: "2026-09-24",
    is_manually_scheduled: true,
  };
  assert.equal((await updateSchedulePhase("floor", input)).error, null);
  assert.equal(patch.is_manually_scheduled, true);
  assert.equal(patch.start_date, input.start_date);
  assert.equal("planned_start_date" in patch, false);
  assert.equal("assigned_employee_ids" in patch, false);
  assert.equal("is_confirmed" in patch, false);
  assert(
    (await updateSchedulePhase("floor", { ...input, end_date: "2026-09-01" }))
      .error
  );
  dbError = { message: "Save failed" };
  assert.equal(
    (await updateSchedulePhase("floor", input)).error,
    "Save failed"
  );
  authenticated = false;
  assert.equal(
    (await updateSchedulePhase("floor", input)).error,
    "Not authenticated"
  );
  console.log(
    "Manual date persistence, unchanged baseline, date-only writes, DST/year boundaries, auth and error checks passed."
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
