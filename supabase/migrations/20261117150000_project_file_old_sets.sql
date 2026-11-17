-- Jorge (11/17): the field only ever sees the latest drawings. The office marks
-- a superseded set "Old set" on the Files tab: it stays in the office list but
-- the crew Job Folder, the sub portal, the site QR page and the PM job email
-- stop showing it. Lives on the per-file override row (same file_key identity
-- the tab already uses for moves, renames and removals).
alter table public.project_file_overrides
  add column if not exists superseded_at timestamptz;
