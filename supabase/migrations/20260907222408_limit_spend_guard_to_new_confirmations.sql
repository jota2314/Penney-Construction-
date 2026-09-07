-- Historical records retain their existing review state.
drop trigger if exists trg_keep_unallocated_spend_in_review on public.invoices;
alter table public.invoices drop constraint if exists invoices_review_requires_allocation;
drop function if exists public.keep_unallocated_spend_in_review();

create or replace function public.guard_new_spend_confirmation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.review_status = 'ok'
     and (old.review_status is distinct from new.review_status
          or new.help_resolved_at is distinct from old.help_resolved_at
          or new.help_resolved_by is distinct from old.help_resolved_by)
     and (new.project_id is null or new.estimate_line_item_id is null) then
    raise exception 'Choose a job and budget line before confirming' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_guard_new_spend_confirmation
before update of review_status, help_resolved_at, help_resolved_by on public.invoices
for each row execute function public.guard_new_spend_confirmation();
