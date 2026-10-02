# Warehouse catalog photos

Warehouse photos remain in the existing private `warehouse-photos` bucket. The catalog, item detail, checkout/return pickers, AI material results and activity use the existing signed photo URLs. No new table or public storage access is needed.

Manufacturer and retailer images imported with a `catalogref` filename display a reference label. They identify a researched product or product family, not the condition, package contents or quantity of Penney stock. Item notes retain the source page, identification basis and variant caveat. Mixed bins, unidentified items and uncertain variants should receive actual warehouse photos instead of guessed product images. A normal staff photo upload replaces a reference through the existing action.

`scripts/warehouse-catalog-photos.mjs` prepares reviewed source images as JPEGs plus 320px thumbnails. Source manifests and before/after records live outside the public repository. Publishing requires a visual-review manifest bound to each image hash, verifies storage readback, preserves any existing photo, and updates only photo paths and appended notes with an `updated_at` concurrency guard. All other row values are compared after saving. An uncertain update response retains uploaded objects and writes a readback marker; inspect the row before retrying. Publishing does not create stock movements or modify stock levels.

Validation: the warehouse component preview includes reference, staff-photo and missing-photo cases. The reference badge/caption must appear only for reference images. Existing warehouse tests cover the underlying material and stock workflows; TypeScript and targeted lint check the thumbnail wiring.
