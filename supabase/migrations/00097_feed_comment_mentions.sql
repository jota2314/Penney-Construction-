-- @mentions inside feed comments, mirroring company_feed_posts / daily_logs.

ALTER TABLE public.feed_comments
  ADD COLUMN IF NOT EXISTS tagged_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mentioned_profile_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.feed_comments
  DROP CONSTRAINT IF EXISTS feed_comments_tags_array;
ALTER TABLE public.feed_comments
  ADD CONSTRAINT feed_comments_tags_array
  CHECK (jsonb_typeof(tagged_entities) = 'array');
