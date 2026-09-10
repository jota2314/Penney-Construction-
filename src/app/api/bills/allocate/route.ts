import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { askClaude } from "@/lib/bills/model";
import { ownsBillUpload, loadBillRead, billReadResponse } from "@/lib/bills/read-store";

export const runtime = "nodejs";
export const maxDuration = 120;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "CO #6 · " for a change-order line, "" for base scope. */
function coPrefix(l: { change_order_id?: string | null; change_orders?: unknown }): string {
  if (!l.change_order_id) return "";
  const co = (Array.isArray(l.change_orders) ? l.change_orders[0] : l.change_orders) as
    | { change_order_number: number | null }
    | null
    | undefined;
  return co?.change_order_number ? `CO #${co.change_order_number} · ` : "CO · ";
}

export async function POST(request: NextRequest) {
  const deadline = Date.now() + 105_000;
  const user = await getUser();
  const owner = user?.profile?.id ?? user?.id;
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const input = await request.json();
    const path = String(input.storagePath ?? "");
    if (!ownsBillUpload(owner, path)) return NextResponse.json({ error: "Not your upload" }, { status: 403 });
    const read = await loadBillRead(owner, path);
    if (!read) return NextResponse.json({ error: "Read this saved file before dividing it." }, { status: 409 });
    const result = await billReadResponse(read, typeof input.projectId === "string" ? input.projectId : null);
    if (input.amount !== undefined) {
      if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount === 0) {
        return NextResponse.json({ error: "Enter a valid invoice total." }, { status: 400 });
      }
      result.scan.amount = round2(input.amount);
    }
    if (!result.job || ["quote", "delivery_ticket"].includes(result.scan.documentType) || result.scan.amount === null) return NextResponse.json(result);
    const { scan, job } = result;
    const amount = scan.amount!;
    const projectId = job.id;
    const vendorName = scan.vendor;
    const items = scan.items;
    const creditCheck = { isCredit: amount < 0 };
    const fuelAutoRouted = scan.fuelAutoRouted;
    const extracted = { summary: scan.summary, extracted_text: scan.extractedText };
    const supabase = await createClient();
    let allocationFailed = false;
    // --- Allocate across the job's budget lines (current_estimate_id is the
    // canonical pointer — see the field-capture scan for the history) --------
    //
    // The splitter reasons in DOLLARS SPENT, so a credit is allocated on its
    // magnitude and the signs are flipped once at the end — asking the model
    // to sum to a negative is how you get a split that doesn't add up.
    const allocTotal = Math.abs(amount);
    const { data: estimateId, error: estimateError } = await supabase.rpc("current_estimate_id", {
      p_project_id: projectId,
    });

    if (estimateError) throw new Error("Could not load the job budget. Retry dividing the saved invoice.");

    let allocations: Array<{
      lineItemId: string;
      lineLabel: string;
      trade: string | null;
      amount: number;
      note: string | null;
    }> = [];
    // The job's budget lines ride back so the confirm card can re-point or
    // split an allocation the AI got wrong before anything books.
    let budgetLines: Array<{ id: string; description: string; trade: string | null }> = [];

    if (estimateId) {
      const { data: lines, error: linesError } = await supabase
        .from("estimate_line_items")
        .select("id, description, trade, total_cost, change_order_id, change_orders:change_order_id(change_order_number)")
        .eq("estimate_id", estimateId as string)
        .eq("is_section_header", false)
        .limit(200);

      if (linesError) throw new Error("Could not load budget lines. Retry dividing the saved invoice.");

      // A change-order line is named by its CO so it can be told apart from
      // the base scope in the confirm card's dropdown.
      budgetLines = (lines ?? []).map((l) => ({
        id: l.id,
        description: coPrefix(l) + l.description,
        trade: l.trade ?? null,
      }));

      // A fill-up goes on the overhead Fuel line whole — no model call needed.
      if (fuelAutoRouted && lines && lines.length > 0) {
        const fuelLine = lines.find((l) => /fuel|gas/i.test(l.description ?? ""));
        if (fuelLine) {
          allocations = [
            {
              lineItemId: fuelLine.id,
              lineLabel: fuelLine.description,
              trade: fuelLine.trade ?? null,
              amount,
              note: "Gas",
            },
          ];
        }
      }

      if (allocations.length === 0 && lines && lines.length > 0) {
        const itemText = items.length
          ? items
              .map((i) => `- ${i.description} | ${i.amount ?? "?"} | ${i.trade ?? "?"}`)
              .join("\n")
          : "(no itemization readable)";

        const allocPrompt = `A ${vendorName} ${creditCheck.isCredit ? "credit memo" : "bill"} for $${allocTotal} on job "${job.label}".
What it covers: ${extracted.summary ?? "unknown"}

Line items (description | amount | trade):
${itemText}

Bill text:
${(extracted.extracted_text ?? "").slice(0, 4000)}

Budget lines on this job (id | description | trade | budget):
${lines.map((l) => `${l.id} | ${l.description} | ${l.trade ?? "-"} | ${l.total_cost}`).join("\n")}

Split this ${creditCheck.isCredit ? "credit across the budget lines the original charges came off" : "bill across the budget lines it actually covers"}. A sub's bill usually lands whole on that trade's line; a supplier run can split across trades.

Rules:
- the amounts MUST sum to exactly ${allocTotal}
- put tax and any unattributable remainder on the largest allocation
- only use line ids from the list above
- if nothing in the list genuinely fits, return {"allocations": []} — a wrong line is worse than none

Return ONLY JSON: {"allocations": [{"line_item_id": "<uuid>", "amount": <number>, "note": "<what this covers, 6 words max>"}]}`;

        const proposal = await askClaude([{ type: "text", text: allocPrompt }], 1500, deadline, "allocation");
        allocationFailed = !Array.isArray(proposal?.allocations);
        const raw = Array.isArray(proposal?.allocations)
          ? (proposal.allocations as Array<Record<string, unknown>>)
          : [];

        const byId = new Map(lines.map((l) => [l.id, l]));
        const cleaned = raw
          .map((a) => ({
            lineItemId: String(a?.line_item_id ?? ""),
            amount:
              typeof a?.amount === "number" && Number.isFinite(a.amount) ? round2(a.amount) : 0,
            note: typeof a?.note === "string" ? a.note : null,
          }))
          .filter((a) => byId.has(a.lineItemId) && a.amount > 0);

        if (cleaned.length !== raw.length) allocationFailed = true;

        const merged = new Map<string, { amount: number; note: string | null }>();
        for (const a of cleaned) {
          const prior = merged.get(a.lineItemId);
          merged.set(a.lineItemId, {
            amount: round2((prior?.amount ?? 0) + a.amount),
            note: prior?.note ?? a.note,
          });
        }

        allocations = [...merged.entries()].map(([lineItemId, v]) => ({
          lineItemId,
          lineLabel: byId.get(lineItemId)?.description ?? "Budget line",
          trade: byId.get(lineItemId)?.trade ?? null,
          amount: v.amount,
          note: v.note,
        }));

        const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
        if (allocations.length > 0 && Math.abs(sum - allocTotal) > 0.02) {
          allocationFailed = true;
        } else if (allocations.length > 0 && sum !== allocTotal) {
          const biggest = allocations.reduce((best, a, i) => a.amount > allocations[best].amount ? i : best, 0);
          allocations[biggest].amount = round2(allocations[biggest].amount + allocTotal - sum);
        }
        if (allocationFailed) allocations = [];
      }

      // Back to the document's own sign, so the confirm card and the commit
      // route both see a credit as a credit.
      if (creditCheck.isCredit) {
        allocations = allocations.map((a) => ({ ...a, amount: round2(-Math.abs(a.amount)) }));
      }
    }

    return NextResponse.json({ ...result, allocations, budgetLines,
      allocationStatus: allocationFailed ? "failed" : "complete",
      ...(allocationFailed ? { allocationError: "The invoice is read and saved, but its budget split did not finish. Retry dividing it or choose the budget lines below." } : {}),
    });
  } catch (error) {
    console.warn("bill_allocation_failed", { type: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Could not divide the invoice. Its saved read is safe; please retry." }, { status: 503 });
  }
}
