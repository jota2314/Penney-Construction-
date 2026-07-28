import { notFound } from "next/navigation";
import { ScorecardGrid } from "@/components/eos/scorecard-grid";
import { getEosContext, listMeasurables } from "@/lib/eos/queries";
import { recentWeeks } from "@/lib/constants/eos";

export default async function EosScorecardPage() {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const weeks = recentWeeks(13);
  const measurables = await listMeasurables(ctx, weeks);

  return (
    <ScorecardGrid measurables={measurables} weeks={weeks} people={ctx.people} />
  );
}
