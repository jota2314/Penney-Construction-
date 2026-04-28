-- User-authored custom prompt that is injected into every AI chat the user
-- starts. This is the "tell the AI things about how I work" feature exposed
-- in /settings → AI Instructions.
--
-- One row per profile. The row is upserted from the settings UI.

CREATE TABLE IF NOT EXISTS public.user_ai_instructions (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  instructions text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ai_instructions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own ai instructions" ON public.user_ai_instructions;
CREATE POLICY "Users can read own ai instructions"
  ON public.user_ai_instructions FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can upsert own ai instructions" ON public.user_ai_instructions;
CREATE POLICY "Users can upsert own ai instructions"
  ON public.user_ai_instructions FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own ai instructions" ON public.user_ai_instructions;
CREATE POLICY "Users can update own ai instructions"
  ON public.user_ai_instructions FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own ai instructions" ON public.user_ai_instructions;
CREATE POLICY "Users can delete own ai instructions"
  ON public.user_ai_instructions FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid());

-- Bump updated_at automatically.
CREATE OR REPLACE FUNCTION public.touch_user_ai_instructions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_touch_user_ai_instructions ON public.user_ai_instructions;
CREATE TRIGGER trg_touch_user_ai_instructions
  BEFORE UPDATE ON public.user_ai_instructions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_ai_instructions();
