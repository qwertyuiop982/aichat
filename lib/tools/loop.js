'use strict';
const chalk = require('chalk');
const toolsMod = require('./index');

// Parse tool-call blocks from model output. Accepts TWO forms:
//   1. Fenced: ```tool_call\n{...JSON...}\n```   (preferred)
//   2. Bare JSON line(s) starting with {"name": ...} on its own line
// Returns { calls: [{name, arguments, raw}], cleaned: <text without tool-call blocks> }
function parseToolCalls(text) {
  const raw = String(text || '');
  const calls = [];

  // Form 1: fenced ```tool_call ... ``` (or any ```...``` whose inner is {name,...})
  const fenceRe = /```(?:tool_call\s*)?\n?([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(raw))) {
    const inner = String(m[1] || '').trim();
    if (!inner.startsWith('{')) continue;
    const c = tryParseToolJson(inner);
    if (c) calls.push({ ...c, raw: inner });
  }

  // Form 2: bare JSON objects on their own lines, e.g. {"name":"web_search","arguments":{...}}
  // We look for any { ... } that contains a "name" key matching a known tool,
  // and we extract the matching brace-balanced object.
  if (!calls.length) {
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      // find matching closing brace
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) continue;
      const objStr = trimmed.slice(0, end + 1);
      const c = tryParseToolJson(objStr);
      if (c) calls.push({ ...c, raw: objStr });
    }
  }

  // Remove matched raw substrings from text -> cleaned
  let cleaned = raw;
  for (const c of calls) {
    if (c.raw && cleaned.includes(c.raw)) {
      cleaned = cleaned.replace(c.raw, '');
    }
  }
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return { calls, cleaned };
}

function tryParseToolJson(inner) {
  let obj;
  try { obj = JSON.parse(inner); } catch (_) { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const name = obj.name || obj.tool || obj.function;
  if (!name || typeof name !== 'string') return null;
  const args = (obj.arguments != null) ? obj.arguments
             : (obj.args != null) ? obj.args
             : (obj.parameters != null) ? obj.parameters
             : {};
  return { name, arguments: args };
}

function formatToolResult(name, ok, payload, call) {
  // Inject tool result into conversation.
  // We use role: 'user' (NOT role: 'tool') because many OpenAI-compatible APIs
  // (DeepSeek, local llama.cpp, etc.) do not recognise the 'tool' role and
  // silently drop messages with that role. Wrapping the result in a user-role
  // message with a clear marker ensures the model always sees it.
  // On success: plain-text summary (with structured payload appended).
  // On error:   plain-text with a clear "Tool X FAILED: ..." prefix so the model
  //             understands this is a failure, not a successful structured return.
  let body;
  if (ok) {
    body = JSON.stringify(payload == null ? '' : payload, null, 2);
  } else {
    const err = (payload && payload.error) ? payload.error : String(payload);
    body = 'Tool ' + name + ' FAILED: ' + err + '\n' +
      '(Fix the call and retry — do NOT invent a result. If the error says "path must be absolute", ' +
      'use an absolute path, a relative path like "./x", or "~/..." which expands to HOME.)';
  }
  const header = '[Tool Result: ' + name + (ok ? ' — OK' : ' — ERROR') + ']';
  if (call && call.id) { if (call.provider === 'anthropic') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: body }] }; return { role: 'tool', tool_call_id: call.id, content: body }; }
  if (call && call.provider === 'google') return { role: 'user', content: [{ functionResponse: { name: name, response: { content: body } } }] };
  return { role: 'user', content: header + '\n' + body };
}

// runAgentLoop:
//   cfg: chat config
//   initialMessages: array (already includes the user turn)
//   opts: { tools: bool, maxSteps: number, onStep: fn(step, calls, results), ctx: {} }
//   returns: { finalText, steps, totalCalls }
async function runAgentLoop(cfg, initialMessages, opts) {
  const maxSteps = Math.max(1, Math.min(200, Number((opts && opts.maxSteps) || 100)));
  const onStep = (opts && opts.onStep) || (() => {});
  const ctx = (opts && opts.ctx) || {};
  let useTools = true;
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'tools')) {
    useTools = opts.tools !== false;
  }
  const chatMod = require('../chat');
  const messages = initialMessages.slice();
  let step = 0;
  let totalCalls = 0;
  let finalText = '';

  while (step < maxSteps) {
    step++;
    const nativeTools = useTools ? toolsMod.asNativeTools() : [];
    const data = await chatMod.chat(cfg, messages, { extra: nativeTools.length ? { tools: nativeTools } : undefined });
    const extracted = chatMod.extractContent(data, cfg);
    const { content: out, reasoning } = extracted;
    // reasoning_content is internal reasoning: never display or persist it.
    // It is only included in parserText for legacy text-based tool calls.
    const visibleText = String(out || '');
    const parserText = visibleText + (reasoning ? '\n' + String(reasoning) : '');

    if (!useTools) {
      finalText = visibleText;
      onStep({ step, text: visibleText, calls: [], results: [], stop: true });
      break;
    }

    let calls = extracted.toolCalls || [];
    let cleaned = visibleText;
    if (!calls.length) {
      const parsed = parseToolCalls(parserText);
      calls = parsed.calls;
      // Only remove legacy blocks from visible output.
      const visibleParsed = parseToolCalls(visibleText);
      if (visibleParsed.calls.length) cleaned = visibleParsed.cleaned;
    }
    if (!calls.length) {
      finalText = cleaned;
      onStep({ step, text: cleaned, calls: [], results: [], stop: true });
      break;
    }

    // save assistant turn (cleaned) before tool results
    finalText = cleaned;
    if (extracted.assistant && extracted.toolCalls && extracted.toolCalls.length) messages.push(extracted.assistant);
    else messages.push({ role: 'assistant', content: cleaned || '' });

    // Execute tools (sequentially; could parallelize but order helps model)
    const results = [];
    for (const c of calls) {
      const r = await toolsMod.runOne(c.name, c.arguments, ctx);
      results.push({ name: c.name, ok: r.ok, error: r.error, result: r.result, meta: r.meta });
      totalCalls++;
    }
    // append tool messages
    for (const r of results) {
      messages.push(formatToolResult(r.name, r.ok, r.ok ? r.result : { error: r.error }, calls[results.indexOf(r)]));
    }

    onStep({ step, text: cleaned, calls, results, stop: false });

    if (step >= maxSteps) {
      finalText = '[Tool loop stopped after ' + maxSteps + ' steps. Some tool work may remain incomplete. Run again or increase --max-steps.]';
      onStep({ step, text: finalText, calls: [], results: [], stop: true, incomplete: true });
      break;
    }
  }

  return { finalText, steps: step, totalCalls, messages };
}

module.exports = { parseToolCalls, formatToolResult, runAgentLoop };