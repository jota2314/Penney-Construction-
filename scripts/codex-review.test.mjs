import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeReviewUrl, buildCodexReviewUrl, buildFinalAuditPath, buildReviewPrompt, DEFAULT_CODEX_WORKSPACE } from "../src/lib/codex/review.ts";

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

test("Claude desktop handoff opens a Code session in the folder with the prompt", () => {
  const prompt = "Review O'Brien & Sons\nΔ costs? #2 + credits = $100";
  const url = new URL(buildClaudeReviewUrl(prompt, DEFAULT_CODEX_WORKSPACE));
  assert.equal(url.protocol, "claude:");
  assert.equal(url.hostname, "code");
  assert.equal(url.pathname, "/new");
  assert.equal(url.searchParams.get("folder"), DEFAULT_CODEX_WORKSPACE);
  assert.equal(url.searchParams.get("q"), prompt);
  assert.deepEqual([...url.searchParams.keys()], ["folder", "q"]);
  assert.equal(url.hash, "");
  const job = buildReviewPrompt({ kind: "job", projectId: "job-123" }, "https://penney.test");
  assert.ok(job.length <= 14336, "Claude desktop truncates prompts past 14,336 characters");
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
    assert.equal(buildClaudeReviewUrl("Review", path), "");
  }
  assert.equal(buildCodexReviewUrl("  ", DEFAULT_CODEX_WORKSPACE), "");
  assert.equal(buildClaudeReviewUrl("  ", DEFAULT_CODEX_WORKSPACE), "");
  assert.ok(buildCodexReviewUrl("Review", "/Users/jorge/Penney Construction"));
});

test("status and uncertain reviews keep their intent without requesting final approval", () => {
  const context = { kind: "job", projectId: "job-123" };
  const implicit = buildReviewPrompt(context, "https://penney.test");
  const status = buildReviewPrompt({ ...context, focus: "status" }, "https://penney.test");
  const unsure = buildReviewPrompt({ ...context, focus: "unsure" }, "https://penney.test");
  assert.equal(implicit, status);
  assert.match(status, /Review the current job status/);
  assert.match(status, /do not assume I requested finalization/);
  assert.match(unsure, /I am unsure whether this job needs an active-job check or final closeout/);
  for (const prompt of [status, unsure]) {
    assert.match(prompt, /Do not guess physical completion/);
    assert.match(prompt, /read-only for business records/);
    assert.match(prompt, /Do not send messages\./);
    assert.doesNotMatch(prompt, /prepare the team's final-audit results email|using only Penney MCP send_email/);
    assert.doesNotMatch(prompt, /Finish through the existing native final-audit approval flow/);
  }
});

test("final review carries evidence, net receipt and fully allocated profit requirements into both desktop handoffs", () => {
  const projectId = "56c6ba80-b8db-4c85-8a4d-3be3dd486f93";
  const prompt = buildReviewPrompt({ kind: "job", projectId, focus: "closeout" }, "https://penney.test");
  for (const requirement of [
    /using get_job_review first/,
    /Compare the saved baseline, inspect changed evidence and unresolved issues/,
    /bounced-check reversals once and replacement receipts once/,
    /Do not count bonuses or training reimbursements as customer income/,
    /actual company overhead recorded in the system and its supported allocation basis/,
    /never substitute a flat 15% allowance/,
    /additional burden not already included/,
    /not zero cost/,
    /net profit and margin/,
    /accessible, versioned file in this project's Files/,
    /exact remaining blockers/,
    /A reviewer must approve the concrete final figures/,
    /Verify the saved final record and financial closure afterward/,
    /Review is not closure/,
    /auditing does not authorize changing ledger entries/,
  ]) assert.match(prompt, requirement);
  assert.ok(prompt.includes(`https://penney.test${buildFinalAuditPath(projectId)}`));
  assert.ok(prompt.length <= 14336, "Final review must fit the desktop handoff");
  assert.equal(new URL(buildCodexReviewUrl(prompt, DEFAULT_CODEX_WORKSPACE)).searchParams.get("prompt"), prompt);
  assert.equal(new URL(buildClaudeReviewUrl(prompt, DEFAULT_CODEX_WORKSPACE)).searchParams.get("q"), prompt);
});

test("final results email follows verified closure and exact-draft approval through Penney only", () => {
  const prompt = buildReviewPrompt({ kind: "job", projectId: "job-123", focus: "closeout" }, "https://penney.test");
  for (const requirement of [
    /After verifying the saved native final closure, prepare the team's final-audit results email using only Penney MCP send_email/,
    /Do not compose or send final-results email while the job is blocked, reopened or not financially closed/,
    /actual current project\/team records and their access to job financials/,
    /do not infer recipients from the company domain or a crew mailing list/,
    /approved immutable final record for final revenue, net receipts, direct job costs, additional payroll burden, actual allocated overhead, total final cost, net profit and margin/,
    /remaining receivables\/payables, and the final report link/,
    /Check saved email IDs first to avoid duplicate sends/,
    /parks a draft and does not send/,
    /Show the full parked To\/Cc\/Subject\/Body and attachments in chat/,
    /wait for fresh explicit approval of that exact draft/,
    /44d71aa6-8168-4aaf-beb2-6c2be224cca1/,
    /Only after approval call send_email with that draft_id/,
    /Recheck that the approved final record is still current before confirming/,
    /If the draft changes, show the replacement and get fresh approval/,
    /never use Gmail\/Outlook, browser sending, SMTP or an app\/API fallback/,
    /save the final-record ID, draft ID and confirmed message ID\/outcome in the audit baseline/,
    /Never claim sent without a successful tool result/,
    /not an automatic app email/,
    /only messaging actions authorized by this closeout review/,
  ]) assert.match(prompt, requirement);
  assert.doesNotMatch(prompt, /Do not send messages\./, "the closeout exception must not contradict the final-results email instruction");
  const weekly = buildReviewPrompt({ kind: "weekly", label: "This week", startDate: "2026-10-12", endDate: "2026-10-18", path: "/finances#weekly" }, "https://penney.test");
  assert.match(weekly, /do not change records, send messages, or make payments/);
  assert.doesNotMatch(weekly, /prepare the team's final-audit results email/);
});

test("final audit link keeps the selected project in a single encoded query parameter", () => {
  const projectId = "job with & query=#characters";
  const url = new URL(buildFinalAuditPath(projectId), "https://penney.test");
  assert.equal(url.pathname, "/finances");
  assert.equal(url.hash, "#projects");
  assert.deepEqual([...url.searchParams.entries()], [["auditProject", projectId]]);
});
