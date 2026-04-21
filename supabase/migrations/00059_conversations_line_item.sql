-- Bind each takeoff trade chat to its estimate line item.
-- One chat = one line item. The chat is where scope, screenshots, sub quotes,
-- and delivery notes live for that line item across its full lifecycle.
ALTER TABLE conversations
  ADD COLUMN estimate_line_item_id uuid REFERENCES estimate_line_items(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_estimate_line ON conversations(estimate_line_item_id);
