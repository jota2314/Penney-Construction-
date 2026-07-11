import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerGmailAccessToken } from "@/lib/notifications/tagged-mentions";

export type ScheduleNotifyKind = "confirmed" | "updated";

export type ScheduleNotifyResult = {
  /** Display names that were successfully emailed. */
  emailed: string[];
  /** Display names skipped because they have no email on file. */
  skipped: string[];
  /** Number of push notifications delivered (employees with linked profiles). */
  pushed: number;
  /** Top-level infra failure (no Gmail token, phase not found) — informational. */
  error?: string;
};

// CC on every schedule email so the office always has the paper trail.
const SCHEDULE_CC = [
  "jbetancur@penneyconstructioninc.com",
  "rpenney@penneyconstructioninc.com",
];

type EmployeeRecipient = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  profile_id: string | null;
};

type SubRecipient = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
};

/** Format a plain YYYY-MM-DD date column without timezone drift. */
function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...opts,
  });
}

function formatRange(start: string, end: string): string {
  const startLong = formatDate(start, { weekday: "short", month: "short", day: "numeric" });
  const endLong = formatDate(end, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (start === end) return endLong;
  return `${startLong} – ${endLong}`;
}

/** Short "Jul 13–15" form for subjects. */
export function formatShortRange(start: string, end: string): string {
  const s = formatDate(start, { month: "short", day: "numeric" });
  if (start === end) return s;
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const e = formatDate(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${s}–${e}`;
}

/**
 * Email + push everyone assigned to a schedule phase. Called when a phase is
 * confirmed (goes live) or when a confirmed phase's dates change. Best-effort:
 * never throws — callers await it and surface the result, but a notification
 * failure must never roll back the schedule change itself.
 */
export async function notifySchedulePhaseAssignees(opts: {
  phaseId: string;
  kind: ScheduleNotifyKind;
  actorId: string;
  /** Human-readable "what changed" lines for kind="updated" emails. */
  changes?: string[];
  /** Narrow the fan-out to newly-added assignees. */
  onlyEmployeeIds?: string[];
  onlySubIds?: string[];
}): Promise<ScheduleNotifyResult> {
  const result: ScheduleNotifyResult = { emailed: [], skipped: [], pushed: 0 };

  try {
    const admin = createAdminClient();

    const { data: phase } = await admin
      .from("schedule_phases")
      .select(
        "id, name, start_date, end_date, notes, confirmed_with, assigned_employee_ids, assigned_sub_ids, project_id",
      )
      .eq("id", opts.phaseId)
      .single();
    if (!phase) {
      result.error = "Phase not found";
      return result;
    }

    const { data: project } = phase.project_id
      ? await admin
          .from("projects")
          .select("name, project_number, address, city, state, zip")
          .eq("id", phase.project_id)
          .single()
      : { data: null };

    // --- Resolve recipients ------------------------------------------------
    let employeeIds: string[] = phase.assigned_employee_ids ?? [];
    let subIds: string[] = phase.assigned_sub_ids ?? [];
    if (opts.onlyEmployeeIds) {
      const only = new Set(opts.onlyEmployeeIds);
      employeeIds = employeeIds.filter((id) => only.has(id));
    }
    if (opts.onlySubIds) {
      const only = new Set(opts.onlySubIds);
      subIds = subIds.filter((id) => only.has(id));
    }

    const [{ data: employees }, { data: subs }] = await Promise.all([
      employeeIds.length
        ? admin
            .from("employees")
            .select("id, first_name, last_name, email, profile_id")
            .in("id", employeeIds)
        : Promise.resolve({ data: [] as EmployeeRecipient[] }),
      subIds.length
        ? admin
            .from("subcontractors")
            .select("id, company_name, contact_name, email")
            .in("id", subIds)
        : Promise.resolve({ data: [] as SubRecipient[] }),
    ]);

    type Recipient = {
      name: string;
      greeting: string;
      email: string | null;
      profileId: string | null;
    };
    const recipients: Recipient[] = [
      ...((employees ?? []) as EmployeeRecipient[]).map((e) => ({
        name: `${e.first_name} ${e.last_name ?? ""}`.trim(),
        greeting: e.first_name,
        email: e.email,
        profileId: e.profile_id,
      })),
      ...((subs ?? []) as SubRecipient[]).map((s) => ({
        name: s.contact_name || s.company_name,
        greeting: s.contact_name?.split(" ")[0] || s.company_name,
        email: s.email,
        profileId: null,
      })),
    ];
    if (recipients.length === 0) return result;

    // --- Compose ------------------------------------------------------------
    const range = formatRange(phase.start_date, phase.end_date);
    const projectLabel = project
      ? `${project.name}${project.project_number ? ` (#${project.project_number})` : ""}`
      : "Penney Construction project";
    const addressLine = project
      ? [project.address, project.city, project.state, project.zip].filter(Boolean).join(", ")
      : "";

    const subject =
      opts.kind === "confirmed"
        ? `You're scheduled: ${phase.name} — ${project?.name ?? "Penney Construction"} (${formatShortRange(phase.start_date, phase.end_date)})`
        : `Schedule update: ${phase.name} — ${project?.name ?? "Penney Construction"}`;

    const buildBody = (greeting: string): string => {
      const lines: string[] = [`Hi ${greeting},`, ""];
      if (opts.kind === "confirmed") {
        lines.push("You've been scheduled for the following work:", "");
      } else {
        lines.push("The schedule for work you're assigned to has changed:", "");
      }
      lines.push(`Project: ${projectLabel}`, `Phase: ${phase.name}`);
      if (opts.kind === "updated" && opts.changes?.length) {
        lines.push("", "What changed:");
        for (const change of opts.changes) lines.push(`- ${change}`);
        lines.push("", `New dates: ${range}`);
      } else {
        lines.push(`Dates: ${range}`);
      }
      if (addressLine) lines.push(`Address: ${addressLine}`);
      if (opts.kind === "confirmed" && phase.notes) lines.push(`Notes: ${phase.notes}`);
      if (opts.kind === "confirmed" && phase.confirmed_with)
        lines.push(`Confirmed with: ${phase.confirmed_with}`);
      lines.push("", "Questions? Reply to this email or call the office.");
      return lines.join("\n");
    };

    // --- Send ---------------------------------------------------------------
    const accessToken = await getServerGmailAccessToken(admin, opts.actorId);
    if (!accessToken) {
      result.error = "No connected Google account available — emails skipped";
      console.error("[schedule-notify] No Gmail token; schedule emails skipped", {
        phaseId: opts.phaseId,
        kind: opts.kind,
      });
    }

    const { data: actorProfile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", opts.actorId)
      .maybeSingle();
    const fromEmail = actorProfile?.email ?? SCHEDULE_CC[0];

    const seenEmails = new Set<string>();
    await Promise.allSettled(
      recipients.map(async (recipient) => {
        // Push to crew with a linked profile regardless of email.
        if (recipient.profileId) {
          try {
            const delivered = await sendPushToUser(admin, recipient.profileId, {
              title: subject,
              body: `${projectLabel} — ${range}`,
              url: "/crew",
              tag: `schedule-phase-${phase.id}`,
            });
            result.pushed += delivered;
          } catch (err) {
            console.error("[schedule-notify] Push failed", {
              recipient: recipient.name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (!recipient.email) {
          result.skipped.push(recipient.name);
          return;
        }
        const emailKey = recipient.email.toLowerCase();
        if (seenEmails.has(emailKey)) return;
        seenEmails.add(emailKey);
        if (!accessToken) return;

        try {
          await sendEmailWithAccessToken(
            {
              to: recipient.email,
              cc: SCHEDULE_CC.filter((cc) => cc.toLowerCase() !== emailKey).join(", "),
              subject,
              body: buildBody(recipient.greeting),
            },
            accessToken,
          );
          result.emailed.push(recipient.name);
          await admin.from("email_logs").insert({
            subject,
            from_email: fromEmail,
            to_email: recipient.email,
            direction: "outbound",
            category: "internal",
            project_id: phase.project_id,
            sent_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error("[schedule-notify] Email failed", {
            recipient: recipient.email,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[schedule-notify] Notification fan-out failed", {
      phaseId: opts.phaseId,
      kind: opts.kind,
      error: result.error,
    });
    return result;
  }
}
