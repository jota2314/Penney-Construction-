import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { EmailDraftReview, type DraftReviewData } from "@/components/command-center/email-draft-review";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Review Email | Penney Construction" };

interface DraftRow {
  id: string;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  bcc_emails: string[] | null;
  subject: string | null;
  body: string | null;
  file_ids: string[] | null;
  project_id: string | null;
  status: string;
  origin: string | null;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

export default async function EmailDraftPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const { data: draftRaw } = await supabase
    .from("email_drafts")
    .select(
      "id, to_emails, cc_emails, bcc_emails, subject, body, file_ids, project_id, status, origin",
    )
    .eq("id", id)
    .maybeSingle<DraftRow>();

  if (!draftRaw) return notFound();
  const draft = draftRaw;

  // Already-sent / discarded drafts: show a terminal state instead of an editor.
  if (draft.status === "discarded") {
    return (
      <TerminalState
        title="Draft discarded"
        message="This draft was discarded and is no longer available to send."
      />
    );
  }

  let projectName: string | null = null;
  if (draft.project_id) {
    const { data: p } = await supabase
      .from("projects")
      .select("name")
      .eq("id", draft.project_id)
      .maybeSingle<{ name: string }>();
    projectName = p?.name ?? null;
  }

  let attachmentNames: string[] = [];
  const fileIds = asArray(draft.file_ids);
  if (fileIds.length > 0) {
    const { data: files } = await supabase
      .from("project_files")
      .select("filename")
      .in("id", fileIds)
      .returns<{ filename: string }[]>();
    attachmentNames = (files || []).map((f) => f.filename);
  }

  const data: DraftReviewData = {
    id: draft.id,
    to: asArray(draft.to_emails),
    cc: asArray(draft.cc_emails),
    bcc: asArray(draft.bcc_emails),
    subject: draft.subject ?? "",
    body: draft.body ?? "",
    status: draft.status,
    projectName,
    attachmentNames,
    origin: draft.origin,
  };

  return (
    <div className="min-h-screen">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <Link
            href="/command-center/emails"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Inbox
          </Link>
        </div>
      </div>
      <EmailDraftReview draft={data} />
    </div>
  );
}

function TerminalState({ title, message }: { title: string; message: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
      <h1 className="text-xl font-semibold mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-6">{message}</p>
      <Link
        href="/command-center/emails"
        className="inline-flex items-center gap-1.5 text-sm text-amber-500 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Inbox
      </Link>
    </div>
  );
}
