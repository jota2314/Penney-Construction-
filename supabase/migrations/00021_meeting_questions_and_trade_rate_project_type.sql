-- Meeting questions: AI-generated follow-up questions after walkthrough
CREATE TABLE public.meeting_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE CASCADE NOT NULL,
  question text NOT NULL,
  answer text,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('dimensions', 'materials', 'fixtures', 'structural', 'scope', 'budget', 'timeline', 'general')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view meeting_questions"
  ON public.meeting_questions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert meeting_questions"
  ON public.meeting_questions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update meeting_questions"
  ON public.meeting_questions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete meeting_questions"
  ON public.meeting_questions FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.meeting_questions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_meeting_questions_meeting ON public.meeting_questions(meeting_id);

-- Add project_type to trade_rates for type-specific cost books
ALTER TABLE public.trade_rates ADD COLUMN project_type text
  CHECK (project_type IS NULL OR project_type IN ('bathroom', 'kitchen', 'remodel', 'addition', 'new_construction'));

-- Drop old unique constraint and add new one that includes project_type
ALTER TABLE public.trade_rates DROP CONSTRAINT trade_rates_trade_name_unit_type_key;
ALTER TABLE public.trade_rates ADD CONSTRAINT trade_rates_trade_name_unit_type_project_type_key
  UNIQUE NULLS NOT DISTINCT (trade_name, unit_type, project_type);
