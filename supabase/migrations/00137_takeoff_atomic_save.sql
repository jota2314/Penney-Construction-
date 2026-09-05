create or replace function public.save_takeoff_drawing(
 p_project_id uuid, p_storage_path text, p_measurements jsonb, p_expected jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare current_versions jsonb; expected_versions jsonb; item jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if jsonb_typeof(p_measurements) <> 'array' or jsonb_typeof(p_expected) <> 'array' then raise exception 'Expected arrays'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || '/' || p_storage_path,0));
 select coalesce(jsonb_object_agg(id::text,updated_at),'{}'::jsonb) into current_versions from takeoff_measurements
 where project_id=p_project_id and storage_path=p_storage_path and measurement_type <> 'checklist';
 select coalesce(jsonb_object_agg((v->>'id')::uuid::text,(v->>'updatedAt')::timestamptz),'{}'::jsonb)
 into expected_versions from jsonb_array_elements(p_expected) v;
 if current_versions <> expected_versions then
 raise exception using errcode='40001', message='This drawing changed in another tab. Your changes have not been saved. Reload the drawing before editing again.';
 end if;
 if (select count(*) <> count(distinct v->>'id') from jsonb_array_elements(p_measurements) v) then raise exception 'Duplicate IDs'; end if;
 for item in select * from jsonb_array_elements(p_measurements) loop
 if exists(select 1 from takeoff_measurements where id=(item->>'id')::uuid and
 (project_id<>p_project_id or storage_path is distinct from p_storage_path or measurement_type='checklist')) then raise exception 'Measurement belongs to another drawing'; end if;
 insert into takeoff_measurements(id,project_id,storage_path,file_id,page_number,measurement_type,label,points,value,unit,color,scale_pixels_per_foot,created_by,updated_at,notes,trade)
 values((item->>'id')::uuid,p_project_id,p_storage_path,
 (select id from project_files where project_id=p_project_id and storage_path=p_storage_path limit 1),
 (item->>'pageNumber')::integer,item->>'type',item->>'label',item->'points',(item->>'value')::numeric,item->>'unit',item->>'color',(item->>'scalePixelsPerFoot')::numeric,auth.uid(),clock_timestamp(),item->>'notes',item->>'trade')
 on conflict(id) do update set page_number=excluded.page_number,measurement_type=excluded.measurement_type,label=excluded.label,points=excluded.points,
 value=excluded.value,unit=excluded.unit,color=excluded.color,scale_pixels_per_foot=excluded.scale_pixels_per_foot,updated_at=excluded.updated_at;
 end loop;
 -- Delete only from the version-checked snapshot, including the last shape.
 delete from takeoff_measurements t where project_id=p_project_id and storage_path=p_storage_path and measurement_type <> 'checklist'
 and not exists(select 1 from jsonb_array_elements(p_measurements) v where (v->>'id')::uuid=t.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at)),'[]'::jsonb) into result
 from takeoff_measurements where project_id=p_project_id and storage_path=p_storage_path and measurement_type <> 'checklist';
 return result;
end $$;
revoke all on function public.save_takeoff_drawing(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_takeoff_drawing(uuid,text,jsonb,jsonb) to authenticated;

