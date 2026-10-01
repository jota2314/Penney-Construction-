# Warehouse intelligence

The Warehouse page now connects material knowledge, on-shelf stock, approved request demand, checkouts and the movement ledger. Staff can describe a job in plain language, receive real catalog matches, and open the existing material workflow. The assistant does not create purchases, reservations, assignments, messages or stock movements.

## Evidence reviewed

Read-only production inspection on September 30, 2026 found 376 active catalog items, 310 without descriptions, no material orders, and 78 movements in the preceding 30 days. Of those, 73 were linked to Richard Donnelly's profile and five were recorded under the unlinked name Rick Donnelly. The UI preserves this distinction rather than guessing identities.

Rick Donnelly is the active Warehouse Manager/Runner in employees (d03d9f89-d291-4fc1-8dd7-90cac434ee0d). There is no warehouse_manager profile role. Access therefore uses office roles or an active warehouse/runner employee title, including the app's effective identity while impersonating.

The open Briscon staples checkout (642650f8-767a-41f6-991c-ebb4ea605ae4, item 8a7b7407-4e46-459c-b089-40833095a5a0, WH-0092) records one box with Steven Riley for Conway Residence, entered by Richard Donnelly on September 30. This informed the distinction between handler and logger. These observations are a historical development baseline; the feature reloads current records.

## Behavior and limits

- Next actions include pending reviews, approved picks, ready handoffs, overdue need dates, aggregate shortages, replenishment review and checkouts older than 14 shop-calendar days.
- Only remaining approved demand reduces planned availability. Ready picks and checkouts are already deducted from on-shelf stock. Pending requests are not reservations. Incompatible units and write-in lines require verification.
- A zero reorder point does not create a purchasing policy. Suggested replenishment uses known thresholds, reorder quantities and approved shortages, and asks staff to consider returns first.
- Who has what shows open checkouts; activity shows recorded movements over 30 days. Neither is an attendance or productivity measure.
- The AI endpoint reloads session-scoped data, uses the existing Anthropic integration, validates structured responses and rejects unknown material references. Evidence-card quantities, locations and names come from the server snapshot, not the model.
- Material use and suitability remain suggestions until exact dimensions, model, condition and manufacturer requirements are verified. General catalog text alone cannot establish compatibility or safety certification.
- Failed source queries stop the answer. Each source has a 1,000-row limit with explicit incompleteness warnings at the cap. The AI sees the most recent 100 movement details plus the loaded 30-day actor counts.
- Existing database RLS is unchanged. The new endpoint is gated to office roles and active warehouse/runner staff; it uses no service-role client. Its in-process concurrent-request guard is best effort, not a distributed quota.
- No migration is required. Normal application deployment is required. Test fixture previews are not live application screenshots.

## Validation

Run `node --test scripts/warehouse-intelligence.test.mjs scripts/warehouse-assistant.test.mjs scripts/warehouse-checkouts.test.mjs` for stock calculations, date boundaries, identity separation, query failures, authorization, request validation and AI reference validation. Assistant tests mock the provider and snapshot; they do not certify a live model response or production login.

Run `node scripts/warehouse-preview.cjs` from the repository for static component previews at 1280px and 390px, including an overflow assertion. This renders the actual component and stylesheet with fixture data, without changing live records. Existing receiving, checkout and request flows retain their own tests.
