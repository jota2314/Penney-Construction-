import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved uploads | Penney Construction" };

export default async function SavedUploads({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAuth();
  const user = await getUser();
  const owner = user?.profile?.id ?? user?.id;
  if (!owner) return null;
  const page = Math.max(0, Math.min(10000, Number((await searchParams).page) || 0));
  const supabase = await createClient();
  const bucket = supabase.storage.from("field-captures");
  const { data: files, error } = await bucket.list(owner, {
    limit: 50, offset: page * 50, sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw new Error("Could not load saved uploads. Please retry.");
  const entries = (files ?? []).filter((f) => f.id);
  const paths = entries.map((f) => `${owner}/${f.name}`);
  const { data: urls, error: urlError } = paths.length ? await bucket.createSignedUrls(paths, 3600) : { data: [], error: null };
  if (urlError) throw new Error("Could not open saved files. Please retry.");
  const { data: invoices, error: invoiceError } = paths.length ? await supabase.from("invoices")
    .select("id, attachment_storage_path, vendor_name, amount")
    .in("attachment_storage_path", paths) : { data: [], error: null };
  if (invoiceError) throw new Error("Could not check attached invoices. Please retry.");
  return <>
    <Header title="Saved uploads" backHref="/spent/review" />
    <main className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <p className="text-sm text-muted-foreground">Your receipt photos and invoices stay here even if reading or filing fails. Saving a file does not create a charge.</p>
      {!entries.length && <p>No saved uploads on this page.</p>}
      {entries.map((file, index) => {
        const path = paths[index];
        const linked = (invoices ?? []).filter((i) => i.attachment_storage_path === path);
        const url = urls?.find((u) => u.path === path)?.signedUrl;
        return <section key={file.id} className="rounded-xl border p-4 space-y-2">
          <p className="font-medium break-all">{file.name.replace(/^[0-9a-f-]{36}-/i, "")}</p>
          <p className="text-xs text-muted-foreground">Saved {new Date(file.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</p>
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-amber-600 underline">View saved file</a>}
          {linked.map((i) => <p key={i.id}><Link href={`/spent/${i.id}`} className="underline">{i.vendor_name} · ${Number(i.amount ?? 0).toFixed(2)}</Link></p>)}
          {!linked.length && <p className="text-sm">File saved; not attached to an invoice. <Link href={`/command-center?billUpload=${encodeURIComponent(path)}`} className="underline">Finish filing</Link></p>}
        </section>;
      })}
      <nav className="flex gap-4">
        {page > 0 && <Link href={`?page=${page - 1}`}>Newer uploads</Link>}
        {entries.length === 50 && <Link href={`?page=${page + 1}`}>Older uploads</Link>}
      </nav>
    </main>
  </>;
}
