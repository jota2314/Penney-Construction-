-- The repository's numbered migration sequence has drifted from production.
-- Re-apply the company feed schema under a globally unique migration version
-- so deployment runners do not mistake 00093 for an already-applied migration.

CREATE TABLE IF NOT EXISTS public.company_feed_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  tagged_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  mentioned_profile_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  photo_storage_paths text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_feed_posts_body_length
    CHECK (char_length(body) <= 4000),
  CONSTRAINT company_feed_posts_has_content
    CHECK (char_length(btrim(body)) > 0 OR cardinality(photo_storage_paths) > 0),
  CONSTRAINT company_feed_posts_tags_array
    CHECK (jsonb_typeof(tagged_entities) = 'array')
);

CREATE INDEX IF NOT EXISTS company_feed_posts_created_idx
  ON public.company_feed_posts(created_at DESC);

CREATE INDEX IF NOT EXISTS company_feed_posts_project_created_idx
  ON public.company_feed_posts(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.company_feed_posts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.company_feed_posts TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read company posts"
  ON public.company_feed_posts;
CREATE POLICY "Authenticated users can read company posts"
  ON public.company_feed_posts FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can create their own company posts"
  ON public.company_feed_posts;
CREATE POLICY "Users can create their own company posts"
  ON public.company_feed_posts FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Users can edit their own company posts"
  ON public.company_feed_posts;
CREATE POLICY "Users can edit their own company posts"
  ON public.company_feed_posts FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own company posts"
  ON public.company_feed_posts;
CREATE POLICY "Users can delete their own company posts"
  ON public.company_feed_posts FOR DELETE TO authenticated
  USING (author_id = auth.uid());
