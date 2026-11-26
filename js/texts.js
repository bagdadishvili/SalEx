// texts.js — every text the family may want to rename, in ONE place, with its default.
// The user's own versions live in settings.texts (synced to both phones). Change them on the
// admin page (Settings → 🛠 ადმინი) or with "✎ ტექსტების რედაქტირება": tap any underlined
// text and type a new one. No code changes needed.

import { getState, updateState } from './state.js';

export const TEXT_GROUPS = [
  ['people', '👤 ადამიანები / ანგარიშები', {
    'person.giorgi': 'გიორგი',
    'person.nino': 'ნინო',
    'person.shared': 'საერთო',
    'icon.giorgi': '🧔',
    'icon.nino': '👩‍🦰',
    'icon.shared': '👥'
  }],
  ['nav', '🧭 მენიუ', {
    'app.title': 'ოჯახის ბიუჯეტი',
    'tab.dashboard': 'მთავარი',
    'tab.transactions': 'ხარჯები',
    'tab.templates': 'შაბლონები',
    'tab.categories': 'გეგმა',
    'tab.settings': 'პარამეტრები',
    'tab.assistant': 'AI'
  }],
  ['cards', '🧩 მთავარი ეკრანის ბარათები', {
    'card.summary': '📊 თვის მიმოხილვა',
    'card.due': '⏳ დარჩენილი გადასახადები',
    'card.envelopes': '🛒 ყოველდღიური ბიუჯეტი',
    'card.extras': '🧺 დამატებითი ხარჯები',
    'card.income': '💶 შემოსავალი',
    'card.rate': '💱 კურსი (1 € = ? ₾)',
    'card.georgia': '📤 საქართველოში გადასარიცხი',
    'card.savings': '💰 დანაზოგები',
    'card.split': '💸 ხელფასის განაწილება (50/50)',
    'card.year': '📅 პერიოდის მიმოხილვა',
    'card.payday': '✅ ხელფასის დღე',
    'card.calendar': '🗓 მომდევნო ჩამოჭრები',
    'card.bank': '🏦 ბანკის ნაშთის შემოწმება',
    'card.reserve': '📆 იშვიათი ხარჯების რეზერვი',
    'card.close': '🔒 თვის დახურვა',
    'card.trends': '📊 ხარჯების დინამიკა',
    'card.fx': '📈 ლარის კურსის გავლენა',
    'card.whatif': '🧮 ბიუჯეტის სიმულატორი'
  }],
  ['summary', '📊 თვის მიმოხილვის ველები', {
    'summary.bills': '📄 გადასახადები',
    'summary.budgets': '🛒 ყოველდღიური ბიუჯეტი',
    'summary.total': 'ჯამი',
    'summary.income': 'შემოსავალი',
    'summary.costs': 'ხარჯები',
    'summary.savings': 'დანაზოგი',
    'summary.free': 'თავისუფალი'
  }],
  ['split', '💸 გადარიცხვების ცხრილი', {
    'split.tabKeep': 'პირადზე დატოვებით',
    'split.tabFull': 'სრულად საერთოზე',
    'split.income': '💶 ხელფასი',
    'split.toShared': '➡️ საერთოზე',
    'split.keep': '🏠 პირადზე დატოვე',
    'split.back': '↩️ საერთოდან უკან',
    'split.savings': '💰 დანაზოგზე',
    'split.free': '🛍 თავისუფალი'
  }],
  ['buttons', '🔘 ღილაკები და ფილტრები', {
    'btn.newExpense': '+ ახალი ხარჯი',
    'btn.prepare': '📅 თვის მომზადება',
    'btn.newTemplate': '+ ახალი შაბლონი',
    'btn.pay': 'გადახდა',
    'btn.paid': '✓ გადახდილია',
    'btn.transfer': 'გადატანა',
    'btn.transferred': '⇄ გადატანილია',
    'btn.debit': 'ჩამოჭრა',
    'btn.debited': '✓ ჩამოჭრილია',
    'btn.groupByCategory': 'კატეგორიებით',
    'filter.all': 'ყველა',
    'filter.unpaid': 'გადაუხდელი',
    'filter.moved': '⇄ გადატანილი',
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

// ---------------- Any other text on the screen (v17, v19) ----------------
// Buttons, titles, hints, labels, toasts… everything made with el() can be renamed — by tapping
// it in "✎ edit texts" mode or on the admin page (which lists every text the app has shown).
// Stored by its original wording: settings.texts['~<original>'] = new text (synced; each text
// merges on its own). v19: numbers are not part of the wording — "▼ 5 ხარჯი" is stored as
// "▼ {1} ხარჯი", so it is renamed once and keeps showing the live number in place of {1}.

export const RAW = '~';
const LETTERS = /[\u10D0-\u10FFA-Za-z]/;
const NUM = /[-\u2212+]?\d+(?:[ \u00A0.,:/]\d+)*/g;

/** "▼ 5 ხარჯი" → { shape: "▼ {1} ხარჯი", nums: ["5"] } */
export function textShape(s) {
  const nums = [];
  const shape = String(s).replace(NUM, (m) => { nums.push(m); return `{${nums.length}}`; });
  return { shape, nums };
}
function fillNums(template, nums) {
  return template.replace(/\{(\d+)\}/g, (m, i) => nums[i - 1] ?? '');
}

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

/** A message about one of the family's own items: it quotes its name („<name>": …). */
function quotesDataName(s) {
  const re = /„([^"“”„]{1,80})["“”]/g;
  let m;
  while ((m = re.exec(s))) { if (isDataName(m[1].trim())) return true; }
  return false;
}

/** Can this on-screen text be renamed (words, not just a number or the family's data)? */
export function isRenameable(s) {
  if (typeof s !== 'string' || s.length < 2 || s.length > 300 || !LETTERS.test(s) || isDataName(s)) return false;
  if (s.includes('„') && quotesDataName(s)) return false;
  return LETTERS.test(textShape(s).shape.replace(/\{\d+\}/g, ''));
}

// Results are cached per data version (the state object changes on every edit).
let cacheOf = null;
const cache = new Map();

/** Text resolver for el(): the family's own wording for a text, if they set one. key = its shape. */
export function resolveText(original) {
  if (typeof original !== 'string') return { text: original, renameable: false };
  const st = getState();
  if (cacheOf !== st || cache.size > 6000) { cache.clear(); cacheOf = st; }
  let r = cache.get(original);
  if (r) return r;
  if (!isRenameable(original)) r = { text: original, renameable: false };
  else {
    const { shape, nums } = textShape(original);
    const custom = st?.settings?.texts?.[RAW + shape];
    r = { text: typeof custom === 'string' && custom.trim() ? fillNums(custom, nums) : original, renameable: true, key: shape };
    noteSeen(shape);
  }
  cache.set(original, r);
  return r;
}

/** Renamed free texts: [original shape, new text] pairs (admin page). */
export function rawOverrides() {
  const texts = getState()?.settings?.texts || {};
  return Object.keys(texts).filter(k => k.startsWith(RAW)).map(k => [k.slice(RAW.length), texts[k]]);
}

// ---- Catalog of every text the app has shown (this device only), for the admin page ----
const SEEN_KEY = 'familyBudget.textsSeen';
let seen = null;
let seenTimer = null;
let pageOverride = null;
function loadSeen() {
  if (seen) return seen;
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { seen = {}; }
  return seen;
}
function currentPage() {
  if (pageOverride) return pageOverride;
  if (typeof document === 'undefined') return '';
  const route = (document.getElementById('view-root') || {}).dataset?.route || '';
  return document.querySelector('#modal-root .modal') ? `${route}:dialog` : route;
}
function noteSeen(shape) {
  const list = loadSeen();
  if (list[shape] !== undefined || Object.keys(list).length > 5000) return;
  list[shape] = currentPage();
  clearTimeout(seenTimer);
  seenTimer = setTimeout(() => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(list)); } catch { /* full */ } }, 1500);
}
/** Runs fn with texts counted as shown on page `name` (used when collecting all pages). */
export function withPage(name, fn) {
  const before = pageOverride;
  pageOverride = name;
  try { return fn(); } finally { pageOverride = before; }
}
/** { shape: page } of every renameable text seen on this device. */
export function seenTexts() {
  return { ...loadSeen() };
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
    const custom = getState()?.settings?.texts?.[key];
    const value = await ask(key, named ? t(named) : (typeof custom === 'string' && custom.trim() ? custom : original), original);
    if (value === null) return;
    setText(key, value);
    afterSave();
  }, true);
}

/** Person / account display names (editable). */
export function personName(account) {
  return t(`person.${['giorgi', 'nino'].includes(account) ? account : 'shared'}`);
}

/** Icon per person (v20: clearly different — 🧔 Giorgi, 👩‍🦰 Nino, 👥 both; renameable in admin). */
export function personIcon(account) {
  return t(`icon.${['giorgi', 'nino'].includes(account) ? account : 'shared'}`);
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
