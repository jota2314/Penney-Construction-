-- 1. Add entity tags + @mentions to daily_logs (same shape as company_feed_posts).
-- 2. push_subscriptions for web-push endpoints (already existed live with this
--    exact schema — kept here so repo migrations document it; IF NOT EXISTS no-ops).
-- 3. app_notifications: in-app mention notifications sourced from company posts,
--    daily logs, or project updates. Insert happens server-side (service role);
--    recipients can only read and mark-read their own.

ALTER TABLE public.daily_logs
  ADD COLUMN IF NOT EXISTS tagged_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mentioned_profile_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.daily_logs
  DROP CONSTRAINT IF EXISTS daily_logs_tags_array;

ALTER TABLE public.daily_logs
  ADD CONSTRAINT daily_logs_tags_array
  CHECK (jsonb_typeof(tagged_entities) = 'array');

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their push subscriptions"
  ON public.push_subscriptions;

CREATE POLICY "Users manage their push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('mention')),
  title text NOT NULL CHECK (char_length(title) <= 200),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  url text NOT NULL DEFAULT '/',
  source_type text NOT NULL CHECK (
    source_type IN ('company_post', 'daily_log', 'project_update')
  ),
  source_id uuid NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_profile_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS app_notifications_recipient_created_idx
  ON public.app_notifications(recipient_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS app_notifications_recipient_unread_idx
  ON public.app_notifications(recipient_profile_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their notifications"
  ON public.app_notifications;

CREATE POLICY "Users can read their notifications"
  ON public.app_notifications FOR SELECT TO authenticated
  USING (recipient_profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can mark their notifications read"
  ON public.app_notifications;

CREATE POLICY "Users can mark their notifications read"
  ON public.app_notifications FOR UPDATE TO authenticated
  USING (recipient_profile_id = auth.uid())
  WITH CHECK (recipient_profile_id = auth.uid());
