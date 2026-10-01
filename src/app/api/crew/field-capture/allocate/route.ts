import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { askClaude } from "@/lib/bills/model";
import { ownsBillUpload, loadBillRead } from "@/lib/bills/read-store";
import type {
  CrewRead,
  CrewAllocation,
  CrewBudgetLine,
  CrewAllocateResponse,
} from "@/lib/crew/receipt-scan-types";

export const runtime = "nodejs";
export const maxDuration = 60;
const ALLOCATE_BUDGET_MS = 50_000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * SPLIT a read receipt across one job's budget lines. Writes nothing.
 *
 * Runs after ./ (the read) and again whenever the crew member changes the job —
 * it reuses the saved read, so changing the job costs a couple of seconds
 * instead of re-reading the photo. A failed split never costs the read: the
 * screen gets the job's budget lines either way and the crew picks by hand.
 */

type LineRow = {
  id: string;
  description: string;
  trade: string | null;
  total_cost: number | null;
  section: string | null;
  change_order_id: string | null;
  change_orders: { change_order_number: number | null } | Array<{ change_order_number: number | null }> | null;
};

/** "CO #6 · " for a change-order line, "" for base scope. */
function coPrefix(l: LineRow): string {
  if (!l.change_order_id) return "";
  const co = Array.isArray(l.change_orders) ? l.change_orders[0] : l.change_orders;
  return co?.change_order_number ? `CO #${co.change_order_number} · ` : "CO · ";
}

export async function POST(request: NextRequest) {
  const deadline = Date.now() + ALLOCATE_BUDGET_MS;
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) {
    return NextResponse.json({ error: "Not signed in — open the app again." }, { status: 401 });
  }

  try {
    const input = await request.json();
    const storagePath = String(input?.storagePath ?? "");
    const projectId = typeof input?.projectId === "string" ? input.projectId.trim() : "";
    if (!ownsBillUpload(profileId, storagePath)) {
      return NextResponse.json({ error: "That receipt belongs to someone else." }, { status: 403 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "Pick the job first." }, { status: 400 });
    }

    const read = (await loadBillRead(profileId, storagePath)) as CrewRead | null;
    if (!read) {
      return NextResponse.json({ error: "Scan this receipt first." }, { status: 409 });
    }
    const scan = read.scan;

    const supabase = await createClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_number")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) {
      return NextResponse.json({ error: "That job wasn't found — pick it again." }, { status: 404 });
    }
    const job = {
      id: project.id,
      label: project.project_number ? `${project.project_number} ${project.name}` : project.name,
    };

    // The crew member may have corrected the total before the split ran.
    const amount =
      typeof input?.amount === "number" && Number.isFinite(input.amount) && input.amount !== 0
        ? round2(input.amount)
        : scan.amount;
    const isCredit = Boolean(scan.isCredit) || (amount !== null && amount < 0);

    // Ask the canonical pointer which estimate IS this job's budget — a signed
    // job's estimate is 'accepted', which the old status filter missed.
    const { data: estimateId, error: estimateError } = await supabase.rpc("current_estimate_id", {
      p_project_id: projectId,
    });
    if (estimateError) {
      return NextResponse.json(
        { error: "Couldn't load the job's budget lines. Tap Retry." },
        { status: 503 },
      );
    }

    let lines: LineRow[] = [];
    if (estimateId) {
      const { data, error } = await supabase
        .from("estimate_line_items")
        .select(
          "id, description, trade, total_cost, section, change_order_id, change_orders:change_order_id(change_order_number)",
        )
        .eq("estimate_id", estimateId as string)
        .eq("is_section_header", false)
        .order("sort_order", { ascending: true })
        .limit(300);
      if (error) {
        return NextResponse.json(
          { error: "Couldn't load the job's budget lines. Tap Retry." },
          { status: 503 },
        );
      }
      lines = (data ?? []) as LineRow[];
    }

    // Change-order lines after base scope, each named by its CO so the two
    // can be told apart on a phone.
    const budgetLines: CrewBudgetLine[] = [...lines]
      .sort((a, b) => Number(Boolean(a.change_order_id)) - Number(Boolean(b.change_order_id)))
      .map((l) => ({
        id: l.id,
        description: coPrefix(l) + (l.description ?? "").trim(),
        trade: l.trade ?? null,
        section: l.section ?? null,
        isChangeOrder: Boolean(l.change_order_id),
      }));
    const labelOf = new Map(budgetLines.map((l) => [l.id, l]));

    const respond = (
      allocations: CrewAllocation[],
      allocationStatus: CrewAllocateResponse["allocationStatus"],
      allocationError?: string,
    ) => {
      const body: CrewAllocateResponse = {
        job,
        // Back to the slip's own sign, so a credit stays a credit.
        allocations: isCredit
          ? allocations.map((a) => ({ ...a, amount: round2(-Math.abs(a.amount)) }))
          : allocations,
        budgetLines,
        allocationStatus,
        ...(allocationError ? { allocationError } : {}),
      };
      return NextResponse.json(body);
    };

    // A delivery ticket carries no money, and a quote's money was never spent.
    if (amount === null || ["quote", "delivery_ticket"].includes(scan.documentType)) {
      return respond([], "not_required");
    }
    if (lines.length === 0) {
      return respond([], "failed", "This job has no budget lines yet — it files to the job and the office places it.");
    }

    const allocTotal = Math.abs(amount);

    // A fill-up goes on the overhead Fuel line whole — no model call needed.
    if (scan.fuelAutoRouted && projectId === read.suggestedProjectId) {
      const fuelLine = lines.find((l) => /fuel|gas/i.test(l.description ?? ""));
      if (fuelLine) {
        return respond(
          [{
            lineItemId: fuelLine.id,
            lineLabel: labelOf.get(fuelLine.id)?.description ?? fuelLine.description,
            trade: fuelLine.trade ?? null,
            amount: allocTotal,
            note: "Gas",
          }],
          "complete",
        );
      }
    }

    const itemText = scan.items.length
      ? scan.items.map((i) => `- ${i.description} | ${i.amount ?? "?"} | ${i.trade ?? "?"}`).join("\n")
      : "(no itemization readable)";

    const allocPrompt = `A ${scan.vendor} ${isCredit ? "return credit" : "receipt"} for $${allocTotal} on job "${job.label}".
What was bought: ${scan.summary ?? "unknown"}

Items read off the receipt (description | amount | trade):
${itemText}

Receipt text:
${(scan.extractedText ?? "").slice(0, 4000)}

Budget lines on this job (id | description | trade | budget):
${lines.map((l) => `${l.id} | ${coPrefix(l)}${l.description} | ${l.trade ?? "-"} | ${l.total_cost}`).join("\n")}

Split this ${isCredit ? "credit across the budget lines the returned material was bought on" : "receipt across the budget lines it actually paid for"}. Material bought for a trade belongs on that trade's line. One store run often covers several trades — split it when it did, and return a single allocation when it didn't.

Rules:
- the amounts MUST sum to exactly ${allocTotal}
- put tax and any unattributable remainder on the largest allocation
- only use line ids from the list above
- if nothing in the list genuinely fits, return {"allocations": []} — a wrong line is worse than none

Return ONLY JSON: {"allocations": [{"line_item_id": "<uuid>", "amount": <number>, "note": "<what this covers, 6 words max>"}]}`;

    const proposal = await askClaude([{ type: "text", text: allocPrompt }], 1500, deadline, "allocation");
    if (!proposal || !Array.isArray(proposal.allocations)) {
      return respond([], "failed", "Couldn't match a budget line automatically — pick one below.");
    }

    const byId = new Map(lines.map((l) => [l.id, l]));
    const merged = new Map<string, { amount: number; note: string | null }>();
    for (const raw of proposal.allocations as Array<Record<string, unknown>>) {
      const id = String(raw?.line_item_id ?? "");
      const amt = typeof raw?.amount === "number" && Number.isFinite(raw.amount) ? round2(raw.amount) : 0;
      if (!byId.has(id) || amt <= 0) continue;
      const prior = merged.get(id);
      merged.set(id, {
        amount: round2((prior?.amount ?? 0) + amt),
        note: prior?.note ?? (typeof raw?.note === "string" ? raw.note : null),
      });
    }

    const allocations: CrewAllocation[] = [...merged.entries()].map(([lineItemId, v]) => ({
      lineItemId,
      lineLabel: labelOf.get(lineItemId)?.description ?? "Budget line",
      trade: byId.get(lineItemId)?.trade ?? null,
      amount: v.amount,
      note: v.note,
    }));

    // The split has to add up to the receipt. Small drift (rounding, tax) goes
    // on the biggest line; a split that's badly off is dropped rather than
    // shipped — the crew picks the line instead.
    const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
    if (allocations.length > 0 && Math.abs(sum - allocTotal) > 0.05) {
      return respond([], "failed", "Couldn't match a budget line automatically — pick one below.");
    }
    if (allocations.length > 0 && sum !== allocTotal) {
      const biggest = allocations.reduce((best, a, i) => (a.amount > allocations[best].amount ? i : best), 0);
      allocations[biggest].amount = round2(allocations[biggest].amount + allocTotal - sum);
    }

    return respond(allocations, allocations.length > 0 ? "complete" : "failed",
      allocations.length > 0 ? undefined : "Nothing on this job's budget clearly fits — pick a line below.");
  } catch (err) {
    console.error("[field-capture] allocate failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Couldn't match budget lines. Tap Retry, or pick one by hand." },
      { status: 503 },
    );
  }
}
