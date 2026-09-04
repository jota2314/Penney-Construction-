import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmailDetail } from "@/components/command-center/email-detail";
import { isInMailbox, viewerDirection } from "@/lib/email/mailbox-scope";

export const metadata: Metadata = { title: "Email Detail | Penney Construction" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnUrl?: string }>;
}

export default async function EmailDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { returnUrl } = await searchParams;
  const authUser = await requireAuth();
  const supabase = await createClient();
  const userName = authUser.profile?.full_name || authUser.email.split("@")[0];

  const { data: email } = await supabase
    .from("inbox_emails")
    .select("*")
    .eq("id", id)
    .single();

  if (!email) notFound();

  // Scope: a user can only open emails from their own inbox — owned OR
  // stamped into their mailbox (a teammate's sync stored it first).
  // Honor impersonation — profile.id is the effective user.
  // Project-context views still see everyone's emails because they
  // query by project_id, not by email id directly.
  const effectiveUserId = authUser.profile?.id ?? authUser.id;
  if (email.created_by && !isInMailbox(email, effectiveUserId)) notFound();
  email.direction = viewerDirection(
    email,
    effectiveUserId,
    authUser.profile?.email ?? authUser.email,
  );

  // Everything below depends only on the email row, so run it concurrently.
  // This keeps opening an email to two database round trips instead of a
  // projects → matched entities → conversation waterfall.
  const [projectsRes, customerRes, subRes, conversationRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, project_type")
      .order("name"),
    email.matched_customer_id
      ? supabase
          .from("customers")
          .select("id, first_name, last_name")
          .eq("id", email.matched_customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null as null | { id: string; first_name: string | null; last_name: string | null } }),
    email.matched_subcontractor_id
      ? supabase
          .from("subcontractors")
          .select("id, company_name")
          .eq("id", email.matched_subcontractor_id)
          .maybeSingle()
      : Promise.resolve({ data: null as null | { id: string; company_name: string | null } }),
    supabase
      .from("conversations")
      .select("id")
      .eq("inbox_email_id", id)
      .maybeSingle(),
  ]);
  const projects = projectsRes.data ?? [];
  const conversation = conversationRes.data;

  const matchedNames = {
    customer: customerRes.data
      ? `${customerRes.data.first_name ?? ""} ${customerRes.data.last_name ?? ""}`.trim() || null
      : null,
    sub: subRes.data?.company_name ?? null,
    project:
      (email.matched_project_id &&
        projects?.find((p) => p.id === email.matched_project_id)?.name) ||
      null,
  };

  let existingMessages: {
    id: string;
    role: string;
    content: string;
    source: string | null;
    metadata: Record<string, unknown> | null;
  }[] = [];

  if (conversation) {
    const { data: msgs } = await supabase
      .from("conversation_messages")
      .select("id, role, content, source, metadata")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });
    existingMessages = msgs ?? [];
  }

  return (
    <>
      <Header title="Email" backHref={returnUrl || "/command-center/emails"} backLabel="Inbox" />
      <EmailDetail
        email={email}
        projects={projects ?? []}
        userName={userName}
        backUrl={returnUrl || undefined}
        matchedNames={matchedNames}
        existingConversation={
          conversation
            ? { id: conversation.id, messages: existingMessages }
            : null
        }
      />
    </>
  );
}
