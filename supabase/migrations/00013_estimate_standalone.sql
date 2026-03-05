-- Allow estimates to exist without a project or lead (standalone estimates)
ALTER TABLE public.estimates DROP CONSTRAINT estimates_must_have_parent;
