// views/settings.js — Bucket CRUD, free-money split, appearance, data, sync, danger zone §5.5.

import { getState, updateState, wipeState } from '../state.js';
import { sumAllPercents, effectiveCardOrder } from '../calc.js';
import { el, confirmDialog, toast } from '../ui.js';
import { exportJson, importJson, exportCsv, importCsv } from '../exporter.js';
import { applyAppearance, checkBackupReminder } from '../app.js';
import { pickColor, COLOR_PRESETS } from '../components.js';
import * as sync from '../sync.js';

const CARD_LABELS = {
  summary: 'თვის მიმოხილვა', income: 'შემოსავალი', rate: 'კურსი', georgia: 'საქართველოში გადასარიცხი',
  free: 'თავისუფალი თანხა', planVsActual: 'დაგეგმილი vs რეალური'
};

function cardLabel(state, key) {
  if (CARD_LABELS[key]) return CARD_LABELS[key];
  return state.categories.find(c => c.id === key)?.name || key;
}

export function renderSettings(root) {
  const container = el('div', { class: 'settings-view' });
  root.appendChild(container);

  container.appendChild(renderBuckets());
  container.appendChild(renderAppearance());
  container.appendChild(renderSync());
  container.appendChild(renderDataSection());
  container.appendChild(renderDangerZone());
}

// ---------------- Percent plan (over unified categories) + free-money split ----------------

function renderBuckets() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'პროცენტული გეგმა' }));
  card.appendChild(el('p', { class: 'card__sub', text: 'თითო ძირითად კატეგორიას აქვს სამიზნე პროცენტი შემოსავლიდან. კატეგორიების დამატება, გადარქმევა, ფერი და წაშლა — „კატეგორიები" გვერდზეა.' }));

  const list = el('div', { class: 'order-list', style: 'margin-top:8px' });
  const sumEl = el('div', { class: 'sum-indicator', style: 'margin-top:8px' });

  function updateSum() {
    const state = getState();
    const sum = sumAllPercents(state.settings, state.categories);
    sumEl.textContent = sum === 100
      ? `ჯამი: ${sum}% ✓ — ყველაფერი ავტომატურად ინახება`
      : `ჯამი: ${sum}% (უნდა იყოს 100%)`;
    sumEl.className = 'sum-indicator ' + (sum === 100 ? 'sum-indicator--ok' : 'sum-indicator--bad');
  }

  function draw() {
    const state = getState();
    list.innerHTML = '';

    state.categories.filter(c => !c.parentId).forEach(cat => {
      const row = el('div', { class: 'order-list__item', style: 'flex-wrap:wrap;gap:8px' });
      row.appendChild(el('span', { class: 'color-dot', style: `background:${cat.color}` }));
      row.appendChild(el('span', { text: cat.name, style: 'flex:1;min-width:120px;font-weight:600' }));
      const percentInput = el('input', { type: 'number', min: '0', max: '100', value: String(cat.percent), style: 'width:70px;min-height:36px' });
      percentInput.addEventListener('input', () => {
        updateState(draft => {
          const c = draft.categories.find(x => x.id === cat.id);
          if (c) c.percent = Number(percentInput.value) || 0;
          return draft;
        });
        updateSum();
      });
      row.append(percentInput, el('span', { text: '%' }));
      list.appendChild(row);
    });

    // Free-money split (fixed pair, percent + color editable).
    ['giorgi', 'nino'].forEach(owner => {
      const cfg = state.settings.planFree[owner];
      const label = owner === 'giorgi' ? 'თავისუფალი (გიორგი)' : 'თავისუფალი (ნინო)';
      const row = el('div', { class: 'order-list__item', style: 'flex-wrap:wrap;gap:8px' });
      const colorBtn = el('button', { type: 'button', class: 'color-swatch', style: `background:${cfg.color};width:24px;height:24px` });
      colorBtn.addEventListener('click', async () => {
        const color = await pickColor(cfg.color);
        if (!color) return;
        updateState(draft => { draft.settings.planFree[owner].color = color; return draft; });
        toast('ფერი შენახულია ✓');
        draw();
      });
      row.appendChild(colorBtn);
      row.appendChild(el('span', { text: label, style: 'flex:1;min-width:120px;font-weight:600' }));
      const percentInput = el('input', { type: 'number', min: '0', max: '100', value: String(cfg.percent), style: 'width:70px;min-height:36px' });
      percentInput.addEventListener('input', () => {
        updateState(draft => { draft.settings.planFree[owner].percent = Number(percentInput.value) || 0; return draft; });
        updateSum();
      });
      row.append(percentInput, el('span', { text: '%' }));
      list.appendChild(row);
    });

    updateSum();
  }

  draw();
  card.appendChild(list);
  card.appendChild(sumEl);
  return card;
}

// ---------------- Appearance ----------------

function renderAppearance() {
  const state = getState();
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'გაფორმება' }));

  const themeRow = el('div', { class: 'field' }, [el('label', { text: 'თემა' })]);
  const themeSelect = el('select', {}, [el('option', { value: 'light', text: 'ღია' }), el('option', { value: 'dark', text: 'მუქი' })]);
  themeSelect.value = state.settings.theme;
  themeSelect.addEventListener('change', () => {
    updateState(draft => { draft.settings.theme = themeSelect.value; return draft; });
    applyAppearance();
    toast('შენახულია ✓');
  });
  themeRow.appendChild(themeSelect);
  card.appendChild(themeRow);

  card.appendChild(el('label', { text: 'აქცენტის ფერი (ზოგადი UI)', style: 'font-size:0.85rem;color:var(--text-muted);display:block;margin-bottom:6px' }));
  const swatchRow = el('div', { class: 'color-swatch-row' });
  COLOR_PRESETS.slice(0, 7).forEach(color => {
    const swatch = el('button', { class: 'color-swatch', style: `background:${color}`, 'aria-pressed': String(state.settings.accentColor === color), 'aria-label': color });
    swatch.addEventListener('click', () => {
      updateState(draft => { draft.settings.accentColor = color; return draft; });
      applyAppearance();
      swatchRow.querySelectorAll('.color-swatch').forEach(s => s.setAttribute('aria-pressed', 'false'));
      swatch.setAttribute('aria-pressed', 'true');
      toast('შენახულია ✓');
    });
    swatchRow.appendChild(swatch);
  });
  card.appendChild(swatchRow);

  const fontRow = el('div', { class: 'field', style: 'margin-top:12px' }, [el('label', { text: 'ფონტის ზომა' })]);
  const fontSelect = el('select', {}, [
    el('option', { value: 'small', text: 'პატარა' }),
    el('option', { value: 'medium', text: 'საშუალო' }),
    el('option', { value: 'large', text: 'დიდი' })
  ]);
  fontSelect.value = state.settings.fontScale;
  fontSelect.addEventListener('change', () => {
    updateState(draft => { draft.settings.fontScale = fontSelect.value; return draft; });
    applyAppearance();
    toast('შენახულია ✓');
  });
  fontRow.appendChild(fontSelect);
  card.appendChild(fontRow);

  card.appendChild(el('label', { text: 'დეშბორდის ბლოკების თანმიმდევრობა', style: 'font-size:0.85rem;color:var(--text-muted);display:block;margin:16px 0 6px' }));
  const orderList = el('div', { class: 'order-list' });
  function moveCard(idx, delta) {
    updateState(draft => {
      // Work on the effective order (includes every category card), then store it.
      const order = effectiveCardOrder(draft.settings, draft.categories);
      [order[idx + delta], order[idx]] = [order[idx], order[idx + delta]];
      draft.settings.dashboardCardOrder = order;
      return draft;
    });
    drawOrder();
  }
  function drawOrder() {
    const s = getState();
    const order = effectiveCardOrder(s.settings, s.categories);
    orderList.innerHTML = '';
    order.forEach((key, idx) => {
      const up = el('button', { class: 'icon-btn', 'aria-label': 'ზემოთ', text: '▲' });
      if (idx === 0) up.disabled = true;
      up.addEventListener('click', () => moveCard(idx, -1));
      const down = el('button', { class: 'icon-btn', 'aria-label': 'ქვემოთ', text: '▼' });
      if (idx === order.length - 1) down.disabled = true;
      down.addEventListener('click', () => moveCard(idx, 1));
      orderList.appendChild(el('div', { class: 'order-list__item' }, [
        el('span', { text: cardLabel(s, key) }),
        el('div', { class: 'order-list__buttons' }, [up, down])
      ]));
    });
  }
  drawOrder();
  card.appendChild(orderList);

  return card;
}

// ---------------- Cross-device sync ----------------

function renderSync() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'სინქრონიზაცია მოწყობილობებს შორის' }));
  card.appendChild(el('p', { class: 'card__sub', text: 'დააკავშირე კომპიუტერი და სმარტფონი GitHub-ის პირადი Gist-ის საშუალებით — ცვლილება ერთგან ავტომატურად აისახება მეორეზეც.' }));

  card.appendChild(el('details', { class: 'help-details' }, [
    el('summary', { text: '📖 ინსტრუქცია ნაბიჯ-ნაბიჯ: როგორ დავაკავშირო?' }),
    el('ol', {}, [
      el('li', { text: 'გახსენი github.com და შედი ანგარიშზე (თუ არ გაქვს — დარეგისტრირდი უფასოდ).' }),
      el('li', { text: 'დააჭირე შენს პროფილის ფოტოს (ზედა მარჯვენა კუთხე) → Settings.' }),
      el('li', { text: 'გვერდის ბოლოში, მარცხენა მენიუში: Developer settings → Personal access tokens → Tokens (classic).' }),
      el('li', { text: 'დააჭირე „Generate new token (classic)". Note ველში ჩაწერე „family-budget". Expiration: აირჩიე „No expiration".' }),
      el('li', { text: 'უფლებების სიაში მონიშნე მხოლოდ „gist" — სხვა არაფერი.' }),
      el('li', { text: 'დააჭირე „Generate token" და დააკოპირე კოდი (ghp_-ით იწყება). ის მხოლოდ ერთხელ გამოჩნდება!' }),
      el('li', { text: 'ჩასვი token ქვემოთ ველში და დააჭირე „დაკავშირებას" — ავტომატურად შეიქმნება Gist და გამოჩნდება Gist ID.' }),
      el('li', { text: 'მეორე მოწყობილობაზე ჩაწერე იგივე token + ეს Gist ID და იქაც დააჭირე „დაკავშირებას".' }),
      el('li', { text: 'მზადაა — ამის შემდეგ ყველა ცვლილება ავტომატურად სინქრონდება ორივე მოწყობილობაზე.' })
    ])
  ]));

  const cfg = sync.getSyncConfig();

  const tokenInput = el('input', { type: 'password', placeholder: 'GitHub token (ghp_...)', value: cfg.token || '', autocomplete: 'off' });
  const gistIdInput = el('input', { type: 'text', placeholder: 'Gist ID (მეორე მოწყობილობიდან დააკოპირე)', value: cfg.gistId || '' });

  const statusEl = el('div', { class: 'card__sub', style: 'margin-top:8px' });
  function refreshStatus() {
    const s = sync.getSyncConfig();
    if (!s.token) { statusEl.textContent = 'სინქრონიზაცია გამორთულია — ჩაწერე token.'; return; }
    if (!s.gistId) { statusEl.textContent = 'token შენახულია. დააჭირე „დაკავშირებას“ ახალი Gist-ის შესაქმნელად, ან ჩაწერე არსებული Gist ID.'; return; }
    statusEl.textContent = s.lastSyncedAt
      ? `დაკავშირებულია. ბოლო სინქრონიზაცია: ${new Date(s.lastSyncedAt).toLocaleString('ka-GE')}`
      : 'დაკავშირებულია. სინქრონიზაცია ჯერ არ მომხდარა.';
  }
  refreshStatus();

  const connectBtn = el('button', { class: 'btn btn--primary', text: 'დაკავშირება / ახალი Gist-ის შექმნა' });
  connectBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) { toast('ჩაწერე GitHub token', 'error'); return; }
    sync.saveSyncConfig({ token, gistId: gistIdInput.value.trim() || null });
    connectBtn.disabled = true;
    connectBtn.textContent = 'დაკავშირება...';
    try {
      const gistId = await sync.connect();
      gistIdInput.value = gistId;
      toast('დაკავშირებულია ✓ — Gist ID დააკოპირე მეორე მოწყობილობაზეც', 'ok');
    } catch (e) {
      toast('შეცდომა: ' + e.message, 'error');
    }
    connectBtn.disabled = false;
    connectBtn.textContent = 'დაკავშირება / ახალი Gist-ის შექმნა';
    refreshStatus();
  });

  // Pull = download the latest data saved from the OTHER device.
  const pullBtn = el('button', { class: 'btn btn--secondary', text: '⬇ ჩამოტვირთვა (მეორე მოწყობილობის მონაცემები)' });
  pullBtn.addEventListener('click', async () => {
    try {
      const pulled = await sync.pullNow();
      toast(pulled ? 'მონაცემები განახლდა ✓' : 'უკვე უახლესი ვერსია გაქვს ✓');
      if (pulled) location.reload();
    } catch (e) {
      toast('შეცდომა: ' + e.message, 'error');
    }
    refreshStatus();
  });

  // Push = upload this device's data right now (normally happens automatically).
  const pushBtn = el('button', { class: 'btn btn--secondary', text: '⬆ ატვირთვა (ამ მოწყობილობის მონაცემები)' });
  pushBtn.addEventListener('click', async () => {
    try {
      const pushed = await sync.pushNow();
      toast(pushed ? 'აიტვირთა ✓' : 'ჯერ დააკავშირე სინქრონიზაცია', pushed ? 'ok' : 'error');
    } catch (e) {
      toast('შეცდომა: ' + e.message, 'error');
    }
    refreshStatus();
  });

  const disconnectBtn = el('button', { class: 'btn btn--ghost', text: 'გათიშვა' });
  disconnectBtn.addEventListener('click', () => {
    sync.saveSyncConfig({ token: '', gistId: null });
    tokenInput.value = '';
    gistIdInput.value = '';
    toast('სინქრონიზაცია გათიშულია');
    refreshStatus();
  });

  card.appendChild(el('div', { class: 'field' }, [el('label', { text: 'GitHub Personal Access Token (gist scope)' }), tokenInput]));
  card.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Gist ID' }), gistIdInput]));
  card.appendChild(statusEl);
  card.appendChild(el('div', { class: 'btn-row' }, [connectBtn, pullBtn, pushBtn, disconnectBtn]));

  return card;
}

// ---------------- Data (export/import) ----------------

function renderDataSection() {
  const state = getState();
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'მონაცემები' }));

  const lastBackupText = state.settings.lastBackupAt
    ? `ბოლო ბექაფი: ${new Date(state.settings.lastBackupAt).toLocaleString('ka-GE')}`
    : 'ბოლო ბექაფი: არასდროს';
  const backupInfo = el('div', { class: 'card__sub', text: lastBackupText });
  card.appendChild(backupInfo);

  const btnRow = el('div', { class: 'btn-row' });

  const exportJsonBtn = el('button', { class: 'btn btn--secondary', text: 'JSON ექსპორტი' });
  exportJsonBtn.addEventListener('click', () => {
    exportJson();
    toast('ბექაფი ჩამოტვირთულია ✓');
    checkBackupReminder();
    backupInfo.textContent = `ბოლო ბექაფი: ${new Date().toLocaleString('ka-GE')}`;
  });

  const importInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
  const importBtn = el('button', { class: 'btn btn--secondary', text: 'JSON იმპორტი' });
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    const ok = await confirmDialog('იმპორტი გადაწერს ყველა მიმდინარე მონაცემს. გავაგრძელო?', { danger: true, confirmLabel: 'დიახ, გადავწერო' });
    if (!ok) { importInput.value = ''; return; }
    try {
      await importJson(file);
      toast('მონაცემები აღდგენილია ✓');
      applyAppearance();
      location.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
    importInput.value = '';
  });

  const exportCsvBtn = el('button', { class: 'btn btn--secondary', text: 'CSV ექსპორტი' });
  exportCsvBtn.addEventListener('click', () => { exportCsv(); toast('CSV ჩამოტვირთულია ✓'); });

  const importCsvInput = el('input', { type: 'file', accept: '.csv', style: 'display:none' });
  const importCsvBtn = el('button', { class: 'btn btn--secondary', text: 'CSV იმპორტი' });
  importCsvBtn.addEventListener('click', () => importCsvInput.click());
  importCsvInput.addEventListener('change', async () => {
    const file = importCsvInput.files[0];
    if (!file) return;
    const ok = await confirmDialog('CSV იმპორტი დაამატებს ტრანზაქციებს არსებულ მონაცემებს (ზუსტი დუბლიკატები გამოტოვდება, არაფერი წაიშლება). გავაგრძელო?', { confirmLabel: 'იმპორტი' });
    if (!ok) { importCsvInput.value = ''; return; }
    try {
      const { added, skipped } = await importCsv(file);
      toast(`დაემატა ${added} ტრანზაქცია${skipped ? `, გამოტოვდა ${skipped}` : ''} ✓`);
    } catch (e) {
      toast(e.message, 'error');
    }
    importCsvInput.value = '';
  });

  btnRow.append(exportJsonBtn, importBtn, importInput, exportCsvBtn, importCsvBtn, importCsvInput);
  card.appendChild(btnRow);

  return card;
}

function renderDangerZone() {
  const zone = el('div', { class: 'danger-zone' });
  zone.appendChild(el('h3', { text: 'საშიში ზონა' }));
  zone.appendChild(el('p', { class: 'card__sub', text: 'ყველა მონაცემის წაშლა შეუქცევადია. აუცილებლად გააკეთეთ JSON ექსპორტი წინასწარ.' }));
  const wipeBtn = el('button', { class: 'btn btn--danger', text: 'ყველაფრის წაშლა' });
  wipeBtn.addEventListener('click', async () => {
    const ok1 = await confirmDialog('ნამდვილად გსურთ ყველა მონაცემის წაშლა?', { danger: true, confirmLabel: 'დიახ' });
    if (!ok1) return;
    const ok2 = await confirmDialog('ეს მოქმედება საბოლოოა და ვერ გაუქმდება. საბოლოო დადასტურება?', { danger: true, confirmLabel: 'წავშალო ყველაფერი' });
    if (!ok2) return;
    wipeState();
    toast('ყველა მონაცემი წაიშალა');
    location.reload();
  });
  zone.appendChild(el('div', { class: 'btn-row' }, [wipeBtn]));
  return zone;
}
