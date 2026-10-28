// monthEngine.js — month initialization and template-driven transaction generation.

import { isTemplateDueInMonth } from './calc.js';
import { EPOCH } from './records.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Ensures the month exists on `draft` (state draft), copying rate/income from previous month. */
export function initMonth(draft, key) {
  if (!draft.months[key]) {
    const keys = Object.keys(draft.months).sort();
    const prevKey = keys.filter(k => k < key).pop();
    const prev = prevKey ? draft.months[prevKey] : null;
    draft.months[key] = {
      exchangeRate: prev ? prev.exchangeRate : 3.00,
      income: prev ? { ...prev.income } : { giorgi: 0, nino: 0 },
      plannedSavings: null,
      generatedFromTemplates: false,
      skipTemplates: [],
      _u: EPOCH, // derived from the previous month, not a user edit
      transactions: []
    };
    // Re-opening a month that was deleted earlier: it comes back (empty) on purpose.
    if (draft.deleted && draft.deleted[`month:${key}`]) {
      delete draft.deleted[`month:${key}`];
      draft.months[key]._u = new Date().toISOString();
    }
  }
  const m = draft.months[key];
  if (!Array.isArray(m.skipTemplates)) m.skipTemplates = [];
  return m;
}

/** Compute the due date within `monthKeyStr` for a template, preserving the day-of-month. */
function dueDateForMonth(tpl, monthKeyStr) {
  const day = Number(tpl.firstDueDate.slice(8, 10));
  const [y, m] = monthKeyStr.split('-').map(Number);
  // Clamp day to last day of target month (handles e.g. day 31 in a 30-day month).
  const lastDay = new Date(y, m, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return `${monthKeyStr}-${String(clampedDay).padStart(2, '0')}`;
}

/** Same id on every device for "template X in month Y" — so two phones never create duplicates. */
export function generatedTxnId(tplId, key) {
  return `txn_${tplId}_${key}`;
}

function isDue(draft, month, tpl, key, existing) {
  if (!tpl.active) return false;
  if (existing.has(tpl.id)) return false;
  if (month && month.skipTemplates && month.skipTemplates.includes(tpl.id)) return false; // user deleted it here
  if (draft.deleted && draft.deleted[generatedTxnId(tpl.id, key)]) return false;
  return isTemplateDueInMonth(tpl, key);
}

/** Builds the transaction a template produces for a month. */
export function txnFromTemplate(tpl, key, { fresh = false } = {}) {
  const t = {
    id: generatedTxnId(tpl.id, key),
    templateId: tpl.id,
    name: tpl.name,
    categoryId: tpl.categoryId,
    owner: tpl.account || tpl.owner || 'shared',
    account: tpl.account || 'shared',
    toGeorgia: !!tpl.toGeorgia,
    currency: tpl.currency,
    amountPlanned: tpl.amount,
    amountActual: null,
    paid: false,
    paidAt: null,
    rateAtPayment: null,
    dueDate: dueDateForMonth(tpl, key),
    note: '',
    // Generated = derived data: an old stamp, so a deletion on another device wins.
    _u: fresh ? undefined : EPOCH
  };
  if (tpl.type === 'envelope') { t.kind = 'envelope'; t.spends = []; if (tpl.dailyHint === false) t.dailyHint = false; }
  if (t._u === undefined) delete t._u;
  return t;
}

/**
 * Generates transactions in draft.months[key] from all active templates due this month.
 * Never duplicates (skips if a transaction with the same templateId already exists), and
 * never re-creates one the user deleted in that month.
 * opts.fresh: explicit "↻" by the user — also brings back previously deleted ones.
 */
export function generateMonthTransactions(draft, key, { fresh = false } = {}) {
  const month = initMonth(draft, key);
  if (fresh) {
    month.skipTemplates = [];
    draft.templates.forEach(tpl => { if (draft.deleted) delete draft.deleted[generatedTxnId(tpl.id, key)]; });
  }
  const existing = new Set(month.transactions.filter(t => t.templateId).map(t => t.templateId));
  draft.templates.forEach(tpl => {
    if (!isDue(draft, month, tpl, key, existing)) return;
    month.transactions.push(txnFromTemplate(tpl, key, { fresh }));
    existing.add(tpl.id);
  });
  // (no head flag change here: generation is derived and must not stamp the month head)
  return month;
}

/**
 * True if opening this month would actually change state (month missing, or an
 * active template is due but not yet materialized). Lets views avoid useless
 * updateState() calls on every render (which would bump updatedAt and trigger sync pushes).
 */
export function monthNeedsGeneration(state, key) {
  const month = state.months[key];
  if (!month) return true;
  const existing = new Set(month.transactions.filter(t => t.templateId).map(t => t.templateId));
  return state.templates.some(t => isDue(state, month, t, key, existing));
}

function shiftKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** First month >= fromKey in which the template is due (or null within 3 years). */
export function nextDueFrom(tpl, fromKey) {
  let k = fromKey;
  for (let i = 0; i < 36; i++) {
    if (isTemplateDueInMonth(tpl, k)) return k;
    k = shiftKey(k, 1);
  }
  return null;
}

/**
 * A month counts as "prepared" once the user ran the month preparation, or (older data)
 * once it already holds template transactions. Unprepared months are NOT filled silently —
 * the app shows the preparation screen instead, so you always see what goes in.
 */
export function monthIsPrepared(state, key) {
  const m = state.months[key];
  if (!m) return false;
  if (m.preparedAt) return true;
  // Older data: a month that already holds template transactions counts as prepared —
  // unless they were added one by one ("also add to this month"), which must not
  // switch on the automatic top-up of all other templates.
  return !m.addedSingly && m.transactions.some(t => t.templateId);
}

/**
 * Adds ONE template's transaction to a month right now (even if the template is not
 * due there, e.g. a new expense that starts today). Returns false if it is already there.
 */
export function addTemplateToMonth(draft, tplId, key) {
  const tpl = draft.templates.find(t => t.id === tplId);
  if (!tpl) return false;
  const month = initMonth(draft, key);
  if (month.transactions.some(t => t.templateId === tplId)) return false;
  if (!month.preparedAt) month.addedSingly = true;
  month.skipTemplates = (month.skipTemplates || []).filter(id => id !== tplId);
  if (draft.deleted) delete draft.deleted[generatedTxnId(tplId, key)];
  month.transactions.push(txnFromTemplate(tpl, key, { fresh: true }));
  return true;
}

/**
 * What a month would contain:
 *  due      — active templates due this month: { tpl, existing (txn already in month) | null, skipped }
 *  notDue   — active templates not due this month: { tpl, next }
 *  inactive — switched-off templates
 */
export function planMonth(state, key) {
  const m = state.months[key];
  const txns = m ? m.transactions : [];
  const skip = new Set((m && m.skipTemplates) || []);
  const due = [], notDue = [], inactive = [];
  state.templates.forEach(tpl => {
    if (!tpl.active) { inactive.push({ tpl }); return; }
    if (isTemplateDueInMonth(tpl, key)) {
      due.push({ tpl, existing: txns.find(t => t.templateId === tpl.id) || null, skipped: skip.has(tpl.id) });
    } else {
      notDue.push({ tpl, next: nextDueFrom(tpl, shiftKey(key, 1)) });
    }
  });
  return { due, notDue, inactive };
}

/**
 * Applies the preparation screen's choices in one go (inside updateState):
 * income/rate for the month, chosen templates → transactions (with this-month amounts),
 * unchosen ones → skipped for this month. Already existing transactions stay untouched.
 * choices: { income:{giorgi,nino}, rate, rateSource?, items:[{tplId, include, amount}] }
 */
export function applyMonthPreparation(draft, key, choices) {
  const month = initMonth(draft, key);
  if (choices.income) month.income = { giorgi: Number(choices.income.giorgi) || 0, nino: Number(choices.income.nino) || 0 };
  if (choices.rate > 0) {
    month.exchangeRate = choices.rate;
    if (choices.rateSource) month.rateSource = choices.rateSource;
  }
  const skip = new Set(month.skipTemplates || []);
  let added = 0;
  (choices.items || []).forEach(it => {
    const tpl = draft.templates.find(t => t.id === it.tplId);
    if (!tpl) return;
    const exists = month.transactions.some(t => t.templateId === tpl.id);
    if (!it.include) { if (!exists) skip.add(tpl.id); return; }
    skip.delete(tpl.id);
    if (draft.deleted) delete draft.deleted[generatedTxnId(tpl.id, key)];
    if (exists) return;
    const txn = txnFromTemplate(tpl, key, { fresh: true });
    if (it.amount > 0) txn.amountPlanned = it.amount;
    month.transactions.push(txn);
    added += 1;
  });
  month.skipTemplates = [...skip];
  month.preparedAt = new Date().toISOString();
  return added;
}

/** Navigates to (creates + generates) a month, returns the month key. Use on app load / month nav. */
export function ensureMonthGenerated(draft, key) {
  initMonth(draft, key);
  generateMonthTransactions(draft, key);
  return key;
}

export { uid };
