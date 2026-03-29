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
  await requireAuth();
  const supabase = await createClient();

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

  return (
    <>
      <Header title="Email" />
      <EmailDetail email={email} projects={projects ?? []} />
    </>
  );
}
