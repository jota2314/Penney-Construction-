import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { JobBoard } from "@/components/board/job-board";
import type {
  BoardProject,
  BoardPhase,
  BoardOrder,
  BoardTodo,
} from "@/components/board/job-board";

export const metadata: Metadata = { title: "Job Board | Penney Construction" };

/** Active-pipeline statuses shown on the board, in display order. */
const BOARD_STATUSES = ["in_progress", "contracted", "proposal_sent", "estimating"] as const;

/**
 * Jorge's private planning table. Returns 404 rather than redirecting — same
 * posture as /design: someone who shouldn't be here gets no signal the route
 * exists. Middleware (canAccessPath) blocks it first; this is the second layer.
 */
export default async function BoardPage() {
  const user = await requireAuth();
  if (!canViewJobBoard(user.profile?.email ?? user.email)) notFound();

  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, project_number, status, phase")
    .in("status", [...BOARD_STATUSES])
    .eq("is_overhead", false)
    .order("created_at", { ascending: false });

  const statusRank = new Map(BOARD_STATUSES.map((s, i) => [s as string, i]));
  const boardProjects: BoardProject[] = (projects ?? []).sort(
    (a, b) => (statusRank.get(a.status) ?? 9) - (statusRank.get(b.status) ?? 9),
  );

  const ids = boardProjects.map((p) => p.id);

  const [{ data: phases }, { data: orders }, { data: todos }] = await Promise.all([
    ids.length
      ? supabase
          .from("schedule_phases")
          .select("id, project_id, name, start_date, end_date, status, color, event_type")
          .in("project_id", ids)
          .order("start_date")
      : Promise.resolve({ data: [] as BoardPhase[] }),
    ids.length
      ? supabase
          .from("material_orders")
          .select(
            "id, project_id, order_number, status, needed_by, notes, material_order_items(item_name)",
          )
          .in("project_id", ids)
          .in("status", ["pending", "approved", "ready"])
      : Promise.resolve({ data: [] as BoardOrder[] }),
    ids.length
      ? supabase
          .from("todos")
          .select("id, project_id, description, due_date, priority")
          .in("project_id", ids)
          .eq("status", "open")
          .not("due_date", "is", null)
      : Promise.resolve({ data: [] as BoardTodo[] }),
  ]);

  return (
    <>
      <Header title="Job Board" subtitle="Private" backHref="/command-center" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
        <JobBoard
          projects={boardProjects}
          phases={(phases ?? []) as BoardPhase[]}
          orders={(orders ?? []) as BoardOrder[]}
          todos={(todos ?? []) as BoardTodo[]}
        />
      </div>
    </>
  );
}
