-- estimate_line_items has two parallel column sets that drifted apart:
--   legacy:    quantity / unit_cost / total_cost / markup_percentage / total_price
--   canonical: cost / markup_pct / client_price / profit
-- The trade-chat tools write the legacy side; the estimate editor writes the
-- canonical side; the old sync trigger summed only the legacy side, so editor
-- edits never reached the estimate header (Callanan Option A bug, 2026-06-08).
--
-- Fix in two layers:
--  1) BEFORE row trigger: whichever side of a pair changed wins and is copied
--     to the other, so the pairs can no longer drift on future writes.
--     profit is always re-derived.
--  2) AFTER trigger (rewritten): header totals = sum over NON-HEADER lines of
--     COALESCE(cost, total_cost) and COALESCE(client_price, total_price) —
--     line totals, NOT cost × quantity. Also maintains total_profit and
--     markup_pct on the estimate.

-- ── 1) Keep the dual line-item columns converged ──────────────────────────
CREATE OR REPLACE FUNCTION sync_line_item_dual_columns() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Fill whichever side is missing from the other.
    IF NEW.cost IS NULL THEN NEW.cost := NEW.total_cost; END IF;
    IF NEW.total_cost IS NULL THEN NEW.total_cost := NEW.cost; END IF;
    IF NEW.client_price IS NULL THEN NEW.client_price := NEW.total_price; END IF;
    IF NEW.total_price IS NULL THEN NEW.total_price := NEW.client_price; END IF;
  ELSE
    -- The side that changed wins. If both changed in one statement, the
    -- canonical (cost/client_price) side wins.
    IF NEW.cost IS DISTINCT FROM OLD.cost THEN
      NEW.total_cost := NEW.cost;
    ELSIF NEW.total_cost IS DISTINCT FROM OLD.total_cost THEN
      NEW.cost := NEW.total_cost;
    END IF;

    IF NEW.client_price IS DISTINCT FROM OLD.client_price THEN
      NEW.total_price := NEW.client_price;
    ELSIF NEW.total_price IS DISTINCT FROM OLD.total_price THEN
      NEW.client_price := NEW.total_price;
    END IF;
  END IF;

  IF NEW.client_price IS NOT NULL AND NEW.cost IS NOT NULL THEN
    NEW.profit := NEW.client_price - NEW.cost;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS estimate_line_items_sync_dual_columns ON estimate_line_items;

CREATE TRIGGER estimate_line_items_sync_dual_columns
BEFORE INSERT OR UPDATE ON estimate_line_items
FOR EACH ROW EXECUTE FUNCTION sync_line_item_dual_columns();

-- ── 2) Header totals from canonical line totals ───────────────────────────
-- Replaces the 00076 version (which summed only total_cost/total_price and
-- ignored is_section_header, total_profit, markup_pct).
-- markup_pct is numeric(5,2): clamp to ±999.99 so degenerate estimates
-- (near-zero cost, real price) can't blow up every line-item write.
CREATE OR REPLACE FUNCTION sync_estimate_totals_from_lines() RETURNS TRIGGER AS $$
DECLARE
  affected_ids uuid[];
  eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_ids := ARRAY[OLD.estimate_id];
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.estimate_id IS DISTINCT FROM OLD.estimate_id THEN
      affected_ids := ARRAY[OLD.estimate_id, NEW.estimate_id];
    ELSE
      affected_ids := ARRAY[NEW.estimate_id];
    END IF;
  ELSE -- INSERT
    affected_ids := ARRAY[NEW.estimate_id];
  END IF;

  FOREACH eid IN ARRAY affected_ids LOOP
    IF eid IS NULL THEN CONTINUE; END IF;
    UPDATE estimates e SET
      total_cost   = s.sum_cost,
      total_price  = s.sum_price,
      total_profit = s.sum_price - s.sum_cost,
      markup_pct   = CASE WHEN s.sum_cost > 0
                          THEN LEAST(GREATEST(
                                 ROUND((s.sum_price - s.sum_cost) / s.sum_cost * 100, 2),
                                 -999.99), 999.99)
                          ELSE 0 END,
      updated_at   = NOW()
    FROM (
      SELECT COALESCE(SUM(COALESCE(li.cost, li.total_cost, 0)), 0)          AS sum_cost,
             COALESCE(SUM(COALESCE(li.client_price, li.total_price, 0)), 0) AS sum_price
      FROM estimate_line_items li
      WHERE li.estimate_id = eid
        AND NOT COALESCE(li.is_section_header, false)
    ) s
    WHERE e.id = eid;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The AFTER trigger from 00076 (estimate_line_items_sync_totals) already
-- points at this function name; no need to recreate it.

-- ── 3) One-time header backfill with the new convention ───────────────────
-- Deliberately does NOT touch line-item rows: 235 existing rows have
-- cost <> total_cost and we cannot know which side a historical edit meant.
-- Headers follow the canonical side from here on.
WITH sums AS (
  SELECT e.id,
         COALESCE(SUM(COALESCE(li.cost, li.total_cost, 0))
                  FILTER (WHERE NOT COALESCE(li.is_section_header, false)), 0) AS sum_cost,
         COALESCE(SUM(COALESCE(li.client_price, li.total_price, 0))
                  FILTER (WHERE NOT COALESCE(li.is_section_header, false)), 0) AS sum_price
  FROM estimates e
  LEFT JOIN estimate_line_items li ON li.estimate_id = e.id
  GROUP BY e.id
)
UPDATE estimates e
SET total_cost   = s.sum_cost,
    total_price  = s.sum_price,
    total_profit = s.sum_price - s.sum_cost,
    markup_pct   = CASE WHEN s.sum_cost > 0
                        THEN LEAST(GREATEST(
                               ROUND((s.sum_price - s.sum_cost) / s.sum_cost * 100, 2),
                               -999.99), 999.99)
                        ELSE 0 END
FROM sums s
WHERE s.id = e.id
  AND (ROUND(e.total_price::numeric, 2)  IS DISTINCT FROM ROUND(s.sum_price::numeric, 2)
    OR ROUND(e.total_cost::numeric, 2)   IS DISTINCT FROM ROUND(s.sum_cost::numeric, 2)
    OR e.total_profit                    IS DISTINCT FROM (s.sum_price - s.sum_cost));
