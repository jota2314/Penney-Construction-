import { sendEmailWithAccessToken, sendLargeEmailWithAccessToken } from "@/lib/google/gmail";
import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldVisibleFiles } from "@/lib/crew/crew-visibility";
import { getServerGmailAccessToken } from "@/lib/notifications/tagged-mentions";
import {
  TEST_MODE_RECIPIENT_EMAILS,
  isNotificationTestMode,
  testModeSubject,
} from "@/lib/notifications/test-mode";

const APP_URL = "https://www.penneyconstruction.build";

/** How many upcoming schedule steps the email lists. */
const UPCOMING_STEPS = 8;

/**
 * Gmail caps a message at 25 MB after base64 (which adds about a third), so
 * the raw files attached to one email stay under this. Whatever does not fit
 * is listed by name and stays one tap away in the app.
 */
const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

/** Documents go on before photos, so drawings never lose their spot to a picture. */
const ATTACH_ORDER = ["construction_drawings", "plans", "specs", "permits", "photos"];

type JobFile = {
  id: string;
  filename: string | null;
  size: number | null;
  category: string | null;
  mime_type: string | null;
  storage_path: string | null;
  storage_bucket: string | null;
  created_at: string;
};

type EmailAttachment = { filename: string; mimeType: string; content: string };

/**
 * The job's documents for the PM: drawings, specs, permits and site photos,
 * the way the office Files tab left them (removed files stay out, renames and
 * moves apply, only the latest revision of a drawing set). Money paperwork —
 * invoices, quotes, estimates, contracts — is never attached.
 */
async function loadJobAttachments(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<{ attachments: EmailAttachment[]; leftOut: string[] }> {
  const [{ data: rows }, { data: dismissed }, { data: overrides }] = await Promise.all([
    admin
      .from("project_files")
      .select("id, filename, size, category, mime_type, storage_path, storage_bucket, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    admin.from("project_dismissed_files").select("file_key").eq("project_id", projectId),
    admin.from("project_file_overrides").select("file_key, category, display_name, superseded_at").eq("project_id", projectId),
  ]);

  const rank = (category: string | null) => {
    const i = ATTACH_ORDER.indexOf(category ?? "");
    return i === -1 ? ATTACH_ORDER.length : i;
  };
  const files = fieldVisibleFiles(
    (rows ?? []) as JobFile[],
    (dismissed ?? []).map((d) => d.file_key),
    overrides ?? [],
  )
    .filter((f) => !!f.storage_path && !!f.filename)
    // Stable sort: newest first inside each category.
    .sort((a, b) => rank(a.category) - rank(b.category));

  const attachments: EmailAttachment[] = [];
  const leftOut: string[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const file of files) {
    const name = file.filename as string;
    const key = `${name.toLowerCase()}|${file.size ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (used + (file.size ?? 0) > MAX_ATTACH_BYTES) {
      leftOut.push(name);
      continue;
    }
    try {
      // Email-filed rows live in `email-attachments`, uploads in
      // `project-files`; older rows carry no bucket, so try both.
      const buckets = file.storage_bucket
        ? [file.storage_bucket]
        : ["project-files", "email-attachments"];
      let blob: Blob | null = null;
      for (const bucket of buckets) {
        const { data } = await admin.storage.from(bucket).download(file.storage_path as string);
        if (data) {
          blob = data;
          break;
        }
      }
      if (!blob) {
        leftOut.push(name);
        continue;
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (used + buffer.length > MAX_ATTACH_BYTES) {
        leftOut.push(name);
        continue;
      }
      used += buffer.length;
      attachments.push({
        // The name goes inside a quoted mail header.
        filename: name.replace(/["\\\r\n]/g, "_"),
        mimeType: file.mime_type?.split(";")[0].trim() || "application/octet-stream",
        content: buffer.toString("base64"),
      });
    } catch (err) {
      leftOut.push(name);
      console.error("[pm-assignment-notify] Could not attach file", {
        file: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { attachments, leftOut };
}

export type PmAssignmentNotifyResult = {
  emailed: boolean;
  /** Why nothing was sent (no email on file, no Gmail token, …). */
  error?: string;
};

/** Format a plain YYYY-MM-DD date column without timezone drift. */
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Email (and push) a project manager the moment a job is assigned to them,
 * explaining the job: where it is, who the client is, the scope, and what is
 * coming up on the schedule. Best-effort: never throws — a notification
 * failure must never undo or block the assignment itself.
 *
 * Dollar amounts are left out on purpose: project managers do not see job
 * money in the app, so the email does not show it either.
 */
export async function notifyProjectManagerAssigned(opts: {
  projectId: string;
  pmProfileId: string;
  actorId: string;
}): Promise<PmAssignmentNotifyResult> {
  const result: PmAssignmentNotifyResult = { emailed: false };

  try {
    // Assigning a job to yourself needs no email.
    if (opts.pmProfileId === opts.actorId) return result;

    const admin = createAdminClient();

    const { data: project } = await admin
      .from("projects")
      .select(
        "id, name, project_number, project_type, status, address, city, state, zip, description, scope_of_work, required_trades, next_action, estimated_start_date, estimated_end_date, customer_id, assigned_estimator",
      )
      .eq("id", opts.projectId)
      .maybeSingle();
    if (!project) {
      result.error = "Project not found";
      return result;
    }

    const profileIds = [opts.pmProfileId, opts.actorId, project.assigned_estimator].filter(
      (id): id is string => !!id,
    );
    const today = new Date().toISOString().slice(0, 10);

    const [{ data: profiles }, { data: customer }, { data: phases }] = await Promise.all([
      admin.from("profiles").select("id, full_name, email").in("id", profileIds),
      project.customer_id
        ? admin
            .from("customers")
            .select("first_name, last_name, phone, email")
            .eq("id", project.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("schedule_phases")
        .select("name, start_date, end_date")
        .eq("project_id", opts.projectId)
        .order("start_date", { ascending: true }),
    ]);

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    const pm = byId.get(opts.pmProfileId);
    const actor = byId.get(opts.actorId);
    const estimator = project.assigned_estimator ? byId.get(project.assigned_estimator) : null;

    if (!pm?.email) {
      result.error = "Project manager has no email on file";
      return result;
    }

    // --- Compose ------------------------------------------------------------
    const jobLabel = `${project.name}${project.project_number ? ` (${project.project_number})` : ""}`;
    const addressLine = [project.address, project.city, project.state, project.zip]
      .filter(Boolean)
      .join(", ");
    const clientName = customer
      ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
      : "";
    const actorName = actor?.full_name || "The office";
    const greeting = pm.full_name?.split(" ")[0] || "there";

    const lines: string[] = [
      `Hi ${greeting},`,
      "",
      `${actorName} assigned you as project manager on this job:`,
      "",
      `Job: ${jobLabel}`,
    ];
    if (project.project_type) lines.push(`Type: ${titleCase(project.project_type)}`);
    if (project.status) lines.push(`Status: ${titleCase(project.status)}`);
    if (addressLine) lines.push(`Address: ${addressLine}`);
    if (clientName) {
      const contact = [customer?.phone, customer?.email].filter(Boolean).join(", ");
      lines.push(`Client: ${clientName}${contact ? ` (${contact})` : ""}`);
    }
    if (estimator?.full_name) lines.push(`Estimator: ${estimator.full_name}`);

    if (project.description) lines.push("", "About the job:", project.description);
    if (project.scope_of_work) lines.push("", "Scope of work:", project.scope_of_work);

    const trades = (project.required_trades ?? []).filter(Boolean);
    if (trades.length) lines.push("", `Trades: ${trades.map(titleCase).join(", ")}`);

    const allPhases = phases ?? [];
    if (allPhases.length) {
      const first = allPhases[0].start_date;
      const last = allPhases.reduce((max, p) => (p.end_date > max ? p.end_date : max), allPhases[0].end_date);
      lines.push("", `Schedule: ${formatDate(first)} to ${formatDate(last)} (${allPhases.length} steps)`);
      const upcoming = allPhases.filter((p) => p.end_date >= today).slice(0, UPCOMING_STEPS);
      if (upcoming.length) {
        lines.push("Coming up:");
        for (const phase of upcoming) {
          const when =
            phase.start_date === phase.end_date
              ? formatDate(phase.start_date)
              : `${formatDate(phase.start_date)} to ${formatDate(phase.end_date)}`;
          lines.push(`- ${when}: ${phase.name}`);
        }
      }
    } else if (project.estimated_start_date) {
      lines.push("", `Estimated start: ${formatDate(project.estimated_start_date)}`);
    } else {
      lines.push("", "Schedule: no dates set yet.");
    }

    if (project.next_action) lines.push("", `Next step: ${project.next_action}`);

    // Documents ride along as attachments. A storage hiccup must not stop the
    // email itself, so a failure here just sends it without them.
    let attachments: EmailAttachment[] = [];
    let leftOut: string[] = [];
    try {
      ({ attachments, leftOut } = await loadJobAttachments(admin, project.id));
    } catch (err) {
      console.error("[pm-assignment-notify] Could not load job documents", {
        projectId: project.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const buildBody = (attached: string[], inApp: string[]): string => {
      const out = [...lines];
      if (attached.length) {
        out.push("", `Attached (${attached.length}):`);
        for (const name of attached) out.push(`- ${name}`);
      }
      if (inApp.length) {
        out.push("", "Not attached, open them in the app:");
        for (const name of inApp.slice(0, 15)) out.push(`- ${name}`);
        if (inApp.length > 15) out.push(`- and ${inApp.length - 15} more`);
      }
      out.push(
        "",
        "Open the job in the app for the full scope, schedule, files and photos:",
        `${APP_URL}/projects/${project.id}`,
        "",
        `Questions? Reply to this email or call ${actor?.full_name?.split(" ")[0] || "the office"}.`,
      );
      return out.join("\n");
    };

    const subject = `New job assigned to you: ${project.name}`;
    const attachedNames = attachments.map((a) => a.filename);

    // --- Send ---------------------------------------------------------------
    // Test mode: the email goes to the tester alone, marked, with no push.
    const testMode = await isNotificationTestMode(admin);

    if (!testMode) {
      try {
        await sendPushToUser(admin, pm.id, {
          title: "New job assigned to you",
          body: [project.name, addressLine].filter(Boolean).join(" — "),
          url: `/projects/${project.id}`,
          tag: `pm-assigned-${project.id}`,
        });
      } catch (err) {
        console.error("[pm-assignment-notify] Push failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const accessToken = await getServerGmailAccessToken(admin, opts.actorId);
    if (!accessToken) {
      result.error = "No connected Google account available — email skipped";
      console.error("[pm-assignment-notify] No Gmail token; email skipped", {
        projectId: opts.projectId,
      });
      return result;
    }

    const to = testMode ? TEST_MODE_RECIPIENT_EMAILS[0] : pm.email;
    const sentSubject = testMode ? testModeSubject(`${subject} (for ${pm.email})`) : subject;

    let sentWithFiles = false;
    if (attachments.length) {
      try {
        await sendLargeEmailWithAccessToken(
          { to, subject: sentSubject, body: buildBody(attachedNames, leftOut), attachments },
          accessToken,
        );
        sentWithFiles = true;
      } catch (err) {
        // Google turned the big message down: the PM still gets the rundown,
        // with the documents listed as waiting in the app.
        console.error("[pm-assignment-notify] Send with attachments failed, retrying without", {
          projectId: project.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!sentWithFiles) {
      await sendEmailWithAccessToken(
        { to, subject: sentSubject, body: buildBody([], [...attachedNames, ...leftOut]) },
        accessToken,
      );
    }
    result.emailed = true;

    await admin.from("email_logs").insert({
      subject: sentSubject,
      from_email: actor?.email ?? TEST_MODE_RECIPIENT_EMAILS[0],
      to_email: to,
      direction: "outbound",
      category: "internal",
      project_id: project.id,
      sent_at: new Date().toISOString(),
    });

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[pm-assignment-notify] Failed", {
      projectId: opts.projectId,
      error: result.error,
    });
    return result;
  }
}
