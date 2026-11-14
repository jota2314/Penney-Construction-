import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { listWebsiteInquiries, listInquiryAssignees } from "@/lib/actions/website-inquiries";
import { canManageWebsiteInquiries, isRyan } from "@/lib/inquiries/model";
import { InquiryList } from "@/components/inquiries/inquiry-list";
import { CalendarConnectionBanner } from "@/components/inquiries/calendar-connection-banner";

export const metadata: Metadata = { title: "Website inquiries | Penney Construction" };
export default async function WebsiteInquiriesPage({ searchParams }: { searchParams: Promise<{ calendar?: string | string[] }> }) {
  const user = await requireAuth();
  if (!canManageWebsiteInquiries(user.profile?.email) || !canManageWebsiteInquiries(user.realProfile?.email)) redirect("/command-center");
  const { calendar } = await searchParams;
  let rows; let assignees: string[] = []; let failed = false;
  try { [rows, assignees] = await Promise.all([listWebsiteInquiries(), listInquiryAssignees()]); } catch { failed = true; }
  // One server snapshot keeps age/overdue labels identical during hydration.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return <><Header title="Website inquiries" backHref="/command-center" /><div className="flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-4">
    {/* The calendar check talks to Google, so it streams in on its own and never delays the leads. */}
    <Suspense fallback={null}><CalendarConnectionBanner viewerIsRyan={!user.isImpersonating && isRyan(user.realProfile?.email)} readOnly={!!user.isImpersonating} attempt={typeof calendar === "string" ? calendar : ""} /></Suspense>
    {failed ? <p role="alert" className="rounded-xl border p-5">The inquiry queue could not be loaded. Refresh to retry; no records have been changed.</p> : <InquiryList rows={rows || []} now={now} assignees={assignees} senderName={user.realProfile?.full_name || "Penney Construction"} readOnly={!!user.isImpersonating} />}
  </div></div></>;
}
