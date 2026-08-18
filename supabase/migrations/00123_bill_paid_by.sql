-- Office "Add a bill" flow: who actually PAID a bill can differ from who
-- filed it (Nicole files, Ryan swiped his card). The QB expense push draws
-- on the payer's Capital One subaccount, so record the payer explicitly;
-- it falls back to created_by when null (field captures — crew pay their own).
alter table invoices
  add column if not exists paid_by_profile_id uuid references profiles(id);

comment on column invoices.paid_by_profile_id is
  'Who paid this bill (card-holder matching for the QBO expense push). Null = the filer paid.';
