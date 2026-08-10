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
  const seen = new Set<string>(); // Dedup by filename

  // 1. Get drawings and specs from project_files table
  const { data: files } = await supabase
    .from("project_files")
    .select("filename, storage_path, mime_type, category")
    .eq("project_id", projectId)
    .in("category", ["construction_drawings", "specs", "estimates"])
    .order("created_at", { ascending: false })
    .limit(5);

  for (const file of files || []) {
    try {
      // project_files doesn't track which bucket the file actually lives
      // in. Drawings registered from the takeoff viewer often point at
      // email-attachments (email-delivered PDFs) instead of project-files.
      // Try both buckets.
      let blob: Blob | null = null;
      const { data: d1 } = await supabase.storage
        .from("project-files")
        .download(file.storage_path);
      blob = d1;
      if (!blob) {
        const { data: d2 } = await supabase.storage
          .from("email-attachments")
          .download(file.storage_path);
        blob = d2;
      }

      if (blob) {
        const buffer = await blob.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        attachments.push({
          filename: file.filename,
          mimeType: file.mime_type || "application/pdf",
          content: base64,
        });
        seen.add(file.filename.toLowerCase());
      } else {
        console.error(`project_files row ${file.filename} not found in either project-files or email-attachments bucket (path: ${file.storage_path})`);
      }
    } catch (err) {
      console.error(`Failed to download project file ${file.filename}:`, err);
    }
  }

  // 2. Also check email attachments for PDFs (construction drawings often come via email)
  if (attachments.length < 5) {
    const { data: emails } = await supabase
      .from("inbox_emails")
      .select("attachments")
      .eq("project_id", projectId)
      .not("attachments", "is", null)
      .order("date", { ascending: false })
      .limit(20);

    const pdfAttachments: { filename: string; storage_path: string; mimeType: string }[] = [];
    for (const email of emails || []) {
      const atts = email.attachments as { filename: string; storage_path?: string; mimeType?: string }[] | null;
      if (!atts) continue;
      for (const att of atts) {
        if (!att.storage_path) continue;
        const isPdf = att.mimeType === "application/pdf" || att.filename?.toLowerCase().endsWith(".pdf");
        if (!isPdf) continue;
        if (seen.has(att.filename.toLowerCase())) continue;
        pdfAttachments.push({ filename: att.filename, storage_path: att.storage_path, mimeType: att.mimeType || "application/pdf" });
        seen.add(att.filename.toLowerCase());
      }
    }

    // Download up to remaining slots
    const remaining = 5 - attachments.length;
    for (const att of pdfAttachments.slice(0, remaining)) {
      try {
        const { data: blob } = await supabase.storage
          .from("email-attachments")
          .download(att.storage_path);

        if (blob) {
          const buffer = await blob.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          attachments.push({ filename: att.filename, mimeType: att.mimeType, content: base64 });
        }
      } catch (err) {
        console.error(`Failed to download email attachment ${att.filename}:`, err);
      }
    }
  }

  return attachments;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { bidPackageId, customSubject, customBody, selectedFiles } = await request.json();
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

    // If no scope on bid package, pull trade-specific scope from estimate
    let scopeText = pkg.scope_of_work || "";
    if (!scopeText) {
      // Canonical current estimate — a status filter here returned nothing
      // for signed jobs, sending subs a bid package with no scope.
      const { data: currentEstimateId } = await supabase.rpc("current_estimate_id", {
        p_project_id: pkg.project_id,
      });

      if (currentEstimateId) {
        const { data: lines } = await supabase
          .from("estimate_line_items")
          .select("description, scope_text, trade")
          .eq("estimate_id", currentEstimateId as string)
          .ilike("trade", `%${pkg.trade}%`);

        if (lines?.length) {
          scopeText = lines.map((l) => l.scope_text || "").filter(Boolean).join("\n\n");
        }
      }
    }

    // Fetch attachments — use user-selected files if provided, otherwise auto-fetch
    let fileAttachments: Attachment[];
    if (selectedFiles && Array.isArray(selectedFiles) && selectedFiles.length > 0) {
      fileAttachments = [];
      for (const sf of selectedFiles as { filename: string; storage_path: string; bucket: string }[]) {
        try {
          // Preferred bucket first, fall back to the other if not found
          const preferred = sf.bucket === "project-files" ? "project-files" : "email-attachments";
          const fallback = preferred === "project-files" ? "email-attachments" : "project-files";
          let blob: Blob | null = null;
          const { data: d1 } = await supabase.storage.from(preferred).download(sf.storage_path);
          blob = d1;
          if (!blob) {
            const { data: d2 } = await supabase.storage.from(fallback).download(sf.storage_path);
            blob = d2;
          }
          if (blob) {
            const buffer = await blob.arrayBuffer();
            fileAttachments.push({
              filename: sf.filename,
              mimeType: "application/pdf",
              content: Buffer.from(buffer).toString("base64"),
            });
          } else {
            console.error(`Selected file ${sf.filename} not found in either bucket (path: ${sf.storage_path})`);
          }
        } catch (err) {
          console.error(`Failed to download selected file ${sf.filename}:`, err);
        }
      }
    } else {
      fileAttachments = await getProjectAttachments(supabase, pkg.project_id);
    }

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
        scopeOfWork: scopeText || "See attached documents for scope details.",
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
