import type { SupabaseClient } from "@supabase/supabase-js";
import type { LogTransaction } from "./daily-log";

const INVOICE_BUCKETS = ["email-attachments", "project-files", "field-captures"] as const;
const SIGNED_URL_TTL = 60 * 60;
const BATCH_SIZE = 100;

/** Resolve files only after the caller's office-role gate and RLS reads.
 * Pass the displayed transactions, not the entire financial history. A missing
 * object or storage outage must never hide the log or change its totals.
 */
export async function resolveDailyLogAttachments(
  db: SupabaseClient,
  records: LogTransaction[],
): Promise<LogTransaction[]> {
  const resolved = records.map(record => ({
    ...record,
    attachments: record.attachments.map(attachment => ({ ...attachment, url: null as string | null })),
  }));
  const invoiceAttachments = resolved.filter(record => record.kind === "expense").flatMap(record => record.attachments);
  const paymentAttachments = resolved.filter(record => record.kind === "income").flatMap(record => record.attachments);
  const buckets = [...new Set<string>([
    ...INVOICE_BUCKETS,
    ...paymentAttachments.map(attachment => attachment.bucket).filter((bucket): bucket is string => Boolean(bucket)),
  ])];

  for (const bucket of buckets) {
    const invoices = INVOICE_BUCKETS.some(candidate => candidate === bucket)
      ? invoiceAttachments.filter(attachment => !attachment.url)
      : [];
    // Payments have an explicit bucket: do not guess a different file with
    // the same path when their recorded bucket is absent or unavailable.
    const payments = paymentAttachments.filter(attachment => attachment.bucket === bucket && !attachment.url);
    const pending = [...invoices, ...payments];
    const paths = [...new Set(pending.map(attachment => attachment.path))];
    for (let start = 0; start < paths.length; start += BATCH_SIZE) {
      try {
        const { data } = await db.storage.from(bucket).createSignedUrls(paths.slice(start, start + BATCH_SIZE), SIGNED_URL_TTL);
        for (const entry of data ?? []) {
          if (entry.error || !entry.path || !entry.signedUrl) continue;
          for (const attachment of pending) {
            if (attachment.path === entry.path) {
              attachment.bucket = bucket;
              attachment.url = entry.signedUrl;
            }
          }
        }
      } catch {
        // Keep the file listed as unavailable and try the next invoice bucket.
      }
    }
  }
  return resolved;
}
