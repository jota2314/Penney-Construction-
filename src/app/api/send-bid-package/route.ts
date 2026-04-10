import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { markBidSent, updateBidPackageStatus, getBidEmailTemplate } from "@/lib/actions/bids";

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

      try {
        const sent = await sendEmail({ to: sub.email, subject, body });

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
      results,
    });
  } catch (error) {
    console.error("send-bid-package error:", error);
    return NextResponse.json({ error: "Failed to send bid package" }, { status: 500 });
  }
}
