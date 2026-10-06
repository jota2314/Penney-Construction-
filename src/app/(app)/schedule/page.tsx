import { redirect } from "next/navigation";

/**
 * The schedule lives on the Job Board now — Jobs (every job's Gantt) and Crew
 * (who's where each day) on one screen. Two schedules meant two places to
 * update and one of them always stale, so /schedule just forwards. (10/5/26)
 */
export default function SchedulePage() {
  redirect("/board");
}
