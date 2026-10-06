"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { updateSchedulePhase } from "@/lib/actions/schedule";

/**
 * Batch date moves from the Jobs view — one drag that carries several bars
 * (a shift-click selection, "everything after this", or a crew bar that
 * stands for one row per person).
 *
 * Every row still goes through `updateSchedulePhase`, so validation and the
 * "your dates changed" email to people on a confirmed phase behave exactly as
 * a single move from the project page. Rows are written one at a time and the
 * first failure stops the batch, reporting how far it got — a half-moved
 * selection is visible on the board after the refresh, never silent.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const movesSchema = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        projectId: z.string().uuid(),
        start: dateSchema,
        end: dateSchema,
      })
      .refine((m) => m.end >= m.start, { message: "A step can't end before it starts." }),
  )
  .min(1)
  .max(150, "That's too many steps to move at once.");

export type BoardMove = z.infer<typeof movesSchema>[number];

export async function moveBoardPhases(
  moves: BoardMove[],
): Promise<{ error: string | null; moved: number; emailed: number }> {
  const parsed = movesSchema.safeParse(moves);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the dates.", moved: 0, emailed: 0 };
  }

  const user = await getUser();
  if (!user) return { error: "Not signed in", moved: 0, emailed: 0 };
  const viewer = { role: user.profile?.role, email: user.profile?.email ?? user.email };
  if (!canViewJobBoard(viewer)) return { error: "Not allowed", moved: 0, emailed: 0 };

  let moved = 0;
  let emailed = 0;
  for (const m of parsed.data) {
    const res = await updateSchedulePhase(m.id, {
      project_id: m.projectId,
      start_date: m.start,
      end_date: m.end,
    });
    if (res.error) {
      revalidatePath("/board");
      return {
        error: moved ? `Moved ${moved} of ${parsed.data.length}, then: ${res.error}` : res.error,
        moved,
        emailed,
      };
    }
    moved++;
    emailed += res.notify?.emailed.length ?? 0;
  }

  revalidatePath("/board");
  revalidatePath("/crew");
  return { error: null, moved, emailed };
}
