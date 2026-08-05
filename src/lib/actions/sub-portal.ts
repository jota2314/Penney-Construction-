"use server";

import { requireAuth } from "@/lib/auth/require-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin, normalizePhone } from "@/lib/sub-portal/auth";

export interface SubPortalStatus {
  id: string;
  token: string;
  phone_login: string | null;
  has_pin: boolean;
  enabled: boolean;
  last_viewed_at: string | null;
  view_count: number;
}

function toStatus(row: {
  id: string;
  token: string;
  phone_login: string | null;
  pin_hash: string | null;
  enabled: boolean;
  last_viewed_at: string | null;
  view_count: number;
}): SubPortalStatus {
  return {
    id: row.id,
    token: row.token,
    phone_login: row.phone_login,
    has_pin: !!row.pin_hash,
    enabled: row.enabled,
    last_viewed_at: row.last_viewed_at,
    view_count: row.view_count,
  };
}

const PORTAL_COLS = "id, token, phone_login, pin_hash, enabled, last_viewed_at, view_count";

export async function getSubPortalStatus(
  subcontractorId: string
): Promise<SubPortalStatus | null> {
  await requireAuth();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("sub_portal_access")
    .select(PORTAL_COLS)
    .eq("subcontractor_id", subcontractorId)
    .maybeSingle();
  return data ? toStatus(data) : null;
}

/**
 * Create (or refresh) portal access for a sub and set their PIN. The login
 * phone comes from the sub's record; returns the new status. PIN hashing
 * stays server-side — the raw PIN is never stored.
 */
export async function setSubPortalPin(
  subcontractorId: string,
  pin: string
): Promise<{ status?: SubPortalStatus; error?: string }> {
  const user = await requireAuth();
  if (!/^\d{4,6}$/.test(pin)) return { error: "PIN must be 4-6 digits." };

  const supabase = createAdminClient();
  const { data: sub } = await supabase
    .from("subcontractors")
    .select("phone")
    .eq("id", subcontractorId)
    .single();
  const phone = normalizePhone(sub?.phone || "");
  if (phone.length < 10) {
    return { error: "This sub needs a valid phone number on file first — that's their login." };
  }

  const { data: dup } = await supabase
    .from("sub_portal_access")
    .select("id, subcontractor_id")
    .eq("phone_login", phone)
    .neq("subcontractor_id", subcontractorId)
    .maybeSingle();
  if (dup) return { error: "Another sub already uses this phone number to sign in." };

  const { data: existing } = await supabase
    .from("sub_portal_access")
    .select("id, token")
    .eq("subcontractor_id", subcontractorId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("sub_portal_access")
      .update({
        phone_login: phone,
        pin_hash: hashPin(existing.token, pin),
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(PORTAL_COLS)
      .single();
    if (error) return { error: error.message };
    return { status: toStatus(data) };
  }

  // Insert first so Postgres mints the token, then hash the PIN against it.
  const { data: created, error: insertErr } = await supabase
    .from("sub_portal_access")
    .insert({ subcontractor_id: subcontractorId, phone_login: phone, created_by: user.id })
    .select(PORTAL_COLS)
    .single();
  if (insertErr || !created) return { error: insertErr?.message || "Couldn't create portal access." };

  const { data, error } = await supabase
    .from("sub_portal_access")
    .update({ pin_hash: hashPin(created.token, pin) })
    .eq("id", created.id)
    .select(PORTAL_COLS)
    .single();
  if (error) return { error: error.message };
  return { status: toStatus(data) };
}

export async function toggleSubPortalEnabled(
  subcontractorId: string,
  enabled: boolean
): Promise<{ status?: SubPortalStatus; error?: string }> {
  await requireAuth();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sub_portal_access")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("subcontractor_id", subcontractorId)
    .select(PORTAL_COLS)
    .single();
  if (error) return { error: error.message };
  return { status: toStatus(data) };
}
