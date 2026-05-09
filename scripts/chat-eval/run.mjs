#!/usr/bin/env node
/**
 * Chat eval runner.
 *
 * Runs each prompt in prompts.json through /api/chat (the main AI Assistant)
 * and writes a markdown report with response, token counts, cache stats,
 * and latency. Used to compare before/after when making the chat smarter.
 *
 * Usage:
 *   node scripts/chat-eval/run.mjs --label baseline
 *   node scripts/chat-eval/run.mjs --label after-caching
 *   node scripts/chat-eval/run.mjs --compare baseline after-caching
 *
 * Env (set in .env.local — script auto-loads it):
 *   CHAT_EVAL_URL    Base URL of the chat (default http://localhost:3000)
 *   CHAT_EVAL_COOKIE Full Cookie header from a signed-in browser session
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROMPTS = path.join(__dirname, "prompts.json");
const RESULTS = path.join(__dirname, "results");

// Parse a tiny .env.local — we don't pull dotenv as a dep just for this
function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const URL_BASE = process.env.CHAT_EVAL_URL || "http://localhost:3000";
const COOKIE = process.env.CHAT_EVAL_COOKIE || "";

const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

const label = arg("--label");
const compareA = args.indexOf("--compare") !== -1 ? args[args.indexOf("--compare") + 1] : null;
const compareB = args.indexOf("--compare") !== -1 ? args[args.indexOf("--compare") + 2] : null;

if (!label && !compareA) {
  console.error("Usage:");
  console.error("  --label <name>             Run all prompts and save results/<name>.md");
  console.error("  --compare <a> <b>          Compare results/<a>.md vs results/<b>.md");
  process.exit(1);
}

if (compareA && compareB) {
  compare(compareA, compareB);
} else {
  runAll(label);
}

// ── Run all prompts ─────────────────────────────────────────────────────

async function runAll(label) {
  if (!COOKIE) {
    console.error("CHAT_EVAL_COOKIE is empty.");
    console.error("Sign into the app, copy the Cookie header from DevTools, and add to .env.local:");
    console.error('  CHAT_EVAL_COOKIE="<paste here>"');
    process.exit(1);
  }
  const { prompts } = JSON.parse(fs.readFileSync(PROMPTS, "utf8"));
  fs.mkdirSync(RESULTS, { recursive: true });
  const out = path.join(RESULTS, `${label}.md`);

  const lines = [];
  lines.push(`# Chat eval — ${label}`);
  lines.push(``);
  lines.push(`- Run at: ${new Date().toISOString()}`);
  lines.push(`- URL: ${URL_BASE}`);
  lines.push(`- Prompts: ${prompts.length}`);
  lines.push(``);

  let totals = {
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    latencyMs: 0,
    failed: 0,
  };

  for (const p of prompts) {
    process.stdout.write(`▸ ${p.id} … `);
    const t0 = Date.now();
    let result;
    try {
      result = await runOne(p.text);
    } catch (err) {
      result = { error: err.message || String(err) };
    }
    const latencyMs = Date.now() - t0;
    if (result.error) {
      console.log(`FAILED (${result.error})`);
      totals.failed++;
    } else {
      console.log(
        `${latencyMs}ms · in ${result.usage.input_tokens} · out ${result.usage.output_tokens} · cache_read ${result.usage.cache_read_input_tokens || 0}`
      );
      totals.input += result.usage.input_tokens || 0;
      totals.output += result.usage.output_tokens || 0;
      totals.cacheCreate += result.usage.cache_creation_input_tokens || 0;
      totals.cacheRead += result.usage.cache_read_input_tokens || 0;
      totals.latencyMs += latencyMs;
    }

    lines.push(`## ${p.id}`);
    lines.push(``);
    lines.push(`**Category:** ${p.category}`);
    lines.push(``);
    lines.push(`**Prompt:** ${p.text}`);
    lines.push(``);
    lines.push(`**Expects:** ${p.expects}`);
    lines.push(``);
    if (result.error) {
      lines.push(`**ERROR:** ${result.error}`);
    } else {
      lines.push(`**Latency:** ${latencyMs}ms`);
      lines.push(``);
      lines.push(
        `**Tokens:** input ${result.usage.input_tokens || 0} · output ${result.usage.output_tokens || 0} · cache_create ${result.usage.cache_creation_input_tokens || 0} · cache_read ${result.usage.cache_read_input_tokens || 0}`
      );
      lines.push(``);
      lines.push(`**Tool calls:** ${result.toolCalls.length > 0 ? result.toolCalls.map((t) => t.name).join(", ") : "(none)"}`);
      lines.push(``);
      lines.push(`**Response:**`);
      lines.push("");
      lines.push("```");
      lines.push(result.text || "(empty)");
      lines.push("```");
    }
    lines.push(``);
  }

  lines.push(`## Totals`);
  lines.push(``);
  lines.push(`- Input tokens: ${totals.input}`);
  lines.push(`- Output tokens: ${totals.output}`);
  lines.push(`- Cache created: ${totals.cacheCreate}`);
  lines.push(`- Cache read: ${totals.cacheRead}`);
  lines.push(`- Total latency: ${totals.latencyMs}ms`);
  lines.push(`- Failed: ${totals.failed}`);

  fs.writeFileSync(out, lines.join("\n"));
  console.log(`\nWrote ${path.relative(ROOT, out)}`);
}

// ── Run a single prompt ─────────────────────────────────────────────────

async function runOne(text) {
  const res = await fetch(`${URL_BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: COOKIE,
    },
    body: JSON.stringify({ message: text, source: "text" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  const toolCalls = [];
  let usage = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const ev = JSON.parse(json);
        // /api/chat SSE shape: text {content}, proposed_action, tool_status,
        // done {usage}, error {message}, conversation_id
        if (ev.type === "text") fullText += ev.content || ev.delta || "";
        else if (ev.type === "proposed_action")
          toolCalls.push({ name: ev.action_type, input: ev.data });
        else if (ev.type === "tool_status" && ev.status === "running")
          toolCalls.push({ name: ev.tool, input: null });
        else if (ev.type === "done") usage = ev.usage || usage;
        else if (ev.type === "usage") usage = ev.usage || usage;
        else if (ev.type === "error") throw new Error(ev.message || "stream error");
      } catch (err) {
        if (err instanceof Error && err.message?.startsWith("HTTP ")) throw err;
        // ignore non-JSON SSE lines
      }
    }
  }

  return { text: fullText.trim(), toolCalls, usage };
}

// ── Compare two runs ────────────────────────────────────────────────────

function compare(a, b) {
  const fileA = path.join(RESULTS, `${a}.md`);
  const fileB = path.join(RESULTS, `${b}.md`);
  if (!fs.existsSync(fileA)) {
    console.error(`Missing ${fileA}`);
    process.exit(1);
  }
  if (!fs.existsSync(fileB)) {
    console.error(`Missing ${fileB}`);
    process.exit(1);
  }

  const totalsA = parseTotals(fs.readFileSync(fileA, "utf8"));
  const totalsB = parseTotals(fs.readFileSync(fileB, "utf8"));

  console.log(`\n${a}  →  ${b}\n`);
  console.log(`Input tokens:    ${totalsA.input} → ${totalsB.input}    (${pct(totalsA.input, totalsB.input)})`);
  console.log(`Output tokens:   ${totalsA.output} → ${totalsB.output}    (${pct(totalsA.output, totalsB.output)})`);
  console.log(`Cache read:      ${totalsA.cacheRead} → ${totalsB.cacheRead}`);
  console.log(`Latency total:   ${totalsA.latencyMs}ms → ${totalsB.latencyMs}ms    (${pct(totalsA.latencyMs, totalsB.latencyMs)})`);
  console.log(`Failed:          ${totalsA.failed} → ${totalsB.failed}`);
  console.log(`\nFor per-prompt diffs, run:  diff ${path.relative(ROOT, fileA)} ${path.relative(ROOT, fileB)}`);
}

function parseTotals(md) {
  const get = (label) => {
    const m = md.match(new RegExp(`- ${label}:\\s*(-?\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  return {
    input: get("Input tokens"),
    output: get("Output tokens"),
    cacheCreate: get("Cache created"),
    cacheRead: get("Cache read"),
    latencyMs: get("Total latency"),
    failed: get("Failed"),
  };
}

function pct(a, b) {
  if (a === 0) return "+∞";
  const d = ((b - a) / a) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}
