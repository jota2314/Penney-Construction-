-- Rollout backfill for the confirm-to-go-live schedule model.
--
-- From this point on, live surfaces (/schedule calendar, crew app, Command
-- Center tile) only show phases where is_confirmed = true OR status is
-- in_progress/completed. New phases are born tentative and must be confirmed
-- (which requires an assignee + a budget line and emails everyone assigned).
--
-- This one-time backfill silently confirms work that is already underway or
-- imminent (starting within 14 days) so nothing disappears from the live
-- schedule at rollout. Pure SQL — the app-side notifier never runs, so NO
-- emails are sent. Everything further out stays tentative on purpose.

update schedule_phases
set is_confirmed  = true,
    confirmed_at  = now(),
    confirmed_with = 'Auto-confirmed at rollout (backfill)'
where is_confirmed = false
  and (
    status = 'in_progress'
    or (status = 'not_started' and start_date <= current_date + interval '14 days')
  );
