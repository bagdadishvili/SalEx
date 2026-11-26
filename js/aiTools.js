// aiTools.js — what the assistant may SEE and DO (v19), the same for every AI provider.
// Reading is free and runs at once; every change is only PROPOSED and runs after the user's ✓.
// Token saving: ids are short aliases (t3 = transaction, c2 = category, p7 = template), data is
// sent as compact lines instead of JSON, and only the selected month goes up front — the model
// reads everything else on demand with `read`.

import {
  planFor, totalIncome, isEnvelope, isExtra, isFromSavings, isTwoStep, envelopeUsed, txnPaidEur,
  computeSavingsOverview, resolveTopCategory, computeRangeOverview, FREE_BUCKET_ID
} from './calc.js';
import { planInMonth } from './plan.js';
import { ACTIONS, RECORD_FIELDS } from './actions.js';
import { runDiagnostics } from './diagnostics.js';
import { budgetMonthKey, salaryStart } from './state.js';
import { initMonth } from './monthEngine.js';

// ---------------- short ids ----------------

/** Real id ⇄ short alias, stable for one conversation. */
export class Aliases {
  constructor() { this.toShort = new Map(); this.toReal = new Map(); this.n = { t: 0, c: 0, p: 0 }; }
  s(real, kind) {
    if (real === null || real === undefined || real === '' || real === FREE_BUCKET_ID) return real;
    let a = this.toShort.get(real);
    if (!a) { a = `${kind}${++this.n[kind]}`; this.toShort.set(real, a); this.toReal.set(a, real); }
    return a;
  }
  r(alias) {
    if (alias === null || alias === undefined) return alias;
    return this.toReal.get(String(alias).trim()) || alias;
  }
}

const ID_KIND = { categoryId: 'c', parentId: 'c', fromSavings: 'c', templateId: 'p', fromEnvelope: 't', other: 't' };

/** A record as JSON with its ids shortened (for `read record`). */
function aliasRecord(rec, kind, A) {
  const out = JSON.parse(JSON.stringify(rec));
  delete out._u; delete out._uf;
  if (out.id) out.id = A.s(out.id, kind);
  Object.keys(ID_KIND).forEach(k => { if (k in out && out[k]) out[k] = A.s(out[k], ID_KIND[k]); });
  (out.moves || []).forEach(mv => { if (mv.other) mv.other = A.s(mv.other, 't'); });
  return out;
}

/** Turns short ids inside a fields object back into real ids. */
function unaliasFields(fields, A) {
  const out = { ...fields };
  Object.keys(ID_KIND).forEach(k => { if (typeof out[k] === 'string') out[k] = A.r(out[k]); });
  return out;
}

// ---------------- compact text views ----------------

const n2 = (v) => String(Math.round((Number(v) || 0) * 100) / 100);
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');

function catKind(cats, c) {
  if (c.parentId === FREE_BUCKET_ID) return 'free';
  const top = resolveTopCategory(cats, c.id);
  return top && top.parentId !== FREE_BUCKET_ID && top.goalType === 'min' ? 'savings' : 'spend';
}

function targetText(cfg, resolved) {
  if (!cfg) return '-';
  if (cfg.targetType === 'auto') return `auto=${n2(resolved && resolved.amount)}`;
  if (cfg.targetType === 'amount') return `${n2(cfg.amount)}€`;
  return `${n2(cfg.percent)}%`;
}

function txnLine(t, m, cats, A) {
  const cur = t.currency === 'GEL' ? '₾' : '€';
  const id = A.s(t.id, 't');
  const base = [id, t.name, A.s(t.categoryId, 'c'), t.account || 'shared'];
  if (isEnvelope(t)) {
    const used = envelopeUsed(t, m.transactions, m.exchangeRate);
    return [...base, `budget ${n2(t.amountPlanned)}${cur} used ${n2(used)} left ${n2((t.amountPlanned || 0) - used)}${t.paid ? ' closed' : ''}`, '', 'envelope'].join('|');
  }
  let status = 'open';
  if (t.paid) status = `paid ${n2(t.amountActual ?? t.amountPlanned)}${cur} ${ddmm(t.paidAt)}`;
  else if (t.transferredAt) status = `transferred ${ddmm(t.transferredAt)}`;
  const flags = [
    isTwoStep(t, cats) ? 'two-step' : '',
    isExtra(t) ? `extra${t.fromEnvelope ? ` from ${A.s(t.fromEnvelope, 't')}` : ''}` : '',
    isFromSavings(t) ? `fromSavings ${A.s(t.fromSavings, 'c')}` : '',
    t.toGeorgia ? 'georgia' : '',
    t.templateId ? `tpl ${A.s(t.templateId, 'p')}` : '',
    t.note ? `note: ${t.note.slice(0, 40)}` : ''
  ].filter(Boolean).join(', ');
  return [...base, `${n2(t.amountPlanned)}${cur}`, status, ddmm(t.dueDate), flags].join('|');
}

/** The selected month in compact lines — sent with the user's message whenever it changed. */
export function monthText(state, key, A) {
  const m = state.months[key];
  if (!m) return `month ${key}: not created yet (it will be created when something is recorded).`;
  const cats = state.categories;
  const { categories: rc } = planFor(m, cats, state.settings);
  const L = [];
  L.push(`month ${key}${key === budgetMonthKey() ? ' (current budget month)' : ''}: income giorgi ${n2(m.income.giorgi)} · nino ${n2(m.income.nino)} · total ${n2(totalIncome(m))} EUR · rate ${m.exchangeRate} GEL/EUR · salary arrived ${salaryStart(key, state)}${m.preparedAt ? '' : ' · not prepared yet'}${m.closedAt ? ' · closed' : ''}`);
  L.push('categories (id|name|kind|owner|parent|target this month):');
  rc.forEach(c => {
    const cfg = planInMonth(state, { cat: c.id }, key);
    const parent = c.parentId === FREE_BUCKET_ID ? 'free' : (c.parentId ? A.s(c.parentId, 'c') : '-');
    L.push([A.s(c.id, 'c'), c.name, catKind(cats, c), c.owner || 'shared', parent, targetText(cfg, c)].join('|'));
  });
  const fg = planInMonth(state, { free: 'giorgi' }, key), fn = planInMonth(state, { free: 'nino' }, key);
  L.push(`free money target: giorgi ${targetText(fg)} · nino ${targetText(fn)}`);
  L.push('transactions (id|name|cat|account|plan|status|due|flags):');
  m.transactions.slice().sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).forEach(t => L.push(txnLine(t, m, cats, A)));
  const sav = computeSavingsOverview(m, cats, state.months, key).items;
  if (sav.length) {
    L.push('savings (id|name|owner|plan|transferred|spent from it|balance all months):');
    sav.forEach(s => L.push([A.s(s.id, 'c'), s.name, s.owner, n2(s.planned), n2(s.done), n2(s.withdrawn), s.balance === null ? '-' : n2(s.balance)].join('|')));
  }
  return L.join('\n');
}

/** Opening context: today, the selected month and the top data problems. */
export function snapshotText(state, key, A) {
  const findings = runDiagnostics(state, { currentKey: budgetMonthKey() }).filter(f => !f.month || f.month === key).slice(0, 8);
  return [
    `DATA (today ${new Date().toISOString().slice(0, 10)}; the user is looking at month ${key})`,
    monthText(state, key, A),
    findings.length ? `checks: ${findings.map(f => `${f.month ? `${f.month} ` : ''}${f.title}`).join(' / ')}` : ''
  ].filter(Boolean).join('\n');
}

function overviewText(state) {
  const keys = Object.keys(state.months).sort();
  const L = ['months (key|income|planned bills|paid|saved|entries|prepared):'];
  const range = computeRangeOverview(state.months, state.categories, keys[0] || '0000-00', keys[keys.length - 1] || '9999-99', null, budgetMonthKey());
  keys.forEach(k => {
    const m = state.months[k];
    const row = range.rows.find(r => r.key === k);
    const planned = m.transactions.reduce((s, t) => s + (isEnvelope(t) || isExtra(t) || isFromSavings(t) ? 0 : (t.currency === 'GEL' ? (t.amountPlanned || 0) / (m.exchangeRate || 1) : (t.amountPlanned || 0))), 0);
    const paid = m.transactions.reduce((s, t) => s + txnPaidEur(t, m.exchangeRate), 0);
    L.push([k, n2(totalIncome(m)), n2(planned), n2(paid), row ? n2(row.saved) : '0', m.transactions.length, m.preparedAt ? 'yes' : 'no'].join('|'));
  });
  L.push(`templates: ${state.templates.length} · categories: ${state.categories.length} · salary day: ${state.settings.salaryDay} · budget month now: ${budgetMonthKey()}`);
  return L.join('\n');
}

function categoriesText(state, A) {
  const cats = state.categories;
  return ['categories (id|name|kind|owner|parent|goalType|term|global target|color|savings goal):', ...cats.map(c => [
    A.s(c.id, 'c'), c.name, catKind(cats, c), c.owner || 'shared', c.parentId === FREE_BUCKET_ID ? 'free' : (c.parentId ? A.s(c.parentId, 'c') : '-'),
    c.goalType, c.term || '', targetText(c), c.color, c.goalAmount ? `${n2(c.goalAmount)}€${c.goalBy ? ` by ${c.goalBy}` : ''}` : ''
  ].join('|'))].join('\n');
}

function templatesText(state, A) {
  return ['templates (id|name|cat|type|amount|cycle months|first due|account|active|flags):', ...state.templates.map(t => [
    A.s(t.id, 'p'), t.name, A.s(t.categoryId, 'c'), t.type || 'fixed', `${n2(t.amount)}${t.currency === 'GEL' ? '₾' : '€'}`,
    t.oneTime ? 'once' : (t.cycleMonths || 1), t.firstDueDate, t.account || 'shared', t.active ? 'yes' : 'no',
    [t.toGeorgia ? 'georgia' : '', t.dailyHint === false ? 'no daily hint' : ''].filter(Boolean).join(',')
  ].join('|'))].join('\n');
}

function settingsText(state) {
  const s = { ...state.settings };
  ['texts', 'aiNotes', '_u', '_uf', 'lastBackupAt'].forEach(k => delete s[k]);
  return `settings: ${JSON.stringify(s)}\nrenamed texts: ${Object.keys(state.settings.texts || {}).length}`;
}

function searchText(state, query, A) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 'empty query';
  const L = [];
  Object.keys(state.months).sort().forEach(k => {
    const m = state.months[k];
    m.transactions.filter(t => (t.name || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q))
      .forEach(t => L.push(`${k} ${txnLine(t, m, state.categories, A)}`));
  });
  state.templates.filter(t => t.name.toLowerCase().includes(q)).forEach(t => L.push(`template ${A.s(t.id, 'p')}|${t.name}|${n2(t.amount)}|${t.active ? 'active' : 'off'}`));
  state.categories.filter(c => c.name.toLowerCase().includes(q)).forEach(c => L.push(`category ${A.s(c.id, 'c')}|${c.name}`));
  return L.length ? L.slice(0, 80).join('\n') + (L.length > 80 ? `\n…${L.length - 80} more — search narrower` : '') : 'nothing found';
}

function recordText(state, key, input, A) {
  const type = input.type || 'transaction';
  const id = A.r(input.id);
  if (type === 'settings') return settingsText(state);
  if (type === 'month') {
    const m = state.months[input.month || key];
    if (!m) return 'month not found';
    const head = { ...m }; delete head.transactions; delete head._u; delete head._uf;
    return JSON.stringify(head);
  }
  if (type === 'template') { const t = state.templates.find(x => x.id === id); return t ? JSON.stringify(aliasRecord(t, 'p', A)) : 'template not found'; }
  if (type === 'category') { const c = state.categories.find(x => x.id === id); return c ? JSON.stringify(aliasRecord(c, 'c', A)) : 'category not found'; }
  const months = input.month ? [input.month] : Object.keys(state.months);
  for (const k of months) {
    const t = (state.months[k]?.transactions || []).find(x => x.id === id);
    if (t) return `month ${k}: ${JSON.stringify(aliasRecord(t, 't', A))}`;
  }
  return 'transaction not found';
}

/** Runs a `read` call. Output is capped so one call never floods the conversation. */
export function runRead(state, key, input, A) {
  const month = /^\d{4}-\d{2}$/.test(input.month || '') ? input.month : key;
  let out;
  switch (input.what) {
    case 'overview': out = overviewText(state); break;
    case 'month': out = monthText(state, month, A); break;
    case 'categories': out = categoriesText(state, A); break;
    case 'templates': out = templatesText(state, A); break;
    case 'settings': out = settingsText(state); break;
    case 'record': out = recordText(state, key, input, A); break;
    case 'search': out = searchText(state, input.query, A); break;
    case 'checks': out = runDiagnostics(state, { currentKey: budgetMonthKey() }).map(f => `[${f.level}] ${f.month || ''} ${f.title} → ${f.fix}`).join('\n') || 'no problems found'; break;
    default: out = 'what: overview, month, categories, templates, settings, record, search, checks';
  }
  return out.length > 12000 ? `${out.slice(0, 12000)}\n…(cut — ask narrower)` : out;
}

/** Short Georgian label of a read, for the chat ("🔎 AI კითხულობს: …"). */
export function readLabel(input) {
  return {
    overview: 'ყველა თვის მოკლე მიმოხილვა', month: `თვე ${input.month || ''}`, categories: 'კატეგორიები', templates: 'შაბლონები',
    settings: 'პარამეტრები', record: 'ერთი ჩანაწერი', search: `ძებნა „${input.query || ''}"`, checks: 'შემოწმების შედეგები'
  }[input.what] || 'მონაცემები';
}

// ---------------- tool list (neutral JSON schema; ai.js converts it per provider) ----------------

const P = (props, required = []) => ({ type: 'object', properties: props, required });
const S = (description, values) => (values ? { type: 'string', enum: values, description } : { type: 'string', description });
const N = (description) => ({ type: 'number', description });
const B = (description) => ({ type: 'boolean', description });
const MONTH = S('YYYY-MM; omit = the month the user is looking at');
const ACC = S('whose account pays', ['shared', 'giorgi', 'nino']);
const fieldList = Object.entries(RECORD_FIELDS).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ');

export const TOOL_DEFS = [
  { name: 'read', description: 'Read any data (free, runs at once). what: overview = all months in short; month = one month in full; categories; templates; settings; record = one record as JSON (type + id; month for a transaction); search = find by name in all months, templates and categories (query); checks = data problems found by the app.',
    params: P({ what: S('what to read', ['overview', 'month', 'categories', 'templates', 'settings', 'record', 'search', 'checks']), month: MONTH, type: S('record type', ['transaction', 'template', 'category', 'month', 'settings']), id: S('record id'), query: S('text to search') }, ['what']) },
  { name: 'add_expense', description: 'Record a new expense in a month (paid by default, because it already happened).',
    params: P({ month: MONTH, name: S('what it was, in Georgian'), amount: N('amount'), currency: S('currency', ['EUR', 'GEL']), category_id: S('category id'), account: ACC, paid: B('already paid? default true'), to_georgia: B('sent to Georgia'), note: S('optional') }, ['name', 'amount', 'category_id']) },
  { name: 'spend_from_savings', description: 'Money taken OUT of a savings category to pay an expense: records it as paid and lowers that saving\'s balance. Never edit the savings transfer instead.',
    params: P({ month: MONTH, savings_category_id: S('savings category id'), amount: N('EUR'), name: S('what it was spent on'), category_id: S('category of the expense itself (not savings)'), account: ACC }, ['savings_category_id', 'amount', 'name']) },
  { name: 'budget', description: 'A spend-as-you-go budget (envelope: food, fuel…). op spend = a purchase; left = how much is LEFT now (spent is worked out); all_spent = count the rest (or amount) as spent; move = move amount of budget to another budget (to_id) in the same month.',
    params: P({ month: MONTH, envelope_id: S('budget (envelope) id'), op: S('operation', ['spend', 'left', 'all_spent', 'move']), amount: N('amount in the budget currency'), to_id: S('target budget id (move)'), note: S('optional') }, ['envelope_id', 'op']) },
  { name: 'set_status', description: 'Mark a bill unpaid, transferred or paid. transferred = only two-step bills (debited from giorgi\'s or nino\'s own account): the money was moved to that account, the bank has not taken it yet. paid = paid / debited, optionally with the real amount.',
    params: P({ month: MONTH, txn_id: S('transaction id'), status: S('new status', ['unpaid', 'transferred', 'paid']), amount: N('real paid amount (optional)') }, ['txn_id', 'status']) },
  { name: 'set_income', description: 'Set a month\'s salary of giorgi and/or nino (EUR).',
    params: P({ month: MONTH, giorgi: N('EUR'), nino: N('EUR') }) },
  { name: 'set_target', description: 'Change the plan target of a category (or of free money) from a month on (scope forward) or for that month only. Earlier months never change. target_type auto = follows that month\'s planned bills of the category.',
    params: P({ month: MONTH, category_id: S('category id (or use free)'), free: S('free money of', ['giorgi', 'nino']), target_type: S('unit', ['percent', 'amount', 'auto']), value: N('percent or EUR; omit for auto'), scope: S('scope', ['forward', 'only']) }, ['target_type']) },
  { name: 'update_record', description: `Change fields of any record. Changeable fields — ${fieldList}. fields_json = a JSON object as text, e.g. {"amountPlanned":120,"dueDate":"2026-12-05"}. Use short ids inside (categoryId, parentId). For plan targets use set_target, for income set_income.`,
    params: P({ type: S('record type', ['transaction', 'template', 'category', 'month', 'settings']), id: S('record id (not for month/settings)'), month: MONTH, fields_json: S('JSON object with the new values') }, ['type', 'fields_json']) },
  { name: 'create_record', description: 'Create a transaction (in a month), a template or a category. fields_json = JSON object as text with the same field names as update_record (transaction needs name, categoryId, amountPlanned; template needs name, categoryId, amount; category needs name).',
    params: P({ type: S('record type', ['transaction', 'template', 'category']), month: MONTH, fields_json: S('JSON object with the values') }, ['type', 'fields_json']) },
  { name: 'delete_record', description: 'Delete a transaction, a template (its entries stay), an unused category, or a whole PAST month.',
    params: P({ type: S('record type', ['transaction', 'template', 'category', 'month']), id: S('record id (not for month)'), month: MONTH }, ['type']) },
  { name: 'report_issue', description: 'Write a note for the app developer about a bug, a confusing screen or a missing feature that needs a CODE change (not a data change). Saved at once to the app\'s "to fix" list.',
    params: P({ title: S('short title, Georgian'), detail: S('what is wrong, where, what the code should do instead') }, ['title', 'detail']) }
];

export const READ_TOOLS = new Set(['read']);
export const NOTE_TOOL = 'report_issue';

function parseFields(v) {
  if (v && typeof v === 'object') return v;
  try { const o = JSON.parse(String(v || '')); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* fall through */ }
  throw new Error('fields_json უნდა იყოს JSON ობიექტი, მაგ. {"amountPlanned": 120}');
}

/** Write tools → app actions (actions.js). Each returns a Georgian one-line description. */
const WRITE = {
  add_expense: (d, k, i, A) => ACTIONS.addExpense(d, k, { name: i.name, amount: i.amount, currency: i.currency === 'GEL' ? 'GEL' : 'EUR', categoryId: A.r(i.category_id), account: i.account, paid: i.paid !== false, toGeorgia: !!i.to_georgia, note: i.note || '' }),
  spend_from_savings: (d, k, i, A) => ACTIONS.spendFromSavings(d, k, { savingsCategoryId: A.r(i.savings_category_id), amount: i.amount, name: i.name, categoryId: i.category_id ? A.r(i.category_id) : null, account: i.account || null }),
  budget: (d, k, i, A) => {
    const id = A.r(i.envelope_id);
    if (i.op === 'spend') return ACTIONS.envelopeSpend(d, k, { envelopeId: id, amount: i.amount, note: i.note || '' });
    if (i.op === 'left') return ACTIONS.envelopeSetLeft(d, k, { envelopeId: id, left: i.amount });
    if (i.op === 'all_spent') return ACTIONS.envelopeMarkSpent(d, k, { envelopeId: id, amount: i.amount ?? null });
    if (i.op === 'move') return ACTIONS.moveEnvelopeBudget(d, k, { fromId: id, toId: A.r(i.to_id), amount: i.amount });
    throw new Error('op: spend, left, all_spent ან move');
  },
  set_status: (d, k, i, A) => ACTIONS.setStatus(d, k, { txnId: A.r(i.txn_id), status: i.status, amount: i.amount ?? null }),
  set_income: (d, k, i) => ACTIONS.setIncome(d, k, { giorgi: i.giorgi ?? null, nino: i.nino ?? null }),
  set_target: (d, k, i, A) => ACTIONS.setTarget(d, k, { categoryId: i.category_id ? A.r(i.category_id) : null, free: i.free || null, targetType: i.target_type, value: i.value, scope: i.scope || 'forward' }),
  update_record: (d, k, i, A) => ACTIONS.updateRecord(d, k, { type: i.type, id: i.id ? A.r(i.id) : null, fields: unaliasFields(parseFields(i.fields_json), A) }),
  create_record: (d, k, i, A) => ACTIONS.createRecord(d, k, { type: i.type, fields: unaliasFields(parseFields(i.fields_json), A) }),
  delete_record: (d, k, i, A) => ACTIONS.deleteRecord(d, k, { type: i.type, id: i.id ? A.r(i.id) : null })
};
export const isWriteTool = (name) => !!WRITE[name];

/** The month a call works on (its own `month`, or the one the user is looking at). */
export function callMonth(input, key) {
  return /^\d{4}-\d{2}$/.test((input && input.month) || '') ? input.month : key;
}

/** Applies one proposed call to a state draft (inside updateState). Returns its description. */
export function applyCall(draft, key, call, A) {
  const fn = WRITE[call.name];
  if (!fn) throw new Error(`უცნობი მოქმედება: ${call.name}`);
  const k = callMonth(call.input, key);
  const needsMonth = !['settings', 'template', 'category'].includes(call.input && call.input.type) && call.name !== 'delete_record';
  if (needsMonth && !draft.months[k]) initMonth(draft, k);
  return fn(draft, k, call.input || {}, A);
}

/** Plain-words description of a proposed call, by dry-running it on a throw-away copy. */
export function describeCall(state, key, call, A) {
  try {
    const copy = JSON.parse(JSON.stringify(state));
    const label = applyCall(copy, key, call, A);
    const k = callMonth(call.input, key);
    return { label: k !== key ? `${label} · ${k}` : label, ok: true };
  } catch (e) {
    return { label: `⚠️ ${e.message}`, ok: false };
  }
}
