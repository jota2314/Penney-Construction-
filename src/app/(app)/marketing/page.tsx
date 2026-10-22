import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { MarketingLibrary } from "@/components/marketing/marketing-library";
import { getMarketingLibrary } from "@/lib/actions/marketing";

export const metadata: Metadata = { title: "Marketing | Penney Construction" };

export default async function MarketingPage() {
  const library = await getMarketingLibrary();
  return <><Header title="Marketing" /><MarketingLibrary initialItems={library.items} projects={library.projects} initialError={library.error} /></>;
}
