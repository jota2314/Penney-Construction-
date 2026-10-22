import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file, overrides = {}) {
  const compiled = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(name => name in overrides ? overrides[name] : require(name), compiled, compiled.exports);
  return compiled.exports;
}
const validation = load('src/lib/marketing/validation.ts');
const access = load('src/lib/marketing/access.ts');
const itemId = '71762b11-b7c6-4416-b36e-217e44c80792';
const assetId = '6080a6de-cde6-4373-a09d-c2c340c2b4b7';
const item = { title: 'Kitchen reel', kind: 'video', status: 'draft' };
const upload = { item_id: itemId, filename: 'kitchen.mp4', mime_type: 'video/mp4', size: 10, role: 'media', sort_order: 0 };

test('marketing roles exclude field, warehouse, absent and invented roles', () => {
  for (const role of ['owner','office_admin','precon_manager','project_manager']) assert.equal(access.canManageMarketing(role), true);
  for (const role of ['field','warehouse','admin',undefined,null,'OWNER']) assert.equal(access.canManageMarketing(role), false);
});

test('Instagram links reject script schemes, lookalike domains, credentials and ports', () => {
  for (const url of ['https://instagram.com/p/abc/', 'https://www.instagram.com/reel/abc/?igsh=test']) assert.equal(validation.isInstagramUrl(url), true);
  for (const url of ['http://instagram.com/p/abc','javascript:alert(1)','https://instagram.com.evil.test/x','https://evil.test@instagram.com/x','https://instagram.com:8080/x']) assert.equal(validation.isInstagramUrl(url), false);
});

test('Posted requires an actual Instagram post or Reel, not a profile URL', () => {
  for (const instagram_url of [null,'','https://instagram.com/penneyconstruction/','https://instagram.com/','https://instagram.com/p/','https://instagram.com/p/abc/extra']) {
    assert.equal(validation.marketingItemSchema.safeParse({ ...item, status: 'posted', instagram_url }).success, false, String(instagram_url));
  }
  for (const path of ['p/abc','reel/abc/','reels/abc/','tv/abc/?igsh=test']) {
    assert.equal(validation.marketingItemSchema.safeParse({ ...item, status: 'posted', instagram_url: `https://www.instagram.com/${path}` }).success, true, path);
  }
  assert.equal(validation.marketingItemSchema.safeParse({ ...item, instagram_url: null }).success, true);
});

test('item fields trim and normalize nullable fields without inventing posted dates', () => {
  const result = validation.marketingItemSchema.parse({ ...item, title: ' Kitchen reel ', instagram_url: ' ', posted_at: '' });
  assert.equal(result.title, 'Kitchen reel');
  assert.equal(result.posted_at, null);
  assert.equal(result.instagram_url, null);
  assert.equal(result.project_id, null);
  for (const posted_at of ['2026-02-30','2026-13-01','October 22']) assert.equal(validation.marketingItemSchema.safeParse({ ...item, posted_at }).success, false);
  assert.equal(validation.marketingItemSchema.safeParse({ ...item, posted_at: '2026-10-22' }).success, true);
});

test('uploads enforce size, safe names, MIME and role independently', () => {
  assert.equal(validation.marketingUploadSchema.safeParse({ ...upload, size: 500 * 1024 * 1024 }).success, true);
  const invalid = [{ size: 0 },{ size: 500 * 1024 * 1024 + 1 },{ filename: '../kitchen.mp4' },{ filename: 'a\\b.mp4' },
    { mime_type: 'text/html', filename: 'page.html' },{ filename: 'video.jpg' },{ role: 'cover' },
    { mime_type: 'application/zip', filename: 'slides.zip' },{ sort_order: -1 }];
  for (const fields of invalid) assert.equal(validation.marketingUploadSchema.safeParse({ ...upload, ...fields }).success, false, JSON.stringify(fields));
  assert.equal(validation.marketingUploadSchema.safeParse({ ...upload, role: 'download', mime_type: 'application/zip', filename: 'slides.zip' }).success, true);
});

test('object names remain under their reserved item and asset IDs', () => {
  assert.equal(validation.marketingObjectPath(itemId, assetId, 'Kitchen • final.jpg'), `${itemId}/${assetId}/Kitchen---final.jpg`);
  assert.equal(validation.marketingObjectPath(itemId, assetId, '.hidden.jpg'), `${itemId}/${assetId}/file-hidden.jpg`);
  assert.equal(validation.marketingUploadEndpoint('https://abc.supabase.co'), 'https://abc.storage.supabase.co/storage/v1/upload/resumable');
  assert.equal(validation.marketingUploadEndpoint('http://127.0.0.1:54321'), 'http://127.0.0.1:54321/storage/v1/upload/resumable');
});

test('finalization rejects missing, mismatched or incomplete storage metadata', () => {
  assert.equal(validation.storageMetadataMatches(upload, { size: 10, mimetype: 'video/mp4' }), true);
  for (const metadata of [null, {}, { size: 9, mimetype: 'video/mp4' }, { size: 10, mimetype: 'text/html' }]) {
    assert.equal(validation.storageMetadataMatches(upload, metadata), false);
  }
});

test('effective role gates both reads and writes; View as can never write', async () => {
  for (const user of [null, { id: itemId, profile: { role: 'field' } }, { id: itemId, profile: { role: 'warehouse' } }]) {
    const auth = load('src/lib/marketing/auth.ts', { '@/lib/auth/get-user': { getUser: async () => user }, '@/lib/marketing/access': access });
    await assert.rejects(auth.requireMarketingUser(false));
    await assert.rejects(auth.requireMarketingUser(true));
  }
  const user = { id: itemId, profile: { role: 'office_admin' }, isImpersonating: true };
  const auth = load('src/lib/marketing/auth.ts', { '@/lib/auth/get-user': { getUser: async () => user }, '@/lib/marketing/access': access });
  assert.equal(await auth.requireMarketingUser(false), user);
  await assert.rejects(auth.requireMarketingUser(true), /Exit View as/);
});

test('every public server action stops before database access when unauthorized', async () => {
  let dbCalls = 0;
  const actions = load('src/lib/actions/marketing.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/supabase/server': { createClient() { dbCalls++; throw new Error('must not run'); } },
    '@/lib/marketing/auth': { async requireMarketingUser() { throw new Error('Forbidden test'); } },
    '@/lib/marketing/validation': validation,
  });
  const results = await Promise.all([
    actions.getMarketingLibrary(), actions.createMarketingItem(item), actions.updateMarketingItem(itemId,item),
    actions.archiveMarketingItem(itemId), actions.reserveMarketingUpload(upload), actions.finalizeMarketingUpload(assetId),
    actions.reorderMarketingAssets(itemId,[assetId]), actions.removeMarketingAsset(assetId),
  ]);
  for (const result of results) assert.equal(result.error, 'Forbidden test');
  assert.equal(dbCalls, 0);
});

test('an authorized retry of an archived asset succeeds without further mutations', async () => {
  let queries = 0;
  const lookup = {
    select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: { item_id: itemId, archived_at: '2026-10-22T12:00:00Z' }, error: null }; },
  };
  const actions = load('src/lib/actions/marketing.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/supabase/server': { async createClient() { return { from(table) {
      queries++; assert.equal(table, 'marketing_assets'); return lookup;
    } }; } },
    '@/lib/marketing/auth': { async requireMarketingUser(write) { assert.equal(write, true); return { id: itemId }; } },
    '@/lib/marketing/validation': validation,
  });
  assert.deepEqual(await actions.removeMarketingAsset(assetId), { success: true });
  assert.equal(queries, 1);
});
