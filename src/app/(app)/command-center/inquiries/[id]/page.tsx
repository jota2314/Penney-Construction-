import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getWebsiteInquiry, listInquiryAssignees, listMatchingInquiryLeads } from "@/lib/actions/website-inquiries";
import { canManageWebsiteInquiries } from "@/lib/inquiries/model";
import { InquiryDetail } from "@/components/inquiries/inquiry-detail";
import { listWebsiteInquiryEmails, type WebsiteInquiryEmail } from "@/lib/actions/website-inquiry-email";

export const metadata: Metadata = { title: "Inquiry | Penney Construction" };
export default async function WebsiteInquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (!canManageWebsiteInquiries(user.profile?.email) || !canManageWebsiteInquiries(user.realProfile?.email)) redirect("/command-center");
  const { id } = await params;
  const [inquiry, assignees, matchingLeads] = await Promise.all([getWebsiteInquiry(id), listInquiryAssignees(), listMatchingInquiryLeads(id)]);
  if (!inquiry) notFound();
  let emailHistory: WebsiteInquiryEmail[] | null = null;
  try { emailHistory = await listWebsiteInquiryEmails(id); } catch { /* Keep the inquiry visible, but block sending until its history can be checked. */ }
  return <><Header title="Website inquiry" backHref="/command-center/inquiries" /><div className="flex-1 overflow-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl"><InquiryDetail key={`${inquiry.id}:${inquiry.updated_at}`} inquiry={inquiry} assignees={assignees} matchingLeads={matchingLeads} readOnly={!!user.isImpersonating} senderName={user.realProfile?.full_name || "Penney Construction"} emailHistory={emailHistory} /></div></div></>;
}
