import { z } from "zod";

export const reportProgressSchema = z.object({
  status: z.enum(["remaining", "finished"]),
  remaining: z.string().trim().max(1500),
  timeNeeded: z.string().trim().max(200),
  blockers: z.string().trim().min(1).max(1500),
}).superRefine((value, ctx) => {
  if (value.status === "remaining" && (!value.remaining || !value.timeNeeded)) {
    ctx.addIssue({ code: "custom", message: "Describe what remains and the time needed." });
  }
});

export type ReportProgress = z.infer<typeof reportProgressSchema>;

export function formatReportProgress(value: ReportProgress): string {
  return [
    `Task status: ${value.status === "finished" ? "Worker reports assigned task finished" : "Work remains"}`,
    `Remaining: ${value.status === "finished" ? "None reported for assigned task" : value.remaining}`,
    ...(value.status === "remaining" ? [`Time needed: ${value.timeNeeded}`] : []),
    `Blocked by: ${value.blockers}`,
  ].join("\n");
}
