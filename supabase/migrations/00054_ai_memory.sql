-- AI Memory & Learning System
-- Stores learned preferences, rules, entity notes, and action outcome patterns

-- ── ai_memory: persistent knowledge the AI has learned ──
CREATE TABLE IF NOT EXISTS ai_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'user_preference',    -- "I prefer to always create a todo for follow-ups"
    'company_rule',       -- "Nicole handles permits", "Default state is MA"
    'workflow_pattern',   -- "When a quote comes in, also create a todo"
    'entity_note',        -- "Chuck Cameron = Charles Cameron", "ABC Electric does residential only"
    'correction'          -- "Project type should be 'remodel' not 'renovation'"
  )),
  key TEXT NOT NULL,          -- short identifier: "default_state", "chuck_cameron_nickname"
  value TEXT NOT NULL,        -- the actual memory/fact
  source TEXT NOT NULL DEFAULT 'user_taught' CHECK (source IN ('user_taught', 'auto_learned', 'correction')),
  relevance_score INTEGER DEFAULT 1,  -- bumped each time this memory is relevant
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint for upsert by user + key
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_memory_user_key ON ai_memory(user_id, key) WHERE is_active = true;

-- Index for fast lookup by user + category
CREATE INDEX IF NOT EXISTS idx_ai_memory_user_category ON ai_memory(user_id, category, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_memory_user_active ON ai_memory(user_id, is_active) WHERE is_active = true;

-- ── action_outcomes: tracks what the AI proposed and what happened ──
CREATE TABLE IF NOT EXISTS action_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  email_id UUID REFERENCES inbox_emails(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,       -- create_project, create_quote, etc.
  action_label TEXT,               -- "Create project Smith Kitchen"
  proposed_data JSONB DEFAULT '{}',-- what the AI originally proposed
  final_data JSONB DEFAULT '{}',   -- what was actually saved (after user edits)
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'approved_with_edits', 'rejected', 'skipped')),
  edited_fields TEXT[],            -- which fields the user changed: ["amount", "status"]
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_user ON action_outcomes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_outcomes_type ON action_outcomes(action_type, outcome);

-- RLS
ALTER TABLE ai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own memories" ON ai_memory
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own outcomes" ON action_outcomes
  FOR ALL USING (auth.uid() = user_id);
