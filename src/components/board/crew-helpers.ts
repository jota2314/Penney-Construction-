import type { CrewCell } from "@/lib/board/crew-board-data";

/** What a copy carries: the job, the words, and whether it's confirmed. */
export interface CrewClip {
  projectId: string;
  projectName: string;
  scope: string;
  confirmed: boolean;
  color: string;
}

export function clipFrom(cell: CrewCell): CrewClip | null {
  if (!cell.projectId) return null;
  return {
    projectId: cell.projectId,
    projectName: cell.projectName,
    scope: cell.name !== cell.projectName ? cell.name : "",
    confirmed: cell.confirmed,
    color: cell.color,
  };
}

/** A chip moves only when this board owns it outright; everything else copies. */
export function movable(cell: CrewCell) {
  return cell.source === "board" && !cell.shared;
}

/** "Jackling Project" → "Jackling": the generic tail costs a chip its name. */
export function shortJob(name: string) {
  const cut = name.replace(/\s+(project|renovation|remodel|residence|reno)$/i, "").trim();
  return cut || name;
}

export function longDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** "Thu 10/8" */
export function shortDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

/** Whole days from a to b (inclusive count is this + 1). */
export function daysBetween(a: string, b: string) {
  return Math.round(
    (new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000,
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
