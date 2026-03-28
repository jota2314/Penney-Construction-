import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getEmailVolume } from "@/lib/actions/command-center";
import { EmailVolumeChart } from "@/components/command-center/email-volume-chart";

export default async function EmailsPage() {
  await requireAuth();

  const volume = await getEmailVolume().catch(() => []);

  return (
    <>
      <Header title="Email" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 min-w-0 overflow-hidden">
        <EmailVolumeChart data={volume} />
      </div>
    </>
  );
}
