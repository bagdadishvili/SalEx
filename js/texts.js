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
    'card.due': '⏳ ამ თვეში გადასახდელი (დარჩენილი)',
    'card.envelopes': '🛒 ხარჯები (კვება, საწვავი)',
    'card.extras': '🧺 დამატებითი ხარჯები',
    'card.income': 'შემოსავალი',
    'card.rate': 'კურსი (1 € = ? ₾)',
    'card.georgia': 'საქართველოში გადასარიცხი',
    'card.savings': '💰 დანაზოგები',
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
    'summary.free': 'თავისუფალი'
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
    'btn.prepare': '📅 შემდეგი თვის მომზადება',
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
  const def = key.startsWith(RAW) ? key.slice(RAW.length) : DEFAULTS[key];
  updateState(d => {
    d.settings.texts = { ...(d.settings.texts || {}) };
    const v = String(value || '').trim();
    if (!v || v === def) delete d.settings.texts[key];
    else d.settings.texts[key] = v.slice(0, key.startsWith(RAW) ? 300 : 80);
    return d;
  });
}

// ---------------- Any other text on the screen (v17) ----------------
// Buttons, hints, labels… everything made with el() can be renamed by tapping it in
// "✎ edit texts" mode. Stored by its original wording: settings.texts['~<original>'] = new
// text — synced like the named texts above (each text merges on its own).

export const RAW = '~';

let namesOf = null;
let names = new Set();
/** The family's own data (expense, template, category and people names) is never "UI text". */
function isDataName(s) {
  const st = getState();
  if (!st) return false;
  if (namesOf !== st) {
    namesOf = st;
    names = new Set([
      ...(st.templates || []).map(x => x.name),
      ...(st.categories || []).map(x => x.name),
      ...Object.values(st.months || {}).flatMap(m => (m.transactions || []).map(x => x.name)),
      ...['giorgi', 'nino', 'shared'].map(p => personName(p))
    ]);
  }
  return names.has(s);
}

/** Can this on-screen text be renamed (a word or sentence, not a number or the family's data)? */
export function isRenameable(s) {
  return typeof s === 'string' && s.length >= 2 && s.length <= 300 && /[\u10D0-\u10FFA-Za-z]/.test(s) && !/\d/.test(s) && !isDataName(s);
}

/** Text resolver for el(): the family's own wording for an original text, if they set one. */
export function resolveText(original) {
  if (!isRenameable(original)) return { text: original, renameable: false };
  const custom = getState()?.settings?.texts?.[RAW + original];
  return { text: typeof custom === 'string' && custom.trim() ? custom : original, renameable: true };
}

/** Renamed free texts: [original, new] pairs (admin page). */
export function rawOverrides() {
  const texts = getState()?.settings?.texts || {};
  return Object.keys(texts).filter(k => k.startsWith(RAW)).map(k => [k.slice(RAW.length), texts[k]]);
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
    const target = e.target.closest && e.target.closest('[data-tkey], [data-rtext]');
    if (!target || target.closest('[data-noedit]')) return;
    e.preventDefault();
    e.stopPropagation();
    const named = target.getAttribute('data-tkey');
    const key = named || RAW + target.getAttribute('data-rtext');
    const original = named ? defaultText(named) : key.slice(RAW.length);
    const value = await ask(key, named ? t(named) : resolveText(original).text, original);
    if (value === null) return;
    setText(key, value);
    afterSave();
  }, true);
}

/** Person / account display names (editable). */
export function personName(account) {
  return t(`person.${['giorgi', 'nino'].includes(account) ? account : 'shared'}`);
}

/** Icon per person: Nino 👩, Giorgi 👨, both 👥. */
export function personIcon(account) {
  return account === 'nino' ? '👩' : account === 'giorgi' ? '👨' : '👥';
}

/** "👩 ნინო" — icon and name never split over two lines. */
export function personTag(account) {
  return `${personIcon(account)}\u00A0${personName(account)}`;
}

/** Georgian genitive of a name: კვება → კვების, საწვავი → საწვავის ("კვების ფულიდან"). */
export function genitive(name) {
  const s = String(name || '').trim();
  if (/[აი]$/.test(s)) return s.slice(0, -1) + 'ის';
  if (/[ეოუ]$/.test(s)) return s + 'ს';
  return s + 'ის';
}

/** Georgian dative of a name: კვება → კვებას, საწვავი → საწვავს ("კვებას დააკლდა"). */
export function dative(name) {
  const s = String(name || '').trim();
  if (/ი$/.test(s)) return s.slice(0, -1) + 'ს';
  if (/[აეოუ]$/.test(s)) return s + 'ს';
  return s + 'ს';
}
