-- Run against a development database as an administrator. All fixtures roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from profiles limit 1),true);
do $test$
declare
 p uuid := (select id from projects limit 1);
 i uuid := gen_random_uuid();
 path text := '__takeoff_test_' || gen_random_uuid()::text;
 rows jsonb; versions jsonb; stale jsonb; caught boolean;
begin
 if p is null or auth.uid() is null then raise exception 'Requires a project and profile fixture'; end if;
 rows=jsonb_build_array(jsonb_build_object('id',i,'pageNumber',1,'type','area','label','Test box',
 'points','[{"x":0,"y":0},{"x":36,"y":0},{"x":36,"y":36},{"x":0,"y":36}]'::jsonb,
 'value',1,'unit','sqft','color','#22c55e','scalePixelsPerFoot',36,'notes','Preserve notes','trade','flooring'));
 versions=save_takeoff_drawing(p,path,rows,'[]');
 stale=versions;
 versions=save_takeoff_drawing(p,path,rows,versions);
 if (select notes<>'Preserve notes' or trade<>'flooring' or value<>1 from takeoff_measurements where id=i)
 or versions->0->>'id'<>i::text then raise exception 'Identity, geometry or metadata lost'; end if;
 caught=false;
 begin perform save_takeoff_drawing(p,path,'[]',stale); exception when serialization_failure then caught=true; end;
 if not caught then raise exception 'Stale save accepted'; end if;
 caught=false;
 begin
  perform save_takeoff_drawing(p,path,jsonb_set(rows,'{0,label}','"Changed"') ||
    jsonb_build_array(jsonb_set(jsonb_set(rows->0,'{id}',to_jsonb(gen_random_uuid())),'{value}','"bad"')),versions);
 exception when invalid_text_representation then caught=true;
 end;
 if not caught or (select label<>'Test box' from takeoff_measurements where id=i) then raise exception 'Failed save partially committed'; end if;
 versions=save_takeoff_drawing(p,path,'[]',versions);
 if versions<>'[]'::jsonb or exists(select 1 from takeoff_measurements where id=i) then raise exception 'Final shape not deleted'; end if;
 versions=save_takeoff_drawing(p,path,rows,versions);
 if (select notes<>'Preserve notes' from takeoff_measurements where id=i) then raise exception 'Undo lost metadata'; end if;
end $test$;
rollback;

