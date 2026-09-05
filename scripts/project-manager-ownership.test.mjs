import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function load(path) {
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const team = await load('../src/lib/auth/team-access.ts');
const access = await load('../src/lib/auth/role-access.ts');
test('Office users can assign a responsible PM without granting that person a role', () => {
  for (const role of ['owner', 'precon_manager', 'project_manager', 'office_admin']) assert.equal(team.canAssignProjectManager(role), true);
  for (const role of ['field', null, undefined, 'invalid']) assert.equal(team.canAssignProjectManager(role), false);
  assert.equal(team.canBeProjectManager('project_manager'), true);
  assert.equal(team.canBeProjectManager('owner'), true);
  assert.equal(team.canBeProjectManager('office_admin'), false);
  assert.equal(team.canBeProjectManager('field'), false);
});
test('PMs cannot open EOS even if they are on its old email allowlist', () => {
  for (const path of ['/eos', '/eos/rocks', '/command-center/agents', '/command-center/agents/example']) {
    assert.equal(access.canAccessPath({role: 'project_manager', email: 'hclick@penneyconstructioninc.com'}, path), false, path);
  }
  assert.equal(access.canAccessPath({role: 'project_manager', email: 'hclick@penneyconstructioninc.com'}, '/projects/example'), true);
});
