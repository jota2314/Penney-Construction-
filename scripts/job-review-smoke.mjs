// Authenticated read-only smoke test. Writes only review audit baselines.
// NODE_ENV/deployment URL is supplied explicitly; never print service secrets.
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const base=process.argv[2] ?? 'http://localhost:3091';
if (!['http://localhost:3091','https://www.penneyconstruction.build'].includes(base)) throw Error('Unexpected review destination');
const project='b12ec6da-a6ca-4d9e-92ae-80c334c49517';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const [key,actor]=await Promise.all([db.from('app_settings').select('value').eq('key','proposal_pdf_service_key').single(),db.from('profiles').select('id').eq('email','jbetancur@penneyconstructioninc.com').single()]);
if(key.error||actor.error)throw Error('Service authentication unavailable');
const headers={'content-type':'application/json','x-service-key':String(key.data.value),'x-penney-actor':actor.data.id};
let last;const durations=[];
for(let i=0;i<3;i++){
 const t=Date.now();const response=await fetch(`${base}/api/job-review`,{method:'POST',headers,body:JSON.stringify({action:'get_job_review',project_id:project})});
 last=await response.json();if(!response.ok)throw Error(JSON.stringify(last));durations.push(Date.now()-t);
}
if(last.money.recorded_cost!==1090642||last.money.net_minutes!==341)throw Error('Conway trial no longer matches; inspect changed records before claiming parity');
const inspected=await fetch(`${base}/api/job-review`,{method:'POST',headers,body:JSON.stringify({action:'inspect_job_finding',project_id:project,run_id:last.run_id,finding_id:last.findings[0].id})});
if(!inspected.ok)throw Error('Evidence drill-down failed: '+await inspected.text());
const unauth=await fetch(`${base}/api/job-review`,{method:'POST',headers:{...headers,'x-service-key':'invalid'},body:'{}'});if(unauth.status!==401)throw Error('Invalid service key accepted');
const missing=await fetch(`${base}/api/job-review`,{method:'POST',headers,body:JSON.stringify({action:'apply_job_correction',project_id:project,preview_id:crypto.randomUUID()})});if(missing.status!==400)throw Error('Missing correction authorization accepted');
fs.writeFileSync('.job-review-result.json',JSON.stringify(last,null,2));
console.log(JSON.stringify({durations_ms:durations,saved_run:last.run_id,money:last.money,changes:last.changes,drill_down:inspected.status,unauthorized:unauth.status,missing_authorization:missing.status},null,2));
