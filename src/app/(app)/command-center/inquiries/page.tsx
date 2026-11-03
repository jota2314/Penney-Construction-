import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { listWebsiteInquiries } from "@/lib/actions/website-inquiries";
import { canManageWebsiteInquiries } from "@/lib/inquiries/model";
import { InquiryList } from "@/components/inquiries/inquiry-list";

export const metadata: Metadata = { title: "Website inquiries | Penney Construction" };
export default async function WebsiteInquiriesPage() {
  const user = await requireAuth();
  if (!canManageWebsiteInquiries(user.profile?.role) || !canManageWebsiteInquiries(user.realProfile?.role)) redirect("/command-center");
  let rows; let failed = false;
  try { rows = await listWebsiteInquiries(); } catch { failed = true; }
  // One server snapshot keeps age/overdue labels identical during hydration.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return <><Header title="Website inquiries" backHref="/command-center" /><div className="flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl">{failed ? <p role="alert" className="rounded-xl border p-5">The inquiry queue could not be loaded. Refresh to retry; no records have been changed.</p> : <InquiryList rows={rows || []} now={now} />}</div></div></>;
}
