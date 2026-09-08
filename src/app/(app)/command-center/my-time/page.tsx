import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getMyHoursSummary, getMyTimeLog } from "@/lib/actions/daily-logs";
import { MyTime } from "@/components/crew/my-time";

export default async function MyTimePage() {
  const user = await requireAuth();
  const supabase = await createClient();
  const { data: employee, error } = await supabase.from("employees")
    .select("id").eq("profile_id", user.profile?.id ?? user.id).maybeSingle();
  if (error) throw error;
  if (!employee) return <p className="p-6">Your account needs to be linked to an employee before you can clock in.</p>;
  const [hours, entries] = await Promise.all([getMyHoursSummary(), getMyTimeLog(14)]);
  return <MyTime hours={hours} entries={entries} />;
}
