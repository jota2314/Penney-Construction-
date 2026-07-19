-- Feed posts (company posts + the crew "Post update" daily logs) now notify
-- the whole team, not just @tagged profiles. The broadcast variant writes
-- kind='post'; widen the kind check to allow it.
alter table public.app_notifications
  drop constraint app_notifications_kind_check;

alter table public.app_notifications
  add constraint app_notifications_kind_check
  check (kind = any (array['mention'::text, 'comment'::text, 'post'::text]));
