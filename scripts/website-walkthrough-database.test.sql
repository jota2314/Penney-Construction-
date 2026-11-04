-- Run inside a transaction and ROLLBACK. No Google/email transport is called.
do $$
declare actor uuid; inquiry uuid:=gen_random_uuid(); inquiry2 uuid:=gen_random_uuid(); booking uuid:=gen_random_uuid();
 op uuid:=gen_random_uuid(); op2 uuid:=gen_random_uuid(); cancel_op uuid:=gen_random_uuid(); cancel_op2 uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid();
 stamp timestamptz; starts timestamptz:=date_trunc('day',now())+interval '10 days 15 hours';
 result jsonb; second jsonb; rejected boolean; email_id uuid;
begin
 select profile_id into actor from public.website_inquiry_members where assignee_name='Ryan' limit 1;
 if actor is null then raise exception 'Test requires existing Ryan membership'; end if;
 if has_table_privilege('anon','public.website_walkthrough_bookings','SELECT') or
   has_table_privilege('authenticated','public.website_walkthrough_bookings','INSERT') then raise exception 'Booking grants too broad'; end if;
 if has_function_privilege('authenticated','public.begin_website_walkthrough(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz,text,text,text,text,text,boolean,text,uuid)','EXECUTE') then raise exception 'Reservation RPC exposed'; end if;
 if has_function_privilege('authenticated','public.begin_cancel_website_walkthrough(uuid,uuid,uuid)','EXECUTE') or
   has_function_privilege('authenticated','public.finish_cancel_website_walkthrough(uuid,uuid)','EXECUTE') then raise exception 'Cancellation RPC exposed'; end if;
 insert into public.todos(id,contact_name,contact_type,project_name,description,priority,category,assignee,source,created_by,due_date,website_inquiry,intake_status)
 values(inquiry,'Booking verification fixture','client','Rollback-only verification','Email: walkthrough-test@example.invalid','high','follow_up_clients','Shannon','website',actor,starts,
 jsonb_build_object('name','Booking verification fixture','email','walkthrough-test@example.invalid','walkthrough',jsonb_build_object('start',starts,'end',starts+interval '1 hour','timeZone','America/New_York','address','Rollback-only address')),'new') returning updated_at into stamp;
 result:=public.begin_website_walkthrough(booking,inquiry,actor,stamp,starts,starts+interval '1 hour','Rollback-only address','walkthrough-test@example.invalid','rpenney@penneyconstructioninc.com','Test confirmation','Rollback-only draft',false,'',op);
 if result->>'status'<>'confirming' or result->>'claimed'<>'true' or result->>'newly_created'<>'true' then raise exception 'First reservation failed'; end if;
 second:=public.begin_website_walkthrough(booking,inquiry,actor,stamp,starts,starts+interval '1 hour','Rollback-only address','walkthrough-test@example.invalid','rpenney@penneyconstructioninc.com','Test confirmation','Rollback-only draft',false,'',op2);
 if second->>'claimed'<>'false' then raise exception 'Duplicate request acquired active lease'; end if;
 rejected:=false;
 begin perform public.record_website_walkthrough_event(booking,'fixture','https://calendar.google.com/calendar/event?eid=fixture',op2); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Nonowner operation changed booking'; end if;
 rejected:=false;
 begin perform public.finish_website_walkthrough(booking,op); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Finished booking without calendar/email receipts'; end if;
 insert into public.todos(id,contact_name,contact_type,project_name,description,priority,category,assignee,source,created_by,due_date,website_inquiry,intake_status)
 values(inquiry2,'Overlap fixture','client','Rollback-only verification','Email: walkthrough-test-2@example.invalid','high','follow_up_clients','Shannon','website',actor,starts,
 jsonb_build_object('email','walkthrough-test-2@example.invalid'),'new') returning updated_at into stamp;
 rejected:=false;
 begin perform public.begin_website_walkthrough(gen_random_uuid(),inquiry2,actor,stamp,starts,starts+interval '1 hour','Rollback-only address','walkthrough-test-2@example.invalid','rpenney@penneyconstructioninc.com','Test','Draft',true,'Test client agreed',gen_random_uuid()); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Overlapping booking was allowed'; end if;
 rejected:=false;
 begin perform public.begin_website_walkthrough(gen_random_uuid(),inquiry2,actor,stamp,starts+interval '4 hours',starts+interval '5 hours','Rollback-only address','walkthrough-test-2@example.invalid','rpenney@penneyconstructioninc.com','Test','Draft',false,'',gen_random_uuid()); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Unagreed alternative was confirmed'; end if;
 rejected:=false;
 begin update public.todos set intake_status='walkthrough' where id=inquiry2; exception when others then rejected:=true; end;
 if not rejected then raise exception 'Manual booking without receipt was allowed'; end if;
 perform public.record_website_walkthrough_event(booking,'fixture','https://calendar.google.com/calendar/event?eid=fixture',op);
 email_id:=(result->>'confirmation_email_id')::uuid;
 insert into public.website_inquiry_emails(id,inquiry_id,sender_profile_id,recipient_email,subject,body,status,gmail_message_id,sent_at)
 values(email_id,inquiry,actor,'walkthrough-test@example.invalid','Test confirmation','Rollback-only draft','sent','rollback-only-receipt',now());
 result:=public.finish_website_walkthrough(booking,op);
 if result->>'status'<>'confirmed' or (select intake_status from public.todos where id=inquiry)<>'walkthrough' then raise exception 'Complete receipts did not finish booking'; end if;
 rejected:=false;
 begin delete from public.todos where id=inquiry; exception when others then rejected:=true; end;
 if not rejected then raise exception 'Confirmed booking could be orphaned'; end if;

 -- Cancellation is a separate leased operation. Its intent survives uncertainty.
 result:=public.begin_cancel_website_walkthrough(booking,actor,cancel_op);
 if result->>'status'<>'cancelling' or result->>'claimed'<>'true' or result->>'cancel_requested_at' is null then raise exception 'Cancellation was not durably claimed'; end if;
 second:=public.begin_cancel_website_walkthrough(booking,actor,cancel_op2);
 if second->>'claimed'<>'false' then raise exception 'Duplicate cancellation acquired active lease'; end if;
 rejected:=false;
 begin perform public.finish_cancel_website_walkthrough(booking,cancel_op2);
 exception when others then if sqlerrm not like '%owned%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'A different operation finished cancellation'; end if;
 result:=public.mark_website_walkthrough_problem(booking,'Simulated unknown Google cancellation',false,cancel_op);
 if result->>'status'<>'cancelling' or result->>'cancel_requested_at' is null or result->>'operation_token' is not null then
   raise exception 'Cancellation uncertainty lost intent or retained an expired worker'; end if;
 select updated_at into stamp from public.todos where id=inquiry;
 rejected:=false;
 begin perform public.begin_website_walkthrough(booking,inquiry,actor,stamp,starts,starts+interval '1 hour','Rollback-only address','walkthrough-test@example.invalid','rpenney@penneyconstructioninc.com','Test confirmation','Rollback-only draft',false,'',op2);
 exception when others then if sqlerrm not like '%Cancellation is in progress%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Confirmation resumed after cancellation intent'; end if;
 rejected:=false;
 begin perform public.begin_website_walkthrough(replacement,inquiry,actor,stamp,starts,starts+interval '1 hour','Rollback-only address','walkthrough-test@example.invalid','rpenney@penneyconstructioninc.com','Replacement confirmation','New reviewed draft',true,'Client agreed after rescheduling',op2);
 exception when others then if sqlerrm not like '%already has a booking%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Replacement booking allowed before verified cancellation'; end if;

 -- A fresh cancellation lease can reconcile the same event; only its owner releases the slot.
 result:=public.begin_cancel_website_walkthrough(booking,actor,cancel_op2);
 if result->>'claimed'<>'true' then raise exception 'Cancellation could not be resumed after uncertainty'; end if;
 rejected:=false;
 begin perform public.finish_cancel_website_walkthrough(booking,cancel_op);
 exception when others then if sqlerrm not like '%owned%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Stale cancellation worker finished a newer operation'; end if;
 result:=public.finish_cancel_website_walkthrough(booking,cancel_op2);
 if result->>'status'<>'cancelled' or result->>'cancelled_at' is null or
   (select intake_status from public.todos where id=inquiry)<>'contacted' then raise exception 'Verified cancellation did not release inquiry'; end if;
 second:=public.begin_cancel_website_walkthrough(booking,actor,gen_random_uuid());
 if second->>'status'<>'cancelled' or second->>'claimed'<>'false' then raise exception 'Cancelled booking was not idempotent'; end if;

 -- The original website selection is not fresh consent after a cancellation.
 select updated_at into stamp from public.todos where id=inquiry;
 rejected:=false;
 begin perform public.begin_website_walkthrough(replacement,inquiry,actor,stamp,starts,starts+interval '1 hour','Rollback-only address','walkthrough-test@example.invalid','rpenney@penneyconstructioninc.com','Replacement confirmation','New reviewed draft',false,'',op2);
 exception when others then if sqlerrm not like '%homeowner must agree%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Cancelled website selection was reused as consent'; end if;
 result:=public.begin_website_walkthrough(replacement,inquiry,actor,stamp,starts,starts+interval '1 hour','Rollback-only address','walkthrough-test@example.invalid','rpenney@penneyconstructioninc.com','Replacement confirmation','New reviewed draft',true,'Client agreed again after cancellation',op2);
 if result->>'status'<>'confirming' or result->>'claimed'<>'true' then raise exception 'Released slot could not be reserved after fresh consent'; end if;
 if (select status from public.website_walkthrough_bookings where id=booking)<>'cancelled' then raise exception 'Replacement erased cancellation history'; end if;
end $$;
