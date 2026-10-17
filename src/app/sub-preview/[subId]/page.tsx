import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/get-user";
import { SubPreviewClient } from "./preview-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sub portal preview · Penney Construction",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#252D2B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Staff preview of one sub's portal, outside the app chrome so it looks
// exactly like his phone. Read-only: it never sets his cookie, never bumps
// his view count and never creates a login. Field crew and signed-out
// visitors never get here (the middleware guards /sub-preview too).
export default async function SubPreviewPage({ params }: { params: Promise<{ subId: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!user.profile || user.profile.role === "field") redirect("/crew");
  const { subId } = await params;
  return <SubPreviewClient subId={subId} />;
}
