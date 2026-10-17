-- Optional cover image for a client portal document (e.g. a design
-- presentation's rendering). When the document is visible on the portal, its
-- cover is shown as the hero on the client's Home tab. Additive and nullable.
alter table public.client_portal_documents
  add column if not exists cover_bucket text,
  add column if not exists cover_path text;

comment on column public.client_portal_documents.cover_path is
  'Optional image (storage path in cover_bucket) shown as the Home hero on the client portal while this document is visible there.';
