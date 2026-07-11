-- Comments on the unified command-center feed: company posts + daily logs.
-- One shared table keyed by (source_type, source_id) so a single thread
-- component works for both post kinds.

CREATE TABLE IF NOT EXISTS public.feed_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('company_post', 'daily_log')),
  source_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_comments_body_length CHECK (char_length(body) <= 2000),
  CONSTRAINT feed_comments_has_content CHECK (char_length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS feed_comments_source_idx
  ON public.feed_comments(source_type, source_id, created_at);

ALTER TABLE public.feed_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read feed comments"
  ON public.feed_comments;
CREATE POLICY "Authenticated users can read feed comments"
  ON public.feed_comments FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can create their own feed comments"
  ON public.feed_comments;
CREATE POLICY "Users can create their own feed comments"
  ON public.feed_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own feed comments"
  ON public.feed_comments;
CREATE POLICY "Users can delete their own feed comments"
  ON public.feed_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- Let comment notifications land in the in-app inbox. app_notifications
-- dedups on (recipient, source_type, source_id), so comment notifications
-- use the comment id as source_id under the new 'feed_comment' source type.
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_kind_check;
ALTER TABLE public.app_notifications
  ADD CONSTRAINT app_notifications_kind_check
  CHECK (kind IN ('mention', 'comment'));

ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_source_type_check;
ALTER TABLE public.app_notifications
  ADD CONSTRAINT app_notifications_source_type_check
  CHECK (source_type IN ('company_post', 'daily_log', 'project_update', 'feed_comment'));
