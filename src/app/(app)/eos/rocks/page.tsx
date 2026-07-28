import { notFound } from "next/navigation";
import { RocksBoard } from "@/components/eos/rocks-board";
import { getEosContext, listRockQuarters, listRocks } from "@/lib/eos/queries";
import { currentQuarter } from "@/lib/constants/eos";

export default async function EosRocksPage({
  searchParams,
}: {
  searchParams: Promise<{ quarter?: string }>;
}) {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const { quarter: requested } = await searchParams;
  const quarters = await listRockQuarters(ctx);
  const quarter =
    requested && quarters.includes(requested) ? requested : currentQuarter();
  const rocks = await listRocks(ctx, quarter);

  return (
    <RocksBoard
      rocks={rocks}
      people={ctx.people}
      quarter={quarter}
      quarters={quarters}
    />
  );
}
