import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/components/marketing/upload-marketing-file.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const reservation = { asset_id: "asset-1", bucket: "marketing-media", path: "item/asset/video.mp4", token: "test-signature", endpoint: "https://example.invalid/storage/v1/upload/resumable", chunk_size: 6 * 1024 * 1024 };
const asset = { id: "asset-1", filename: "video.mp4" };
const queued = () => ({ id: "queue-1", file: { name: "video.mp4", type: "video/mp4", size: 9876543, lastModified: 10 }, role: "media", progress: 0, state: "queued" });

function harness({ finalize, start, previous = [] } = {}) {
  const calls = { reserved: [], finalized: [], uploads: [], resumed: [], aborted: 0 };
  class Upload {
    constructor(file, options) { this.file = file; this.options = options; calls.uploads.push(this); }
    async findPreviousUploads() { return previous; }
    resumeFromPreviousUpload(upload) { calls.resumed.push(upload); }
    start() { if (start) start(this); else { this.options.onProgress(5, 10); this.options.onSuccess(); } }
    async abort() { calls.aborted++; }
  }
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule, exports: sandboxModule.exports, process: { env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-key" } },
    require(name) {
      if (name === "tus-js-client") return { Upload };
      if (name === "./marketing-utils") return { mimeOf: file => file.type };
      if (name === "@/lib/actions/marketing") return {
        reserveMarketingUpload: async input => { calls.reserved.push(input); return { upload: reservation }; },
        finalizeMarketingUpload: async id => { calls.finalized.push(id); return finalize ? finalize(calls.finalized.length) : { asset }; },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { calls, upload: sandboxModule.exports.uploadMarketingFile };
}

{
  const test = harness();
  const progress = [];
  const reservations = [];
  const result = await test.upload("item-1", queued(), 2, new AbortController().signal, value => progress.push(value), value => reservations.push(value));
  assert.equal(result, asset);
  assert.equal(test.calls.reserved[0].sort_order, 2);
  assert.equal(test.calls.uploads[0].options.chunkSize, 6291456);
  assert.equal(test.calls.uploads[0].options.headers["x-signature"], reservation.token);
  assert.equal(test.calls.uploads[0].options.headers["x-upsert"], undefined);
  assert.deepEqual(progress, [50]);
  assert.equal(reservations[0], reservation);
  assert.deepEqual(test.calls.finalized, ["asset-1"]);
}

{
  const test = harness();
  const result = await test.upload("item-1", { ...queued(), reservation }, 0, new AbortController().signal, () => {}, () => {});
  assert.equal(result, asset);
  assert.equal(test.calls.uploads.length, 0, "A lost finalization response must not re-upload a stored file");
  assert.equal(test.calls.reserved.length, 0);
}

{
  const previous = [{ uploadUrl: "https://example.invalid/resumable/old-upload" }];
  const test = harness({ previous, finalize: call => call === 1 ? { error: "Not finished yet" } : { asset } });
  await test.upload("item-1", { ...queued(), reservation }, 0, new AbortController().signal, () => {}, () => {});
  assert.equal(test.calls.reserved.length, 0, "A paused file reuses its reservation");
  assert.equal(test.calls.resumed[0], previous[0]);
  assert.equal(test.calls.finalized.length, 2);
}

{
  const test = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(test.upload("item-1", queued(), 0, controller.signal, () => {}, () => {}), /Upload paused/);
  assert.equal(test.calls.reserved.length, 0);
  assert.equal(test.calls.uploads.length, 0);
}

{
  const controller = new AbortController();
  const test = harness({ start: () => controller.abort() });
  await assert.rejects(test.upload("item-1", queued(), 0, controller.signal, () => {}, () => {}), /Upload paused/);
  assert.equal(test.calls.aborted, 1);
  assert.equal(test.calls.finalized.length, 0, "Paused transfers must not finalize incomplete files");
}

console.log("Marketing upload tests passed: signed chunks, confirmation retry, resume, and cancellation.");
