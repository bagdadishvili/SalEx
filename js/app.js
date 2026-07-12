// app.js — entry point + router.

import { loadState, getState } from './state.js';
import { runSelfChecks } from './calc.js';
import { initAutoSync } from './sync.js';
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
  settings: renderSettings
};

const viewRoot = document.getElementById('view-root');
const tabBar = document.getElementById('tab-bar');

function currentRouteFromHash() {
  const hash = (location.hash || '#dashboard').slice(1);
  return routes[hash] ? hash : 'dashboard';
}

export function navigate(route) {
  if (!routes[route]) route = 'dashboard';
  if (location.hash !== `#${route}`) {
    location.hash = `#${route}`;
    return; // hashchange listener will render
  }
  render(route);
}

function render(route) {
  viewRoot.innerHTML = '';
  tabBar.querySelectorAll('.tab-bar__item').forEach(btn => {
    const active = btn.dataset.route === route;
    btn.toggleAttribute('aria-current', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  routes[route](viewRoot);
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
  if (!settings.lastBackupAt) {
    banner.hidden = false;
    banner.textContent = 'რჩევა: ჯერ არ გაქვთ გაკეთებული JSON ბექაფი — გააკეთეთ პარამეტრებში.';
    return;
  }
  const days = (Date.now() - new Date(settings.lastBackupAt).getTime()) / 86400000;
  if (days > 30) {
    banner.hidden = false;
    banner.textContent = `ბოლო ბექაფი იყო ${Math.floor(days)} დღის წინ — რეკომენდირებულია ახალი JSON ექსპორტი.`;
  } else {
    banner.hidden = true;
  }
}

function init() {
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('[sw] registration failed', err));
  }

  initAutoSync();
}

export { applyAppearance, checkBackupReminder };

init();
