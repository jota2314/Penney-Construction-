/**
 * One stable color per project for the crew board.
 *
 * Hashed off the project id so a job keeps its color across days, weeks, and
 * reloads without anyone having to pick one — and so the daily rows the board
 * writes into `schedule_phases` carry the same color the lanes view draws.
 * Shared between server and client: the loader stamps colors on payloads, the
 * grid falls back to it for rows that predate the board.
 *
 * FNV-1a with a fixed seed. The seed was chosen (8/31/26) so that the jobs
 * running that month all land on different colors; a plain char-sum put
 * three of that week's six jobs on the same amber.
 */
const PALETTE = [
  "#d97706",
  "#f97316",
  "#3b82f6",
  "#0ea5e9",
  "#22c55e",
  "#a855f7",
  "#10b981",
  "#fb7185",
  "#c084fc",
  "#14b8a6",
  "#f59e0b",
  "#ec4899",
  "#eab308",
  "#6366f1",
  "#84cc16",
  "#8b5cf6",
  "#f43f5e",
  "#06b6d4",
] as const;

const SEED = 525;

export function projectColor(projectId: string | null | undefined): string {
  if (!projectId) return "#9ca3af";
  let h = (2166136261 ^ SEED) >>> 0;
  for (let i = 0; i < projectId.length; i++) {
    h ^= projectId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}
