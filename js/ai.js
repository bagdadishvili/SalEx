// ai.js — the assistant's connection to an AI provider, straight from the browser (v19):
// Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), DeepSeek, OpenRouter (many models with one key)
// or any other OpenAI-compatible service (Mistral, DeepSeek, Groq, a local Ollama/LM Studio…).
// The family's own API keys stay on THIS device only (never in backups or sync).
// Each provider has an adapter: it turns the shared tool list (aiTools.js) and the conversation
// into its own request, and its answer back into { text, calls, stop, message, usage }.
// The conversation is kept in the provider's own format and is append-only (needed for
// Claude's thinking blocks and Gemini's thought signatures, and it keeps the prompt cache warm).

const STORE = 'familyBudget.ai.v1';
const OLD_KEY = 'familyBudget.aiKey'; // v18: one Anthropic key

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', kind: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'ChatGPT (OpenAI)', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-5-mini', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Gemini (Google)', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
  deepseek: { label: 'DeepSeek — ძალიან იაფი', kind: 'openai', base: 'https://api.deepseek.com', model: 'deepseek-chat', keyHint: 'sk-…', keyUrl: 'https://platform.deepseek.com/api_keys' },
  openrouter: { label: 'OpenRouter — ბევრი მოდელი ერთი გასაღებით', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys' },
  custom: { label: 'სხვა სერვისი (OpenAI-თავსებადი)', kind: 'openai', base: '', model: '', keyHint: 'API key', keyUrl: '' }
};

// ---------------- settings (this device only) ----------------

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
}

/** { provider, keys:{id:key}, models:{id:model}, bases:{id:url}, effort:'low'|'medium' } */
export function getAiConfig() {
  const c = readStore();
  const cfg = { provider: PROVIDERS[c.provider] ? c.provider : 'anthropic', keys: c.keys || {}, models: c.models || {}, bases: c.bases || {}, effort: c.effort === 'medium' ? 'medium' : 'low' };
  if (!cfg.keys.anthropic) { try { const old = localStorage.getItem(OLD_KEY); if (old) cfg.keys.anthropic = old; } catch { /* ignore */ } }
  return cfg;
}

export function setAiConfig(partial) {
  const cur = getAiConfig();
  const next = { ...cur, ...partial, keys: { ...cur.keys, ...(partial.keys || {}) }, models: { ...cur.models, ...(partial.models || {}) }, bases: { ...cur.bases, ...(partial.bases || {}) } };
  Object.keys(next.keys).forEach(k => { if (!next.keys[k]) delete next.keys[k]; });
  try {
    localStorage.setItem(STORE, JSON.stringify(next));
    if (partial.keys && 'anthropic' in partial.keys) localStorage.removeItem(OLD_KEY); // moved into the new store
  } catch { /* storage full or blocked */ }
  return next;
}

/** The provider in use, with its key, model and address filled in. */
export function activeProvider() {
  const c = getAiConfig();
  const preset = PROVIDERS[c.provider];
  return {
    id: c.provider, ...preset,
    key: (c.keys[c.provider] || '').trim(),
    model: (c.models[c.provider] || preset.model || '').trim(),
    base: (c.bases[c.provider] || preset.base || '').trim().replace(/\/+$/, ''),
    effort: c.effort
  };
}

export function hasAiKey() { return !!activeProvider().key; }

// ---------------- adapters ----------------

const safeJson = (s) => { try { return typeof s === 'string' ? (JSON.parse(s || '{}') || {}) : (s || {}); } catch { return {}; } };

/** Gemini accepts only a subset of JSON Schema (upper-case types, no additionalProperties). */
function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = geminiSchema(s.items);
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]));
  if (s.required && s.required.length) out.required = s.required;
  return out;
}

const anthropic = {
  url: (p) => `${p.base}/messages`,
  headers: (p, o) => ({
    'content-type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
    ...(o.fallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {})
  }),
  body(p, system, tools, messages, o) {
    // Cache marker on the newest block: the whole conversation so far is read from the cache
    // on the next request (moving the marker does not change the history itself).
    const msgs = messages.slice();
    const last = msgs[msgs.length - 1];
    if (last && Array.isArray(last.content) && last.content.length) {
      const c = last.content.slice();
      c[c.length - 1] = { ...c[c.length - 1], cache_control: { type: 'ephemeral' } };
      msgs[msgs.length - 1] = { ...last, content: c };
    }
    const b = {
      model: p.model, max_tokens: 16000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.params })),
      tool_choice: { type: 'auto' }, messages: msgs
    };
    if (o.effort) b.output_config = { effort: p.effort };
    if (o.fallbacks) b.fallbacks = 'default';
    return b;
  },
  parse(data) {
    const content = Array.isArray(data.content) && data.content.length ? data.content : [{ type: 'text', text: '…' }];
    const calls = content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input || {} }));
    const stop = calls.length ? 'tool' : ({ max_tokens: 'max', refusal: 'refusal' }[data.stop_reason] || 'end');
    const u = data.usage || {};
    return {
      text: content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), calls, stop,
      message: { role: 'assistant', content },
      usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 }
    };
  },
  userTurn: (results, texts) => [{ role: 'user', content: [
    ...results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.error ? { is_error: true } : {}) })),
    ...texts.map(text => ({ type: 'text', text }))
  ] }],
  isTurnStart: (m) => m.role === 'user' && Array.isArray(m.content) && m.content.every(b => b.type === 'text'),
  /** One-time recovery when the API refuses old thinking blocks: drop them, keep text + tool calls. */
  stripThinking: (messages) => messages.map(m => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return m;
    const content = m.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    return { ...m, content: content.length ? content : [{ type: 'text', text: '…' }] };
  }),
  modelsUrl: (p) => `${p.base}/models?limit=100`,
  modelIds: (data) => (data.data || []).map(m => m.id)
};

const openai = {
  url: (p) => `${p.base}/chat/completions`,
  headers: (p) => ({ 'content-type': 'application/json', authorization: `Bearer ${p.key}` }),
  body(p, system, tools, messages, o) {
    const b = {
      model: p.model, messages: [{ role: 'system', content: system }, ...messages],
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.params } })),
      tool_choice: 'auto'
    };
    // reasoning models of OpenAI itself: think less = fewer (paid) tokens
    if (o.reasoning && p.id === 'openai' && /^(gpt-5|o\d)/.test(p.model)) b.reasoning_effort = p.effort;
    return b;
  },
  parse(data) {
    const ch = (data.choices || [])[0] || {};
    const msg = ch.message || {};
    const toolCalls = (msg.tool_calls || []).filter(c => c && c.function);
    const calls = toolCalls.map(c => ({ id: c.id, name: c.function.name, input: safeJson(c.function.arguments) }));
    const stop = calls.length ? 'tool' : ch.finish_reason === 'length' ? 'max' : ch.finish_reason === 'content_filter' ? 'refusal' : 'end';
    const text = typeof msg.content === 'string' ? msg.content.trim() : '';
    const message = { role: 'assistant', content: text || (toolCalls.length ? null : '…') };
    if (toolCalls.length) message.tool_calls = toolCalls;
    const u = data.usage || {};
    return { text, calls, stop, message, usage: { input: u.prompt_tokens || 0, cached: (u.prompt_tokens_details || {}).cached_tokens || 0, output: u.completion_tokens || 0 } };
  },
  userTurn: (results, texts) => [
    ...results.map(r => ({ role: 'tool', tool_call_id: r.id, content: r.content })),
    ...(texts.length ? [{ role: 'user', content: texts.join('\n\n') }] : [])
  ],
  isTurnStart: (m) => m.role === 'user',
  modelsUrl: (p) => `${p.base}/models`,
  modelIds: (data) => (data.data || []).map(m => m.id)
};

const gemini = {
  url: (p) => `${p.base}/models/${encodeURIComponent(p.model)}:generateContent`,
  headers: (p) => ({ 'content-type': 'application/json', 'x-goog-api-key': p.key }),
  body: (p, system, tools, messages) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: messages,
    tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: geminiSchema(t.params) })) }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
  }),
  parse(data) {
    const cand = (data.candidates || [])[0];
    const u = data.usageMetadata || {};
    const usage = { input: u.promptTokenCount || 0, cached: u.cachedContentTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
    if (!cand) return { text: '', calls: [], stop: 'refusal', message: { role: 'model', parts: [{ text: '…' }] }, usage };
    const parts = (cand.content && cand.content.parts) || [];
    const calls = parts.filter(x => x.functionCall).map((x, i) => ({
      id: x.functionCall.id || `gc_${Date.now().toString(36)}_${i}`, gid: x.functionCall.id || null,
      name: x.functionCall.name, input: x.functionCall.args || {}
    }));
    const stop = calls.length ? 'tool' : cand.finishReason === 'MAX_TOKENS' ? 'max' : /SAFETY|BLOCK|PROHIBITED|RECITATION|SPII/.test(cand.finishReason || '') ? 'refusal' : 'end';
    return {
      text: parts.filter(x => typeof x.text === 'string' && !x.thought).map(x => x.text).join('\n').trim(), calls, stop,
      message: { role: 'model', parts: parts.length ? parts : [{ text: '…' }] }, usage
    };
  },
  userTurn: (results, texts) => [{ role: 'user', parts: [
    ...results.map(r => ({ functionResponse: { name: r.name, response: { result: r.content }, ...(r.gid ? { id: r.gid } : {}) } })),
    ...texts.map(text => ({ text }))
  ] }],
  isTurnStart: (m) => m.role === 'user' && (m.parts || []).every(x => typeof x.text === 'string'),
  modelsUrl: (p) => `${p.base}/models?pageSize=200`,
  modelIds: (data) => (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name).replace(/^models\//, ''))
};

export const ADAPTERS = { anthropic, openai, gemini };
export function adapterFor(p = activeProvider()) { return ADAPTERS[p.kind]; }

// ---------------- requests ----------------

function errorText(data) {
  if (!data) return '';
  if (typeof data.error === 'string') return data.error;
  return (data.error && (data.error.message || data.error.status)) || data.message || '';
}

function niceError(status, raw) {
  if (status === 401 || status === 403) return `API გასაღები არასწორია ან ამ მოდელზე წვდომა არ აქვს (${status})`;
  if (status === 402) return 'ანგარიშზე თანხა არ არის (402) — შეავსე ბალანსი სერვისის საიტზე';
  if (status === 404) return `მოდელი ან მისამართი ვერ მოიძებნა (404) — აირჩიე მოდელი სიიდან (📋). ${raw}`.trim();
  if (status === 429) return 'ლიმიტი ამოიწურა ან ძალიან ბევრი მოთხოვნაა (429) — სცადე ცოტა ხანში ან შეამოწმე ბალანსი';
  if (status >= 500) return `სერვისის შეცდომა (${status}) — სცადე მოგვიანებით`;
  return `შეცდომა ${status}: ${raw}`;
}

async function request(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('კავშირი ვერ მოხერხდა — შეამოწმე ინტერნეტი. (ზოგი სერვისი ბრაუზერიდან პირდაპირ კავშირს არ უშვებს — მაშინ სცადე OpenRouter.)');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = errorText(data);
    const err = new Error(niceError(res.status, raw));
    err.status = res.status; err.raw = raw;
    throw err;
  }
  return data;
}

// Options that a provider/model may refuse; switched off for the session after the first refusal.
const optional = { fallbacks: true, effort: true, reasoning: true };

/**
 * One model turn. `conv.messages` is the conversation in the provider's format; it is only
 * changed by the one-time thinking recovery (Claude). Returns the adapter's parsed answer.
 */
export async function callModel(conv, system, tools) {
  const p = activeProvider();
  if (!p.key) throw new Error('ჯერ ჩაწერე API გასაღები (ზემოთ)');
  if (!p.base) throw new Error('ჯერ ჩაწერე სერვისის მისამართი (ზემოთ)');
  if (!p.model) throw new Error('ჯერ აირჩიე მოდელი (ზემოთ)');
  const A = adapterFor(p);
  let stripped = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const o = { ...optional };
    try {
      const data = await request(A.url(p), { method: 'POST', headers: A.headers(p, o), body: JSON.stringify(A.body(p, system, tools, conv.messages, o)) });
      return A.parse(data);
    } catch (e) {
      if (e.status !== 400) throw e;
      const raw = String(e.raw || '');
      if (p.kind === 'anthropic' && optional.fallbacks && /fallback/i.test(raw)) { optional.fallbacks = false; continue; }
      if (p.kind === 'anthropic' && optional.effort && /effort|output_config/i.test(raw)) { optional.effort = false; continue; }
      if (p.kind === 'anthropic' && !stripped && /signature|thinking/i.test(raw)) { conv.messages = A.stripThinking(conv.messages); stripped = true; continue; }
      if (p.kind === 'openai' && optional.reasoning && /reasoning/i.test(raw)) { optional.reasoning = false; continue; }
      throw e;
    }
  }
  throw new Error('მოთხოვნა ვერ შესრულდა');
}

/** Models this key can use (also a free connection test — no tokens are spent). */
export async function listModels() {
  const p = activeProvider();
  if (!p.key) throw new Error('ჯერ ჩაწერე API გასაღები');
  if (!p.base) throw new Error('ჯერ ჩაწერე სერვისის მისამართი');
  const A = adapterFor(p);
  const headers = { ...A.headers(p, {}) };
  delete headers['content-type'];
  const data = await request(A.modelsUrl(p), { method: 'GET', headers });
  let ids = A.modelIds(data);
  if (p.id === 'openai') ids = ids.filter(id => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding/.test(id));
  return [...new Set(ids)].sort();
}

// ---------------- what the model is told once (static, so it stays in the prompt cache) ----------------

export const SYSTEM_PROMPT = `You are the assistant inside "ოჯახის ბიუჯეტი", the family budget web app of Giorgi and Nino (they live in Germany; some money goes to Georgia). Answer in Georgian, short and plain — they are not programmers. No long tables unless asked.

Data model:
- Month (YYYY-MM): income giorgi/nino (EUR), exchange rate (GEL per 1 EUR), transactions.
- Categories are dashboard blocks. kind: spend | savings (money moved to savings) | free (personal free money). owner: shared (50/50) | giorgi | nino. Sub-categories roll up into their parent.
- Every month has its own plan: a target per category (percent of income | amount € | auto = that month's planned bills of the category). set_target changes it from a month on (forward) or for that month only; earlier months never change.
- Transaction kinds: bill (planned amount; paid amount once paid), envelope = spend-as-you-go budget (food, fuel: budget, used, left), extra = bought with an envelope's money, fromSavings = an expense paid with saved money (lowers the savings balance; the month's transfer to savings stays).
- Two-step bills: a bill debited from giorgi's or nino's OWN account is first "transferred" (money moved to that account) and later "paid" (the bank debited it). Shared-account bills, savings transfers and envelopes are one step.
- Templates create each month's bills (cycle in months, first due date).
- A month's budget starts the day its salary arrived (month salaryDate; settings.salaryDay is only the default for new months). Savings categories may have a goal (goalAmount, goalBy YYYY-MM). Optional features are switched on/off in settings.features.
- Ids are short: t# transaction, c# category, p# template, "free" = personal free money.

How to work:
- The selected month's current data comes with the user's message ("DATA"). For anything else call read (free). Never read what you already have.
- Change data ONLY with tools. Every change is shown to the user as a proposal and runs only after their ✓ — say in one short line what you propose.
- Do exactly what was asked, with the fewest changes. Never tidy up other entries or targets.
- "spent X from savings on Y" → spend_from_savings (never edit the savings transfer). "food is all spent" → budget op all_spent. "40 left in fuel went to food" → budget op move. "I moved the money for that bill to my account" → set_status transferred.
- If something is ambiguous (which month, saving, person), ask one short question instead of guessing.
- Amounts are EUR unless ₾/lari is said.
- If numbers do not add up, a screen misled the user or they needed a workaround, call report_issue (what the CODE should do). Mention relevant items from "checks".`;
