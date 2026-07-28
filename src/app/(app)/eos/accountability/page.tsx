import { notFound } from "next/navigation";
import { AccountabilityChart } from "@/components/eos/accountability-chart";
import { getEosContext, listSeats } from "@/lib/eos/queries";

export default async function EosAccountabilityPage() {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const seats = await listSeats(ctx);

  return <AccountabilityChart seats={seats} people={ctx.people} />;
}
