-- Add a real labor unit without changing historical prices.
alter table public.trade_rates drop constraint trade_rates_unit_type_check;
alter table public.trade_rates add constraint trade_rates_unit_type_check
  check (unit_type in ('sqft','linear_ft','each','lump_sum','hour'));
update public.trade_rates set unit_type='hour'
where trade_name='Carpenter Labor (per hour)' and unit_type='each';

-- One originating Gmail thread per automatically created estimating project.
alter table public.projects add column if not exists estimating_source_thread text;
create unique index if not exists projects_estimating_source_thread_unique
  on public.projects(estimating_source_thread) where estimating_source_thread is not null;

create or replace function public.intake_estimate_request(email_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  mail public.inbox_emails%rowtype;
  project_uuid uuid;
  thread_key text;
  creator uuid;
  customer_projects integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not exists (
    select 1 from public.profiles where id=auth.uid() and role in ('owner','precon_manager','office_admin')
  ) then raise exception 'Estimating intake requires office access'; end if;
  select * into mail from public.inbox_emails where id=email_id for update;
  if not found then raise exception 'Email not found'; end if;
  if mail.direction <> 'inbound' or mail.content_type <> 'inquiry'
     or mail.ai_action_required is not true or mail.is_dismissed is true
     or coalesce(mail.sender_type,'') not in ('client','internal')
     or (coalesce(mail.subject,'') || ' ' || coalesce(mail.ai_summary,'')) !~* '(estimat|quot|bid\y|pricing|remodel|renovat|potential job|project prospect)'
  then return null; end if;
  thread_key := coalesce(nullif(mail.thread_id,''),mail.gmail_message_id,mail.id::text);
  perform pg_advisory_xact_lock(hashtextextended('estimating:' || thread_key, 0));
  project_uuid := coalesce(mail.project_id,mail.matched_project_id);
  if project_uuid is null then
    select id into project_uuid from public.projects where estimating_source_thread=thread_key;
  end if;
  if project_uuid is null then
    select count(distinct coalesce(project_id,matched_project_id))
      into customer_projects from public.inbox_emails
      where thread_id=mail.thread_id and coalesce(project_id,matched_project_id) is not null;
    if customer_projects=1 then
      select coalesce(project_id,matched_project_id) into project_uuid
      from public.inbox_emails where thread_id=mail.thread_id
        and coalesce(project_id,matched_project_id) is not null limit 1;
    elsif customer_projects>1 then return null;
    end if;
  end if;
  if project_uuid is null then
    -- Unknown customers or customers with existing jobs need a match in the queue.
    -- Never assume a new email thread means a new construction project.
    if mail.matched_customer_id is null then return null; end if;
    select count(*) into customer_projects from public.projects
      where customer_id=mail.matched_customer_id and status not in ('completed','cancelled');
    if customer_projects>0 then return null; end if;
    creator := coalesce(auth.uid(),mail.created_by);
    if creator is null then return null; end if;
    -- Serialize different email threads from the same customer, too.
    perform pg_advisory_xact_lock(hashtextextended('estimating-customer:' || mail.matched_customer_id::text, 0));
    if exists(select 1 from public.projects where customer_id=mail.matched_customer_id and status not in ('completed','cancelled')) then return null; end if;
    insert into public.projects(name,customer_id,status,project_type,description,next_action,created_by,estimating_source_thread)
    values(left(coalesce(nullif(mail.subject,''),'New estimate request'),160),mail.matched_customer_id,'estimating','other',
      mail.ai_summary,'Confirm scope, site address and drawings; prepare preliminary estimate.',creator,thread_key)
    returning id into project_uuid;
  end if;
  update public.inbox_emails set project_id=project_uuid where id=email_id and project_id is null;
  return project_uuid;
end $$;
revoke all on function public.intake_estimate_request(uuid) from public,anon;
grant execute on function public.intake_estimate_request(uuid) to authenticated,service_role;
