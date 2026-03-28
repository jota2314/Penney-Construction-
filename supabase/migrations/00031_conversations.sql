-- AI Chat conversations for Command Center
-- Phase 1: AI Chat Panel

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  source TEXT DEFAULT 'text' CHECK (source IN ('text', 'voice')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversation_messages_conv ON conversation_messages(conversation_id);
CREATE INDEX idx_conversation_messages_created ON conversation_messages(created_at);

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own conversations"
  ON conversations FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage messages in their conversations"
  ON conversation_messages FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

-- Project scope fields for Phase 2 (adding now to avoid a second migration)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scope_of_work TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS required_trades JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_recommendations JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_target NUMERIC;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_drawings JSONB DEFAULT '[]';
