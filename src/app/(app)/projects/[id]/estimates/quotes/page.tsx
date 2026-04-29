import { redirect } from "next/navigation";

// The bids workspace moved to /projects/[id]/bids — line-item-grouped, single page for bids+quotes.
export default async function LegacyProjectQuotesRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/bids`);
}
