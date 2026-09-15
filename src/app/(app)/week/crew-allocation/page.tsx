import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { isFieldTask } from "@/lib/crew/clock-task-policy";
import { AllocationReviewForm } from "@/components/crew/allocation-review-form";
async function loadAll<T>(makePage: (from: number, to: number) => PromiseLike<{data: T[] | null; error: {message: string} | null}>) {
  return fetchAllRows(async (from,to) => {
    const result=await makePage(from,to);
    if(result.error) throw new Error("Allocation review could not load: " + result.error.message);
    return result;
  });
}
export default async function CrewAllocationPage() {
  await requireRole(["owner","office_admin","precon_manager"]);
  const db = await createClient();
  const logs = await loadAll((from,to) => db.from("daily_logs")
    .select("id,project_id,author_id,started_at,ended_at,status,text,line_item_note,updated_at,estimate_line_item_id,daily_report_id,phase:schedule_phases!schedule_phase_id(estimate_line_item_id),worker:profiles!author_id(full_name),project:projects!project_id(name)")
    .eq("line_item_needs_review",true).order("started_at",{ascending:false}).order("id").range(from,to));
  const rows = (logs ?? []).filter(l=>l.status === "in_progress" || (l.ended_at && l.started_at < l.ended_at));
  const projectIds = [...new Set(rows.map(l=>l.project_id).filter(Boolean))];
  const {data: estimates} = projectIds.length ? await db.from("estimates").select("id,project_id,status").in("project_id",projectIds).neq("status","superseded") : {data:[]};
  const estimateIds = (estimates??[]).map(e=>e.id);
  const lines = estimateIds.length ? await loadAll((from,to)=>db.from("estimate_line_items").select("id,estimate_id,description,is_locked,is_section_header").in("estimate_id",estimateIds).order("sort_order").order("id").range(from,to)) : [];
  const reportIds = [...new Set(rows.map(l=>l.daily_report_id).filter(Boolean))];
  const {data: reports,error: reportError} = reportIds.length ? await db.from("daily_logs").select("id,text").in("id",reportIds) : {data:[],error:null};
  if(reportError) throw new Error("Work reports could not load.");
  const reportById=new Map((reports??[]).map(r=>[r.id,r.text]));
  return <main className="mx-auto max-w-5xl space-y-5 p-6">
    <Link href="/week" className="underline">Back to Weekly Close</Link>
    <h1 className="text-2xl font-semibold">Crew time — allocation review</h1>
    <p>{rows.length} entries need review. Confirm the work before assigning a line. For mixed tasks, leave the entry pending until the hour split is known. Recorded hours stay unchanged.</p>
    {rows.map(log=>{
      const project=Array.isArray(log.project)?log.project[0]:log.project;
      const worker=Array.isArray(log.worker)?log.worker[0]:log.worker;
      const phase=Array.isArray(log.phase)?log.phase[0]:log.phase;
      const currentId=log.estimate_line_item_id??phase?.estimate_line_item_id;
      const current=(lines??[]).find(l=>l.id===currentId);
      const eligibleEstimates=new Set((estimates??[]).filter(e=>e.project_id===log.project_id).map(e=>e.id));
      const choices=(lines??[]).filter(l=>eligibleEstimates.has(l.estimate_id)&&!l.is_locked&&!l.is_section_header&&isFieldTask(l.description));
      return <section key={log.id} className="rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold">{worker?.full_name} · {project?.name} · {new Date(log.started_at).toLocaleDateString("en-US",{timeZone:"America/New_York"})}</h2>
        <p>{log.ended_at ? `${((Date.parse(log.ended_at)-Date.parse(log.started_at))/3600000).toFixed(2)} hours before breaks` : "Still clocked in"} · {current?.description??(currentId?"Existing task (see review note)":"Unassigned")}</p>
        <p className="whitespace-pre-wrap text-sm">{log.text||reportById.get(log.daily_report_id)||"No written report yet."}</p>
        <p className="whitespace-pre-wrap text-sm text-amber-700 dark:text-amber-400">{log.line_item_note}</p>
        {log.status==="completed"&&<AllocationReviewForm id={log.id} version={log.updated_at} choices={choices}/>}
      </section>;
    })}
  </main>;
}
