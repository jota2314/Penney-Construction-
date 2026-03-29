import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmailDetail } from "@/components/command-center/email-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EmailDetailPage({ params }: Props) {
  const { id } = await params;
  const authUser = await requireAuth();
  const supabase = await createClient();
  const userName = authUser.profile?.full_name || authUser.email.split("@")[0];

  const { data: email } = await supabase
    .from("inbox_emails")
    .select("*")
    .eq("id", id)
    .single();

  if (!email) notFound();

  // Get existing projects for context
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, project_type")
    .order("name");

  // Load existing conversation for this email (if any)
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("inbox_email_id", id)
    .single();

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
      <Header title="Email" />
      <EmailDetail
        email={email}
        projects={projects ?? []}
        userName={userName}
        existingConversation={
          conversation
            ? { id: conversation.id, messages: existingMessages }
            : null
        }
      />
    </>
  );
}
