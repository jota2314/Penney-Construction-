import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/projects/project-list.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { matchesProjectList, matchesProjectStage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const base = { name: 'Parziale Renovation', project_number: 'PC-104', status: 'contracted', assigned_pm: 'bill', project_manager_name: 'Bill Crowley', customer: { first_name: 'Jane', last_name: 'Parziale' } };
const options = { search: '', stage: 'work', mine: true, viewerId: 'bill' };

test('assigned upcoming jobs move to Running without changing ownership', () => {
  for (const status of ['lead', 'estimating', 'waiting_for_approval', 'proposal_sent', 'contracted']) {
    assert.equal(matchesProjectStage(status, 'preconstruction'), true);
    assert.equal(matchesProjectList({ ...base, status }, options), true);
  }
  const running = { ...base, status: 'in_progress' };
  assert.equal(matchesProjectList(running, options), true);
  assert.equal(matchesProjectList(running, { ...options, stage: 'preconstruction' }), false);
  assert.equal(matchesProjectList(running, { ...options, stage: 'in_progress' }), true);
  for (const status of ['audit', 'completed', 'cancelled']) {
    assert.equal(matchesProjectList({ ...base, status }, options), false);
    assert.equal(matchesProjectList({ ...base, status }, { ...options, stage: status }), true);
  }
});

test('My Projects uses manager identity; All Projects includes other and unassigned jobs', () => {
  for (const assigned_pm of ['other', null]) {
    assert.equal(matchesProjectList({ ...base, assigned_pm }, options), false);
    assert.equal(matchesProjectList({ ...base, assigned_pm }, { ...options, mine: false }), true);
  }
});

test('search spans every stage and owner, matches number, full client and PM names', () => {
  for (const status of ['lead', 'contracted', 'in_progress', 'audit', 'completed', 'cancelled']) {
    for (const search of [' parziale ', 'PC-104', 'Jane Parziale', 'BILL']) {
      assert.equal(matchesProjectList({ ...base, status }, { ...options, viewerId: 'other', stage: 'in_progress', search }), true);
    }
  }
  assert.equal(matchesProjectList(base, { ...options, search: 'missing project' }), false);
  assert.equal(matchesProjectList(base, { ...options, search: '   ', stage: 'in_progress' }), false);
});
