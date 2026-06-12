-- Project Files duplicate cleanup + guard.
--
-- Audit (June 12, 2026) found ~15% of project_files rows were duplicate
-- filings: the hourly agent routines (Dispatch Dan / Bookkeeper Bill) had
-- no "already filed?" check, so an email that wasn't stamped mark_triaged
-- got its attachments re-filed on the next run, two agents filed the same
-- doc under different categories, and the same PDF arriving on a second
-- email (forward / re-send) was filed again.
--
-- Applied to the live DB on 2026-06-12 as `project_files_no_duplicates`
-- (cleanup DELETE was run separately first; it is included here so the
-- migration is reproducible on a fresh database).

-- 1. Remove duplicate filings, keeping the earliest copy of each document.
--    Dedup key is (project_id, filename, size): a revised version of a
--    document has a different byte size and is NOT treated as a duplicate.
with ranked as (
  select id,
         row_number() over (
           partition by project_id, filename, size
           order by created_at
         ) as rn
  from project_files
)
delete from project_files
where id in (select id from ranked where rn > 1);

-- 2. Guard: the same stored object can only be linked once per project.
--    Catches an agent re-processing the same email (identical storage_path).
create unique index if not exists project_files_project_storage_path_uniq
  on project_files (project_id, storage_path);

-- 3. Guard: the same document content (filename + byte size) can only be
--    filed once per project. Catches the same PDF arriving via a different
--    email, which lands at a different storage_path.
create unique index if not exists project_files_project_filename_size_uniq
  on project_files (project_id, filename, size);
