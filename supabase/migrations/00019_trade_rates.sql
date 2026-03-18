-- Trade rates / cost book for AI estimation
CREATE TABLE public.trade_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_name text NOT NULL,
  description text,
  unit_type text NOT NULL DEFAULT 'sqft'
    CHECK (unit_type IN ('sqft', 'linear_ft', 'each', 'lump_sum')),
  avg_cost numeric(10,2) NOT NULL DEFAULT 0,
  avg_price numeric(10,2) NOT NULL DEFAULT 0,
  min_cost numeric(10,2),
  max_cost numeric(10,2),
  sample_count integer NOT NULL DEFAULT 0,
  data_sources text[] NOT NULL DEFAULT '{}',
  last_updated_from text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trade_name, unit_type)
);

ALTER TABLE public.trade_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view trade_rates"
  ON public.trade_rates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert trade_rates"
  ON public.trade_rates FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update trade_rates"
  ON public.trade_rates FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete trade_rates"
  ON public.trade_rates FOR DELETE TO authenticated
  USING (
    (created_by = auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner', 'precon_manager')
    )
  );

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.trade_rates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_trade_rates_active ON public.trade_rates(is_active) WHERE is_active = true;
CREATE INDEX idx_trade_rates_trade_name ON public.trade_rates(trade_name);
