-- Private bathroom design studio.
--
-- These tables back a personal sandbox, not a company feature. A design here is
-- an unfinished idea — wrong tile, wrong budget, a layout that was tried and
-- abandoned — and it must never reach the team, a client, or the Command Center
-- feed. So privacy is enforced in RLS, not only in the UI: every policy is
-- scoped to the two auth accounts that belong to the owner.
--
-- Deliberately NOT linked to public.projects. Attaching a speculative concept to
-- a live job invites it into estimates and client-facing documents by accident.
-- A design carries a free-text `project_label` for the owner's own reference.

-- ── Owner allowlist ──────────────────────────────────────────────────────────
-- A function rather than inlined uuids so the list lives in exactly one place
-- and every policy below stays in sync.
CREATE OR REPLACE FUNCTION public.is_design_studio_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT auth.uid() IN (
    '9135f7eb-e5b8-4fb6-9b36-b7971b531213'::uuid,  -- jorgebetancurfx@gmail.com
    'a912292e-da23-4ed2-bbc5-d9c3aa9ee6ff'::uuid   -- jbetancur@penneyconstructioninc.com
  );
$$;

COMMENT ON FUNCTION public.is_design_studio_owner() IS
  'Allowlist for the private design studio. Both rows are the same person; he has two logins.';

-- ── Materials library ────────────────────────────────────────────────────────
-- A tile/finish read off a real photo. `tile_width_in` and `tile_height_in` are
-- the true product dimensions, which is what makes the 3D model dimensionally
-- honest: a 12x24 renders as a 12x24, so wall tile counts are real rather than
-- decorative wallpaper.
CREATE TABLE IF NOT EXISTS public.design_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'tile',

  -- Real-world product dimensions, inches. Null for non-modular finishes (paint).
  tile_width_in numeric,
  tile_height_in numeric,
  grout_width_in numeric NOT NULL DEFAULT 0.125,
  grout_color text NOT NULL DEFAULT '#cfcabf',
  pattern text NOT NULL DEFAULT 'stack',

  -- Rendering properties. base_color is the fallback when no swatch exists yet.
  base_color text NOT NULL DEFAULT '#d8d4cc',
  roughness numeric NOT NULL DEFAULT 0.6,
  metalness numeric NOT NULL DEFAULT 0,
  finish text,

  -- Storage paths in the `project-files` bucket. source_photo is what the owner
  -- actually shot; texture is the flattened, seamless swatch cropped from it.
  source_photo_path text,
  texture_path text,

  -- Whatever the vision pass read off the photo, kept for provenance so a wrong
  -- swatch can be traced back to what the model thought it saw.
  vision_notes jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT design_materials_kind_valid CHECK (
    kind IN ('tile', 'paint', 'stone', 'wood', 'metal', 'glass', 'other')
  ),
  CONSTRAINT design_materials_pattern_valid CHECK (
    pattern IN ('stack', 'running', 'vertical_stack', 'herringbone', 'basketweave', 'none')
  ),
  CONSTRAINT design_materials_tile_dims_positive CHECK (
    (tile_width_in IS NULL OR tile_width_in > 0)
    AND (tile_height_in IS NULL OR tile_height_in > 0)
  )
);

CREATE INDEX IF NOT EXISTS design_materials_owner_created_idx
  ON public.design_materials(owner_id, created_at DESC);

-- ── Designs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bathroom_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Untitled bathroom',

  -- Free-text only, on purpose. See header note about not joining to projects.
  project_label text,

  -- The RoomSpec. Single source of truth for both the 3D viewer and the
  -- quantity takeoff; see src/types/design.ts for the shape.
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Reference material the owner dropped in (a photo of the existing room, a
  -- hand sketch with measurements, an inspiration shot).
  reference_photo_paths text[] NOT NULL DEFAULT '{}'::text[],

  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bathroom_designs_spec_is_object CHECK (jsonb_typeof(spec) = 'object'),
  CONSTRAINT bathroom_designs_status_valid CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS bathroom_designs_owner_updated_idx
  ON public.bathroom_designs(owner_id, updated_at DESC);

-- ── Version history ──────────────────────────────────────────────────────────
-- Every accepted spec change is snapshotted so an iteration can be walked back.
-- Design is conversational and the model will sometimes get a change wrong; the
-- previous state has to survive that.
CREATE TABLE IF NOT EXISTS public.bathroom_design_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.bathroom_designs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  spec jsonb NOT NULL,
  summary text,

  -- Photoreal output for this version, if one was rendered.
  render_path text,
  render_prompt text,
  -- Viewport capture that was fed to the renderer as the structural reference.
  viewport_path text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bathroom_design_versions_spec_is_object CHECK (jsonb_typeof(spec) = 'object'),
  CONSTRAINT bathroom_design_versions_unique_number UNIQUE (design_id, version_number)
);

CREATE INDEX IF NOT EXISTS bathroom_design_versions_design_idx
  ON public.bathroom_design_versions(design_id, version_number DESC);

-- ── Conversation ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bathroom_design_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.bathroom_designs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  image_paths text[] NOT NULL DEFAULT '{}'::text[],
  -- Which spec version this message produced, when it changed the design.
  resulting_version integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bathroom_design_messages_role_valid CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS bathroom_design_messages_design_created_idx
  ON public.bathroom_design_messages(design_id, created_at ASC);

-- ── updated_at maintenance ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_design_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bathroom_designs_touch ON public.bathroom_designs;
CREATE TRIGGER bathroom_designs_touch
  BEFORE UPDATE ON public.bathroom_designs
  FOR EACH ROW EXECUTE FUNCTION public.touch_design_updated_at();

DROP TRIGGER IF EXISTS design_materials_touch ON public.design_materials;
CREATE TRIGGER design_materials_touch
  BEFORE UPDATE ON public.design_materials
  FOR EACH ROW EXECUTE FUNCTION public.touch_design_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Every table demands BOTH allowlist membership and owner_id = auth.uid().
-- The allowlist alone would let either account read the other's rows, which is
-- fine (same person) but the owner check keeps the data model honest if the
-- allowlist ever grows.

ALTER TABLE public.design_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bathroom_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bathroom_design_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bathroom_design_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'design_materials',
    'bathroom_designs',
    'bathroom_design_versions',
    'bathroom_design_messages'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Design studio owner full access" ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY "Design studio owner full access"
        ON public.%I FOR ALL TO authenticated
        USING (public.is_design_studio_owner() AND owner_id = auth.uid())
        WITH CHECK (public.is_design_studio_owner() AND owner_id = auth.uid())
    $f$, t);
  END LOOP;
END $$;
