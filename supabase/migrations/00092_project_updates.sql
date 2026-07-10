-- Collaborative updates shown in a project's activity stream.
-- Mentions store validated profile UUIDs so notifications never depend on
-- ambiguous display-name parsing.

CREATE TABLE IF NOT EXISTS public.project_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  mentioned_profile_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_updates_project_created_idx
  ON public.project_updates(project_id, created_at DESC);

ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read project updates"
  ON public.project_updates;
CREATE POLICY "Authenticated users can read project updates"
  ON public.project_updates FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can create their own project updates"
  ON public.project_updates;
CREATE POLICY "Users can create their own project updates"
  ON public.project_updates FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Users can edit their own project updates"
  ON public.project_updates;
CREATE POLICY "Users can edit their own project updates"
  ON public.project_updates FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own project updates"
  ON public.project_updates;
CREATE POLICY "Users can delete their own project updates"
  ON public.project_updates FOR DELETE TO authenticated
  USING (author_id = auth.uid());
