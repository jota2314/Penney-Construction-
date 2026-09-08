import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/auth/role-access.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { canAccessPath } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('PM can reach personal clock and existing PM tools', () => {
  for (const path of ['/command-center/my-time', '/command-center/my-time/history', '/projects', '/warehouse', '/schedule']) {
    assert.equal(canAccessPath({ role: 'project_manager' }, path), true, path);
  }
});
test('Personal clock does not grant private administration access', () => {
  for (const path of ['/settings', '/ceo', '/design', '/command-center/agents']) {
    assert.equal(canAccessPath({ role: 'project_manager', email: 'rdonnelly@penneyconstructioninc.com' }, path), false, path);
  }
  for (const role of ['field', undefined, 'invalid']) assert.equal(canAccessPath({ role }, '/command-center/my-time'), false);
});
