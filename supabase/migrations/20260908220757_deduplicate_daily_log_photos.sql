-- A recovered upload reuses its object path. Retrying attachment cannot add
-- the same photo twice. RLS and the existing caller's permissions stay active.
create or replace function public.append_daily_log_photo(p_log_id uuid,p_path text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if nullif(btrim(p_path),'') is null then return false; end if;
  update public.daily_logs
    set photo_storage_paths = case when p_path=any(coalesce(photo_storage_paths,'{}'::text[]))
      then photo_storage_paths else array_append(coalesce(photo_storage_paths,'{}'::text[]),p_path) end,
      updated_at=now()
    where id=p_log_id;
  get diagnostics n=row_count;
  return n>0;
end;
$$;
revoke all on function public.append_daily_log_photo(uuid,text) from public,anon;
grant execute on function public.append_daily_log_photo(uuid,text) to authenticated,service_role;
