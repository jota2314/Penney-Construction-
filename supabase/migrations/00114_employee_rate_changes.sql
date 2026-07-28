-- Audit trail for hourly-rate changes (raises, corrections).
-- The live rate still lives on employees.hourly_rate; this table records who
-- changed it, when, and why. Labor cost is still computed from the CURRENT
-- rate — effective-dated costing is deliberately not implemented yet.

CREATE TABLE IF NOT EXISTS public.employee_rate_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  previous_rate  numeric(10,2),
  new_rate       numeric(10,2),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  kind           text NOT NULL DEFAULT 'raise'
                 CHECK (kind IN ('raise', 'decrease', 'correction', 'initial')),
  reason         text,
  changed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_rate_changes_employee_idx
  ON public.employee_rate_changes (employee_id, effective_date DESC, created_at DESC);

ALTER TABLE public.employee_rate_changes ENABLE ROW LEVEL SECURITY;

-- Reads follow the same "signed-in team member" posture as the rest of the app;
-- the server actions additionally mask rows the viewer may not see. Writes are
-- service-role only (no INSERT/UPDATE/DELETE policy) so history is append-only
-- through the gated server action.
DROP POLICY IF EXISTS "rate changes readable by authenticated" ON public.employee_rate_changes;
CREATE POLICY "rate changes readable by authenticated"
  ON public.employee_rate_changes FOR SELECT TO authenticated USING (true);

-- Baseline: one 'initial' row per employee that already has a rate.
INSERT INTO public.employee_rate_changes
  (employee_id, previous_rate, new_rate, effective_date, kind, reason, created_at)
SELECT e.id, NULL, e.hourly_rate,
       COALESCE(e.hire_date, e.created_at::date), 'initial',
       'Baseline rate on record when rate history was introduced', e.created_at
FROM public.employees e
WHERE e.hourly_rate IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.employee_rate_changes r WHERE r.employee_id = e.id
  );
