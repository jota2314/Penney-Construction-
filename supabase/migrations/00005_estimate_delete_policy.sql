-- Delete policies for estimates and estimate line items
-- Only the creator or an owner can delete estimates
-- Line items follow parent estimate permissions (already covered by "all" policy in RLS)

CREATE POLICY "Users can delete own estimates"
  ON estimates FOR DELETE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
    )
  );
