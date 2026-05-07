-- Keep estimates.total_price / total_cost in sync with the sum of their line items.
-- Eliminates drift between the hero "Contract Value" and the live line-item sum
-- shown elsewhere in the estimate UI.

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
    UPDATE estimates SET
      total_price = COALESCE((SELECT SUM(total_price) FROM estimate_line_items WHERE estimate_id = eid), 0),
      total_cost  = COALESCE((SELECT SUM(total_cost)  FROM estimate_line_items WHERE estimate_id = eid), 0),
      updated_at  = NOW()
    WHERE id = eid;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS estimate_line_items_sync_totals ON estimate_line_items;

CREATE TRIGGER estimate_line_items_sync_totals
AFTER INSERT OR UPDATE OR DELETE ON estimate_line_items
FOR EACH ROW EXECUTE FUNCTION sync_estimate_totals_from_lines();

-- One-time backfill so existing estimates match their line-item sums.
WITH sums AS (
  SELECT e.id,
         COALESCE(SUM(li.total_price), 0) AS sum_price,
         COALESCE(SUM(li.total_cost),  0) AS sum_cost
  FROM estimates e
  LEFT JOIN estimate_line_items li ON li.estimate_id = e.id
  GROUP BY e.id
)
UPDATE estimates e
SET total_price = sums.sum_price,
    total_cost  = sums.sum_cost
FROM sums
WHERE sums.id = e.id
  AND (ROUND(e.total_price::numeric, 2) <> ROUND(sums.sum_price::numeric, 2)
    OR ROUND(e.total_cost::numeric,  2) <> ROUND(sums.sum_cost::numeric,  2));
