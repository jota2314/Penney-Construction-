"use server";

import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { loadSubDay, type SubsToday } from "@/lib/subs/sub-digest";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Subs on site today, for the Job Board strip (plan §4.1): QR check-ins,
 * sub posts and open sub shifts today, plus subs on a CONFIRMED phase
 * covering today who haven't shown up (a penciled-in phase means he hasn't
 * been told, so it never reads as a no-show). The same load feeds the 5:30 PM digest
 * (lib/subs/sub-digest.ts), so the strip and the digest never disagree.
 *
 * Board viewers only (the office roles). Read with the admin client after
 * that check: sub_site_visits is office-read by RLS, and the sub rows and
 * their phones are needed for the Text links.
 */

export type SubsTodayResult = { ok: true; data: SubsToday } | { ok: false; error: string };

export async function getSubsToday(): Promise<SubsTodayResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const viewer = { role: user.profile?.role, email: user.profile?.email ?? user.email };
  if (!canViewJobBoard(viewer)) return { ok: false, error: "Not allowed" };

  try {
    return { ok: true, data: await loadSubDay(createAdminClient()) };
  } catch (err) {
    console.error("[sub-activity] getSubsToday failed", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Couldn't load today's subs." };
  }
}
