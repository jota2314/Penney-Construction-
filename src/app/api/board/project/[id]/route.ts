import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard, canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { signThumbUrls } from "@/lib/image/transform-signed-url";

/**
 * Everything the board's project drawer shows for one job: the schedule
 * around today, recent field logs with photo thumbnails, open todos,
 * material orders, and unsigned change orders.
 *
 * Split out of the page's server load deliberately — the board holds 51 jobs
 * and nobody opens more than a couple of drawers per visit, so this stays
 * lazy instead of tripling the initial payload.
 */

const SIGNED_URL_TTL = 60 * 60 * 6;
const PHOTO_BUCKET = "daily-log-photos";

function localDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const viewer = { role: user.profile?.role, email: user.profile?.email ?? user.email };
  if (!canViewJobBoard(viewer)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const showMoney = canSeeBoardMoney(viewer.role);

  const { id } = await params;
  const supabase = await createClient();
  const today = localDateStr(new Date());
  const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString();

  const { data: project } = await supabase
    .from("projects")
    // Must stay one literal — see the note in lib/board/board-data.ts.
    .select("id, name, project_number, status, phase, address, city, state, zip, contract_value, estimated_value, estimated_start_date, estimated_end_date, actual_start_date, next_action, assigned_pm")
    .eq("id", id)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [
    { data: phases },
    { data: logs },
    { data: todos },
    { data: orders },
    { data: cos },
  ] = await Promise.all([
    supabase
      .from("schedule_phases")
      .select("id, name, start_date, end_date, planned_start_date, planned_end_date, status, color, event_type, is_confirmed, phase_scope")
      .eq("project_id", id)
      .order("start_date"),
    supabase
      .from("daily_logs")
      .select("id, text, started_at, ended_at, photo_storage_paths, author_id, kind")
      .eq("project_id", id)
      .gte("started_at", threeWeeksAgo)
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("todos")
      .select("id, description, due_date, priority, assignee")
      .eq("project_id", id)
      .eq("status", "open")
      .order("due_date", { nullsFirst: false })
      .limit(20),
    supabase
      .from("material_orders")
      .select("id, order_number, status, needed_by, notes, material_order_items(item_name)")
      .eq("project_id", id)
      .in("status", ["pending", "approved", "ready"])
      .order("needed_by"),
    supabase
      .from("change_orders")
      .select("id, change_order_number, title, status, price_impact, sent_to_client_at, client_signed_at")
      .eq("project_id", id)
      .not("status", "in", '("approved","rejected","cancelled")')
      .order("change_order_number"),
  ]);

  // Author names for the logs.
  const authorIds = Array.from(
    new Set((logs ?? []).map((l) => l.author_id).filter(Boolean) as string[]),
  );
  const authorName = new Map<string, string>();
  if (authorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const p of profiles ?? []) authorName.set(p.id, p.full_name ?? "");
  }

  // Photo thumbs. Transforms are baked in at signing time — a signed URL with
  // ?width= appended afterwards returns the full-size image, not a thumbnail.
  const allPaths = (logs ?? []).flatMap(
    (l) => (l.photo_storage_paths as string[] | null) ?? [],
  );
  let thumbs = new Map<string, string>();
  if (allPaths.length) {
    thumbs = await signThumbUrls(supabase, PHOTO_BUCKET, allPaths, SIGNED_URL_TTL).catch(
      () => new Map<string, string>(),
    );
  }

  const now = new Date();
  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      projectNumber: project.project_number,
      status: project.status,
      phase: project.phase,
      address: [project.address, project.city, project.state].filter(Boolean).join(", "),
      nextAction: project.next_action,
      contractValue: showMoney ? (project.contract_value ?? project.estimated_value ?? null) : null,
      startDate: project.actual_start_date ?? project.estimated_start_date,
      targetEnd: project.estimated_end_date,
    },
    // Split around today so the drawer leads with what's happening now.
    phases: {
      current: (phases ?? []).filter(
        (p) => p.start_date <= today && (p.end_date ?? p.start_date) >= today,
      ),
      upcoming: (phases ?? []).filter((p) => p.start_date > today).slice(0, 6),
      recent: (phases ?? [])
        .filter((p) => (p.end_date ?? p.start_date) < today)
        .slice(-4)
        .reverse(),
    },
    logs: (logs ?? []).map((l) => {
      const paths = (l.photo_storage_paths as string[] | null) ?? [];
      return {
        id: l.id,
        text: l.text,
        at: l.started_at,
        open: !l.ended_at,
        author: authorName.get(l.author_id ?? "") || "Crew",
        hoursAgo: Math.round((now.getTime() - new Date(l.started_at).getTime()) / 3600000),
        photos: paths.map((p) => thumbs.get(p)).filter((u): u is string => !!u),
      };
    }),
    todos: (todos ?? []).map((t) => ({
      id: t.id,
      description: t.description,
      dueDate: t.due_date,
      priority: t.priority,
      overdue: !!t.due_date && t.due_date < today,
    })),
    orders: (orders ?? []).map((o) => ({
      id: o.id,
      label: o.material_order_items?.[0]?.item_name || o.notes || o.order_number,
      orderNumber: o.order_number,
      status: o.status,
      neededBy: o.needed_by,
      overdue: !!o.needed_by && o.needed_by < today && o.status !== "ready",
    })),
    changeOrders: (cos ?? []).map((c) => ({
      id: c.id,
      number: c.change_order_number,
      title: c.title,
      status: c.status,
      // The money side of a CO is gated the same as contract values.
      amount: showMoney ? c.price_impact : null,
      sent: !!c.sent_to_client_at,
      signed: !!c.client_signed_at,
    })),
  });
}
