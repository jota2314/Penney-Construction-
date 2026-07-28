import { notFound } from "next/navigation";
import { VtoEditor } from "@/components/eos/vto-editor";
import { getEosContext, getVto, listIssues } from "@/lib/eos/queries";
import { currentQuarter } from "@/lib/constants/eos";

export default async function EosVtoPage() {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const [vto, openIssues] = await Promise.all([
    getVto(ctx),
    listIssues(ctx, { status: "open" }),
  ]);

  return (
    <>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        The V/TO is what Vision Building Day 1 produces (Thu 8/13) and Day 2
        finalises (Wed 9/23). Fill it in as the team agrees each piece — every
        card saves on its own.
      </div>
      <VtoEditor
        vto={vto}
        quarter={currentQuarter()}
        openIssues={openIssues.length}
      />
    </>
  );
}
