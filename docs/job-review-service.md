# Shared job review

The job Review button reads `/api/job-review` and shows a saved current review immediately. `get_job_review` in Penney MCP calls the same service. Weekly Close keeps its existing entry point.

The service uses a single database snapshot, the current contract estimate, and the app's shared historical wage/break calculator. Record fingerprints cover the whole current inventory, including older edited records and available storage object versions. Prior evidence and unresolved findings survive repeat reviews. Resolutions append a successor with source fingerprints; changed resolution evidence reopens the question.

Costs and all monetary outputs are integer cents. Explicit duplicate bills are excluded; split allocations and negative credits count once. Accepted quotes contribute only their unbilled remainder. Potentially matching unlinked bills create a reconciliation question instead of automatically adding the quote again. Current records are not a completed source-document/field audit: remaining costs, payroll burden, permits, completion and final profit stay unverified when evidence is insufficient.

## Tools

- `get_job_review`: current snapshot, saved baseline, stage, money, scopes, warnings and next three actions.
- `inspect_job_finding`: saved source records and short-lived original-document links.
- `preview_job_correction`: exact before/after allocation effects, with no financial write.
- `apply_job_correction`: applies an explicitly authorized preview through the app workflow, records before/after, then refreshes the review.
- `save_job_review_evidence`: retains inspected evidence/open issues or appends evidence-backed resolutions.

The API accepts only verified office roles (owner, office_admin, precon_manager). Browser requests require a real session, no impersonation, and the same origin. MCP uses the existing shared service key and verified caller identity; identity cannot be supplied in tool arguments. Review tables and RPCs are unavailable to public, anonymous and ordinary authenticated database callers.

Correction previews expire after 15 minutes, belong to one caller/job, and reject changed records or source versions. Invoice allocations invoke the existing `confirm_spend_review` workflow, preserving closed-line snapshots. Labor corrections require completed employee shifts and unlocked lines. Amounts, payments, budgets, clock times and job IDs cannot be changed through this feature. Retry an uncertain apply with the same preview ID; application is idempotent. Splits, cross-job transfers, new bills and payments remain in their existing workflows.

## Validation

Run `node --test scripts/job-review.test.mjs scripts/labor-ledger.test.mjs scripts/job-review-database.test.mjs` and TypeScript/lint checks. Database tests use the existing workspace PGlite dependency in `../penney-mcp`; they do not change live financial records. The optional Conway regression reads the existing local audit fixture and checks exact costs/hours. The live smoke test reads `.env.local`, authenticates without printing secrets, and saves only review baselines.

On October 8, 2026, local API calls against live Conway records took 0.38–2.15 seconds including HTTP/authentication and saved-baseline writes. Costs matched the saved audit: $10,906.42, including $241.37 modeled wages and 341 net minutes. These are local API timings, not a guarantee for production or a complete new document/photograph audit.

Production status (October 8, 2026): published with Jorge's explicit approval. The app is live at https://www.penneyconstruction.build (deployment dpl_A5RAvNV4HwiC9UGUobRx5QKrraR2; application commit a9e0f94 pushed to main). The MCP is live at https://penney-mcp.vercel.app (deployment dpl_EY33Rc1RwK4ZGN53bMip4GYyggFq). The final MCP release exposes exactly the existing 22 tools plus the five review tools; no existing tool names were removed. Unrelated invoice-creation work in the primary MCP checkout was excluded from this isolated release. The signed-in browser review and supporting-record drill-down passed. Production API checks took 2.123, 0.630 and 0.552 seconds and matched Conway's $10,906.42 cost and 341 net crew minutes. MCP review plus evidence lookup took 1.497 seconds. These are current-record checks, not a fresh source-document/photo audit. Invalid service credentials and a correction request lacking explicit authorization were rejected. No financial records were changed.

Conway's 12 existing open issues were imported as 13 scoped evidence entries (the painting issue affects two lines), preserving the original source fingerprints and review time. The original local/attached audit remains intact. No Conway financial records were corrected as part of implementation.
