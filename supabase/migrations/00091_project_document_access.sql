-- Project documents and subcontractor quotes contain internal pricing.
-- Restrict both tables and the project-files bucket to PM-level roles.

CREATE OR REPLACE FUNCTION public.can_manage_project_documents()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('owner', 'precon_manager', 'project_manager')
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_project_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_project_documents() TO authenticated;

DROP POLICY IF EXISTS "project_files_select" ON public.project_files;
DROP POLICY IF EXISTS "project_files_insert" ON public.project_files;
DROP POLICY IF EXISTS "project_files_update" ON public.project_files;
DROP POLICY IF EXISTS "project_files_delete" ON public.project_files;

CREATE POLICY "PMs can select project files"
  ON public.project_files FOR SELECT TO authenticated
  USING (public.can_manage_project_documents());
CREATE POLICY "PMs can insert project files"
  ON public.project_files FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project_documents());
CREATE POLICY "PMs can update project files"
  ON public.project_files FOR UPDATE TO authenticated
  USING (public.can_manage_project_documents())
  WITH CHECK (public.can_manage_project_documents());
CREATE POLICY "PMs can delete project files"
  ON public.project_files FOR DELETE TO authenticated
  USING (public.can_manage_project_documents());

DROP POLICY IF EXISTS "Authenticated users can manage quote_requests"
  ON public.quote_requests;
CREATE POLICY "PMs can manage quote requests"
  ON public.quote_requests FOR ALL TO authenticated
  USING (public.can_manage_project_documents())
  WITH CHECK (public.can_manage_project_documents());

DROP POLICY IF EXISTS "Authenticated users can upload project files"
  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read project files"
  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete project files"
  ON storage.objects;

CREATE POLICY "PMs can upload project files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-files'
    AND public.can_manage_project_documents()
  );
CREATE POLICY "PMs can read project files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-files'
    AND public.can_manage_project_documents()
  );
CREATE POLICY "PMs can update project files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-files'
    AND public.can_manage_project_documents()
  )
  WITH CHECK (
    bucket_id = 'project-files'
    AND public.can_manage_project_documents()
  );
CREATE POLICY "PMs can delete project files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-files'
    AND public.can_manage_project_documents()
  );

ALTER TABLE public.project_files
  DROP CONSTRAINT IF EXISTS project_files_category_check;
ALTER TABLE public.project_files
  ADD CONSTRAINT project_files_category_check CHECK (
    category IN (
      'construction_drawings', 'specs', 'pricing', 'contracts', 'permits',
      'photos', 'quotes', 'invoices', 'estimates', 'other'
    )
  );
