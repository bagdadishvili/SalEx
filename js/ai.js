// ai.js — the in-app assistant's connection to Claude (v18). Static app, no server: the browser
// calls the Anthropic Messages API directly with the family's OWN API key, stored only on this
// device (never in backups/sync). Claude can only PROPOSE the app's own actions (actions.js);
// nothing changes until the user ticks and confirms them. It may also file "fix in the app" notes.

import {
  planFor, totalIncome, isEnvelope, isExtra, isFromSavings, envelopeUsed, txnPlannedEur,
  computeSavingsOverview, resolveTopCategory, FREE_BUCKET_ID
} from './calc.js';
import { planInMonth } from './plan.js';

const KEY_STORE = 'familyBudget.aiKey';
const API_URL = 'https://api.anthropic.com/v1/messages';
export const AI_MODEL = 'claude-opus-5-5';

export function getAiKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } }
export function setAiKey(k) { try { if (k) localStorage.setItem(KEY_STORE, k.trim()); else localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } }

const ACC = { type: 'string', enum: ['shared', 'giorgi', 'nino'], description: 'whose account pays: shared, giorgi or nino' };

/** Tool name → [action name in actions.js, input mapper]. report_issue is handled separately. */
export const TOOL_MAP = {
  add_expense: ['addExpense', (i) => ({ name: i.name, amount: i.amount, categoryId: i.category_id, account: i.account, paid: i.paid !== false, toGeorgia: !!i.to_georgia, note: i.note || '' })],
  spend_from_savings: ['spendFromSavings', (i) => ({ savingsCategoryId: i.savings_category_id, amount: i.amount, name: i.name, categoryId: i.category_id || null, account: i.account || null })],
  envelope_spend: ['envelopeSpend', (i) => ({ envelopeId: i.envelope_id, amount: i.amount, note: i.note || '' })],
  envelope_set_left: ['envelopeSetLeft', (i) => ({ envelopeId: i.envelope_id, left: i.left })],
  envelope_mark_spent: ['envelopeMarkSpent', (i) => ({ envelopeId: i.envelope_id, amount: i.amount ?? null })],
  move_envelope_budget: ['moveEnvelopeBudget', (i) => ({ fromId: i.from_id, toId: i.to_id, amount: i.amount })],
  mark_paid: ['markPaid', (i) => ({ txnId: i.txn_id, amount: i.amount ?? null })],
  set_txn_amount: ['setTxnAmount', (i) => ({ txnId: i.txn_id, planned: i.planned ?? null, actual: i.actual ?? null })],
  set_income: ['setIncome', (i) => ({ giorgi: i.giorgi ?? null, nino: i.nino ?? null })],
  set_target: ['setTarget', (i) => ({ categoryId: i.category_id || null, free: i.free || null, targetType: i.target_type, value: i.value, scope: i.scope || 'forward' })]
};

const obj = (props, required) => ({ type: 'object', properties: props, required, additionalProperties: false });
const num = (d) => ({ type: 'number', description: d });
const str = (d) => ({ type: 'string', description: d });

export const TOOLS = [
  { name: 'add_expense', description: 'Record a new expense in the selected month (paid by default, because it already happened). Use the category ids from the data.',
    input_schema: obj({ name: str('what it was, in Georgian'), amount: num('EUR amount'), category_id: str('category id'), account: ACC, paid: { type: 'boolean' }, to_georgia: { type: 'boolean' }, note: str('optional note') }, ['name', 'amount', 'category_id']) },
  { name: 'spend_from_savings', description: 'Money taken OUT of a savings category to pay an expense. Records the expense as paid and lowers that saving\'s balance. Does NOT change the month\'s savings transfer. Use this whenever the user says they spent money from savings.',
    input_schema: obj({ savings_category_id: str('savings category id'), amount: num('EUR'), name: str('what it was spent on'), category_id: str('category of the expense itself (not a savings category); default essentials'), account: ACC }, ['savings_category_id', 'amount', 'name']) },
  { name: 'envelope_spend', description: 'A purchase paid from a spend-as-you-go budget (food, fuel…).',
    input_schema: obj({ envelope_id: str('budget transaction id'), amount: num('amount in the budget currency'), note: str('optional') }, ['envelope_id', 'amount']) },
  { name: 'envelope_set_left', description: 'The user tells how much is LEFT in a budget (from the bank app); spent is worked out.',
    input_schema: obj({ envelope_id: str('budget transaction id'), left: num('amount left') }, ['envelope_id', 'left']) },
  { name: 'envelope_mark_spent', description: 'Count the rest of a budget (or a given part) as spent without entering receipts. Omit amount = everything left.',
    input_schema: obj({ envelope_id: str('budget transaction id'), amount: num('optional amount') }, ['envelope_id']) },
  { name: 'move_envelope_budget', description: 'Move an amount of budget from one food/fuel budget to another in the same month (e.g. fuel left-over was spent on food).',
    input_schema: obj({ from_id: str('budget id where money was left'), to_id: str('budget id where it was spent'), amount: num('amount') }, ['from_id', 'to_id', 'amount']) },
  { name: 'mark_paid', description: 'Mark an existing bill as paid, optionally with the real amount.',
    input_schema: obj({ txn_id: str('transaction id'), amount: num('optional paid amount') }, ['txn_id']) },
  { name: 'set_txn_amount', description: 'Change the planned and/or paid amount of one existing entry. Only when the user asks to correct an amount.',
    input_schema: obj({ txn_id: str('transaction id'), planned: num('new planned amount'), actual: num('new paid amount (entry must be paid)') }, ['txn_id']) },
  { name: 'set_income', description: 'Set the month\'s salary of Giorgi and/or Nino (EUR).',
    input_schema: obj({ giorgi: num('EUR'), nino: num('EUR') }, []) },
  { name: 'set_target', description: 'Change a plan target of a category (or free money) from the selected month on (scope forward) or for that month only. Earlier months never change. target_type auto = follows this month\'s planned expenses of that category.',
    input_schema: obj({ category_id: str('category id (or use free)'), free: { type: 'string', enum: ['giorgi', 'nino'] }, target_type: { type: 'string', enum: ['percent', 'amount', 'auto'] }, value: num('percent or EUR; omit for auto'), scope: { type: 'string', enum: ['forward', 'only'] } }, ['target_type']) },
  { name: 'report_issue', description: 'Write a note for the app developer about something that looks like a bug, a confusing screen, or a missing feature that needs a CODE change (not a data change). Saved to the app\'s "to fix" list. Use it when you notice inconsistent numbers, or the user had to work around the app.',
    input_schema: obj({ title: str('short title, Georgian'), detail: str('what is wrong, where, and what the code should do instead') }, ['title', 'detail']) }
];

export const SYSTEM_PROMPT = `You are the assistant inside "ოჯახის ბიუჯეტი", a family budget web app for Giorgi and Nino (Germany, money also sent to Georgia). Always answer in Georgian, short and plain — they are not programmers.

How the app works:
- Each month has income (giorgi, nino), an exchange rate (GEL per 1 EUR) and transactions.
- Categories are dashboard blocks. goal "min" = savings (money moved to savings), "max" = spending. A category's owner is shared (50/50), giorgi or nino. Sub-categories roll up into their parent block. parent "free" = personal free spending.
- Transaction kinds: normal bill (planned amount; when paid it also has a paid amount, which is what lists show), "envelope" = spend-as-you-go budget like food/fuel (planned budget, spends, left), "extra" = bought with an envelope's money, "fromSavings" = an expense paid with money taken out of savings.
- Each month has its own plan (targets per category: percent, € amount or auto). Changing a target applies from the selected month on (or only that month); earlier months never change.

Rules:
- You can change data ONLY by calling the tools. Every call is shown to the user as a proposal; nothing happens until they confirm. Say briefly what you propose and why.
- Do exactly what the user asked — the smallest set of changes. Never "tidy up" other numbers, never edit entries the user did not mention, never change targets unless asked.
- "I spent X from savings on Y" → spend_from_savings (do NOT edit the savings transfer). "Food/fuel is all spent" → envelope_mark_spent. "X left in fuel went to food" → move_envelope_budget.
- Use only ids that appear in the data. If something is ambiguous (which saving, which month, which person), ask one short question instead of guessing.
- Amounts are EUR unless the user says ₾/lari.
- If you notice numbers that do not add up, a screen that misled the user, or a workaround they needed, call report_issue with what the CODE should do differently. Also mention data problems from the "checks" list when relevant.`;

/** Compact picture of the selected month for the model (ids included so it can act). */
export function buildContext(state, key, findings = []) {
  const m = state.months[key];
  const cats = state.categories;
  const nameOf = (id) => (cats.find(c => c.id === id) || {}).name || id;
  const ctx = { today: new Date().toISOString().slice(0, 10), month: key };
  if (!m) { ctx.note = 'this month is not created yet'; return ctx; }
  const { categories: rc } = planFor(m, cats, state.settings);
  ctx.income = m.income; ctx.rate_gel_per_eur = m.exchangeRate; ctx.total_income = totalIncome(m);
  ctx.categories = rc.map(c => {
    const top = resolveTopCategory(cats, c.id);
    const cfg = planInMonth(state, { cat: c.id }, key);
    return {
      id: c.id, name: c.name, owner: c.owner || 'shared',
      parent: c.parentId === FREE_BUCKET_ID ? 'free' : (c.parentId ? nameOf(c.parentId) : null),
      kind: top && top.parentId !== FREE_BUCKET_ID && top.goalType === 'min' ? 'savings' : (c.parentId === FREE_BUCKET_ID ? 'free' : 'spending'),
      target: cfg.targetType === 'auto' ? 'auto' : cfg.targetType === 'amount' ? `${cfg.amount} EUR` : `${cfg.percent}%`
    };
  });
  ctx.free_money_target = ['giorgi', 'nino'].map(p => ({ person: p, ...planInMonth(state, { free: p }, key) }));
  ctx.transactions = m.transactions.map(t => {
    const r = { id: t.id, name: t.name, category: nameOf(t.categoryId), category_id: t.categoryId, account: t.account, currency: t.currency };
    if (isEnvelope(t)) {
      Object.assign(r, { kind: 'envelope', budget: t.amountPlanned, used: Math.round(envelopeUsed(t, m.transactions, m.exchangeRate) * 100) / 100, closed: !!t.paid });
    } else {
      Object.assign(r, { planned: t.amountPlanned, paid: !!t.paid, paid_amount: t.paid ? (t.amountActual ?? t.amountPlanned) : null, due: t.dueDate });
      if (isExtra(t)) r.kind = 'extra';
      if (isFromSavings(t)) { r.kind = 'fromSavings'; r.from_savings = nameOf(t.fromSavings); }
      if (t.toGeorgia) r.to_georgia = true;
      if (t.currency === 'GEL') r.planned_eur = Math.round(txnPlannedEur(t, m.exchangeRate) * 100) / 100;
    }
    return r;
  });
  ctx.savings = computeSavingsOverview(m, cats, state.months, key).items.map(s => ({ id: s.id, name: s.name, owner: s.owner, plan: Math.round(s.planned), transferred: Math.round(s.done), spent_from_it: Math.round(s.withdrawn), balance_all_months: s.balance === null ? null : Math.round(s.balance) }));
  if (findings.length) ctx.checks = findings.slice(0, 15).map(f => `${f.month || ''} ${f.title}`.trim());
  return ctx;
}

let useFallbacks = true;

/** One request to the Messages API. Returns the parsed response or throws a Georgian error. */
export async function callClaude(messages) {
  const key = getAiKey();
  if (!key) throw new Error('ჯერ ჩაწერე API გასაღები');
  const body = {
    model: AI_MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    output_config: { effort: 'medium' },
    messages
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true'
  };
  if (useFallbacks) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('ინტერნეტთან კავშირი ვერ მოხერხდა');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || '';
    if (res.status === 400 && useFallbacks && /fallback/i.test(msg)) { useFallbacks = false; return callClaude(messages); }
    if (res.status === 401) throw new Error('API გასაღები არასწორია (401)');
    if (res.status === 403) throw new Error('ამ გასაღებს წვდომა არ აქვს (403)');
    if (res.status === 429) throw new Error('ძალიან ბევრი მოთხოვნა — სცადე ცოტა ხანში (429)');
    if (res.status >= 500) throw new Error(`Anthropic-ის სერვერის შეცდომა (${res.status}) — სცადე მოგვიანებით`);
    throw new Error(`შეცდომა ${res.status}: ${msg}`);
  }
  return data;
}
