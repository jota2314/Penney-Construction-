import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { createScheduledEvent } from "@/lib/google/calendar";
import { downloadAttachmentsForEmail } from "@/lib/actions/email-actions";

/**
 * Execute actions from the todo AI chat:
 * - send_email: Actually send a drafted email via Gmail
 * - schedule_meeting: Create a Google Calendar event
 * - assign_workers: Assign employees to a schedule phase
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { action, data } = await request.json();

    if (action === "send_email") {
      const { to_email, to_name, subject, body, cc, attachment_paths, local_attachments } = data;
      if (!to_email || !subject || !body) {
        return NextResponse.json(
          { error: "to_email, subject, and body are required" },
          { status: 400 }
        );
      }

      // Build attachments from Supabase files + local uploads
      let attachments: { filename: string; mimeType: string; content: string }[] | undefined;
      const downloaded = attachment_paths?.length
        ? await downloadAttachmentsForEmail(attachment_paths)
        : [];
      const local = Array.isArray(local_attachments) ? local_attachments : [];
      const all = [...downloaded, ...local];
      if (all.length > 0) attachments = all;

      const result = await sendEmail({
        to: to_name ? `${to_name} <${to_email}>` : to_email,
        subject,
        body,
        cc: cc || undefined,
        attachments,
      });

      // Log the sent email
      await supabase.from("email_logs").insert({
        gmail_message_id: result.id,
        subject,
        from_email: "jbetancur@penneyconstructioninc.com",
        to_email: to_email,
        direction: "outbound",
        category: "follow_up",
        sent_at: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        messageId: result.id,
        threadId: result.threadId,
      });
    }

    if (action === "schedule_meeting") {
      const { name, description, location, start_time, end_time, attendees, with_meet_link } = data;
      if (!name || !start_time) {
        return NextResponse.json(
          { error: "name and start_time are required" },
          { status: 400 }
        );
      }

      // Default end time: 1 hour after start
      const endTime =
        end_time ||
        new Date(
          new Date(start_time).getTime() + 60 * 60 * 1000
        ).toISOString();

      const event = await createScheduledEvent({
        name,
        description: description || undefined,
        location: location || undefined,
        startTime: start_time,
        endTime,
        attendees: attendees || undefined,
        withMeetLink: with_meet_link !== false,
      });

      return NextResponse.json({
        success: true,
        event: {
          id: event.id,
          link: event.htmlLink,
          summary: event.summary,
          start: event.start.dateTime,
          end: event.end.dateTime,
          meetLink: event.hangoutLink || null,
        },
      });
    }

    if (action === "assign_workers") {
      const { project_id, phase_name, employee_ids, start_date, end_date } = data;
      if (!project_id || !employee_ids?.length) {
        return NextResponse.json(
          { error: "project_id and employee_ids are required" },
          { status: 400 }
        );
      }

      // Check if a phase already exists for this assignment
      const { data: existingPhase } = await supabase
        .from("schedule_phases")
        .select("id")
        .eq("project_id", project_id)
        .eq("name", phase_name || "General Work")
        .single();

      if (existingPhase) {
        // Update existing phase with new workers
        await supabase
          .from("schedule_phases")
          .update({
            assigned_employee_ids: employee_ids,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingPhase.id);

        return NextResponse.json({ success: true, phaseId: existingPhase.id });
      }

      // Create a new schedule phase
      const { data: newPhase, error } = await supabase
        .from("schedule_phases")
        .insert({
          project_id,
          name: phase_name || "General Work",
          start_date: start_date || new Date().toISOString().split("T")[0],
          end_date:
            end_date ||
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
          status: "not_started",
          assigned_employee_ids: employee_ids,
          sort_order: 0,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, phaseId: newPhase?.id });
    }

    if (action === "get_employees") {
      const { data: employees, error } = await supabase
        .from("employees")
        .select("id, first_name, last_name, title, status, hourly_rate, phone, email")
        .eq("status", "active")
        .order("last_name");

      if (error) throw error;
      return NextResponse.json({ employees: employees || [] });
    }

    if (action === "get_project_files") {
      const { project_id } = data;
      if (!project_id) {
        return NextResponse.json(
          { error: "project_id required" },
          { status: 400 }
        );
      }

      // Fetch from all 3 sources in parallel
      const [uploadedRes, emailsRes, quotesRes] = await Promise.all([
        // Direct project files
        supabase
          .from("project_files")
          .select("filename, storage_path, mime_type, size, category")
          .eq("project_id", project_id)
          .order("created_at", { ascending: false }),
        // Email attachments linked to this project
        supabase
          .from("inbox_emails")
          .select("subject, attachments")
          .eq("project_id", project_id)
          .not("attachments", "is", null),
        // Quote PDFs
        supabase
          .from("quote_requests")
          .select(
            "subcontractor_name, attachment_storage_path, document_type"
          )
          .eq("project_id", project_id)
          .not("attachment_storage_path", "is", null),
      ]);

      interface FileItem {
        filename: string;
        storagePath: string;
        mimeType: string;
        size: number;
        bucket: string;
        source: string;
      }

      const files: FileItem[] = [];

      // Project files
      (uploadedRes.data ?? []).forEach((f) => {
        files.push({
          filename: f.filename,
          storagePath: f.storage_path,
          mimeType: f.mime_type || "application/octet-stream",
          size: f.size || 0,
          bucket: "project-files",
          source: `Project: ${f.category}`,
        });
      });

      // Email attachments
      (emailsRes.data ?? []).forEach((email) => {
        const atts = (email.attachments || []) as {
          filename: string;
          mimeType: string;
          size: number;
          storage_path?: string;
        }[];
        atts.forEach((att) => {
          if (!att.storage_path) return;
          // Skip tiny images (likely email signatures)
          if (
            att.size < 80000 &&
            att.mimeType?.startsWith("image/")
          )
            return;
          files.push({
            filename: att.filename,
            storagePath: att.storage_path,
            mimeType: att.mimeType || "application/octet-stream",
            size: att.size || 0,
            bucket: "email-attachments",
            source: `Email: ${email.subject?.substring(0, 40) || ""}`,
          });
        });
      });

      // Quote PDFs
      (quotesRes.data ?? []).forEach((q) => {
        if (!q.attachment_storage_path) return;
        files.push({
          filename: `${q.subcontractor_name} - ${q.document_type}.pdf`,
          storagePath: q.attachment_storage_path,
          mimeType: "application/pdf",
          size: 0,
          bucket: "email-attachments",
          source: `Quote: ${q.subcontractor_name}`,
        });
      });

      return NextResponse.json({ files });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
