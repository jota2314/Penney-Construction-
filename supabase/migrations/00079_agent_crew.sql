-- ============================================================
-- Migration 00079: Agent Crew (scheduled Claude Code agents)
-- ============================================================
-- The "agents" are Claude Code Routines that run on a schedule and
-- use MCP (Gmail / Drive / Supabase) to do recurring work — find
-- quotes, sync ledgers, sweep follow-ups, watch for deposits.
--
-- They have no UI of their own, so they log here:
--   * agent_runs        — one row per execution (status, what it did)
--   * agent_suggestions — items the agent surfaces for human review
--     (keeps Penney's "AI suggests, user drives" rule for unattended runs)
--
-- The app's Agent Crew page reads these tables to animate the workers
-- and show a live activity feed.

CREATE TABLE IF NOT EXISTS agent_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'quote_finder' | 'ledger_sync' | 'follow_up_sweeper' | 'deposit_watcher'
  agent_key    text NOT NULL,
  status       text NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','success','error')),
  trigger      text NOT NULL DEFAULT 'schedule'
                 CHECK (trigger IN ('schedule','manual','api')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  items_found  integer NOT NULL DEFAULT 0,
  summary      text,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent
  ON agent_runs (agent_key, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_suggestions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key    text NOT NULL,
  run_id       uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  -- 'quote' | 'follow_up' | 'deposit' | 'ledger_entry'
  kind         text NOT NULL,
  title        text NOT NULL,
  detail       text,
  payload      jsonb,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_suggestions_status
  ON agent_suggestions (status, created_at DESC);

-- Per-agent rollup the dashboard uses to render each worker's card.
CREATE OR REPLACE VIEW agent_crew_status AS
SELECT
  r.agent_key,
  COUNT(*)                                            AS total_runs,
  MAX(r.started_at)                                   AS last_run_at,
  (ARRAY_AGG(r.status ORDER BY r.started_at DESC))[1] AS last_status,
  COALESCE(SUM(r.items_found), 0)                     AS lifetime_items
FROM agent_runs r
GROUP BY r.agent_key;

ALTER TABLE agent_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view agent_runs"
  ON agent_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write agent_runs"
  ON agent_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can view agent_suggestions"
  ON agent_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write agent_suggestions"
  ON agent_suggestions FOR ALL TO authenticated USING (true) WITH CHECK (true);
