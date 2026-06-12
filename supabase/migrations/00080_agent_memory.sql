-- ============================================================
-- Migration 00080: Agent Memory (the shared "agents learn while working" brain)
-- ============================================================
-- The problem this solves: the scheduled routine agents (the inbox
-- dispatcher, the invoice logger) wake up amnesiac every run. They persist
-- task OUTPUT (agent_runs / agent_suggestions) but accumulate ZERO knowledge
-- between runs. The app chats can't learn across sessions either. Claude Code's
-- local markdown memory can never reach the routines — they run remotely on a
-- schedule and never touch a local filesystem.
--
-- agent_memory is the substrate: one table every surface reads/writes through
-- the MCP (read_memory / write_memory) so the app chats, Claude.ai, and the
-- routines all share ONE brain. Mirrors the four markdown memory categories
-- (user / feedback / project / reference).
--
-- Scope, not user ownership, is the access model: routines write via the MCP
-- service-role key with NO auth.uid(), so user_id is nullable and a memory is
-- addressed by scope (global / project / user) rather than per-user RLS.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_memory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Mirrors the Claude Code markdown memory categories.
  --   user      = facts about a person (Jorge prefers X)
  --   feedback  = how to do the work (don't auto-send, draft only)
  --   project   = context about a job/initiative (Ouellette wants French doors)
  --   reference = where to find something (ledgers live in each Drive folder)
  type            text NOT NULL CHECK (type IN ('user','feedback','project','reference')),

  -- How broadly the memory applies. Routines mostly write 'global' (a general
  -- learning) or 'project' (scoped to one job).
  scope           text NOT NULL DEFAULT 'global' CHECK (scope IN ('global','project','user')),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which worker learned this ('dispatcher','invoice_logger', a chat name, ...).
  -- NULL = taught directly by a human.
  agent_key       text,

  title           text NOT NULL,
  content         text NOT NULL,

  source          text NOT NULL DEFAULT 'auto_learned'
                    CHECK (source IN ('user_taught','auto_learned','correction')),

  -- Pinned memories are always injected into the read phase regardless of recall
  -- ranking — use for hard rules ("never send client docs to subs").
  pinned          boolean NOT NULL DEFAULT false,

  relevance_score integer NOT NULL DEFAULT 1,
  hit_count       integer NOT NULL DEFAULT 0,
  last_used_at    timestamptz,

  -- Reserved for semantic recall (pgvector). v1 recall is scope + trigram +
  -- recency; embeddings can be backfilled later without a schema change.
  embedding       vector(1536),

  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Primary read path: "give me the active memories for this scope/type."
CREATE INDEX IF NOT EXISTS idx_agent_memory_scope
  ON agent_memory (scope, type, is_active, updated_at DESC);

-- Project-scoped recall.
CREATE INDEX IF NOT EXISTS idx_agent_memory_project
  ON agent_memory (project_id)
  WHERE project_id IS NOT NULL;

-- Pinned hard-rules are always pulled.
CREATE INDEX IF NOT EXISTS idx_agent_memory_pinned
  ON agent_memory (pinned)
  WHERE pinned = true AND is_active = true;

-- Fuzzy text recall + write-time dedup (pg_trgm is already installed).
CREATE INDEX IF NOT EXISTS idx_agent_memory_content_trgm
  ON agent_memory USING gin (content gin_trgm_ops);

-- Keep updated_at honest.
CREATE OR REPLACE FUNCTION set_agent_memory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_memory_updated_at ON agent_memory;
CREATE TRIGGER trg_agent_memory_updated_at
  BEFORE UPDATE ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION set_agent_memory_updated_at();

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- Same posture as agent_runs/agent_suggestions: the signed-in team can read and
-- write; the MCP routines use the service-role key, which bypasses RLS.
CREATE POLICY "Authenticated can view agent_memory"
  ON agent_memory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write agent_memory"
  ON agent_memory FOR ALL TO authenticated USING (true) WITH CHECK (true);
