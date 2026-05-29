"use server";

/**
 * Job ledger server actions: pull each project's real money in/out from
 * its Google Sheet ledger in the Shared Drive and store it in
 * job_ledger_entries so the app can show deposits, expenses, and cash
 * balance without anyone re-typing the numbers.
 *
 * Pure parsing helpers + types live in "@/lib/ledger/parse" because a
 * "use server" module may only export async functions.
 */

import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { readSheetValues, findSheetsByName } from "@/lib/google/sheets";
import {
  parseLedgerRows,
  type ParsedRow,
  type LedgerEntry,
  type LedgerSummary,
} from "@/lib/ledger/parse";
import { revalidatePath } from "next/cache";

function refFor(projectId: string, r: ParsedRow): string {
  return createHash("sha1")
    .update(`${projectId}|${r.entry_date}|${r.description}|${r.amount}`)
    .digest("hex");
}

/** Last name of a project's primary customer — used to find its ledger. */
async function customerLastName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("name, customers:customer_id(last_name)")
    .eq("id", projectId)
    .single();
  const fromCustomer = (data?.customers as { last_name?: string } | null)
    ?.last_name;
  if (fromCustomer) return fromCustomer;
  // Fall back to the first word of the project name ("Gouthro Addition").
  return data?.name?.split(/\s+/)[0] || null;
}

/**
 * Find and link a Drive ledger sheet to a project by name
 * ("<LastName> Ledger"). Returns the linked file, or null if none found.
 */
export async function autoDiscoverLedger(projectId: string): Promise<{
  fileId?: string;
  url?: string;
  error?: string;
}> {
  const supabase = await createClient();
  const last = await customerLastName(supabase, projectId);
  if (!last) return { error: "Could not determine customer name" };

  let matches;
  try {
    matches = await findSheetsByName(`${last} Ledger`);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Drive search failed" };
  }
  if (!matches.length) return { error: `No "${last} Ledger" sheet in Drive` };

  // Already filtered to native Google Sheets, most recently modified first.
  const best = matches[0];
  await supabase
    .from("projects")
    .update({ ledger_drive_file_id: best.id, ledger_drive_url: best.webViewLink })
    .eq("id", projectId);

  return { fileId: best.id, url: best.webViewLink };
}

/**
 * Read the linked Google Sheet ledger and upsert its rows into
 * job_ledger_entries (deduped by external_ref). Auto-discovers the
 * sheet first if the project isn't linked yet.
 */
export async function syncProjectLedger(projectId: string): Promise<{
  error?: string;
  synced?: number;
  summary?: LedgerSummary;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  let { data: project } = await supabase
    .from("projects")
    .select("ledger_drive_file_id")
    .eq("id", projectId)
    .single();

  if (!project?.ledger_drive_file_id) {
    const found = await autoDiscoverLedger(projectId);
    if (found.error) return { error: found.error };
    project = { ledger_drive_file_id: found.fileId! };
  }

  let rows: string[][];
  try {
    rows = await readSheetValues(project.ledger_drive_file_id!);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to read ledger" };
  }

  const parsed = parseLedgerRows(rows);
  const now = new Date().toISOString();
  const records = parsed.map((r) => ({
    project_id: projectId,
    entry_date: r.entry_date,
    description: r.description,
    amount: r.amount,
    direction: r.direction,
    source: "drive_sync",
    external_ref: refFor(projectId, r),
    synced_at: now,
    created_by: user.id,
  }));

  if (records.length) {
    const { error } = await supabase
      .from("job_ledger_entries")
      .upsert(records, { onConflict: "project_id,external_ref" });
    if (error) return { error: error.message };
  }

  const { data: summary } = await supabase
    .from("job_ledger_summary")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  revalidatePath(`/projects/${projectId}`);
  return { synced: records.length, summary: summary as LedgerSummary };
}

/** Fetch a project's ledger entries + summary for display. */
export async function getProjectLedger(projectId: string): Promise<{
  summary: LedgerSummary | null;
  entries: LedgerEntry[];
  ledgerUrl: string | null;
  error?: string;
}> {
  const supabase = await createClient();

  const [{ data: project }, { data: summary }, { data: entries }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("ledger_drive_url")
        .eq("id", projectId)
        .single(),
      supabase
        .from("job_ledger_summary")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle(),
      supabase
        .from("job_ledger_entries")
        .select("id, entry_date, description, amount, direction, category, source")
        .eq("project_id", projectId)
        .order("entry_date", { ascending: false, nullsFirst: false }),
    ]);

  return {
    summary: (summary as LedgerSummary) || null,
    entries: (entries as LedgerEntry[]) || [],
    ledgerUrl: project?.ledger_drive_url || null,
  };
}
