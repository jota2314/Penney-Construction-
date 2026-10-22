-- Run after applying the migration. All test rows and session settings roll back.
begin;
select set_config('marketing_test.owner_id', (select id::text from public.profiles where role = 'owner' limit 1), true);
select set_config('marketing_test.field_id', (select id::text from public.profiles where role = 'field' limit 1), true);
select set_config('marketing_test.item_id', gen_random_uuid()::text, true);
insert into public.marketing_items(id,title,kind,status)
values (current_setting('marketing_test.item_id')::uuid,'Marketing RLS transaction test','image','draft');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('marketing_test.field_id'),'role','authenticated')::text,true);
do $$
begin
  if public.can_manage_marketing() then raise exception 'Field role gained marketing access'; end if;
  if exists(select 1 from public.marketing_items where id = current_setting('marketing_test.item_id')::uuid)
    then raise exception 'Field role read private marketing metadata'; end if;
  if exists(select 1 from storage.objects where bucket_id = 'marketing-media')
    then raise exception 'Field role read private marketing storage'; end if;
  begin
    insert into public.marketing_items(title,kind,status,created_by)
      values ('Must not create','image','draft',current_setting('marketing_test.field_id')::uuid);
    raise exception 'Field role wrote marketing metadata';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claims', json_build_object('sub',current_setting('marketing_test.owner_id'),'role','authenticated')::text,true);
do $$
declare aid uuid := gen_random_uuid();
begin
  if not public.can_manage_marketing() then raise exception 'Owner denied marketing access'; end if;
  if not exists(select 1 from public.marketing_items where id = current_setting('marketing_test.item_id')::uuid)
    then raise exception 'Owner cannot read marketing metadata'; end if;
  begin
    insert into public.marketing_assets(id,item_id,filename,mime_type,size,storage_path,created_by,upload_status)
    values (aid,current_setting('marketing_test.item_id')::uuid,'missing.jpg','image/jpeg',12,
      current_setting('marketing_test.item_id') || '/' || aid::text || '/missing.jpg',
      current_setting('marketing_test.owner_id')::uuid,'ready');
    raise exception 'An absent storage upload was marked ready';
  exception when raise_exception then
    if sqlerrm not like 'Upload is missing%' then raise; end if;
  end;
  begin
    perform public.reorder_marketing_assets(current_setting('marketing_test.item_id')::uuid,array[aid]);
    raise exception 'Unknown asset accepted in reorder';
  exception when raise_exception then
    if sqlerrm not like 'The file list changed%' then raise; end if;
  end;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.marketing_items limit 1;
    raise exception 'Anonymous role can read marketing metadata';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
