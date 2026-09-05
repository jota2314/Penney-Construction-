# Schedule connections — September 5, 2026

The office should not re-enter Ryan's texts or the crew's job selection. A planned assignment and a time log answer different questions. This release connects those records without silently rewriting the plan.

| Source | Meaning | Where it appears |
| --- | --- | --- |
| Master schedule phase | Project sequence and forecast/confirmed dates | Project Gantt/list; client portal via the existing date cascade |
| Daily crew assignment | Who is planned at a job on a date | Job Board Crew view; worker's 14-day view; confirmed daily work on the client portal |
| Time log | Where a worker actually clocked in and the linked work item | Crew Board actual-work section, existing field feed/time logs and costing |
| Shift wrap-up | Worker-reported finished work, remaining work/time, blockers | Saved to the same time log; shown with actual work on the Crew Board and in the existing field feed |
| Approved change order | Added commercial scope | Schedule tab flags current-estimate scope without an explicit master-phase link |

## Changes

- The Crew Board loads actual shifts using `employees.profile_id = daily_logs.author_id`, uses Eastern work dates, and refreshes every minute while visible and when reopened. Actual work is separate from draggable plan chips. A project mismatch is highlighted without moving or deleting an assignment. Ended shifts are labeled "Worked", not "Completed". Zero-duration photo posts do not count as attendance.
- Clocking in from a scheduled phase stamps its linked estimate line item on the time log, matching the existing job/line-item clock-in path.
- Both home-screen clock-out controls offer an optional finished/remaining/blocked update. Skipping does not erase existing notes/photos. Closing an already closed shift does not overwrite its end time. No master phase is automatically marked complete.
- Approved change orders with uncovered current-estimate scope are visible on the project Schedule tab. "Schedule work" preselects the missing line item, leaves dates to the planner, and creates an unconfirmed master phase through the existing form. Missing budget links are flagged for review. Daily assignments do not count as master-schedule coverage.
- The client portal's daily crew cards require confirmed assignments. Internal unsent draft change orders are excluded; sent or approved change orders remain visible. Internal shift text is not added to the client response.
- Project-wide delay adjustments operate on master phases, retain actual start dates for started work, and skip completed/past work. Daily crew assignments stay in place. Existing notification behavior of the delay action is retained; this release sent no notifications.
- Crew home uses a server-provided greeting and work date, avoiding the server/device timezone text mismatch observed during the earlier screenshot check.

## Boundaries

The portal still reads the existing master schedule and cascade: this release does not introduce a separate published client snapshot or automatically decide that a clock-in changes the promised completion date. A worker's wrap-up is a report, not project-manager sign-off. Rain does not automatically assign backup work. Approved change-order coverage is a review prompt, not an inferred duration or a financial change. No historical schedule records, time logs, approvals, or customer dates were rewritten during implementation.

## Validation

Standalone regression checks cover actual-vs-planned work, effective worker identity, zero-duration posts, multi-day/calendar boundaries, approved scope coverage, shift note/photo preservation, validation and date slipping. Browser checks on an isolated fictional-data route verified date selection, the CO scheduling form's preselected line and empty dates, the actual-work card and the mobile shift wrap-up sheet. The temporary route is removed from the shipped code. No live clock-out, CO approval, or schedule mutation was used as a test.
