import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  WHOOP_API_BASE,
  WHOOP_ACCESS_COOKIE,
  getStoredWhoopRefreshToken,
  refreshWhoopTokens,
  saveWhoopTokens,
} from "@/lib/whoop/auth";

/**
 * GET /api/whoop/data — recovery, sleep, strain, workouts for the /whoop page.
 * Transparently refreshes the access token (WHOOP tokens live ~1h and
 * refresh tokens are single-use, so the rotated token is re-saved every time).
 */

async function whoopGet(path: string, accessToken: string) {
  const res = await fetch(`${WHOOP_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (res.status === 401) return { unauthorized: true as const, data: null };
  if (!res.ok) return { unauthorized: false as const, data: null };
  return { unauthorized: false as const, data: await res.json() };
}

async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const cookieStore = await cookies();
  if (!forceRefresh) {
    const cached = cookieStore.get(WHOOP_ACCESS_COOKIE)?.value;
    if (cached) return cached;
  }

  const refreshToken = await getStoredWhoopRefreshToken();
  if (!refreshToken) return null;

  const tokens = await refreshWhoopTokens(refreshToken);
  if (!tokens) return null;

  await saveWhoopTokens(tokens);
  return tokens.access_token;
}

export async function GET() {
  let accessToken = await getAccessToken();
  if (!accessToken) {
    return NextResponse.json({ connected: false });
  }

  const fetchAll = (token: string) =>
    Promise.all([
      whoopGet("/v2/recovery?limit=7", token),
      whoopGet("/v2/cycle?limit=7", token),
      whoopGet("/v2/activity/sleep?limit=7", token),
      whoopGet("/v2/activity/workout?limit=5", token),
    ]);

  let [recovery, cycle, sleep, workout] = await fetchAll(accessToken);

  // Cookie token may be stale/revoked — one forced refresh, then retry
  if (recovery.unauthorized || cycle.unauthorized) {
    accessToken = await getAccessToken(true);
    if (!accessToken) return NextResponse.json({ connected: false });
    [recovery, cycle, sleep, workout] = await fetchAll(accessToken);
    if (recovery.unauthorized) return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    recoveries: recovery.data?.records ?? [],
    cycles: cycle.data?.records ?? [],
    sleeps: sleep.data?.records ?? [],
    workouts: workout.data?.records ?? [],
  });
}
