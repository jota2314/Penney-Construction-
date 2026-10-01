"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { signThumbUrls } from "@/lib/image/transform-signed-url";

/**
 * Receipt photos a crew member saved but never filed.
 *
 * Every scan saves the photo before the AI reads it, so a scan that hung, a
 * closed app or a dead zone leaves the photo behind — and until now the only
 * way back to it was an office page the crew get bounced from. On 10/1 Dylan
 * shot the same Town Line Paint slip five times; it never filed.
 *
 * Re-shots of one receipt are byte-identical (the phone shrinks the same photo
 * the same way), so the storage eTag collapses them to one row, and a photo
 * whose twin already filed is not "unfinished" at all.
 */

const BUCKET = "field-captures";
const WINDOW_DAYS = 14;
const VISION = /\.(jpe?g|png|webp|gif)$/i;

export type UnfinishedReceipt = {
  storagePath: string;
  savedAt: string;
  vendor: string | null;
  amount: number | null;
  date: string | null;
  thumbUrl: string | null;
  photoUrl: string | null;
};

type StorageEntry = {
  id: string | null;
  name: string;
  created_at: string;
  metadata: { eTag?: string; mimetype?: string; size?: number } | null;
};

async function inChunks<T>(values: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 40) out.push(...(await run(values.slice(i, i + 40))));
  return out;
}

export async function listMyUnfinishedReceipts(
  opts: { withPhotos?: boolean } = {},
): Promise<UnfinishedReceipt[]> {
  const user = await getUser();
  const owner = user?.profile?.id ?? user?.id;
  if (!owner) return [];
  const supabase = await createClient();

  const { data: listed, error } = await supabase.storage.from(BUCKET).list(owner, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw new Error("Couldn't check your saved receipts.");

  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const entries = ((listed ?? []) as StorageEntry[]).filter(
    (f) =>
      f.id &&
      VISION.test(f.name) &&
      Date.parse(f.created_at) >= cutoff &&
      (f.metadata?.mimetype ?? "image/").startsWith("image/"),
  );
  if (entries.length === 0) return [];
  const pathOf = (f: StorageEntry) => `${owner}/${f.name}`;
  const paths = entries.map(pathOf);

  const [invoiceRows, fileRows] = await Promise.all([
    inChunks(paths, async (chunk) => {
      const { data, error: e } = await supabase
        .from("invoices")
        .select("attachment_storage_path")
        .in("attachment_storage_path", chunk);
      if (e) throw new Error("Couldn't check your saved receipts.");
      return (data ?? []).map((r) => r.attachment_storage_path as string);
    }),
    inChunks(paths, async (chunk) => {
      const { data, error: e } = await supabase
        .from("project_files")
        .select("storage_path")
        .in("storage_path", chunk);
      if (e) throw new Error("Couldn't check your saved receipts.");
      return (data ?? []).map((r) => r.storage_path as string);
    }),
  ]);
  const filed = new Set([...invoiceRows, ...fileRows]);
  const filedTags = new Set(
    entries.filter((f) => filed.has(pathOf(f))).map((f) => f.metadata?.eTag).filter(Boolean),
  );

  // Newest first, one row per distinct photo.
  const seenTags = new Set<string>();
  const open = entries.filter((f) => {
    if (filed.has(pathOf(f))) return false;
    const tag = f.metadata?.eTag;
    if (tag) {
      if (filedTags.has(tag) || seenTags.has(tag)) return false;
      seenTags.add(tag);
    }
    return true;
  }).slice(0, 10);
  if (open.length === 0) return [];
  const openPaths = open.map(pathOf);

  // Saved reads give the row a name ("Town Line Paint · $25.66") instead of a time.
  const { data: reads } = await createAdminClient()
    .from("bill_scan_reads")
    .select("storage_path, result")
    .eq("owner_id", owner)
    .in("storage_path", openPaths);
  const readOf = new Map(
    (reads ?? []).map((r) => [
      r.storage_path as string,
      (r.result as { scan?: { vendor?: string; amount?: number | null; date?: string | null } } | null)?.scan,
    ]),
  );

  let thumbs = new Map<string, string>();
  let fulls = new Map<string, string>();
  if (opts.withPhotos) {
    const [t, f] = await Promise.all([
      signThumbUrls(supabase, BUCKET, openPaths, 3600, 240).catch(() => new Map<string, string>()),
      supabase.storage.from(BUCKET).createSignedUrls(openPaths, 3600),
    ]);
    thumbs = t;
    fulls = new Map(
      (f.data ?? []).filter((u) => u.signedUrl && u.path).map((u) => [u.path as string, u.signedUrl]),
    );
  }

  return open.map((f) => {
    const path = pathOf(f);
    const read = readOf.get(path);
    return {
      storagePath: path,
      savedAt: f.created_at,
      vendor: read?.vendor ?? null,
      amount: typeof read?.amount === "number" ? read.amount : null,
      date: read?.date ?? null,
      thumbUrl: thumbs.get(path) ?? fulls.get(path) ?? null,
      photoUrl: fulls.get(path) ?? null,
    };
  });
}
