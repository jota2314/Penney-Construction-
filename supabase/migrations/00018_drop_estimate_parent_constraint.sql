-- Allow standalone estimates (no project or lead required)
-- This constraint was supposed to be dropped in 00013 but may not have been applied
ALTER TABLE public.estimates DROP CONSTRAINT IF EXISTS estimates_must_have_parent;
