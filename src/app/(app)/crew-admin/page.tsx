import { requireAuth } from "@/lib/auth/require-auth";
import { getCrewAdminData } from "@/lib/actions/crew-admin";
import { CrewAdminTabs } from "@/components/crew-admin/crew-admin-tabs";
import { Header } from "@/components/layout/header";

export default async function CrewAdminPage() {
  await requireAuth();
  const data = await getCrewAdminData();

  return (
    <>
      <Header title="Crew Management" backHref="/command-center" />
      <div className="p-4 md:p-6">
        <CrewAdminTabs data={data} />
      </div>
    </>
  );
}
