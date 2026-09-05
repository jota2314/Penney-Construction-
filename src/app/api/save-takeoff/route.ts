import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const payload = z.object({
 projectId: z.uuid(), storagePath: z.string().min(1),
 expected: z.array(z.object({id:z.uuid(),updatedAt:z.string().nullable()})),
 measurements:z.array(z.object({
 id:z.uuid(),type:z.enum(["linear","area","count"]),label:z.string().min(1),
 points:z.array(z.object({x:z.number().finite(),y:z.number().finite()})),
 value:z.number().finite().nonnegative(),unit:z.string().min(1),color:z.string(),
 pageNumber:z.number().int().positive(),scalePixelsPerFoot:z.number().positive().nullable(),
 notes:z.string().nullable().optional(),trade:z.string().nullable().optional(),
 })),
});
export async function POST(request:Request) {
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) return NextResponse.json({error:"Not authenticated"},{status:401});
 try {
 const parsed=payload.safeParse(await request.json());
 if(!parsed.success) return NextResponse.json({error:"Invalid takeoff data. Reload the drawing to use the latest save format."},{status:400});
 const {projectId,storagePath,measurements,expected}=parsed.data;
 const {data,error}=await supabase.rpc("save_takeoff_drawing",{
 p_project_id:projectId,p_storage_path:storagePath,p_measurements:measurements,p_expected:expected,
 });
 if(error) return NextResponse.json({error:error.message},{status:error.code==="40001"?409:500});
 return NextResponse.json({success:true,versions:data});
 } catch(err) {return NextResponse.json({error:err instanceof Error?err.message:"Save failed"},{status:500});}
}
