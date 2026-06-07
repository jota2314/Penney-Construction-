-- ============================================================
-- Migration 00082: Claude Memory (persistent context for Claude Code)
-- ============================================================
-- A cross-session memory for the Claude Code agent Jorge uses every
-- day. Claude Code on the web runs in throwaway containers, so it
-- normally starts every session blank. These tables give it a durable
-- place to remember what Jorge is working on (estimates, app features,
-- admin) and the decisions/preferences/gotchas worth carrying forward.
--
-- A SessionStart hook (.claude/hooks/session-start.sh) tells Claude to
-- read these tables on turn one via the Supabase MCP, and to write back
-- when Jorge says "save"/"remember" or meaningful work wraps up.
--
--   * claude_memory  — durable facts, preferences, decisions, open todos
--   * claude_journal — a dated log of what each session worked on
--
-- This is distinct from the in-app AI chat tables (conversations /
-- conversation_messages) and from the agent crew log (agent_runs).
-- It is single-user (Jorge) by design — no user_id column.

-- ── claude_memory: durable knowledge to carry across sessions ──
CREATE TABLE IF NOT EXISTS claude_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL DEFAULT 'note'
                CHECK (category IN (
                  'preference',       -- how Jorge likes things done
                  'project_context',  -- what's going on with a project/feature
                  'workflow',         -- recurring patterns / how-to
                  'decision',         -- a choice made + the reasoning
                  'contact',          -- people, who-does-what
                  'gotcha',           -- a trap to avoid / hard-won lesson
                  'todo',             -- an open thread to pick back up
                  'note'              -- anything else
                )),
  title       text NOT NULL,         -- short label, e.g. "deploy: never push to main directly"
  body        text NOT NULL,         -- the actual content
  tags        text[] NOT NULL DEFAULT '{}',
  priority    integer NOT NULL DEFAULT 0,   -- higher surfaces first
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One memory per logical key (title) while active, so writes can upsert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_memory_title_active
  ON claude_memory (lower(title)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_claude_memory_active
  ON claude_memory (status, priority DESC, updated_at DESC);

-- ── claude_journal: a dated log of what each session did ──
CREATE TABLE IF NOT EXISTS claude_journal (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date  date NOT NULL DEFAULT current_date,
  area        text NOT NULL DEFAULT 'other'
                CHECK (area IN ('estimate', 'app', 'admin', 'mcp', 'other')),
  summary     text NOT NULL,         -- one-line "what I did"
  details     text,                  -- longer notes, decisions, next steps
  session_id  text,                  -- Claude Code session id, if known
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claude_journal_date
  ON claude_journal (entry_date DESC, created_at DESC);

-- ── keep claude_memory.updated_at fresh on update ──
CREATE OR REPLACE FUNCTION claude_memory_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_claude_memory_updated_at ON claude_memory;
CREATE TRIGGER trg_claude_memory_updated_at
  BEFORE UPDATE ON claude_memory
  FOR EACH ROW EXECUTE FUNCTION claude_memory_touch_updated_at();

-- ── RLS ──
-- Writes happen through the Supabase MCP (service role, bypasses RLS).
-- Allow signed-in app users to read/write too, so a future in-app view
-- of "what Claude knows" can reuse the same tables.
ALTER TABLE claude_memory  ENABLE ROW LEVEL SECURITY;
ALTER TABLE claude_journal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated manage claude_memory" ON claude_memory;
CREATE POLICY "authenticated manage claude_memory" ON claude_memory
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated manage claude_journal" ON claude_journal;
CREATE POLICY "authenticated manage claude_journal" ON claude_journal
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
