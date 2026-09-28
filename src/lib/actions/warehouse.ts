"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { canManageWarehouse } from "@/lib/auth/role-access";
import { isWarehousePhotoPathFor } from "@/lib/warehouse/checkouts";
import { signWarehousePhoto } from "@/lib/warehouse/photo-urls";
import type {
  MaterialOrderDeliveryMethod,
  MaterialOrderPriority,
  MaterialOrderStatus,
  MaterialOrderWithItems,
  WarehouseItem,
  WarehouseOpenCheckout,
  WarehouseTransaction,
  WarehouseTransactionType,
} from "@/types/database";

const PHOTO_BUCKET = "warehouse-photos";

// ── Helpers ────────────────────────────────────────────────────

async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  return {
    supabase,
    id: user.id,
    name: profile?.full_name || profile?.email || "Unknown",
  };
}

function revalidateWarehouse() {
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/orders");
  revalidatePath("/warehouse/out");
  revalidatePath("/crew/materials");
}

/**
 * Whether the person using the app (impersonation-aware, so "View as Rick"
 * shows what Rick sees) may add/replace/remove item photos. The database
 * enforces the same rule on the real signed-in user via can_manage_warehouse().
 */
export async function getWarehouseAccess(): Promise<{ canManagePhotos: boolean }> {
  const user = await getUser();
  if (!user?.profile) return { canManagePhotos: false };
  const supabase = await createClient();
  const { data: employees } = await supabase
    .from("employees")
    .select("title, status")
    .eq("profile_id", user.profile.id)
    .limit(5);
  const canManagePhotos =
    canManageWarehouse({ role: user.profile.role }) ||
    (employees ?? []).some((e) =>
      canManageWarehouse({ employeeTitle: e.title, employeeActive: e.status === "active" })
    );
  return { canManagePhotos };
}

// ── Inventory: reads ───────────────────────────────────────────

export interface WarehouseSummary {
  activeItems: number;
  lowStockItems: number;
  inventoryValue: number;
  openOrders: number;
  pendingOrders: number;
}

export async function getWarehouseSummary(): Promise<WarehouseSummary> {
  const supabase = await createClient();
  const [{ data: items }, { data: orders }] = await Promise.all([
    supabase
      .from("warehouse_items")
      .select("quantity_on_hand, reorder_point, unit_cost")
      .eq("is_active", true),
    supabase
      .from("material_orders")
      .select("status")
      .in("status", ["pending", "approved", "ready"]),
  ]);

  const activeItems = items?.length ?? 0;
  const lowStockItems =
    items?.filter((i) => i.quantity_on_hand <= i.reorder_point).length ?? 0;
  const inventoryValue =
    items?.reduce(
      (sum, i) => sum + i.quantity_on_hand * (i.unit_cost ?? 0),
      0
    ) ?? 0;
  const openOrders = orders?.length ?? 0;
  const pendingOrders = orders?.filter((o) => o.status === "pending").length ?? 0;

  return { activeItems, lowStockItems, inventoryValue, openOrders, pendingOrders };
}

export async function getWarehouseItems(): Promise<WarehouseItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_items")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) return [];
  return (data ?? []) as WarehouseItem[];
}

export async function getWarehouseItem(id: string): Promise<{
  item: WarehouseItem;
  transactions: WarehouseTransaction[];
  openCheckouts: WarehouseOpenCheckout[];
  photoUrl: string | null;
} | null> {
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("warehouse_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!item) return null;

  const [{ data: transactions }, { data: openCheckouts }, photoUrl] = await Promise.all([
    supabase
      .from("warehouse_transactions")
      .select("*, projects(name)")
      .eq("item_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("warehouse_open_checkouts")
      .select("*")
      .eq("item_id", id)
      .order("checked_out_at", { ascending: true }),
    signWarehousePhoto(supabase, (item as WarehouseItem).photo_path),
  ]);

  return {
    item: item as WarehouseItem,
    transactions: (transactions ?? []) as WarehouseTransaction[],
    openCheckouts: (openCheckouts ?? []) as WarehouseOpenCheckout[],
    photoUrl,
  };
}

// ── Check-out / check-in ───────────────────────────────────────

/** Everything currently out on a job, oldest first. */
export async function getOpenCheckouts(): Promise<WarehouseOpenCheckout[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_open_checkouts")
    .select("*")
    .order("checked_out_at", { ascending: true })
    .limit(1000);
  if (error) return [];
  return (data ?? []) as WarehouseOpenCheckout[];
}

export interface WarehouseEmployee {
  id: string;
  name: string;
  title: string | null;
}

/** Active employees for the "taken by / returned by" pickers. */
export async function getWarehouseEmployees(): Promise<WarehouseEmployee[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("id, first_name, last_name, title")
    .eq("status", "active")
    .order("first_name", { ascending: true });
  return (data ?? [])
    .filter((e) => !/test account/i.test(e.title ?? ""))
    .map((e) => ({
      id: e.id,
      name: [e.first_name, e.last_name].filter(Boolean).join(" ").trim(),
      title: e.title,
    }))
    .filter((e) => e.name.length > 0);
}

export async function checkOutItem(params: {
  itemId: string;
  quantity: number;
  projectId: string;
  employeeId: string;
  notes?: string | null;
}): Promise<{ checkoutId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  if (!params.projectId) return { error: "Pick the job site it is going to" };
  if (!params.employeeId) return { error: "Pick who is taking it" };
  if (!(params.quantity > 0)) return { error: "Enter a quantity greater than zero" };

  const { data, error } = await user.supabase.rpc("warehouse_check_out", {
    p_item_id: params.itemId,
    p_quantity: params.quantity,
    p_project_id: params.projectId,
    p_employee_id: params.employeeId,
    p_notes: params.notes?.trim() || null,
    p_performed_by: user.id,
    p_performed_by_name: user.name,
  });
  if (error) return { error: error.message };

  revalidateWarehouse();
  revalidatePath(`/warehouse/items/${params.itemId}`);
  return { checkoutId: data as string };
}

export async function checkInItem(params: {
  checkoutId: string;
  quantity: number;
  employeeId: string;
  notes?: string | null;
}): Promise<{ stillOut?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  if (!params.employeeId) return { error: "Pick who returned it" };
  if (!(params.quantity > 0)) return { error: "Enter a quantity greater than zero" };

  const { data, error } = await user.supabase.rpc("warehouse_check_in", {
    p_checkout_id: params.checkoutId,
    p_quantity: params.quantity,
    p_employee_id: params.employeeId,
    p_notes: params.notes?.trim() || null,
    p_performed_by: user.id,
    p_performed_by_name: user.name,
  });
  if (error) return { error: error.message };

  const { data: checkout } = await user.supabase
    .from("warehouse_transactions")
    .select("item_id")
    .eq("id", params.checkoutId)
    .maybeSingle();
  revalidateWarehouse();
  if (checkout?.item_id) revalidatePath(`/warehouse/items/${checkout.item_id}`);
  return { stillOut: Number(data ?? 0) };
}

/**
 * Close a checkout whose remainder was used up on the job. No stock moves —
 * it already left the shelf at checkout — it just comes off Out on Jobs.
 */
export async function closeCheckoutAsUsed(
  checkoutId: string
): Promise<{ usedQuantity?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await user.supabase.rpc("warehouse_close_checkout", {
    p_checkout_id: checkoutId,
    p_performed_by: user.id,
    p_performed_by_name: user.name,
  });
  if (error) return { error: error.message };

  const { data: checkout } = await user.supabase
    .from("warehouse_transactions")
    .select("item_id")
    .eq("id", checkoutId)
    .maybeSingle();
  revalidateWarehouse();
  if (checkout?.item_id) revalidatePath(`/warehouse/items/${checkout.item_id}`);
  return { usedQuantity: Number(data ?? 0) };
}

/**
 * Save a scanned barcode onto an item, so the next scan finds it. Refuses a
 * code another active item already carries — one scan must mean one item.
 */
export async function setWarehouseItemBarcode(
  itemId: string,
  barcode: string
): Promise<{ ok?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const code = barcode.trim();
  if (!code) return { error: "No barcode to save" };

  const { data: clash } = await user.supabase
    .from("warehouse_items")
    .select("id, name")
    .eq("barcode", code)
    .eq("is_active", true)
    .neq("id", itemId)
    .limit(1);
  if (clash && clash.length > 0) {
    return { error: `That barcode is already on "${clash[0].name}"` };
  }

  const { error } = await user.supabase
    .from("warehouse_items")
    .update({ barcode: code })
    .eq("id", itemId);
  if (error) return { error: error.message };

  revalidateWarehouse();
  revalidatePath(`/warehouse/items/${itemId}`);
  return { ok: true };
}

// ── Item photos ────────────────────────────────────────────────

const PHOTO_FORBIDDEN = "Only warehouse staff and admins can change item photos";

/**
 * Attach a photo the browser already uploaded to warehouse-photos (the
 * upload itself is gated by the bucket's policies). Replaces and deletes any
 * previous photo.
 */
export async function setWarehouseItemPhoto(
  itemId: string,
  paths: { photoPath: string; thumbPath: string }
): Promise<{ ok?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  if (!(await getWarehouseAccess()).canManagePhotos) return { error: PHOTO_FORBIDDEN };
  if (
    !isWarehousePhotoPathFor(itemId, paths.photoPath) ||
    !isWarehousePhotoPathFor(itemId, paths.thumbPath)
  ) {
    return { error: "That photo doesn't belong to this item" };
  }

  const { data: before } = await user.supabase
    .from("warehouse_items")
    .select("photo_path, photo_thumb_path")
    .eq("id", itemId)
    .maybeSingle();
  if (!before) return { error: "Item not found" };

  const { error } = await user.supabase
    .from("warehouse_items")
    .update({ photo_path: paths.photoPath, photo_thumb_path: paths.thumbPath })
    .eq("id", itemId);
  if (error) return { error: error.message };

  const stale = [before.photo_path, before.photo_thumb_path].filter(
    (p): p is string => !!p && p !== paths.photoPath && p !== paths.thumbPath
  );
  if (stale.length > 0) {
    await user.supabase.storage.from(PHOTO_BUCKET).remove(stale);
  }

  revalidateWarehouse();
  revalidatePath(`/warehouse/items/${itemId}`);
  return { ok: true };
}

export async function removeWarehouseItemPhoto(
  itemId: string
): Promise<{ ok?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  if (!(await getWarehouseAccess()).canManagePhotos) return { error: PHOTO_FORBIDDEN };

  const { data: before } = await user.supabase
    .from("warehouse_items")
    .select("photo_path, photo_thumb_path")
    .eq("id", itemId)
    .maybeSingle();
  if (!before) return { error: "Item not found" };

  const { error } = await user.supabase
    .from("warehouse_items")
    .update({ photo_path: null, photo_thumb_path: null })
    .eq("id", itemId);
  if (error) return { error: error.message };

  const stale = [before.photo_path, before.photo_thumb_path].filter(
    (p): p is string => !!p
  );
  if (stale.length > 0) {
    await user.supabase.storage.from(PHOTO_BUCKET).remove(stale);
  }

  revalidateWarehouse();
  revalidatePath(`/warehouse/items/${itemId}`);
  return { ok: true };
}

// ── Inventory: writes ──────────────────────────────────────────

export interface WarehouseItemInput {
  name: string;
  description?: string | null;
  category: string;
  unit: string;
  reorder_point?: number;
  reorder_quantity?: number | null;
  unit_cost?: number | null;
  location?: string | null;
  vendor?: string | null;
  barcode?: string | null;
  notes?: string | null;
}

export async function createWarehouseItem(
  input: WarehouseItemInput & { initial_quantity?: number }
): Promise<{ id?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  if (!input.name?.trim()) return { error: "Name is required" };

  const { initial_quantity, ...fields } = input;
  const { data, error } = await user.supabase
    .from("warehouse_items")
    .insert({
      ...fields,
      name: fields.name.trim(),
      quantity_on_hand: 0,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Record opening stock through the ledger so history starts at the truth.
  if (initial_quantity && initial_quantity > 0) {
    await user.supabase.rpc("warehouse_adjust_stock", {
      p_item_id: data.id,
      p_change: initial_quantity,
      p_type: "receive",
      p_notes: "Initial stock count",
      p_performed_by: user.id,
      p_performed_by_name: user.name,
    });
  }

  revalidateWarehouse();
  return { id: data.id };
}

export async function updateWarehouseItem(
  id: string,
  input: WarehouseItemInput
): Promise<{ ok?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  if (!input.name?.trim()) return { error: "Name is required" };

  const { error } = await user.supabase
    .from("warehouse_items")
    .update({ ...input, name: input.name.trim() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateWarehouse();
  revalidatePath(`/warehouse/items/${id}`);
  return { ok: true };
}

export async function archiveWarehouseItem(
  id: string
): Promise<{ ok?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await user.supabase
    .from("warehouse_items")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateWarehouse();
  return { ok: true };
}

export async function adjustStock(params: {
  itemId: string;
  change: number;
  type: Extract<WarehouseTransactionType, "receive" | "issue" | "return" | "adjust">;
  projectId?: string | null;
  notes?: string | null;
}): Promise<{ newQuantity?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  if (!params.change || params.change === 0) {
    return { error: "Quantity change cannot be zero" };
  }

  const { data, error } = await user.supabase.rpc("warehouse_adjust_stock", {
    p_item_id: params.itemId,
    p_change: params.change,
    p_type: params.type,
    p_project_id: params.projectId ?? null,
    p_notes: params.notes ?? null,
    p_performed_by: user.id,
    p_performed_by_name: user.name,
  });
  if (error) return { error: error.message };

  revalidateWarehouse();
  revalidatePath(`/warehouse/items/${params.itemId}`);
  return { newQuantity: data as number };
}

// ── Material orders: reads ─────────────────────────────────────

const ORDER_SELECT =
  "*, material_order_items(*), projects(id, name, project_number)";

export async function getMaterialOrders(): Promise<MaterialOrderWithItems[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_orders")
    .select(ORDER_SELECT)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []) as MaterialOrderWithItems[];
}

export async function getMaterialOrder(id: string): Promise<{
  order: MaterialOrderWithItems;
  stockById: Record<string, { quantity_on_hand: number; location: string | null; unit: string }>;
} | null> {
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("material_orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (!order) return null;

  const typed = order as MaterialOrderWithItems;
  const itemIds = typed.material_order_items
    .map((l) => l.item_id)
    .filter((v): v is string => !!v);

  const stockById: Record<
    string,
    { quantity_on_hand: number; location: string | null; unit: string }
  > = {};
  if (itemIds.length > 0) {
    const { data: stock } = await supabase
      .from("warehouse_items")
      .select("id, quantity_on_hand, location, unit")
      .in("id", itemIds);
    for (const s of stock ?? []) {
      stockById[s.id] = {
        quantity_on_hand: s.quantity_on_hand,
        location: s.location,
        unit: s.unit,
      };
    }
  }

  return { order: typed, stockById };
}

export async function getMyMaterialOrders(): Promise<MaterialOrderWithItems[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await user.supabase
    .from("material_orders")
    .select(ORDER_SELECT)
    .eq("requested_by", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as MaterialOrderWithItems[];
}

export async function getActiveProjectsList(): Promise<
  { id: string; name: string; project_number: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .in("status", ["contracted", "in_progress"])
    .order("name", { ascending: true });
  return data ?? [];
}

// ── Material orders: writes ────────────────────────────────────

export interface MaterialOrderInput {
  projectId?: string | null;
  neededBy?: string | null;
  priority: MaterialOrderPriority;
  deliveryMethod: MaterialOrderDeliveryMethod;
  notes?: string | null;
  items: {
    itemId?: string | null;
    name: string;
    quantity: number;
    unit: string;
    notes?: string | null;
  }[];
}

export async function createMaterialOrder(
  input: MaterialOrderInput
): Promise<{ orderId?: string; orderNumber?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const lines = input.items.filter((i) => i.name?.trim() && i.quantity > 0);
  if (lines.length === 0) return { error: "Add at least one item to the order" };

  const { data: order, error } = await user.supabase
    .from("material_orders")
    .insert({
      project_id: input.projectId || null,
      needed_by: input.neededBy || null,
      priority: input.priority,
      delivery_method: input.deliveryMethod,
      notes: input.notes?.trim() || null,
      requested_by: user.id,
      requested_by_name: user.name,
    })
    .select("id, order_number")
    .single();
  if (error) return { error: error.message };

  const { error: linesError } = await user.supabase
    .from("material_order_items")
    .insert(
      lines.map((l) => ({
        order_id: order.id,
        item_id: l.itemId || null,
        item_name: l.name.trim(),
        quantity: l.quantity,
        unit: l.unit || "each",
        notes: l.notes?.trim() || null,
      }))
    );
  if (linesError) {
    // Don't leave an empty order behind.
    await user.supabase.from("material_orders").delete().eq("id", order.id);
    return { error: linesError.message };
  }

  revalidateWarehouse();
  return { orderId: order.id, orderNumber: order.order_number };
}

export async function updateOrderStatus(
  orderId: string,
  status: Extract<MaterialOrderStatus, "approved" | "delivered" | "rejected" | "cancelled">,
  rejectionReason?: string
): Promise<{ ok?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const update: Record<string, unknown> = { status };
  if (status === "approved") {
    update.approved_by = user.id;
    update.approved_at = new Date().toISOString();
  }
  if (status === "rejected") {
    update.rejection_reason = rejectionReason?.trim() || null;
  }

  const { error } = await user.supabase
    .from("material_orders")
    .update(update)
    .eq("id", orderId);
  if (error) return { error: error.message };

  revalidateWarehouse();
  revalidatePath(`/warehouse/orders/${orderId}`);
  return { ok: true };
}

/**
 * Marks an order picked: deducts stock for every catalog line (via the atomic
 * warehouse_adjust_stock function), records fulfilled quantities, and moves the
 * order to "ready". Write-in lines (no item_id) are recorded but don't touch stock.
 */
export async function fulfillMaterialOrder(
  orderId: string,
  lines: { orderItemId: string; itemId: string | null; quantity: number }[]
): Promise<{ ok?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await user.supabase.rpc("warehouse_fulfill_material_order", {
    p_order_id: orderId,
    p_lines: lines.map(({ orderItemId, quantity }) => ({
      orderItemId,
      quantity,
    })),
    p_performed_by_name: user.name,
  });
  if (error) return { error: error.message };

  revalidateWarehouse();
  revalidatePath(`/warehouse/orders/${orderId}`);
  return { ok: true };
}
