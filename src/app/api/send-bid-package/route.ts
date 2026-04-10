import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { markBidSent, updateBidPackageStatus, getBidEmailTemplate } from "@/lib/actions/bids";

interface Attachment {
  filename: string;
  mimeType: string;
  content: string;
}

/** Fetch project drawings + specs from Supabase storage, convert to base64 attachments */
async function getProjectAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];

  // Get drawings and specs from project_files
  const { data: files } = await supabase
    .from("project_files")
    .select("filename, storage_path, mime_type, category")
    .eq("project_id", projectId)
    .in("category", ["construction_drawings", "specs", "estimates"])
    .order("created_at", { ascending: false })
    .limit(5); // Max 5 attachments to keep email reasonable

  if (!files || files.length === 0) return attachments;

  for (const file of files) {
    try {
      const { data: blob } = await supabase.storage
        .from("project-files")
        .download(file.storage_path);

      if (blob) {
        const buffer = await blob.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        attachments.push({
          filename: file.filename,
          mimeType: file.mime_type || "application/pdf",
          content: base64,
        });
      }
    } catch (err) {
      console.error(`Failed to download ${file.filename}:`, err);
    }
  }

  return attachments;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { bidPackageId, customSubject, customBody } = await request.json();
    if (!bidPackageId) {
      return NextResponse.json({ error: "bidPackageId required" }, { status: 400 });
    }

    // Get the bid package with bids + sub details
    const { data: pkg, error: pkgError } = await supabase
      .from("bid_packages")
      .select(`
        *,
        subcontractor_bids (
          id, subcontractor_id, status,
          subcontractors ( company_name, contact_name, email )
        ),
        projects ( name, address, city, state )
      `)
      .eq("id", bidPackageId)
      .single();

    if (pkgError || !pkg) {
      return NextResponse.json({ error: "Bid package not found" }, { status: 404 });
    }

    // Get the email template
    const template = await getBidEmailTemplate(pkg.trade);

    // Fetch project drawings/specs to attach
    const fileAttachments = await getProjectAttachments(supabase, pkg.project_id);

    const results: { subId: string; name: string; success: boolean; error?: string }[] = [];

    // Send to each invited sub
    for (const bid of pkg.subcontractor_bids) {
      const sub = bid.subcontractors;
      if (!sub?.email || bid.status !== "invited") continue;

      // Build variables for template
      const vars: Record<string, string> = {
        contactName: sub.contact_name || sub.company_name,
        projectName: pkg.projects?.name || pkg.name,
        projectAddress: pkg.project_address || [pkg.projects?.address, pkg.projects?.city, pkg.projects?.state].filter(Boolean).join(", ") || "TBD",
        trade: pkg.trade,
        dueDate: pkg.due_date ? new Date(pkg.due_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "ASAP",
        scopeOfWork: pkg.scope_of_work || "See attached documents for scope details.",
      };

      // Replace {{variables}} in template
      let subject = customSubject || template?.subject || `Request for Quote — ${pkg.trade} | ${vars.projectName}`;
      let body = customBody || template?.body || "";

      for (const [key, value] of Object.entries(vars)) {
        subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
        body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
      }

      // Add attachment note to body if files attached
      if (fileAttachments.length > 0) {
        body += `\n\nAttached: ${fileAttachments.map((a) => a.filename).join(", ")}`;
      }

      try {
        const sent = await sendEmail({
          to: sub.email,
          subject,
          body,
          attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
        });

        // Mark bid as sent with gmail message ID
        await markBidSent(bid.id, sent.id);

        // Log to email_logs
        await supabase.from("email_logs").insert({
          gmail_message_id: sent.id,
          direction: "outbound",
          category: "sub_outreach",
          project_id: pkg.project_id,
          created_by: user.id,
        });

        results.push({ subId: bid.subcontractor_id, name: sub.company_name, success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Send failed";
        results.push({ subId: bid.subcontractor_id, name: sub.company_name, success: false, error: msg });
      }
    }

    // Update package status to 'sent'
    const anySuccess = results.some((r) => r.success);
    if (anySuccess) {
      await updateBidPackageStatus(bidPackageId, "sent");
    }

    return NextResponse.json({
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      attachedFiles: fileAttachments.length,
      results,
    });
  } catch (error) {
    console.error("send-bid-package error:", error);
    return NextResponse.json({ error: "Failed to send bid package" }, { status: 500 });
  }
}
