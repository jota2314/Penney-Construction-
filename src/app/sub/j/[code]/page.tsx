import { SiteJoin } from "@/components/sub-portal/site-join";

/**
 * /sub/j/{code} — where a job's site QR lands. Public like the rest of /sub;
 * everything behind it is validated by /api/sub-portal/site.
 */
export default async function SubSiteQrPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <SiteJoin code={code} />;
}
