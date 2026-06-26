"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Switch the active QuickBooks environment between sandbox and production. */
export async function setQuickBooksEnvironment(environment: "sandbox" | "production") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Upsert so the row exists even if the migration seed hasn't run.
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "quickbooks_environment", value: environment }, { onConflict: "key" });

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { error: null };
}
