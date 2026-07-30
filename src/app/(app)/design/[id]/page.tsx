import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { getDesign } from "@/lib/actions/design";
import { DesignStudio } from "@/components/design/design-studio";

export const metadata: Metadata = { title: "Design Studio | Penney Construction" };

export default async function DesignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  if (!canViewDesignStudio(user.profile?.email ?? user.email)) notFound();

  const { id } = await params;
  const design = await getDesign(id);
  if (!design) notFound();

  return (
    <>
      <Header
        title={design.name}
        subtitle={design.projectLabel ?? "Private design"}
        backHref="/design"
        backLabel="Designs"
      />
      <DesignStudio design={design} />
    </>
  );
}
