-- A private company marketing library. Existing project files are left in place.
create or replace function public.can_manage_marketing()
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'office_admin', 'precon_manager', 'project_manager')
  );
$$;
revoke all on function public.can_manage_marketing() from public, anon;
grant execute on function public.can_manage_marketing() to authenticated, service_role;

create table public.marketing_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 10000),
  caption text not null default '' check (length(caption) <= 10000),
  kind text not null check (kind in ('video', 'carousel', 'preview', 'image')),
  status text not null default 'draft' check (status in ('draft', 'ready', 'posted')),
  project_id uuid references public.projects(id) on delete set null,
  instagram_url text check (instagram_url is null or instagram_url ~ '^https://(www\.)?instagram\.com([/?#][^[:space:]]*)?$'),
  posted_at date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  import_key text unique
);
create index marketing_items_active_updated_idx on public.marketing_items(updated_at desc) where archived_at is null;
create index marketing_items_project_idx on public.marketing_items(project_id);

create table public.marketing_assets (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.marketing_items(id) on delete restrict,
  filename text not null check (length(filename) between 1 and 240 and filename !~ '[/\\[:cntrl:]]'),
  mime_type text not null check (mime_type in ('video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf','application/zip','text/plain')),
  size bigint not null check (size > 0 and size <= 524288000),
  storage_bucket text not null default 'marketing-media' check (storage_bucket = 'marketing-media'),
  storage_path text not null,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  role text not null default 'media' check (role in ('media','cover','download')),
  upload_status text not null default 'pending' check (upload_status in ('pending','ready')),
  upload_expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (storage_bucket, storage_path),
  constraint marketing_asset_path_matches_ids check (
    storage_path ~ ('^' || item_id::text || '/' || id::text || '/[a-zA-Z0-9_-][a-zA-Z0-9._-]*$')
  ),
  constraint marketing_cover_is_image check (role <> 'cover' or mime_type like 'image/%'),
  constraint marketing_media_is_visual check (role <> 'media' or mime_type like 'image/%' or mime_type like 'video/%')
);
create index marketing_assets_item_order_idx on public.marketing_assets(item_id,sort_order,id) where archived_at is null;

alter table public.marketing_items enable row level security;
alter table public.marketing_assets enable row level security;
revoke all on public.marketing_items, public.marketing_assets from anon, authenticated;
grant select,insert,update on public.marketing_items, public.marketing_assets to authenticated;
grant all on public.marketing_items, public.marketing_assets to service_role;

create policy marketing_items_read on public.marketing_items for select to authenticated
  using ((select public.can_manage_marketing()));
create policy marketing_items_create on public.marketing_items for insert to authenticated
  with check ((select public.can_manage_marketing()) and created_by = (select auth.uid()));
create policy marketing_items_update on public.marketing_items for update to authenticated
  using ((select public.can_manage_marketing())) with check ((select public.can_manage_marketing()));
create policy marketing_assets_read on public.marketing_assets for select to authenticated
  using ((select public.can_manage_marketing()));
create policy marketing_assets_create on public.marketing_assets for insert to authenticated
  with check ((select public.can_manage_marketing()) and created_by = (select auth.uid())
    and exists (select 1 from public.marketing_items i where i.id = item_id and i.archived_at is null));
create policy marketing_assets_update on public.marketing_assets for update to authenticated
  using ((select public.can_manage_marketing()))
  with check ((select public.can_manage_marketing())
    and exists (select 1 from public.marketing_items i where i.id = item_id and i.archived_at is null));

create or replace function public.marketing_item_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.marketing_item_updated_at() from public, anon, authenticated;
create trigger marketing_item_updated_at before update on public.marketing_items
  for each row execute function public.marketing_item_updated_at();

-- A client cannot mark an unfinished upload ready, even by bypassing the UI.
-- This function is an invoker: the caller must retain access to both the item
-- and the private storage object. No service-role privilege is exposed.
create or replace function public.verify_marketing_asset()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare stored_metadata jsonb;
begin
  if tg_op = 'UPDATE' and (new.item_id <> old.item_id or new.storage_path <> old.storage_path
      or new.storage_bucket <> old.storage_bucket or new.created_by is distinct from old.created_by) then
    raise exception 'An upload reservation cannot be moved to another item or storage object.';
  end if;
  if new.upload_status = 'ready' and (tg_op = 'INSERT' or old.upload_status <> 'ready'
      or new.size <> old.size or new.mime_type <> old.mime_type) then
    select metadata into stored_metadata from storage.objects
      where bucket_id = new.storage_bucket and name = new.storage_path;
    if stored_metadata is null or coalesce((stored_metadata ->> 'size')::bigint, -1) <> new.size
      or coalesce(stored_metadata ->> 'mimetype', '') <> new.mime_type then
      raise exception 'Upload is missing or does not match the reserved file size and type.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.verify_marketing_asset() from public, anon, authenticated;
create trigger verify_marketing_asset before insert or update on public.marketing_assets
  for each row execute function public.verify_marketing_asset();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('marketing-media','marketing-media',false,524288000,array[
  'video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
  'application/pdf','application/zip','text/plain'
]);

create policy marketing_media_read on storage.objects for select to authenticated
  using (bucket_id = 'marketing-media' and (select public.can_manage_marketing()));
create policy marketing_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'marketing-media' and (select public.can_manage_marketing()) and exists (
    select 1 from public.marketing_assets a join public.marketing_items i on i.id = a.item_id
    where a.storage_bucket = bucket_id and a.storage_path = name
      and a.created_by = (select auth.uid()) and a.upload_status = 'pending'
      and a.upload_expires_at > now() and a.archived_at is null and i.archived_at is null
  ));
-- Files are immutable. Archive removes them from the library without deleting
-- source material; there are deliberately no authenticated UPDATE/DELETE policies.

create or replace function public.reorder_marketing_assets(p_item_id uuid,p_asset_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare expected_count integer;
begin
  if not public.can_manage_marketing() then raise exception 'Marketing access required.'; end if;
  perform 1 from public.marketing_items where id = p_item_id and archived_at is null for update;
  if not found then raise exception 'This marketing item is no longer available.'; end if;
  select count(*) into expected_count from public.marketing_assets
    where item_id = p_item_id and archived_at is null and upload_status = 'ready';
  if p_asset_ids is null or cardinality(p_asset_ids) <> expected_count or cardinality(p_asset_ids) > 1000
    or (select count(distinct x) from unnest(p_asset_ids) x) <> expected_count
    or exists (select 1 from unnest(p_asset_ids) x where not exists (
      select 1 from public.marketing_assets a where a.id = x and a.item_id = p_item_id
        and a.archived_at is null and a.upload_status = 'ready'
    )) then raise exception 'The file list changed. Refresh and try again.'; end if;
  update public.marketing_assets a set sort_order = ordered.position - 1
    from unnest(p_asset_ids) with ordinality as ordered(id,position) where a.id = ordered.id;
  update public.marketing_items set updated_at = now() where id = p_item_id;
end;
$$;
revoke all on function public.reorder_marketing_assets(uuid,uuid[]) from public, anon;
grant execute on function public.reorder_marketing_assets(uuid,uuid[]) to authenticated;
