"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveClockAllocation } from "@/lib/actions/clock-allocation";
export function AllocationReviewForm({id,version,choices}:{id:string;version:string;choices:{id:string;description:string}[]}) {
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState<string|null>(null);
  const router=useRouter();
  return <form onSubmit={event=>{
    event.preventDefault();const form=new FormData(event.currentTarget);setError(null);
    startTransition(async()=>{try{const result=await resolveClockAllocation(form);if(result.error)setError(result.error);else router.refresh();}catch{setError("Could not confirm the save. Refresh the page before trying again.");}});
  }} className="flex flex-col gap-2">
    <input type="hidden" name="id" value={id}/><input type="hidden" name="version" value={version}/>
    <label>Correct task<select name="lineId" required defaultValue="" disabled={pending} className="block w-full rounded border p-2 bg-background"><option value="" disabled>Choose after reviewing the report</option>{choices.map(l=><option key={l.id} value={l.id}>{l.description}</option>)}</select></label>
    <label>Reason / confirmation<input name="reason" required minLength={5} maxLength={1000} disabled={pending} className="block w-full rounded border p-2 bg-background" placeholder="What confirms this allocation?"/></label>
    <button disabled={pending} className="rounded bg-foreground text-background p-2 self-start disabled:opacity-50">{pending?"Saving…":"Save allocation and resolve"}</button>
    {error&&<p role="alert" className="text-red-600">{error}</p>}
  </form>;
}
