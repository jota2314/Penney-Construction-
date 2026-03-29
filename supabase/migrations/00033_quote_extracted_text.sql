-- Add extracted_text to quote_requests for storing OCR/parsed content from PDF attachments
alter table quote_requests
  add column if not exists extracted_text text;

comment on column quote_requests.extracted_text is 'Text extracted from the PDF attachment — amounts, line items, scope details';
