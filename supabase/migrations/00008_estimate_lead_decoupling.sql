-- 00008_estimate_lead_decoupling.sql
-- Decouple estimates from projects; allow estimates linked to leads directly.

-- Add lead_id FK to estimates
ALTER TABLE public.estimates ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

-- Make project_id nullable
ALTER TABLE public.estimates ALTER COLUMN project_id DROP NOT NULL;

-- Add description column (for AI overview when no project exists)
ALTER TABLE public.estimates ADD COLUMN description text;

-- Fix version uniqueness: replace single constraint with partial indexes
ALTER TABLE public.estimates DROP CONSTRAINT estimates_project_id_version_key;
CREATE UNIQUE INDEX idx_estimates_project_version ON public.estimates(project_id, version) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX idx_estimates_lead_version ON public.estimates(lead_id, version) WHERE lead_id IS NOT NULL AND project_id IS NULL;

-- Add estimate_id to leads
ALTER TABLE public.leads ADD COLUMN estimate_id uuid REFERENCES public.estimates(id) ON DELETE SET NULL;

-- Add 'estimating' to lead status
ALTER TABLE public.leads DROP CONSTRAINT leads_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check CHECK (status IN ('new','contacted','meeting_scheduled','meeting_complete','estimating','converted','lost'));

-- Estimate must have a parent (project or lead)
ALTER TABLE public.estimates ADD CONSTRAINT estimates_must_have_parent CHECK (project_id IS NOT NULL OR lead_id IS NOT NULL);

-- Indexes
CREATE INDEX idx_estimates_lead ON public.estimates(lead_id);
CREATE INDEX idx_leads_estimate ON public.leads(estimate_id);
