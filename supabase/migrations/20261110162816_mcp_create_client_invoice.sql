-- The Penney MCP's create_client_invoice tool called mcp_create_client_invoice,
-- which was never created, so every call failed (found in the 11/10/2026 MCP
-- smoke test). This adds it alongside the existing revise/apply functions:
-- same actor gate, same line rules, same audit table. It only creates a DRAFT
-- invoice numbered with the job's next per-project number, exactly like the
-- app's createClientInvoice. Nothing is sent, paid, or pushed to QuickBooks.

create or replace function finance_internal.create_invoice(
  p_actor_id uuid, p_project_id uuid, p_title text, p_terms text, p_line_items jsonb,
  p_reason text, p_due_date date default null, p_invoice_date date default null, p_notes text default null
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_invoice public.client_invoices%rowtype;
  v_amount numeric := 0;
  v_line jsonb;
  v_number integer;
begin
  perform finance_internal.require_actor(p_actor_id);
  if p_title is null or length(btrim(p_title)) not between 1 and 500
    or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
    or (p_terms is not null and length(p_terms) > 2000) then
    raise exception 'Provide a title, terms and a reason.';
  end if;
  if p_notes is not null and length(p_notes) > 4000 then raise exception 'Keep the notes under 4,000 characters.'; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Job not found.'; end if;
  if p_line_items is null or jsonb_typeof(p_line_items) <> 'array' then raise exception 'Provide invoice lines.'; end if;
  if jsonb_array_length(p_line_items) not between 1 and 200 then raise exception 'Provide 1 to 200 lines.'; end if;
  for v_line in select value from jsonb_array_elements(p_line_items) loop
    -- Change order credits only arrive through the credit workflow.
    if jsonb_typeof(v_line) <> 'object' or jsonb_typeof(v_line->'description') is distinct from 'string'
      or length(btrim(v_line->>'description')) not between 1 and 4000
      or jsonb_typeof(v_line->'amount') is distinct from 'number'
      or exists (select 1 from jsonb_object_keys(v_line) k where k not in ('description','amount')) then
      raise exception 'Invalid invoice line.';
    end if;
    if abs((v_line->>'amount')::numeric) > 100000000
      or (v_line->>'amount')::numeric <> round((v_line->>'amount')::numeric, 2) then
      raise exception 'Use dollar amounts with at most two decimal places.';
    end if;
    v_amount := v_amount + (v_line->>'amount')::numeric;
  end loop;
  if v_amount <= 0 or v_amount > 100000000 then raise exception 'Invoice total must be positive and within limits.'; end if;

  -- Same numbering as the app: the job's highest invoice number plus one,
  -- serialized per job so two creates can't take the same number.
  perform pg_advisory_xact_lock(hashtextextended('client-invoice-number:'||p_project_id::text, 0));
  select coalesce(max(invoice_number), 0) + 1 into v_number from public.client_invoices where project_id = p_project_id;

  insert into public.client_invoices(project_id, invoice_number, title, line_items, amount, terms, due_date,
                                     invoice_date, notes, status, created_by, source)
  values (p_project_id, v_number, btrim(p_title), p_line_items, v_amount,
          coalesce(nullif(btrim(coalesce(p_terms, '')), ''), 'Due on receipt'), p_due_date,
          coalesce(p_invoice_date, (now() at time zone 'America/New_York')::date),
          nullif(btrim(coalesce(p_notes, '')), ''), 'draft', p_actor_id, 'mcp')
  returning * into v_invoice;

  insert into finance_internal.client_billing_audit(actor_id, project_id, invoice_id, operation, reason, before_record, after_record)
  values (p_actor_id, p_project_id, v_invoice.id, 'create', btrim(p_reason), '{}'::jsonb,
          finance_internal.invoice_revision_record(v_invoice));

  return jsonb_build_object('id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'invoice_date', v_invoice.invoice_date, 'amount', v_invoice.amount, 'status', v_invoice.status,
    'updated_at', v_invoice.updated_at, 'operation', 'create');
end;
$function$;

revoke all on function finance_internal.create_invoice(uuid, uuid, text, text, jsonb, text, date, date, text) from public, anon, authenticated;

create or replace function public.mcp_create_client_invoice(
  p_actor_id uuid, p_project_id uuid, p_title text, p_terms text, p_line_items jsonb,
  p_reason text, p_due_date date default null, p_invoice_date date default null, p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted MCP service required.'; end if;
  return finance_internal.create_invoice(p_actor_id, p_project_id, p_title, p_terms, p_line_items,
    p_reason, p_due_date, p_invoice_date, p_notes);
end;
$function$;

revoke all on function public.mcp_create_client_invoice(uuid, uuid, text, text, jsonb, text, date, date, text) from public, anon, authenticated;
grant execute on function public.mcp_create_client_invoice(uuid, uuid, text, text, jsonb, text, date, date, text) to service_role;
