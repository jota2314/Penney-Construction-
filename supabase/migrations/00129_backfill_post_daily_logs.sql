-- Field updates were being stored as shifts.
--
-- The "Post update" insert in src/lib/actions/daily-logs.ts never set `kind`,
-- so daily_logs.kind fell back to its 'shift' default. Every post landed as a
-- zero-length shift (started_at = ended_at), which put people who only post
-- updates — Bill Crowley, Ryan Penney — on the payroll timesheet with 0h and
-- inflated the "Workers with hours" count.
--
-- The insert now sets kind='post'. This reclassifies the rows already written.
-- Only exact zero-length rows are touched: a real clock-in/clock-out pair
-- never lands on the identical microsecond. Verified before running — all 222
-- matching rows were status='completed' and carried text and/or photos.

update public.daily_logs
set kind = 'post'
where kind = 'shift'
  and ended_at = started_at;
