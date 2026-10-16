import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/get-user";
import { PortalPreviewClient } from "./preview-client";

export const dynamic = "force-dynamic";

// Staff preview of a project's client portal, outside the app chrome so it
// looks exactly like the client's page. Shows staged (DRAFT) content too.
// Field crew and signed-out visitors never get here (middleware also guards).
export default async function PortalPreviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!user.profile || user.profile.role === "field") redirect("/crew");
  const { projectId } = await params;
  return <PortalPreviewClient projectId={projectId} />;
}
