-- Add attachment storage path and document type to quote_requests
-- so quotes can link directly to their source PDF/file

alter table quote_requests
  add column if not exists attachment_storage_path text,
  add column if not exists document_type text default 'quote';

-- document_type: quote, invoice, change_order, estimate, permit, contract, other
comment on column quote_requests.attachment_storage_path is 'Storage path in email-attachments bucket for the source document';
comment on column quote_requests.document_type is 'Type of document: quote, invoice, change_order, estimate, permit, contract, other';
