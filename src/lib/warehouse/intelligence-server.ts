import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { canManageWarehouse } from "@/lib/auth/role-access";
import type { WarehouseSnapshot } from "./intelligence";

export async function warehouseIntelligenceAccess() {
  const user = await getUser();
  if (!user?.profile) return null;
  if (["owner", "precon_manager", "office_admin", "project_manager"].includes(user.profile.role)) return user;
  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").select("title, status").eq("profile_id", user.profile.id);
  if (error) return null;
  return data?.some(e => canManageWarehouse({ employeeTitle: e.title, employeeActive: e.status === "active" })) ? user : null;
}

/** Session client only; fails closed on query failure instead of inventing empty inventory. */
export async function loadWarehouseSnapshot(): Promise<WarehouseSnapshot> {
  const supabase = await createClient();
  const capturedAt = new Date().toISOString();
  const activitySince = new Date(Date.parse(capturedAt) - 30 * 86400000).toISOString();
  const [items, orders, checkouts, transactions] = await Promise.all([
    supabase.from("warehouse_items").select("*").eq("is_active", true).order("id").limit(1000),
    supabase.from("material_orders").select("*, material_order_items(*), projects(id,name,project_number)").in("status", ["pending", "approved", "ready"]).order("created_at").limit(1000),
    supabase.from("warehouse_open_checkouts").select("*").order("checked_out_at").limit(1000),
    supabase.from("warehouse_transactions").select("*, projects(name)").gte("created_at", activitySince).order("created_at", { ascending: false }).limit(1000),
  ]);
  const sources = { items, orders, checkouts, transactions };
  for (const [name, result] of Object.entries(sources)) {
    if (result.error) throw new Error(`Warehouse ${name} could not be loaded`);
  }
  const warnings = Object.entries(sources).filter(([, r]) => r.data?.length === 1000).map(([name]) => `${name}: showing at most 1,000 records; totals and recommendations may be incomplete.`);
  return { items: items.data ?? [], orders: orders.data ?? [], checkouts: checkouts.data ?? [], transactions: transactions.data ?? [], capturedAt, activitySince, warnings } as WarehouseSnapshot;
}
