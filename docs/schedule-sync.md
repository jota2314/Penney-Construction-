# Schedule synchronization

This describes the implementation and its regression checks. It is not a deployment record or confirmation that historical project records have been reconciled.

## Operating behavior

| Gap | Behavior and source of truth |
| --- | --- |
| S01 — Portal dates | Project Schedule, Job Board, Command Center and portal use the same master forecast. Manual dates, confirmed/started work and original baselines retain their separate meanings. |
| S02 — Inspections | An inspection links to one exact master inspection milestone. Booking, pass, failure and reversal synchronize transactionally in both directions and append history. A known actual result day is displayed separately from the saved plan. A trade final does not complete the project. |
| S03 — Missing plans | Daily crew bookings cannot satisfy a missing master plan. Recent positive-duration work or a current shift flags preconstruction statuses for review. The app does not promote status or invent a schedule from notes. |
| S04 — Date edits | Drag, list edits and push-back retain deliberate forecast moves without replacing baselines. Becoming started/completed/confirmed snapshots the visible forecast. Finish delays can move later tentative work; sequence/readiness checks use the effective dates. Confirmed/manual work remains fixed for office review. |
| S05 — Progress | Verified progress is completed master rows divided by master rows. Daily crew and attendance rows supply no percentage credit. Client completion reports remain pending verification; there is no half credit for an active phase. This is a task count, not a measured percentage of physical construction. |
| S06 — Field evidence | Daily assignments can explicitly reference a master activity; new reports inherit that link. Schedule review shows written evidence, asks for a verification note and updates only the selected master. Freshness checks reject stale evidence or phase versions. Clock-out and report submission never complete a whole scope. |
| S07 — Warnings/current work | Board Jobs, Wall and Command Center share deterministic missing-plan, overdue, no-remaining-plan and lifecycle checks. The AI health explanation cannot suppress them. Current/next selection excludes completed, held and attendance-only rows. Past proposed starts say the start date passed. |
| S08 — Lifecycle/refresh | Schedule actions invalidate affected staff and portal paths. Open Project, Command Center and portal screens refresh while visible; editing, dirty review forms and open dialogs pause background refresh. All master work done prompts explicit physical closeout, which also checks inspections. Reopening clears a stale complete phase. Physical transitions do not approve estimates or close financial records. |

## Historical reconciliation

Use Project → Schedule → Inspections to link an existing inspection to its exact milestone, choosing which record contains the verified result/date. Ambiguous names are never matched automatically. Unknown historical actual dates stay unknown. Existing unlinked milestones and inspection records require this review before they synchronize.

Use Schedule review to examine field reports, link the selected activity and record verified status or a revised finish. Report pages contain 40 written reports; review older pages too. A reviewed report is tied to its evidence version, so edited evidence needs another review. Reports with no reliable project/master relationship require explicit correction; this release does not infer historical links or rewrite narratives.

Missing-plan and overdue warnings identify records needing reconciliation. They do not establish that work is physically unfinished. Build/confirm the actual master plan and verify completed work, then explicitly confirm the project's physical state. Existing confirmation notifications and financial workflows remain in their established paths.

## Regression checks

Run from the app checkout after `npm ci`:

```text
node --test scripts/schedule-health.test.mjs scripts/schedule-progress.test.cjs
node scripts/schedule-dates.test.cjs
node scripts/test-gantt-move-data.cjs
node --test scripts/crew-master-links.test.cjs
node --test scripts/inspection-schedule-database.test.mjs scripts/schedule-field-review-database.test.mjs
node node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false
git diff --check
```

The database tests use an isolated PGlite database, never production. Their existing runtime prerequisite is `@electric-sql/pglite` installed in the sibling `../penney-mcp` checkout. They apply the synchronization migrations to a fixture schema and verify permissions, exact links, transactional changes, both inspection and milestone versions, history and financial isolation. Date tests mock application database boundaries. Use ESLint on changed TypeScript files and the normal production build before release.

After deployment, check the same project in Project Schedule, Board Jobs/Wall, Command Center and client portal: deliberate dates and verified progress must agree; completed/attendance-only rows must not appear as current work; confirmed field and inspection updates must refresh across open screens. Check stale-tab rejection, retained unsaved drafts and a missing-master job with a daily booking. Production verification and historical reconciliation must be recorded separately from local test results.
