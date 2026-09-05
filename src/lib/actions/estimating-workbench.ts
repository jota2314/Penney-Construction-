"use server";

import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { isEstimateRequest } from "@/lib/estimates/workbench";
import { loadFieldLearning } from "@/lib/estimates/load-field-learning";

export async function getEstimatingWorkbench() {
  const user = await requireAuth();
  if (!user.profile || !["owner", "precon_manager", "project_manager", "office_admin"].includes(user.profile.role)) {
    return { projects: [], requests: [], quotes: [], labor: [], error: "Office access required" };
  }
  const db = await createClient();
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const [projects, emails, quotes, field, drawings] = await Promise.all([
    db.from("projects").select("id,name,project_number,status,next_action,assigned_estimator,project_drawings")
      .in("status", ["lead", "estimating", "waiting_for_approval", "proposal_sent"]).order("updated_at", { ascending: false }),
    db.from("inbox_emails").select("id,subject,from_name,from_email,ai_summary,content_type,sender_type,ai_action_required,project_id,matched_project_id,date")
      .eq("direction", "inbound").eq("content_type", "inquiry").eq("is_dismissed", false)
      .gte("date", since).order("date", { ascending: false }).limit(200),
    db.from("quote_requests").select("id,project_id,subcontractor_name,trade,amount,status,scope_description,created_at")
      .not("amount", "is", null).order("created_at", { ascending: false }).limit(150),
    loadFieldLearning(db).then(data => ({ data, error: null as { message: string } | null })).catch(error => ({ data: [], error: { message: String(error) } })),
    db.from("project_files").select("project_id").eq("category", "construction_drawings").limit(1000),
  ]);
  const error = [projects, emails, quotes, field].find(result => result.error)?.error?.message || null;
  return {
    projects: (projects.data || []).map(project => ({ ...project, drawingCount: (drawings.data || []).filter(file => file.project_id === project.id).length })),
    requests: (emails.data || []).filter(isEstimateRequest),
    quotes: quotes.data || [],
    labor: field.data,
    error,
  };
}

export type EstimatingWorkbenchData = Awaited<ReturnType<typeof getEstimatingWorkbench>>;
