-- Bid Management: Enhance existing bid_packages + subcontractor_bids for full bid workflow

-- 1. Add columns to bid_packages
ALTER TABLE public.bid_packages
  ADD COLUMN IF NOT EXISTS estimate_line_item_id uuid REFERENCES public.estimate_line_items(id),
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS project_address text,
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]';

-- 2. Add tracking columns to subcontractor_bids
ALTER TABLE public.subcontractor_bids
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS response_gmail_id text,
  ADD COLUMN IF NOT EXISTS attachment_storage_path text,
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS resent_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resent_at timestamptz;

-- 3. Add 'receiving' status to bid_packages (bids coming in but not all)
ALTER TABLE public.bid_packages DROP CONSTRAINT IF EXISTS bid_packages_status_check;
ALTER TABLE public.bid_packages ADD CONSTRAINT bid_packages_status_check
  CHECK (status IN ('draft', 'sent', 'receiving', 'awarded', 'cancelled'));

-- 4. Add 'declined' status to subcontractor_bids
ALTER TABLE public.subcontractor_bids DROP CONSTRAINT IF EXISTS subcontractor_bids_status_check;
ALTER TABLE public.subcontractor_bids ADD CONSTRAINT subcontractor_bids_status_check
  CHECK (status IN ('invited', 'submitted', 'accepted', 'rejected', 'declined', 'no_response'));

-- 5. Create bid_email_templates table
CREATE TABLE IF NOT EXISTS public.bid_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade text,
  template_name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bid_email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage bid_email_templates"
  ON public.bid_email_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.bid_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. Seed default RFQ template
INSERT INTO public.bid_email_templates (template_name, subject, body, is_default) VALUES
('Standard RFQ',
 'Request for Quote — {{trade}} | {{projectName}}',
 'Hi {{contactName}},

Penney Construction is requesting a quote for the following scope of work:

PROJECT: {{projectName}}
ADDRESS: {{projectAddress}}
TRADE: {{trade}}
BID DUE BY: {{dueDate}}

SCOPE OF WORK:
{{scopeOfWork}}

Please reply to this email with your quote, or call Jorge at (978) 473-0183.

Thank you,',
 true);

-- 7. Indexes for bid tracking queries
CREATE INDEX IF NOT EXISTS idx_bid_packages_status ON public.bid_packages(status);
CREATE INDEX IF NOT EXISTS idx_subcontractor_bids_status ON public.subcontractor_bids(status);
CREATE INDEX IF NOT EXISTS idx_bid_packages_sent_at ON public.bid_packages(sent_at DESC);
