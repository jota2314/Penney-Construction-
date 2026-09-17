import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function moduleAt(path, imports={}) {
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,require:name=>{if(name in imports)return imports[name];throw new Error(name);},console});
 return module.exports;
}
test('financial pagination reads >1000 rows and never reports partial totals after failure',async()=>{
 const {financialRows}=moduleAt('src/lib/crew/load-labor-ledger.ts',{'./labor-ledger':{},'@/lib/auth/get-user':{},'@/lib/supabase/admin':{}});
 const input=Array.from({length:2111},(_,id)=>({id}));
 const all=await financialRows((f,t)=>Promise.resolve({data:input.slice(f,t+1),error:null}));
 assert.equal(all.length,2111);assert.equal(all[2110].id,2110);
 await assert.rejects(financialRows((f,t)=>Promise.resolve(f?{data:null,error:{message:'page failed'}}:{data:input.slice(f,t+1),error:null})),/page failed/);
});
test('protected employee wage totals are masked alongside their rate',()=>{
 const {maskTimeEntryRates}=moduleAt('src/lib/auth/rate-visibility.ts',{'./get-user':{},'./role-access':{},'@/lib/supabase/admin':{}});
 const visibility={viewAll:true,hiddenEmployeeIds:new Set(['hidden']),hiddenProfileIds:new Set(),protectedEmployeeIds:new Set(),protectedProfileIds:new Set()};
 const rows=maskTimeEntryRates(visibility,[{employee_id:'hidden',employees:{first_name:'Private',last_name:'Pay',hourly_rate:60},wage_cents:45000,project_cost_cents:45000,paid_minutes:450}]);
 assert.equal(rows[0].employees.hourly_rate,null);assert.equal(rows[0].wage_cents,0);assert.equal(rows[0].project_cost_cents,0);assert.equal(rows[0].paid_minutes,450);
});
