// actions.js — data changes as small named actions (v18). The dashboard buttons AND the AI
// assistant use the same functions, so the assistant can only do what the app itself can do,
// one clearly described step at a time. Each action mutates a state draft (inside updateState)
// and returns a short Georgian description; invalid input throws an Error with a message.

import { todayISO, FREE_BUCKET_ID } from './state.js';
import { envelopeUsed, formatMoney, isEnvelope, savingsCategories, gelToEur } from './calc.js';
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

/** Runs a list of {action, input} — used by the assistant after the user confirms. */
export const ACTIONS = { addExpense, spendFromSavings, envelopeSpend, envelopeSetLeft, envelopeMarkSpent, moveEnvelopeBudget, markPaid, setTxnAmount, setIncome, setTarget };
