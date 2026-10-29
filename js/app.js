// app.js — entry point + router.

import { loadState, getState, updateState, onStateReplaced, isPristine, deviceName, setDeviceName } from './state.js';
import { confirmDialog } from './ui.js';
import { runSelfChecks } from './calc.js';
import { saveSnapshotIfDue } from './backup.js';
import * as sync from './sync.js';
import { toast, openModal, el, whenHistorySettled } from './ui.js';
import { t, installTextEditing, onTextEditMode, setTextEditMode, defaultText } from './texts.js';
import { renderAdmin } from './views/admin.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTransactions } from './views/transactions.js';
import { renderTemplates } from './views/templates.js';
import { renderCategories } from './views/categories.js';
import { renderSettings } from './views/settings.js';

const routes = {
  dashboard: renderDashboard,
  transactions: renderTransactions,
  templates: renderTemplates,
  categories: renderCategories,
  settings: renderSettings,
  admin: renderAdmin
};

const viewRoot = document.getElementById('view-root');
const tabBar = document.getElementById('tab-bar');

function currentRouteFromHash() {
  const hash = (location.hash || '#dashboard').slice(1);
  return routes[hash] ? hash : 'dashboard';
}

export function navigate(route) {
  if (!routes[route]) route = 'dashboard';
  // A dialog that was just closed is still stepping back in history — change the page after that.
  whenHistorySettled(() => {
    if (location.hash !== `#${route}`) {
      location.hash = `#${route}`;
      return; // hashchange listener will render
    }
    render(route);
  });
}

/** Applies the user's own texts to the fixed parts of the page (title, tab bar). */
function applyTexts() {
  const title = document.querySelector('.app-header__title');
  if (title) { title.textContent = t('app.title'); title.setAttribute('data-tkey', 'app.title'); }
  tabBar.querySelectorAll('.tab-bar__item').forEach(btn => {
    const label = btn.querySelector('.tab-bar__label');
    if (!label) return;
    const key = `tab.${btn.dataset.route}`;
    label.textContent = t(key);
    label.setAttribute('data-tkey', key);
  });
}

const scrollByRoute = {}; // e.g. come back to the dashboard exactly where you left it

function render(route) {
  applyTexts();
  const scrollY = window.scrollY;
  const prevRoute = viewRoot.dataset.route;
  const sameRoute = prevRoute === route;
  if (prevRoute && !sameRoute) scrollByRoute[prevRoute] = scrollY;
  viewRoot.innerHTML = '';
  viewRoot.dataset.route = route;
  tabBar.querySelectorAll('.tab-bar__item').forEach(btn => {
    if (btn.dataset.route === route || (route === 'admin' && btn.dataset.route === 'settings')) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  routes[route](viewRoot);
  const target = sameRoute ? scrollY : (scrollByRoute[route] || 0);
  window.scrollTo(0, target);
  // Content may grow a moment later (fonts, async rows) — try once more.
  if (target > 0) requestAnimationFrame(() => { if (Math.abs(window.scrollY - target) > 2) window.scrollTo(0, target); });
}

/** Re-renders the current page (e.g. after data arrived from another device). */
export function rerender() {
  render(currentRouteFromHash());
}

function applyAppearance() {
  const { settings } = getState();
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.documentElement.setAttribute('data-font-scale', settings.fontScale);
  document.documentElement.style.setProperty('--accent', settings.accentColor);
  const rgb = hexToRgb(settings.accentColor);
  if (rgb) document.documentElement.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function checkBackupReminder() {
  const { settings } = getState();
  const banner = document.getElementById('backup-banner');
  banner.hidden = true;

  // Dismissed recently — stay quiet for 30 days.
  if (settings.backupReminderDismissedAt) {
    const d = (Date.now() - new Date(settings.backupReminderDismissedAt).getTime()) / 86400000;
    if (d < 30) return;
  }
  if (isPristine()) return; // nothing to back up yet

  let msg = null;
  if (!settings.lastBackupAt) {
    msg = 'რჩევა: ჯერ არ გაქვთ გაკეთებული JSON ბექაფი — გააკეთეთ პარამეტრებში.';
  } else {
    const days = (Date.now() - new Date(settings.lastBackupAt).getTime()) / 86400000;
    if (days > 30) msg = `ბოლო ბექაფი იყო ${Math.floor(days)} დღის წინ — რეკომენდირებულია ახალი JSON ექსპორტი.`;
  }
  if (!msg) return;

  banner.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'banner-close';
  closeBtn.setAttribute('aria-label', 'შეხსენების დახურვა');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    updateState(draft => { draft.settings.backupReminderDismissedAt = new Date().toISOString(); return draft; });
    banner.hidden = true;
  });
  banner.append(span, closeBtn);
  banner.hidden = false;
}

// ---------------- sync indicator + "sync paused" banner ----------------

function describeSummary(s) {
  if (!s) return '—';
  const when = s.updatedAt && !s.updatedAt.startsWith('1970') ? ` · ბოლო ცვლილება ${new Date(s.updatedAt).toLocaleString('ka-GE', { hour12: false })}` : '';
  return `${s.templates} შაბლონი, ${s.transactions} ტრანზაქცია, ${s.months} თვე${when}`;
}

function renderSyncUi(status) {
  const dot = document.getElementById('sync-dot');
  const banner = document.getElementById('sync-banner');
  if (dot) {
    const map = {
      off: ['', ''], ok: ['ok', 'სინქრონიზებულია'], syncing: ['busy', 'სინქრონიზაცია...'],
      error: ['err', 'სინქრონიზაციის შეცდომა: ' + (status.message || '')], offline: ['off', 'ინტერნეტი არ არის — ცვლილებები მოგვიანებით აიტვირთება'],
      blocked: ['err', 'სინქრონიზაცია შეჩერებულია — საჭიროა შენი გადაწყვეტილება']
    };
    const [cls, title] = map[status.state] || ['', ''];
    dot.className = 'sync-dot' + (cls ? ` sync-dot--${cls}` : '');
    dot.hidden = status.state === 'off';
    dot.title = title;
    dot.setAttribute('aria-label', title);
  }
  if (!banner) return;
  if (status.state !== 'blocked' || !status.blocked) { banner.hidden = true; banner.innerHTML = ''; return; }

  const { kind, local, remote } = status.blocked;
  const localBigger = (local.templates + local.transactions + local.months) >= (remote.templates + remote.transactions + remote.months);
  let text;
  if (kind === 'push') text = 'ამ მოწყობილობაზე გაცილებით ნაკლები მონაცემია, ვიდრე ღრუბელში. ავტომატური ატვირთვა შევაჩერე, რომ ღრუბლის მონაცემები არ წაიშალოს.';
  else if (kind === 'pull') text = 'ღრუბელში გაცილებით ნაკლები მონაცემია, ვიდრე აქ (შეიძლება მეორე მოწყობილობაზე წაიშალა). ჩამოტვირთვა შევაჩერე, რომ აქაური მონაცემები არ დაიკარგოს.';
  else text = 'ამ მოწყობილობაზეც და ღრუბელშიც სხვადასხვა მონაცემია. „გაერთიანება" ორივეს შეინახავს (არაფერი დაიკარგება); ან აირჩიე ერთ-ერთი — მეორე აღდგენის წერტილად დარჩება.';

  banner.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = '⚠️ ' + text;
  const facts = document.createElement('ul');
  [['ეს მოწყობილობა', local], ['ღრუბელი (Gist)', remote]].forEach(([label, s]) => {
    const li = document.createElement('li');
    li.textContent = `${label}: ${describeSummary(s)}`;
    facts.appendChild(li);
  });
  const row = document.createElement('div');
  row.className = 'btn-row';
  const keepLocal = document.createElement('button');
  keepLocal.className = 'btn ' + (localBigger ? 'btn--primary' : 'btn--secondary');
  keepLocal.textContent = 'ამ მოწყობილობის დატოვება' + (localBigger ? ' (რეკომენდებული)' : '');
  const takeRemote = document.createElement('button');
  takeRemote.className = 'btn ' + (!localBigger ? 'btn--primary' : 'btn--secondary');
  takeRemote.textContent = 'ღრუბლის ვერსიის აღება' + (!localBigger ? ' (რეკომენდებული)' : '');
  const decide = (choice) => async () => {
    keepLocal.disabled = takeRemote.disabled = true;
    try {
      await sync.resolveBlocked(choice);
      toast('სინქრონიზაცია განახლდა ✓');
    } catch (e) {
      toast('შეცდომა: ' + e.message, 'error');
    }
  };
  keepLocal.addEventListener('click', decide('local'));
  takeRemote.addEventListener('click', decide('remote'));
  if (kind === 'connect') {
    const merge = document.createElement('button');
    merge.className = 'btn btn--primary';
    merge.textContent = 'გაერთიანება (რეკომენდებული)';
    keepLocal.className = takeRemote.className = 'btn btn--secondary';
    keepLocal.textContent = 'მხოლოდ ამ მოწყობილობის';
    takeRemote.textContent = 'მხოლოდ ღრუბლის';
    merge.addEventListener('click', async () => {
      merge.disabled = keepLocal.disabled = takeRemote.disabled = true;
      try { await sync.resolveBlocked('merge'); toast('გაერთიანდა ✓'); } catch (e) { toast('შეცდომა: ' + e.message, 'error'); }
    });
    row.append(merge, takeRemote, keepLocal);
  } else {
    row.append(takeRemote, keepLocal);
  }
  banner.append(p, facts, row);
  banner.hidden = false;
}

// ---------------- service worker: auto-update ----------------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over — reload once so the page runs the new code.
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(reg => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(err => console.warn('[sw] registration failed', err));
}

/** Asks the browser not to evict our data under storage pressure (and on iOS after inactivity). */
async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* not supported */ }
}

/** "#connect=<token>&gist=<id>" link made on Giorgi's phone (Settings → 📲) for Nino's phone. */
function takeConnectLink() {
  const h = location.hash || '';
  if (!h.startsWith('#connect=')) return null;
  const params = new URLSearchParams(h.slice(1));
  const token = params.get('connect');
  const gist = params.get('gist') || '';
  // Remove the secret from the address bar / history right away.
  try { history.replaceState(null, '', `${location.pathname}${location.search}#dashboard`); } catch { location.hash = '#dashboard'; }
  return token ? { token, gist } : null;
}

async function offerConnect({ token, gist }) {
  const ok = await confirmDialog('დავაკავშირო ეს ტელეფონი ოჯახის ბიუჯეტთან? მონაცემები ავტომატურად ჩამოიტვირთება და შემდეგ ორივე ტელეფონი ერთად განახლდება.', { confirmLabel: 'დაკავშირება' });
  if (!ok) return;
  try {
    const r = await sync.connect(token, gist);
    if (!deviceName()) setDeviceName(t('person.nino'));
    toast(r.action === 'conflict' ? 'დაკავშირებულია — აირჩიე როგორ გავაერთიანო (ზედა ზოლში)' : `დაკავშირებულია ✓ — ეს ტელეფონი: ${deviceName()} (შეცვლა: პარამეტრები → სინქრონიზაცია)`);
    rerender();
  } catch (e) {
    toast('დაკავშირება ვერ მოხერხდა: ' + e.message, 'error');
  }
}

function init() {
  const connectLink = takeConnectLink();
  loadState();
  applyAppearance();
  checkBackupReminder();

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
    runSelfChecks();
  }

  tabBar.querySelectorAll('.tab-bar__item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  window.addEventListener('hashchange', () => render(currentRouteFromHash()));

  render(currentRouteFromHash());

  // "✎ edit texts" mode: tap any underlined text → rename it. A bar at the top ends the mode.
  installTextEditing(askNewText, rerender);
  const editBar = el('div', { class: 'text-edit-bar', hidden: 'true' }, [
    el('span', { text: '✎ რედაქტირების რეჟიმი — შეეხე ხაზგასმულ ტექსტს' }),
    el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: 'დასრულება' })
  ]);
  editBar.querySelector('button').addEventListener('click', () => setTextEditMode(false));
  document.body.appendChild(editBar);
  onTextEditMode((on) => { editBar.hidden = !on; rerender(); });

  let pendingRerender = false;
  onStateReplaced((source) => {
    applyAppearance();
    if (source === 'sync') {
      const who = getState().lastEditor;
      toast(who && who !== deviceName() ? `🔄 ${who}: ცვლილება მოვიდა ✓` : '🔄 მონაცემები განახლდა მეორე მოწყობილობიდან ✓');
    }
    if (source === 'other-tab') toast('მონაცემები განახლდა სხვა ფანჯრიდან');
    // Don't yank an input away while someone is typing — redraw when they leave the field.
    const active = document.activeElement;
    if (active && viewRoot.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
      if (pendingRerender) return;
      pendingRerender = true;
      active.addEventListener('blur', () => { pendingRerender = false; setTimeout(rerender, 0); }, { once: true });
      return;
    }
    rerender();
  });

  registerServiceWorker();
  requestPersistentStorage();
  if (!isPristine()) saveSnapshotIfDue(getState(), 'daily', 20);

  sync.onSyncStatus(renderSyncUi);
  sync.initAutoSync();
  if (connectLink) setTimeout(() => offerConnect(connectLink), 300);
}

function askNewText(key, current, def) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'text', value: current, maxlength: '80' });
    const form = el('form', {}, [
      el('p', { class: 'card__sub', text: `საწყისი: „${def}"` }),
      el('div', { class: 'field' }, [el('label', { text: 'ახალი ტექსტი' }), input])
    ]);
    const save = el('button', { class: 'btn btn--primary', type: 'submit', text: 'შენახვა' });
    const reset = el('button', { class: 'btn btn--ghost', type: 'button', text: '↺ საწყისი' });
    form.appendChild(el('div', { class: 'btn-row' }, [save, reset]));
    let done = false;
    const { close } = openModal(form, { title: '✎ ტექსტის შეცვლა', onClose: () => { if (!done) resolve(null); } });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    form.addEventListener('submit', (e) => { e.preventDefault(); done = true; resolve(input.value); close(); toast('შენახულია ✓'); });
    reset.addEventListener('click', () => { done = true; resolve(''); close(); toast('დაბრუნდა საწყისზე'); });
    void defaultText;
  });
}

/** Shown in Settings; bump together with CACHE_VERSION in sw.js. */
export const APP_VERSION = '16';

export { applyAppearance, checkBackupReminder };

init();
