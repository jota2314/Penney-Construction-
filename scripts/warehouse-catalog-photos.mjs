// Prepare: node scripts/warehouse-catalog-photos.mjs <folder>
// Publish after visual review: node --env-file=<existing env file> scripts/warehouse-catalog-photos.mjs <folder> --publish
// Only fills empty photo fields. Never changes stock, names, prices, or movements.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const folder = resolve(process.argv[2]);
const publish = process.argv.includes('--publish');
const read = async name => JSON.parse(await readFile(resolve(folder, name), 'utf8'));
const save = async (name, data) => writeFile(resolve(folder, name), JSON.stringify(data, null, 2));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = await read('catalog-before.json');
const approved = await read('approved.json');
if (!approved.length || new Set(approved.map(p => p.sku)).size !== approved.length) throw new Error('Empty or duplicate approved list');
await mkdir(resolve(folder, 'images'), { recursive: true });

if (!publish) {
  const prepared = [];
  for (const p of approved) {
    const item = baseline.find(i => i.sku === p.sku);
    if (!item || item.photo_path || !p.source_url?.startsWith('https://') || !p.image_url?.startsWith('https://') || !p.caveat || !p.match_basis) throw new Error(`Unreviewed source: ${p.sku}`);
    try {
      const response = await fetch(p.image_url, { signal: AbortSignal.timeout(30000) });
      const mime = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !(mime?.startsWith('image/') || ['application/octet-stream', 'binary/octet-stream'].includes(mime))) throw new Error(`Image HTTP ${response.status} (${mime})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 20000000) throw new Error('Source image exceeds 20MB');
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) throw new Error('Source image too small');
      const photo = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 86 }).toBuffer();
      const thumb = await sharp(photo).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      await writeFile(resolve(folder, 'images', `${p.sku}.jpg`), photo);
      await writeFile(resolve(folder, 'images', `${p.sku}_thumb.jpg`), thumb);
      prepared.push({ ...p, id: item.id, name: item.name, photo_hash: digest(photo), thumb_hash: digest(thumb), source_width: metadata.width, source_height: metadata.height });
      console.log(`Prepared ${p.sku}`);
    } catch (error) { console.log(`SKIPPED ${p.sku}: ${error.message}`); }
  }
  await save('prepared.json', prepared);
  console.log(`Prepared ${prepared.length}/${approved.length}; visually review before publish.`);
} else {
  const prepared = await read('prepared.json');
  const review = await read('visual-review.json');
  if (!review.images?.length) throw new Error('Visual review required');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (new URL(url).hostname !== 'kozgjatzmllhvqwqbzzy.supabase.co') throw new Error('Wrong project');
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: info, error: bucketError } = await db.storage.getBucket('warehouse-photos');
  if (bucketError || !info || info.public) throw new Error('Existing private photo bucket required');
  const storage = db.storage.from('warehouse-photos');
  let results = [];
  try { results = await read('publication.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const p of prepared.filter(p => review.images.some(r => r.sku === p.sku))) {
    if (!approved.some(a => a.sku === p.sku && a.source_url === p.source_url && a.image_url === p.image_url && a.match_basis === p.match_basis && a.caveat === p.caveat)) throw new Error('Source changed after preparation');
    if (!review.images.some(r => r.sku === p.sku && r.photo_hash === p.photo_hash && r.thumb_hash === p.thumb_hash)) throw new Error('Prepared image was not visually reviewed');
    const photo = await readFile(resolve(folder, 'images', `${p.sku}.jpg`));
    const thumb = await readFile(resolve(folder, 'images', `${p.sku}_thumb.jpg`));
    if (digest(photo) !== p.photo_hash || digest(thumb) !== p.thumb_hash) throw new Error('Image changed after review');
    const { data: before, error: beforeError } = await db.from('warehouse_items').select('*').eq('id', p.id).single();
    if (beforeError || before.sku !== p.sku || before.name !== p.name || !before.is_active) throw new Error(`Item changed: ${p.sku}`);
    if (before.photo_path || before.photo_thumb_path) { console.log(`PRESERVED existing photo ${p.sku}`); continue; }
    await save(`${p.sku}-before-publish.json`, before);
    const stamp = `catalogref20261002_${p.photo_hash.slice(0,16)}`;
    const photoPath = `items/${p.id}/${stamp}.jpg`;
    const thumbPath = `items/${p.id}/${stamp}_thumb.jpg`;
    const paths = [];
    let updated = false;
    let updateAttempted = false;
    try {
      for (const [path, bytes] of [[photoPath, photo], [thumbPath, thumb]]) {
        const { error } = await storage.upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
        if (error) throw error;
        paths.push(path);
      }
      // Verify actual storage bytes before pointing the catalog at them.
      for (const [path, expected] of [[photoPath, p.photo_hash], [thumbPath, p.thumb_hash]]) {
        const { data, error } = await storage.download(path);
        if (error || !data || digest(Buffer.from(await data.arrayBuffer())) !== expected) throw new Error('Storage readback mismatch');
      }
      const notes = [before.notes, `Catalog photo reference (2026-10-02): ${p.source_url}`, `Photo identification: ${p.match_basis}. ${p.caveat}`].filter(Boolean).join('\n');
      updateAttempted = true;
      const { data: after, error } = await db.from('warehouse_items').update({ photo_path: photoPath, photo_thumb_path: thumbPath, notes }).eq('id', p.id).eq('updated_at', before.updated_at).is('photo_path', null).is('photo_thumb_path', null).select('*').single();
      if (error || !after) throw new Error(`Catalog update response failed; readback required: ${p.sku}`);
      updated = true;
      const stable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['photo_path','photo_thumb_path','notes','updated_at'].includes(key)));
      if (!isDeepStrictEqual(stable(before), stable(after))) throw new Error('Non-photo fields unexpectedly changed');
      results.push({ sku: p.sku, id: p.id, name: p.name, photo_path: photoPath, photo_thumb_path: thumbPath, source_url: p.source_url, verified_at: new Date().toISOString() });
      await save('publication.json', results);
      console.log(`Published and verified ${p.sku}`);
    } catch (error) {
      // A lost UPDATE response may hide a successful commit. Never delete
      // uploaded objects once a catalog update has been attempted.
      if (!updated && !updateAttempted && paths.length) await storage.remove(paths);
      if (updateAttempted && !updated) await save(`${p.sku}-needs-readback.json`, { id: p.id, photoPath, thumbPath, error: error.message });
      throw error;
    }
  }
  console.log(`Published ${results.length} catalog reference photos.`);
}
