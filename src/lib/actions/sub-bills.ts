"use server";

import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubBillAiRead } from "@/lib/sub-portal/payload";

/**
 * Weekly Close "Sub bills waiting" (plan §4.7): invoices subs sent from the
 * portal that nobody has filed yet.
 *
 * Filing itself is the existing Command Center bill workflow: the waiting
 * list mounts <BillDrop resumePath={path}>, unchanged. These actions only
 * move a submission between people or send it back. Nothing here writes
 * `invoices` or approves anything for pay.
 *
 * "Filed" is worked out when read: an invoices row whose
 * attachment_storage_path is the submission's storage_path (BillDrop's
 * commit stamps it on every split piece).
 */

const BUCKET = "field-captures";
const OFFICE_ROLES = ["owner", "precon_manager", "project_manager", "office_admin"];

export type SubBillWaitingRow = {
  id: string;
  subName: string;
  projectId: string | null;
  projectName: string | null;
  reviewerId: string;
  reviewerName: string | null;
  /** Filed from my own Saved uploads folder: File it works as is. */
  mine: boolean;
  storagePath: string;
  originalName: string | null;
  fileUrl: string | null;
  /** ET Monday, "YYYY-MM-DD". */
  receivedWeek: string;
  createdAt: string;
  aiRead: SubBillAiRead | null;
  statedNumber: string | null;
  statedAmount: number | null;
};

type Result<T extends object = object> = ({ ok: true } & T) | { ok?: false; error: string };

/**
 * The person filing, as BillDrop sees them: the scan route resumes a path
 * only inside `{profile.id}/`, so "my folder" is profile.id here too.
 */
async function officeUser(): Promise<{ id: string } | { error: string }> {
  const user = await getUser();
  const id = user?.profile?.id ?? null;
  if (!id) return { error: "Not signed in" };
  if (!OFFICE_ROLES.includes(user?.profile?.role ?? "")) return { error: "Only the office can file sub bills" };
  return { id };
}

async function isFiled(path: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("invoices")
    .select("id")
    .eq("attachment_storage_path", path)
    .limit(1);
  if (error) throw new Error("Could not check whether it was filed. Please retry.");
  return (data?.length ?? 0) > 0;
}

export async function listSubBillsWaiting(): Promise<Result<{ rows: SubBillWaitingRow[] }>> {
  const me = await officeUser();
  if ("error" in me) return { error: me.error };
  // Office roles read the table through RLS; signed-in users can read field-captures.
  const supabase = await createClient();

  const { data: subs, error } = await supabase
    .from("sub_bill_submissions")
    .select(
      "id, subcontractor_id, project_id, reviewer_profile_id, storage_path, original_name, ai_read, sub_stated_number, sub_stated_amount, received_week, created_at",
    )
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { error: "Could not load sub bills. Please retry." };
  const rows = subs ?? [];
  if (!rows.length) return { ok: true, rows: [] };

  const paths = rows.map((r) => r.storage_path as string);
  const { data: filedRows, error: filedError } = await supabase
    .from("invoices")
    .select("attachment_storage_path")
    .in("attachment_storage_path", paths);
  if (filedError) return { error: "Could not check filed bills. Please retry." };
  const filed = new Set((filedRows ?? []).map((r) => r.attachment_storage_path as string));
  const waiting = rows.filter((r) => !filed.has(r.storage_path as string));
  if (!waiting.length) return { ok: true, rows: [] };

  const uniq = (vals: (string | null)[]) => [...new Set(vals.filter((v): v is string => !!v))];
  const subIds = uniq(waiting.map((r) => r.subcontractor_id as string));
  const projectIds = uniq(waiting.map((r) => r.project_id as string | null));
  const reviewerIds = uniq(waiting.map((r) => r.reviewer_profile_id as string));
  const waitingPaths = waiting.map((r) => r.storage_path as string);

  const [subRes, projectRes, profileRes, urlRes] = await Promise.all([
    supabase.from("subcontractors").select("id, company_name, contact_name").in("id", subIds),
    projectIds.length
      ? supabase.from("projects").select("id, name, project_number").in("id", projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; project_number: string | null }[] }),
    supabase.from("profiles").select("id, full_name").in("id", reviewerIds),
    supabase.storage.from(BUCKET).createSignedUrls(waitingPaths, 3600),
  ]);
  const subName = new Map(
    (subRes.data ?? []).map((s) => [
      s.id as string,
      s.contact_name ? `${s.company_name} (${String(s.contact_name).split(" ")[0]})` : (s.company_name as string),
    ]),
  );
  const projectName = new Map(
    (projectRes.data ?? []).map((p) => [p.id as string, (p.name as string | null) || (p.project_number as string | null)]),
  );
  const reviewerName = new Map((profileRes.data ?? []).map((p) => [p.id as string, p.full_name as string | null]));
  const urls = new Map((urlRes.data ?? []).map((u) => [u.path as string, u.signedUrl as string]));

  return {
    ok: true,
    rows: waiting.map((r) => ({
      id: r.id as string,
      subName: subName.get(r.subcontractor_id as string) ?? "A sub",
      projectId: (r.project_id as string | null) ?? null,
      projectName: r.project_id ? (projectName.get(r.project_id as string) ?? null) : null,
      reviewerId: r.reviewer_profile_id as string,
      reviewerName: reviewerName.get(r.reviewer_profile_id as string) ?? null,
      mine: r.reviewer_profile_id === me.id,
      storagePath: r.storage_path as string,
      originalName: (r.original_name as string | null) ?? null,
      fileUrl: urls.get(r.storage_path as string) ?? null,
      receivedWeek: r.received_week as string,
      createdAt: r.created_at as string,
      aiRead: (r.ai_read as SubBillAiRead | null) ?? null,
      statedNumber: (r.sub_stated_number as string | null) ?? null,
      statedAmount: r.sub_stated_amount == null ? null : Number(r.sub_stated_amount),
    })),
  };
}

/**
 * Take a sub bill someone else is holding: MOVE the file into my own
 * field-captures folder (a move, not a copy, so it can't be filed twice)
 * and make me its reviewer. Then File it opens BillDrop on the new path.
 */
export async function takeSubBill(submissionId: string): Promise<Result<{ path: string }>> {
  const me = await officeUser();
  if ("error" in me) return { error: me.error };
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("sub_bill_submissions")
    .select("id, storage_path, reviewer_profile_id, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) return { error: "Could not load that bill. Please retry." };
  if (!row) return { error: "That bill is gone. Refresh the page." };
  if (row.status !== "sent") return { error: "That bill was sent back to the sub." };
  const from = row.storage_path as string;
  if (row.reviewer_profile_id === me.id && from.startsWith(`${me.id}/`)) return { ok: true, path: from };
  if (await isFiled(from)) return { error: "Someone already filed this bill. Refresh the page." };

  const fileName = from.split("/")[1];
  if (!fileName) return { error: "That bill's file path is not one the bill flow can open." };
  const to = `${me.id}/${fileName}`;

  // The move is the lock: if two people take it at once, the second move
  // finds nothing at the old path and fails.
  const { error: moveError } = await admin.storage.from(BUCKET).move(from, to);
  if (moveError) return { error: "Someone else just took it, or the file moved. Refresh the page." };

  const { data: updated, error: updateError } = await admin
    .from("sub_bill_submissions")
    .update({ storage_path: to, reviewer_profile_id: me.id })
    .eq("id", row.id)
    .eq("storage_path", from)
    .select("id");
  if (updateError || !updated?.length) {
    // Put the file back so the row and the file agree again.
    await admin.storage.from(BUCKET).move(to, from);
    return { error: "Could not take it. Refresh the page and try again." };
  }

  // A read the first reviewer's bill flow saved points at the old path, which
  // no longer exists. Dropping it means their old link says "no longer
  // available" instead of offering to file a bill whose file has moved.
  await admin.from("bill_scan_reads").delete().eq("storage_path", from);

  return { ok: true, path: to };
}

/** Send it back to the sub with a reason; he sees it under "Needed from you". */
export async function returnSubBill(submissionId: string, reason: string): Promise<Result> {
  const me = await officeUser();
  if ("error" in me) return { error: me.error };
  const why = String(reason ?? "").trim().slice(0, 500);
  if (why.length < 3) return { error: "Say why, so the sub knows what to fix." };
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("sub_bill_submissions")
    .select("id, storage_path, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) return { error: "Could not load that bill. Please retry." };
  if (!row) return { error: "That bill is gone. Refresh the page." };
  if (row.status !== "sent") return { error: "That bill was already sent back." };
  if (await isFiled(row.storage_path as string)) return { error: "This bill is already filed. Fix it from the bill instead." };

  const { data: updated, error: updateError } = await admin
    .from("sub_bill_submissions")
    .update({ status: "returned", returned_reason: why, returned_by: me.id, returned_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "sent")
    .select("id");
  if (updateError || !updated?.length) return { error: "Could not send it back. Refresh the page and try again." };
  return { ok: true };
}
