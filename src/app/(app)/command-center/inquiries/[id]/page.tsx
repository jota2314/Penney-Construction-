import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getWebsiteInquiry, listInquiryAssignees, listMatchingInquiryLeads } from "@/lib/actions/website-inquiries";
import { canManageWebsiteInquiries } from "@/lib/inquiries/model";
import { InquiryDetail } from "@/components/inquiries/inquiry-detail";

export const metadata: Metadata = { title: "Inquiry | Penney Construction" };
export default async function WebsiteInquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (!canManageWebsiteInquiries(user.profile?.role) || !canManageWebsiteInquiries(user.realProfile?.role)) redirect("/command-center");
  const { id } = await params;
  const [inquiry, assignees, matchingLeads] = await Promise.all([getWebsiteInquiry(id), listInquiryAssignees(), listMatchingInquiryLeads(id)]);
  if (!inquiry) notFound();
  return <><Header title="Website inquiry" backHref="/command-center/inquiries" /><div className="flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl"><InquiryDetail key={`${inquiry.id}:${inquiry.updated_at}`} inquiry={inquiry} assignees={assignees} matchingLeads={matchingLeads} readOnly={!!user.isImpersonating} /></div></div></>;
}
