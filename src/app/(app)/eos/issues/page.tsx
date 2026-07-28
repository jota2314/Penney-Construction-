import { notFound } from "next/navigation";
import { IssuesList } from "@/components/eos/issues-list";
import { getEosContext, listIssues } from "@/lib/eos/queries";

export default async function EosIssuesPage() {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const issues = await listIssues(ctx);

  return <IssuesList issues={issues} people={ctx.people} />;
}
