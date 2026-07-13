// views/settings.js — Bucket CRUD, free-money split, appearance, data, sync, danger zone §5.5.

import { getState, updateState, wipeState } from '../state.js';
import { sumAllPercents, formatPercent } from '../calc.js';
import { el, confirmDialog, toast, openModal } from '../ui.js';
import { exportJson, importJson, exportCsv, importCsv } from '../exporter.js';
import { applyAppearance, checkBackupReminder } from '../app.js';
import * as sync from '../sync.js';

const COLOR_PRESETS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#be123c'];

const CARD_LABELS = {
  summary: 'თვის მიმოხილვა', income: 'შემოსავალი', rate: 'კურსი', georgia: 'საქართველოში გადასარიცხი',
  buckets: 'ბიუჯეტის კატეგორიები', free: 'თავისუფალი თანხა', planVsActual: 'გეგმა vs ფაქტი'
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pickColor(currentColor) {
  return new Promise((resolve) => {
    const body = el('div', {});
    const grid = el('div', { class: 'color-swatch-row' });
    COLOR_PRESETS.forEach(color => {
      const swatch = el('button', { type: 'button', class: 'color-swatch', style: `background:${color}`, 'aria-pressed': String(color === currentColor) });
      swatch.addEventListener('click', () => { resolve(color); close(); });
      grid.appendChild(swatch);
    });
    body.appendChild(grid);
    const { close } = openModal(body, { title: 'აირჩიე ფერი', onClose: () => resolve(null) });
  });
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

// ---------------- Buckets (budget categories) + free-money split ----------------

function renderBuckets() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'ბიუჯეტის კატეგორიები და პროცენტები' }));
  card.appendChild(el('p', { class: 'card__sub', text: 'დაამატე, გადაარქვი ან წაშალე ძირითადი ბიუჯეტის კატეგორიები (მაგ. აუცილებელი, დანაზოგი). თითოეულს აქვს სამიზნე პროცენტი და ფერი.' }));

  const list = el('div', { class: 'order-list', style: 'margin-top:8px' });
  const sumEl = el('div', { class: 'sum-indicator', style: 'margin-top:8px' });
  const addBtn = el('button', { class: 'btn btn--secondary btn--sm', text: '+ ახალი კატეგორია' });

  function updateSum() {
    const state = getState();
    const sum = sumAllPercents(state.settings);
    sumEl.textContent = sum === 100
      ? `ჯამი: ${sum}% ✓ — ყველაფერი ავტომატურად ინახება`
      : `ჯამი: ${sum}% (უნდა იყოს 100%)`;
    sumEl.className = 'sum-indicator ' + (sum === 100 ? 'sum-indicator--ok' : 'sum-indicator--bad');
  }

  function draw() {
    const state = getState();
    list.innerHTML = '';

    state.settings.buckets.forEach((bucket, idx) => {
      const row = el('div', { class: 'order-list__item', style: 'flex-wrap:wrap;gap:8px' });

      const nameInput = el('input', { type: 'text', value: bucket.name, style: 'max-width:140px;min-height:36px' });
      nameInput.addEventListener('change', () => {
        updateState(draft => { draft.settings.buckets[idx].name = nameInput.value.trim() || bucket.name; return draft; });
        toast('შენახულია ✓');
      });

      const percentInput = el('input', { type: 'number', min: '0', max: '100', value: String(bucket.percent), style: 'width:70px;min-height:36px' });
      percentInput.addEventListener('input', () => {
        // Commit immediately so the live sum indicator reflects what's typed.
        updateState(draft => { draft.settings.buckets[idx].percent = Number(percentInput.value) || 0; return draft; });
        updateSum();
      });

      const goalSelect = el('select', { style: 'min-height:36px' }, [
        el('option', { value: 'max', text: 'მაქს. (ხარჯი)' }),
        el('option', { value: 'min', text: 'მინ. (დანაზოგი)' })
      ]);
      goalSelect.value = bucket.goalType || 'max';
      goalSelect.addEventListener('change', () => {
        updateState(draft => { draft.settings.buckets[idx].goalType = goalSelect.value; return draft; });
        toast('შენახულია ✓');
      });

      const colorBtn = el('button', { type: 'button', class: 'color-swatch', style: `background:${bucket.color};width:28px;height:28px` });
      colorBtn.addEventListener('click', async () => {
        const color = await pickColor(bucket.color);
        if (!color) return;
        updateState(draft => { draft.settings.buckets[idx].color = color; return draft; });
        toast('ფერი შენახულია ✓');
        draw();
      });

      const deleteBtn = el('button', { class: 'icon-btn', 'aria-label': 'წაშლა', text: '🗑' });
      deleteBtn.addEventListener('click', async () => {
        const inUse = state.categories.some(c => c.bucketId === bucket.id);
        if (inUse) { toast('ჯერ გადაანაწილეთ ამ კატეგორიაზე მიბმული კატეგორიები', 'error'); return; }
        if (state.settings.buckets.length <= 1) { toast('უნდა დარჩეს მინიმუმ ერთი კატეგორია', 'error'); return; }
        const ok = await confirmDialog(`წავშალო „${bucket.name}“?`, { danger: true, confirmLabel: 'წაშლა' });
        if (!ok) return;
        updateState(draft => { draft.settings.buckets = draft.settings.buckets.filter(b => b.id !== bucket.id); return draft; });
        toast('წაიშალა');
        draw();
        updateSum();
      });

      row.append(nameInput, percentInput, el('span', { text: '%' }), goalSelect, colorBtn, deleteBtn);
      list.appendChild(row);
    });

    // Free-money split (fixed pair, rename/recolor/percent editable, not deletable/addable).
    ['giorgi', 'nino'].forEach(owner => {
      const cfg = state.settings.planFree[owner];
      const label = owner === 'giorgi' ? 'თავისუფალი (გიორგი)' : 'თავისუფალი (ნინო)';
      const row = el('div', { class: 'order-list__item', style: 'flex-wrap:wrap;gap:8px' });
      row.appendChild(el('span', { text: label, style: 'min-width:140px;font-weight:600' }));
      const percentInput = el('input', { type: 'number', min: '0', max: '100', value: String(cfg.percent), style: 'width:70px;min-height:36px' });
      percentInput.addEventListener('input', () => {
        updateState(draft => { draft.settings.planFree[owner].percent = Number(percentInput.value) || 0; return draft; });
        updateSum();
      });
      const colorBtn = el('button', { type: 'button', class: 'color-swatch', style: `background:${cfg.color};width:28px;height:28px` });
      colorBtn.addEventListener('click', async () => {
        const color = await pickColor(cfg.color);
        if (!color) return;
        updateState(draft => { draft.settings.planFree[owner].color = color; return draft; });
        toast('ფერი შენახულია ✓');
        draw();
      });
      row.append(percentInput, el('span', { text: '%' }), colorBtn);
      list.appendChild(row);
    });

    updateSum();
  }

  addBtn.addEventListener('click', () => {
    updateState(draft => {
      draft.settings.buckets.push({
        id: uid('bucket'), name: 'ახალი კატეგორია', percent: 0,
        color: COLOR_PRESETS[draft.settings.buckets.length % COLOR_PRESETS.length], goalType: 'max'
      });
      return draft;
    });
    draw();
  });

  draw();
  card.appendChild(list);
  card.appendChild(sumEl);
  card.appendChild(el('p', {
    class: 'card__sub',
    style: 'margin-top:8px',
    text: 'რას ნიშნავს „მაქს." და „მინ.": ეს განსაზღვრავს, როგორ შეფასდეს კატეგორია „გეგმა vs ფაქტი" ბლოკში. მაქს. (ხარჯი) — მიზანი შესრულებულია (მწვანე), თუ პროცენტზე მეტს არ ხარჯავ. მინ. (დანაზოგი) — მიზანი შესრულებულია, თუ მინიმუმ ამ პროცენტს გადადებ. სხვა არაფერზე არ მოქმედებს.'
  }));
  card.appendChild(el('div', { class: 'btn-row' }, [addBtn]));
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
  function drawOrder() {
    const s = getState();
    orderList.innerHTML = '';
    s.settings.dashboardCardOrder.forEach((key, idx) => {
      const item = el('div', { class: 'order-list__item' }, [
        el('span', { text: CARD_LABELS[key] || key }),
        el('div', { class: 'order-list__buttons' }, [upBtn(idx), downBtn(idx, s.settings.dashboardCardOrder.length)])
      ]);
      orderList.appendChild(item);
    });
  }
  function upBtn(idx) {
    const btn = el('button', { class: 'icon-btn', 'aria-label': 'ზემოთ', text: '▲' });
    if (idx === 0) btn.disabled = true;
    btn.addEventListener('click', () => {
      updateState(draft => {
        const arr = draft.settings.dashboardCardOrder;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        return draft;
      });
      drawOrder();
    });
    return btn;
  }
  function downBtn(idx, len) {
    const btn = el('button', { class: 'icon-btn', 'aria-label': 'ქვემოთ', text: '▼' });
    if (idx === len - 1) btn.disabled = true;
    btn.addEventListener('click', () => {
      updateState(draft => {
        const arr = draft.settings.dashboardCardOrder;
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
        return draft;
      });
      drawOrder();
    });
    return btn;
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
