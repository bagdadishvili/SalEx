// texts.js — every text the family may want to rename, in ONE place, with its default.
// The user's own versions live in settings.texts (synced to both phones). Change them on the
// admin page (Settings → 🛠 ადმინი) or with "✎ ტექსტების რედაქტირება": tap any underlined
// text and type a new one. No code changes needed.

import { getState, updateState } from './state.js';

export const TEXT_GROUPS = [
  ['people', '👤 ადამიანები / ანგარიშები', {
    'person.giorgi': 'გიორგი',
    'person.nino': 'ნინო',
    'person.shared': 'საერთო'
  }],
  ['nav', '🧭 მენიუ', {
    'app.title': 'ოჯახის ბიუჯეტი',
    'tab.dashboard': 'დეშბორდი',
    'tab.transactions': 'ტრანზაქციები',
    'tab.templates': 'შაბლონები',
    'tab.categories': 'კატეგორიები',
    'tab.settings': 'პარამეტრები'
  }],
  ['cards', '🧩 დეშბორდის ბარათები', {
    'card.summary': 'თვის მიმოხილვა',
    'card.due': '⏳ ამ თვეში ჯერ გადასახდელი',
    'card.envelopes': '🛒 ყოველდღიური ბიუჯეტები',
    'card.extras': '🧺 დამატებითი ხარჯები',
    'card.income': 'შემოსავალი',
    'card.rate': 'კურსი (1 € = ? ₾)',
    'card.georgia': 'საქართველოში გადასარიცხი',
    'card.free': 'თავისუფალი თანხა',
    'card.split': '💸 ვინ რამდენი გადარიცხოს (50/50)',
    'card.year': 'მიმოხილვა პერიოდით'
  }],
  ['summary', '📊 თვის მიმოხილვის ველები', {
    'summary.bills': '📄 გადასახადები (გადახდილი / სულ)',
    'summary.budgets': '🛒 კვება, საწვავი… (დახარჯული / გეგმა)',
    'summary.total': 'ჯამი',
    'summary.income': 'შემოსავალი',
    'summary.costs': 'ხარჯები',
    'summary.savings': 'დანაზოგი',
    'summary.free': 'თავისუფალი',
    'free.total': 'სულ თავისუფალი'
  }],
  ['split', '💸 გადარიცხვების ცხრილი', {
    'split.tabKeep': 'ჩამოსაჭრელს ანგარიშზე ვიტოვებთ',
    'split.tabFull': 'სრულად საერთოზე, მერე უკან',
    'split.income': '💶 ხელფასი',
    'split.toShared': '➡️ საერთოზე',
    'split.keep': '🏠 ანგარიშზე დატოვე',
    'split.back': '↩️ საერთოდან უკან',
    'split.savings': '💰 დანაზოგზე',
    'split.free': '🛍 რჩება'
  }],
  ['buttons', '🔘 ღილაკები და ფილტრები', {
    'btn.newExpense': '+ ახალი ხარჯი',
    'btn.prepare': '📅 თვის მომზადება',
    'btn.newTemplate': '+ ახალი შაბლონი',
    'btn.pay': 'გადახდა',
    'btn.paid': '✓ გადახდილია',
    'btn.groupByCategory': 'კატეგორიებით დაჯგუფება',
    'filter.all': 'ყველა',
    'filter.unpaid': 'გადაუხდელი',
    'filter.paid': 'გადახდილი'
  }]
];

const DEFAULTS = Object.assign({}, ...TEXT_GROUPS.map(([, , items]) => items));

/** The text to show for `key` (user's version, or the default). */
export function t(key, fallback) {
  const custom = getState()?.settings?.texts?.[key];
  if (typeof custom === 'string' && custom.trim()) return custom;
  return DEFAULTS[key] ?? fallback ?? key;
}

/** Attributes for el(): the text + a marker so "edit texts" mode can rename it in place. */
export function tx(key) {
  return { text: t(key), 'data-tkey': key };
}

export function defaultText(key) {
  return DEFAULTS[key] ?? '';
}

export function setText(key, value) {
  updateState(d => {
    d.settings.texts = { ...(d.settings.texts || {}) };
    const v = String(value || '').trim();
    if (!v || v === DEFAULTS[key]) delete d.settings.texts[key];
    else d.settings.texts[key] = v.slice(0, 80);
    return d;
  });
}

// ---------------- "✎ edit texts" mode ----------------

let editMode = false;
const modeListeners = new Set();

export function isTextEditMode() { return editMode; }
export function onTextEditMode(fn) { modeListeners.add(fn); return () => modeListeners.delete(fn); }

export function setTextEditMode(on) {
  editMode = !!on;
  if (typeof document !== 'undefined') document.body.classList.toggle('text-edit-mode', editMode);
  modeListeners.forEach(fn => { try { fn(editMode); } catch { /* ignore */ } });
}

/**
 * Installs the click handler once: in edit mode a tap on any [data-tkey] element asks for a
 * new text instead of doing its normal action. `ask(key, current, def)` resolves the new value.
 */
export function installTextEditing(ask, afterSave) {
  if (typeof document === 'undefined') return;
  document.addEventListener('click', async (e) => {
    if (!editMode) return;
    const target = e.target.closest && e.target.closest('[data-tkey]');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const key = target.getAttribute('data-tkey');
    const value = await ask(key, t(key), defaultText(key));
    if (value === null) return;
    setText(key, value);
    afterSave();
  }, true);
}

/** Person / account display names (editable). */
export function personName(account) {
  return t(`person.${['giorgi', 'nino'].includes(account) ? account : 'shared'}`);
}
