import { redirect } from "next/navigation";

// Quotes and bids merged into one workspace at /bids (cross-project rollup → /projects/[id]/bids).
export default async function LegacyQuotesRedirect() {
  redirect("/bids");
}
