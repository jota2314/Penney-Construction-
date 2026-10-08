// Migrate an existing local audit's open issues, never alter business records.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const project='b12ec6da-a6ca-4d9e-92ae-80c334c49517';
const root=`../financial-reviews/${project}/2026-10-08-r03-timed`;
const read=file=>JSON.parse(fs.readFileSync(`${root}/${file}`,'utf8'));
const entries=[...read('current-records.json'),...read('supplemental-records.json')];
const records=Object.fromEntries(entries.map(e=>[e.source,e.records]));
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`:JSON.stringify(v)??'null';
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:actor,error}=await db.from('profiles').select('id').eq('email','jbetancur@penneyconstructioninc.com').single();if(error)throw error;
const {data:existing,error:readError}=await db.from('job_review_evidence').select('title,line_id').eq('project_id',project);if(readError)throw readError;
const lineMap={F02:['4cea5d4d-02ec-4141-a3ba-b4e543ac6ccb'],F04:['dfaf5b45-90a7-4fd4-ba55-2f4aec6f320c','b3d510ad-b248-444d-aa1e-d55e8ff8013c']};
const issueBills={F02:['d87e22a5-87e7-4efc-9190-f196a17eb6de'],F04:['87b9a027-58be-479b-8a47-2e39bf0828de','d11588a0-b73f-48c8-a47f-a075379c643f']};
const actions={F01:'Reconcile final invoice #2 with drafts #3/#4 before any further billing. Verify the October 10 due date and receipt evidence.',S01:'Howie/Luis: confirm the screen order, ETA, installation and remaining cost before closeout.',F02:'Howie/BCI: confirm the approved insulation specification and allocate the combined attic/garage bill.',F03:'Howie: obtain the issued permit, fee receipt and passed inspection records.',L01:'Howie/Steven: confirm the September 30 location before assigning $62.07 of crew time.',F04:'Verify WRD’s $600/$900 split and correct the garage-wall allocation while preserving the $1,500 source total.',F05:'Reconcile modeled wages to payroll and burden; confirm the unallocated September 30 shift.',S02:'Howie: verify actual phase dates and remaining screen/inspection/punch work.',L02:'Obtain dated finish photos and confirm the foam/opener-removal sequence.',F06:'Reconcile remittances, missing costs and credits before calculating final profit.',A01:'Resolve remaining document, photo, permit and payroll evidence gaps.',F07:'Verify the executed change order and its $275 cost linkage.'};
let count=0;
for(const issue of read('issues.json')){
 const ids=new Set((`${issue.evidence} ${issue.finding}`).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g)??[]);
 for(const id of issueBills[issue.id]??[])ids.add(id);
 const refs={};
 for(const [source,rows]of Object.entries(records))for(const row of rows){
  if(ids.has(row.id)||(issue.id==='F06'&&source==='invoices')||(issue.id==='A01'&&source==='projects'))refs[`${source}:${row.id}`]=hash(row);
 }
 // If this is a broad coverage finding, anchor it to the saved project/files.
 if(!Object.keys(refs).length)for(const row of records.project_files??[])refs[`project_files:${row.id}`]=hash(row);
 for(const lineId of lineMap[issue.id]??[null]){
  const title=`[${issue.id}] ${issue.finding}`;
  if(existing.some(e=>e.title===title&&e.line_id===lineId)){
   let update=db.from('job_review_evidence').update({priority:issue.priority==='P1'?1:2,action:actions[issue.id]??issue.action}).eq('project_id',project).eq('title',title);
   update=lineId?update.eq('line_id',lineId):update.is('line_id',null);const {error}=await update;if(error)throw error;continue;
  }
  if(lineId){const row=records.lines.find(l=>l.id===lineId);refs[`lines:${lineId}`]=hash(row);}
  const {error:saveError}=await db.from('job_review_evidence').insert({project_id:project,actor_id:actor.id,title,action:actions[issue.id]??issue.action,priority:issue.priority==='P1'?1:2,classification:lineMap[issue.id]?'allocation_question':'question',line_id:lineId,refs,reviewed_at:'2026-10-08T20:29:01Z',resolved:false});
  if(saveError)throw saveError;count++;
 }
}
console.log(JSON.stringify({imported_open_findings:count,source:root,business_records_changed:false}));
