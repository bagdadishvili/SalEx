// actions.js — data changes as small named actions (v18). The dashboard buttons AND the AI
// assistant use the same functions, so the assistant can only do what the app itself can do,
// one clearly described step at a time. Each action mutates a state draft (inside updateState)
// and returns a short Georgian description; invalid input throws an Error with a message.

import { todayISO, FREE_BUCKET_ID, budgetMonthKey } from './state.js';
import { envelopeUsed, formatMoney, isEnvelope, savingsCategories, gelToEur, isTwoStep } from './calc.js';
import { setPlanTarget } from './plan.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function needMonth(draft, key) {
  const m = draft.months[key];
  if (!m) throw new Error(`თვე ${key} არ არსებობს`);
  return m;
}
function needTxn(m, id) {
  const t = m.transactions.find(x => x.id === id);
  if (!t) throw new Error(`ჩანაწერი ვერ მოიძებნა (${id})`);
  return t;
}
function needAmount(v) {
  const n = round2(v);
  if (!(n > 0)) throw new Error('თანხა უნდა იყოს 0-ზე მეტი');
  return n;
}
function needCategory(draft, id) {
  const c = draft.categories.find(x => x.id === id);
  if (!c) throw new Error(`კატეგორია ვერ მოიძებნა (${id})`);
  return c;
}
const ACC = (a) => (['shared', 'giorgi', 'nino'].includes(a) ? a : 'shared');

/** A new expense in the month (paid by default — it already happened). */
export function addExpense(draft, key, { name, amount, categoryId, account = 'shared', currency = 'EUR', paid = true, toGeorgia = false, note = '', date = null }) {
  const m = needMonth(draft, key);
  const v = needAmount(amount);
  needCategory(draft, categoryId);
  if (!String(name || '').trim()) throw new Error('ხარჯს სახელი სჭირდება');
  const d = date || todayISO();
  m.transactions.push({
    id: uid('txn'), templateId: null, name: String(name).trim().slice(0, 80), categoryId,
    owner: ACC(account), account: ACC(account), toGeorgia: !!toGeorgia, currency: currency === 'GEL' ? 'GEL' : 'EUR',
    amountPlanned: v, amountActual: paid ? v : null, paid: !!paid, paidAt: paid ? d : null, rateAtPayment: null,
    dueDate: d, note: note || ''
  });
  return `➕ ${name}: ${formatMoney(v, currency)}${paid ? ' (გადახდილი)' : ''}`;
}

/**
 * Money spent from savings (v18): records the expense (paid) and lowers that saving's balance.
 * The month's savings transfer itself is NOT changed — it really happened.
 */
export function spendFromSavings(draft, key, { savingsCategoryId, amount, name, categoryId = null, account = null, date = null, note = '' }) {
  const m = needMonth(draft, key);
  const v = needAmount(amount);
  const sav = needCategory(draft, savingsCategoryId);
  if (!savingsCategories(draft.categories).some(c => c.id === sav.id)) throw new Error(`„${sav.name}" დანაზოგის კატეგორია არ არის`);
  let cat = categoryId ? needCategory(draft, categoryId) : null;
  if (cat && savingsCategories(draft.categories).some(c => c.id === cat.id)) throw new Error('ხარჯის კატეგორია დანაზოგი ვერ იქნება');
  if (!cat) cat = draft.categories.find(c => c.parentId === FREE_BUCKET_ID) || draft.categories.find(c => c.goalType !== 'min');
  const d = date || todayISO();
  const acc = ACC(account || sav.owner);
  m.transactions.push({
    id: uid('txn_fs'), templateId: null, kind: 'fromSavings', fromSavings: sav.id,
    name: String(name || 'დანაზოგიდან ხარჯი').trim().slice(0, 80), categoryId: cat.id,
    owner: acc, account: acc, toGeorgia: false, currency: 'EUR',
    amountPlanned: 0, amountActual: v, paid: true, paidAt: d, rateAtPayment: null, dueDate: d, note: note || ''
  });
  return `💸 ${formatMoney(v, 'EUR')} დანაზოგიდან („${sav.name}") → ${name || 'ხარჯი'}`;
}

/** A purchase from a food/fuel budget. */
export function envelopeSpend(draft, key, { envelopeId, amount, note = '' }) {
  const m = needMonth(draft, key);
  const env = needTxn(m, envelopeId);
  if (!isEnvelope(env)) throw new Error(`„${env.name}" ბიუჯეტი (კვება/საწვავი) არ არის`);
  const v = needAmount(amount);
  if (!Array.isArray(env.spends)) env.spends = [];
  env.spends.push({ id: uid('sp'), date: todayISO(), amount: v, note: note || '' });
  return `🛒 ${env.name}: დახარჯულია +${formatMoney(v, env.currency)}`;
}

/** What is left in a budget, as seen in the bank app — spent is worked out from it. */
export function envelopeSetLeft(draft, key, { envelopeId, left }) {
  const m = needMonth(draft, key);
  const env = needTxn(m, envelopeId);
  if (!isEnvelope(env)) throw new Error(`„${env.name}" ბიუჯეტი არ არის`);
  const used = envelopeUsed(env, m.transactions, m.exchangeRate);
  const amount = round2((env.amountPlanned || 0) - (Number(left) || 0) - used);
  if (Math.abs(amount) < 0.005) return `🛒 ${env.name}: უცვლელია`;
  if (!Array.isArray(env.spends)) env.spends = [];
  env.spends.push({ id: uid('sp'), date: todayISO(), amount, note: 'ნაშთის მიხედვით' });
  return `🛒 ${env.name}: დარჩა ${formatMoney(left, env.currency)}`;
}

/**
 * "Everything (or X) of this budget was spent" — no need to type every receipt.
 * amount omitted = everything still left.
 */
export function envelopeMarkSpent(draft, key, { envelopeId, amount = null }) {
  const m = needMonth(draft, key);
  const env = needTxn(m, envelopeId);
  if (!isEnvelope(env)) throw new Error(`„${env.name}" ბიუჯეტი არ არის`);
  const left = round2((env.amountPlanned || 0) - envelopeUsed(env, m.transactions, m.exchangeRate));
  const v = amount === null || amount === undefined || amount === '' ? left : needAmount(amount);
  if (!(v > 0)) throw new Error(`„${env.name}"-ში აღარაფერი დარჩა`);
  if (!Array.isArray(env.spends)) env.spends = [];
  env.spends.push({ id: uid('sp'), date: todayISO(), amount: v, note: 'დახარჯულად მოინიშნა (ქვითრების გარეშე)' });
  return `✓ ${env.name}: ${formatMoney(v, env.currency)} დახარჯულად ჩაითვალა`;
}

/**
 * Moves budget between two food/fuel budgets of the same month (e.g. 40 € left in fuel were
 * spent on food from the same account). Plans change only for THIS month; total stays the same.
 */
export function moveEnvelopeBudget(draft, key, { fromId, toId, amount }) {
  const m = needMonth(draft, key);
  const a = needTxn(m, fromId), b = needTxn(m, toId);
  if (!isEnvelope(a) || !isEnvelope(b)) throw new Error('გადატანა შესაძლებელია მხოლოდ ბიუჯეტებს შორის (კვება, საწვავი…)');
  if (a.id === b.id) throw new Error('აირჩიე ორი სხვადასხვა ბიუჯეტი');
  const v = needAmount(amount);
  // amounts in each budget's own currency
  const inB = a.currency === b.currency ? v : (a.currency === 'GEL' ? gelToEur(v, m.exchangeRate) : v * (m.exchangeRate || 0));
  if (v > (a.amountPlanned || 0) + 0.004) throw new Error(`„${a.name}"-ის ბიუჯეტი მხოლოდ ${formatMoney(a.amountPlanned, a.currency)}-ია`);
  const when = todayISO();
  a.amountPlanned = round2(a.amountPlanned - v);
  b.amountPlanned = round2((b.amountPlanned || 0) + inB);
  a.moves = [...(a.moves || []), { id: uid('mv'), date: when, amount: -v, other: b.id }];
  b.moves = [...(b.moves || []), { id: uid('mv'), date: when, amount: round2(inB), other: a.id }];
  return `⇄ ${formatMoney(v, a.currency)}: ${a.name} → ${b.name}`;
}

/** Marks a bill paid (optionally with the real amount). */
export function markPaid(draft, key, { txnId, amount = null }) {
  const m = needMonth(draft, key);
  const t = needTxn(m, txnId);
  if (isEnvelope(t)) throw new Error('ბიუჯეტი (კვება/საწვავი) გადახდით არ ინიშნება — გამოიყენე „დახარჯულად"');
  t.paid = true; t.paidAt = todayISO();
  t.amountActual = amount ? needAmount(amount) : (t.amountActual ?? t.amountPlanned);
  return `✓ ${t.name}: გადახდილი ${formatMoney(t.amountActual, t.currency)}`;
}

/** Changes amounts of one entry: planned and/or paid amount. */
export function setTxnAmount(draft, key, { txnId, planned = null, actual = null }) {
  const m = needMonth(draft, key);
  const t = needTxn(m, txnId);
  const parts = [];
  if (planned !== null && planned !== undefined) { t.amountPlanned = round2(planned); parts.push(`გეგმა ${formatMoney(t.amountPlanned, t.currency)}`); }
  if (actual !== null && actual !== undefined) {
    if (!t.paid) throw new Error(`„${t.name}" ჯერ გადახდილი არ არის — ჯერ მონიშნე გადახდილად`);
    t.amountActual = round2(actual); parts.push(`გადახდილი ${formatMoney(t.amountActual, t.currency)}`);
  }
  if (!parts.length) throw new Error('არაფერი შეიცვალა');
  return `✎ ${t.name}: ${parts.join(', ')}`;
}

/** Month income per person. */
export function setIncome(draft, key, { giorgi = null, nino = null }) {
  const m = needMonth(draft, key);
  const parts = [];
  if (giorgi !== null && giorgi !== undefined) { m.income.giorgi = round2(giorgi); parts.push(`გიორგი ${formatMoney(m.income.giorgi, 'EUR')}`); }
  if (nino !== null && nino !== undefined) { m.income.nino = round2(nino); parts.push(`ნინო ${formatMoney(m.income.nino, 'EUR')}`); }
  if (!parts.length) throw new Error('არაფერი შეიცვალა');
  return `💶 შემოსავალი: ${parts.join(', ')}`;
}

/** Plan target of a category or free money, from this month on (or this month only). */
export function setTarget(draft, key, { categoryId = null, free = null, targetType, value, scope = 'forward' }) {
  if (!['percent', 'amount', 'auto'].includes(targetType)) throw new Error('ერთეული: percent, amount ან auto');
  const ref = free ? { free } : { cat: needCategory(draft, categoryId).id };
  if (free && !['giorgi', 'nino'].includes(free)) throw new Error('free = giorgi ან nino');
  const cfg = { targetType };
  if (targetType === 'percent') cfg.percent = round2(value);
  if (targetType === 'amount') cfg.amount = round2(value);
  setPlanTarget(draft, ref, cfg, key, scope === 'only' ? 'only' : 'forward');
  const name = free ? `თავისუფალი (${free})` : draft.categories.find(c => c.id === categoryId).name;
  const v = targetType === 'auto' ? 'ავტო (ამ თვის ხარჯებიდან)' : targetType === 'percent' ? `${value} %` : formatMoney(value, 'EUR');
  return `🎯 ${name}: ${v} — ${scope === 'only' ? 'მხოლოდ ამ თვეში' : 'ამ თვიდან'}`;
}

/**
 * Status of a bill (v19): 'unpaid' | 'transferred' (two-step bills: money moved to the personal
 * account, not debited yet) | 'paid' (= debited), optionally with the real amount.
 */
export function setStatus(draft, key, { txnId, status, amount = null }) {
  const m = needMonth(draft, key);
  const t = needTxn(m, txnId);
  if (isEnvelope(t)) throw new Error('ბიუჯეტი (კვება/საწვავი) სტატუსით არ ინიშნება — გამოიყენე envelope');
  if (status === 'paid') return markPaid(draft, key, { txnId, amount });
  if (status === 'transferred') {
    if (!isTwoStep(t, draft.categories)) throw new Error(`„${t.name}" საერთო ანგარიშიდან (ან დანაზოგია) — „გადატანილი" მხოლოდ პირადი ანგარიშის გადასახადს აქვს`);
    t.paid = false; t.paidAt = null; t.rateAtPayment = null;
    t.transferredAt = t.transferredAt || todayISO();
    return `⇄ ${t.name}: გადატანილია, ელოდება ჩამოჭრას`;
  }
  if (status === 'unpaid') {
    t.paid = false; t.paidAt = null; t.rateAtPayment = null;
    delete t.transferredAt;
    return `○ ${t.name}: გადაუხდელი`;
  }
  throw new Error('status: unpaid, transferred ან paid');
}

// ---------------- Generic record changes (v19, for the assistant: "change anything") ----------------
// Every field that may be changed is listed with a checker, so a wrong value is refused with a
// clear message instead of breaking the data. Targets (plan %) go through setTarget only.

const isoDate = (v) => {
  if (v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error(`თარიღი უნდა იყოს YYYY-MM-DD (${v})`);
  return String(v);
};
const money = (v) => { const n = round2(v); if (!(n >= 0) || !Number.isFinite(Number(v))) throw new Error(`არასწორი თანხა: ${v}`); return n; };
const moneyOrNull = (v) => (v === null || v === '' ? null : money(v));
const oneOf = (...vals) => (v) => { if (!vals.includes(v)) throw new Error(`დასაშვებია: ${vals.join(', ')}`); return v; };
const text = (max, required = false) => (v) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new Error('ცარიელი არ შეიძლება');
  return s.slice(0, max);
};
const int = (min, max) => (v) => { const n = Math.round(Number(v)); if (!(n >= min && n <= max)) throw new Error(`რიცხვი ${min}–${max}`); return n; };
const bool = (v) => v === true || v === 'true' || v === 1;
const color = (v) => { if (!/^#[0-9a-f]{6}$/i.test(String(v))) throw new Error('ფერი: #RRGGBB'); return String(v); };
const strList = (v) => { if (!Array.isArray(v)) throw new Error('სია უნდა იყოს'); return v.map(String).slice(0, 60); };

const FIELDS = {
  transaction: {
    name: text(80, true), categoryId: 'cat', account: oneOf('shared', 'giorgi', 'nino'), currency: oneOf('EUR', 'GEL'),
    amountPlanned: money, amountActual: moneyOrNull, paid: bool, paidAt: isoDate, transferredAt: isoDate,
    rateAtPayment: (v) => (v === null || v === '' ? null : money(v)), dueDate: isoDate, note: text(200), toGeorgia: bool, dailyHint: bool
  },
  template: {
    name: text(80, true), categoryId: 'cat', type: oneOf('fixed', 'variable', 'envelope'), amount: money, currency: oneOf('EUR', 'GEL'),
    cycleMonths: int(1, 24), firstDueDate: isoDate, account: oneOf('shared', 'giorgi', 'nino'), toGeorgia: bool, active: bool, oneTime: bool, dailyHint: bool
  },
  category: {
    name: text(60, true), color, owner: oneOf('shared', 'giorgi', 'nino'), parentId: 'parent', goalType: oneOf('min', 'max'), term: oneOf('short', 'long', '')
  },
  month: { exchangeRate: (v) => { const n = Number(v); if (!(n > 0 && n < 100)) throw new Error('კურსი 0-ზე მეტი'); return Math.round(n * 10000) / 10000; } },
  settings: {
    salaryDay: int(0, 31), theme: oneOf('light', 'dark'), fontScale: oneOf('small', 'medium', 'large'), accentColor: color,
    newMonthMode: oneOf('wizard', 'auto'), rateAuto: bool, contributionBasis: oneOf('actual', 'plan'), hiddenCards: strList, dashboardCardOrder: strList
  }
};
export const RECORD_FIELDS = Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, Object.keys(v)]));

function checkFields(draft, type, fields, self = null) {
  const rules = FIELDS[type];
  if (!rules) throw new Error('type: transaction, template, category, month ან settings');
  if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) throw new Error('fields ცარიელია');
  const out = {};
  Object.entries(fields).forEach(([k, v]) => {
    const rule = rules[k];
    if (!rule) throw new Error(`ველი „${k}" ვერ შეიცვლება (${type}: ${Object.keys(rules).join(', ')})`);
    if (rule === 'cat') out[k] = needCategory(draft, v).id;
    else if (rule === 'parent') {
      if (v === null || v === '' || v === FREE_BUCKET_ID) out[k] = v === FREE_BUCKET_ID ? FREE_BUCKET_ID : null;
      else {
        const p = needCategory(draft, v);
        if (self && (p.id === self || p.parentId === self)) throw new Error('კატეგორია საკუთარ თავში ვერ ჩაჯდება');
        out[k] = p.id;
      }
    } else out[k] = rule(v);
  });
  return out;
}

function findRecord(draft, type, id, key) {
  if (type === 'transaction') {
    const m = needMonth(draft, key);
    return { rec: needTxn(m, id), month: m };
  }
  if (type === 'template') {
    const rec = draft.templates.find(x => x.id === id);
    if (!rec) throw new Error(`შაბლონი ვერ მოიძებნა (${id})`);
    return { rec };
  }
  if (type === 'category') return { rec: needCategory(draft, id) };
  if (type === 'month') return { rec: needMonth(draft, key) };
  if (type === 'settings') return { rec: draft.settings };
  throw new Error('type: transaction, template, category, month ან settings');
}

const short = (v) => (typeof v === 'string' ? `„${v.slice(0, 40)}"` : JSON.stringify(v));

/** Changes listed fields of any record (validated). */
export function updateRecord(draft, key, { type, id = null, fields }) {
  const { rec } = findRecord(draft, type, id, key);
  const clean = checkFields(draft, type, fields, type === 'category' ? rec.id : null);
  Object.assign(rec, clean);
  if (type === 'transaction' || type === 'template') {
    if ('account' in clean) rec.owner = clean.account;
    if (type === 'transaction' && 'paid' in clean) {
      if (clean.paid) { rec.paidAt = rec.paidAt || todayISO(); rec.amountActual = rec.amountActual ?? rec.amountPlanned; } else { rec.paidAt = null; rec.rateAtPayment = null; }
    }
  }
  if (type === 'month' && 'exchangeRate' in clean) rec.rateSource = { kind: 'manual', source: 'ხელით (AI)', at: new Date().toISOString() };
  const label = type === 'settings' ? 'პარამეტრები' : type === 'month' ? `თვე ${key}` : (rec.name || id);
  return `✎ ${label}: ${Object.entries(clean).map(([k, v]) => `${k} = ${short(v)}`).join(', ')}`;
}

/** Creates a transaction (in the month), a template or a category. */
export function createRecord(draft, key, { type, fields }) {
  if (type === 'transaction') {
    const f = checkFields(draft, 'transaction', { currency: 'EUR', account: 'shared', ...fields });
    if (!f.name || !f.categoryId || !(f.amountPlanned >= 0)) throw new Error('საჭიროა name, categoryId, amountPlanned');
    const m = needMonth(draft, key);
    const paid = !!f.paid;
    m.transactions.push({
      id: uid('txn'), templateId: null, name: f.name, categoryId: f.categoryId, owner: f.account, account: f.account,
      toGeorgia: !!f.toGeorgia, currency: f.currency, amountPlanned: f.amountPlanned,
      amountActual: paid ? (f.amountActual ?? f.amountPlanned) : null, paid, paidAt: paid ? (f.paidAt || todayISO()) : null,
      rateAtPayment: null, dueDate: f.dueDate || `${key}-01`, note: f.note || '', ...(f.transferredAt ? { transferredAt: f.transferredAt } : {})
    });
    return `➕ ${f.name}: ${formatMoney(f.amountPlanned, f.currency)} (${key})`;
  }
  if (type === 'template') {
    const f = checkFields(draft, 'template', { currency: 'EUR', account: 'shared', type: 'fixed', cycleMonths: 1, firstDueDate: `${key}-01`, ...fields });
    if (!f.name || !f.categoryId || !(f.amount > 0)) throw new Error('საჭიროა name, categoryId, amount');
    draft.templates.push({ id: uid('tpl'), active: true, oneTime: false, toGeorgia: false, ...f, owner: f.account });
    return `🧾 ახალი შაბლონი „${f.name}": ${formatMoney(f.amount, f.currency)}, ${f.cycleMonths} თვეში ერთხელ, ${f.firstDueDate}-დან`;
  }
  if (type === 'category') {
    const f = checkFields(draft, 'category', { owner: 'shared', goalType: 'max', color: '#94a3b8', ...fields });
    if (!f.name) throw new Error('საჭიროა name');
    draft.categories.push({ id: uid('cat'), percent: 0, targetType: 'percent', amount: null, georgiaTransfer: false, parentId: null, ...f });
    return `🏷️ ახალი კატეგორია „${f.name}"`;
  }
  throw new Error('type: transaction, template ან category');
}

/** Deletes a transaction, a template, an unused category, or a whole past month. */
export function deleteRecord(draft, key, { type, id = null }) {
  if (type === 'transaction') {
    const m = needMonth(draft, key);
    const t = needTxn(m, id);
    m.transactions = m.transactions.filter(x => x.id !== id);
    // a deleted template entry must not come back on the next render
    if (t.templateId && !(m.skipTemplates || []).includes(t.templateId)) m.skipTemplates = [...(m.skipTemplates || []), t.templateId];
    return `🗑 ${t.name} (${key})`;
  }
  if (type === 'template') {
    const t = draft.templates.find(x => x.id === id);
    if (!t) throw new Error(`შაბლონი ვერ მოიძებნა (${id})`);
    draft.templates = draft.templates.filter(x => x.id !== id);
    return `🗑 შაბლონი „${t.name}" (უკვე შექმნილი ჩანაწერები რჩება)`;
  }
  if (type === 'category') {
    const c = needCategory(draft, id);
    const used = draft.templates.some(x => x.categoryId === id) || draft.categories.some(x => x.parentId === id)
      || Object.values(draft.months).some(m => m.transactions.some(x => x.categoryId === id || x.fromSavings === id));
    if (used) throw new Error(`„${c.name}" გამოიყენება (ჩანაწერები/შაბლონები/ქვეკატეგორიები) — ჯერ გადაიტანე ისინი`);
    draft.categories = draft.categories.filter(x => x.id !== id);
    return `🗑 კატეგორია „${c.name}"`;
  }
  if (type === 'month') {
    needMonth(draft, key);
    if (key >= budgetMonthKey()) throw new Error('მიმდინარე და მომავალი თვე არ იშლება — მხოლოდ გასული');
    delete draft.months[key];
    return `🗑 თვე ${key} მთლიანად`;
  }
  throw new Error('type: transaction, template, category ან month');
}

/** Runs a list of {action, input} — used by the assistant after the user confirms. */
export const ACTIONS = {
  addExpense, spendFromSavings, envelopeSpend, envelopeSetLeft, envelopeMarkSpent, moveEnvelopeBudget, markPaid, setTxnAmount,
  setIncome, setTarget, setStatus, updateRecord, createRecord, deleteRecord
};
