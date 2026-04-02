-- Track Anthropic API usage and costs
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  endpoint text NOT NULL,          -- 'chat', 'email-chat', 'todo-ai', etc.
  model text NOT NULL,             -- 'claude-sonnet-4-20250514', etc.
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_cents integer NOT NULL DEFAULT 0,  -- cost in cents (e.g. 5 = $0.05)
  context text,                    -- optional: project name, email subject, etc.
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast date-range queries
CREATE INDEX idx_ai_usage_created ON ai_usage_logs(created_at DESC);
CREATE INDEX idx_ai_usage_user ON ai_usage_logs(user_id, created_at DESC);

-- RLS
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read ai_usage_logs" ON ai_usage_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert ai_usage_logs" ON ai_usage_logs
  FOR INSERT TO authenticated WITH CHECK (true);
