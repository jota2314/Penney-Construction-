import { createAdminClient } from "@/lib/supabase/admin";
import { getSubPortalLoomUrl } from "@/lib/sub-portal/site-code";
import { SubLogin } from "./sub-login";

// The office can set or change the "Watch how" video; re-read it every few minutes.
export const revalidate = 300;

/**
 * /sub — subcontractor sign-in. The form is the client component in
 * sub-login.tsx; this only looks up the 1-minute "how to" Loom
 * (app_settings.sub_portal_loom_url) so a new sub can watch it before his
 * first sign-in. No Loom set, or the lookup fails: the link is just left off.
 */
export default async function SubLoginPage() {
  let loomUrl: string | null = null;
  try {
    loomUrl = await getSubPortalLoomUrl(createAdminClient());
  } catch {
    loomUrl = null;
  }
  return <SubLogin loomUrl={loomUrl} />;
}
