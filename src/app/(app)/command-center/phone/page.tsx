import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getPhoneLineData } from "@/lib/actions/phone-line";
import { PhoneLine } from "@/components/command-center/phone-line";

export const metadata: Metadata = { title: "Phone Line | Penney Construction" };
export const dynamic = "force-dynamic";

export default async function PhoneLinePage() {
  await requireAuth();
  const data = await getPhoneLineData();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header title="Phone Line" backHref="/command-center" />
      <PhoneLine data={data} />
    </div>
  );
}
