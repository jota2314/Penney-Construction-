import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCodexReviewUrl, buildReviewPrompt, DEFAULT_CODEX_WORKSPACE } from "../src/lib/codex/review.ts";

test("desktop handoff preserves Windows paths and edited prompt punctuation", () => {
  const prompt = "Review O'Brien & Sons\nΔ costs? #2 + credits = $100";
  const url = new URL(buildCodexReviewUrl(prompt, DEFAULT_CODEX_WORKSPACE));
  assert.equal(url.protocol, "codex:");
  assert.equal(url.hostname, "new");
  assert.equal(url.searchParams.get("path"), DEFAULT_CODEX_WORKSPACE);
  assert.equal(url.searchParams.get("prompt"), prompt);
  assert.deepEqual([...url.searchParams.keys()], ["path", "prompt"]);
  assert.equal(url.hash, "");
});

test("selected historical period and job remain scoped in prepared prompts", () => {
  const weekly = buildReviewPrompt({ kind: "weekly", label: "August 2026", startDate: "2026-08-01", endDate: "2026-08-31", path: "/week?range=month&offset=-1" }, "https://penney.test");
  assert.match(weekly, /2026-08-01 through 2026-08-31/);
  assert.match(weekly, /https:\/\/penney.test\/week\?range=month&offset=-1/);
  const job = buildReviewPrompt({ kind: "job", projectId: "job-123" }, "https://penney.test");
  assert.match(job, /project ID job-123/);
  assert.match(job, /\/projects\/job-123\?tab=finances/);
  assert.doesNotMatch(job, /August 2026/);
  for (const prompt of [weekly, job]) {
    assert.match(prompt, /do not rely on QuickBooks/);
    assert.match(prompt, /read-only/);
    assert.match(prompt, /within my authorized access/);
  }
});

test("invalid workspace or empty prompt cannot produce an actionable link", () => {
  for (const path of ["", "Penney Construction", "https://example.com", "C:relative"]) {
    assert.equal(buildCodexReviewUrl("Review", path), "");
  }
  assert.equal(buildCodexReviewUrl("  ", DEFAULT_CODEX_WORKSPACE), "");
  assert.ok(buildCodexReviewUrl("Review", "/Users/jorge/Penney Construction"));
});
