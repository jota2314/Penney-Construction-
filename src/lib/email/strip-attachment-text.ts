/**
 * Drop `text_content` (up to 50k chars of extracted PDF text per attachment)
 * from an email's attachments JSONB before shipping rows to the client.
 * Inbox LIST views only need filename/mimeType/storage_path — the heavy text
 * stays server-side where the AI routes re-read it by email id.
 */
export function stripAttachmentText<T extends { attachments?: unknown }>(email: T): T {
  const atts = email.attachments;
  if (!Array.isArray(atts) || atts.length === 0) return email;
  return {
    ...email,
    attachments: atts.map((a) => {
      if (a && typeof a === "object" && "text_content" in a) {
        const { text_content: _dropped, ...rest } = a as Record<string, unknown>;
        return rest;
      }
      return a;
    }),
  };
}
