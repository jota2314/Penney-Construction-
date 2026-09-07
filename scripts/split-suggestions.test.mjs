import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSplitJson, validateSplitAmounts, splitAnalysisSchema } from '../src/lib/finance/split-suggestions.ts';
test('accept fenced JSON after model explanation',()=>assert.deepEqual(parseSplitJson('Explanation\n```json\n{"pieces":[]}\n```'),{pieces:[]}));
test('exact itemized total and credits',()=>{
  validateSplitAmounts(43.17,[{amount:12.01},{amount:31.16}]);
  validateSplitAmounts(-43.17,[{amount:-12.01},{amount:-31.16}]);
  validateSplitAmounts(43.17,[]);
});
test('reject imbalance, zero, mixed signs and sub-cent values',()=>{
  for(const pieces of [[{amount:21.59},{amount:21.59}],[{amount:0},{amount:43.17}],[{amount:-1},{amount:44.17}],[{amount:21.585},{amount:21.585}]]) assert.throws(()=>validateSplitAmounts(43.17,pieces));
});
test('uncertain jobs remain unset, malformed IDs rejected',()=>{
  assert.equal(splitAnalysisSchema.parse({explanation:'Missing site',warnings:[],pieces:[{project_id:null,amount:43.17,note:'Receipt items'}]}).pieces[0].project_id,null);
  assert.throws(()=>splitAnalysisSchema.parse({explanation:'',warnings:[],pieces:[{project_id:'invented',amount:43.17,note:'items'}]}));
});
