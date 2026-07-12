// views/settings.js — Plan percents, appearance, data (export/import), danger zone §5.5.

import { getState, updateState, wipeState } from '../state.js';
import { el, confirmDialog, toast } from '../ui.js';
import { exportJson, importJson, exportCsv } from '../exporter.js';
import { applyAppearance, checkBackupReminder } from '../app.js';

const ACCENT_PRESETS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0891b2'];

const CARD_LABELS = {
  income: 'შემოსავალი', rate: 'კურსი', essentials: 'აუცილებელი ხარჯები',
  georgia: 'საქართველო', savings: 'დანაზოგი', free: 'თავისუფალი თანხა', planVsActual: 'გეგმა vs ფაქტი'
};

export function renderSettings(root) {
  const container = el('div', { class: 'settings-view' });
  root.appendChild(container);

  container.appendChild(renderPlanPercents());
  container.appendChild(renderAppearance());
  container.appendChild(renderDataSection());
  container.appendChild(renderDangerZone());
}

function renderPlanPercents() {
  const state = getState();
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'გეგმის პროცენტები' }));

  const fields = {};
  const labels = { essentials: 'აუცილებელი', georgia: 'საქართველო', savings: 'დანაზოგი', freeGiorgi: 'თავისუფალი (გიორგი)', freeNino: 'თავისუფალი (ნინო)' };
  const row = el('div', { class: 'field-row' });

  const sumEl = el('div', { class: 'sum-indicator' });

  function computeSum() {
    return Object.values(fields).reduce((s, input) => s + (Number(input.value) || 0), 0);
  }
  function updateSum() {
    const sum = computeSum();
    sumEl.textContent = `ჯამი: ${sum}%`;
    sumEl.className = 'sum-indicator ' + (sum === 100 ? 'sum-indicator--ok' : 'sum-indicator--bad');
    saveBtn.disabled = sum !== 100;
  }

  Object.keys(labels).forEach(key => {
    const input = el('input', { type: 'number', min: '0', max: '100', value: String(state.settings.planPercents[key]) });
    input.addEventListener('input', updateSum);
    fields[key] = input;
    row.appendChild(el('div', { class: 'field' }, [el('label', { text: labels[key] }), input]));
  });

  card.appendChild(row);
  card.appendChild(sumEl);

  const saveBtn = el('button', { class: 'btn btn--primary', text: 'შენახვა' });
  card.appendChild(el('div', { class: 'btn-row' }, [saveBtn]));

  saveBtn.addEventListener('click', () => {
    const sum = computeSum();
    if (sum !== 100) { toast('პროცენტების ჯამი უნდა იყოს 100%', 'error'); return; }
    updateState(draft => {
      Object.keys(labels).forEach(key => { draft.settings.planPercents[key] = Number(fields[key].value); });
      return draft;
    });
    toast('შენახულია ✓');
  });

  updateSum();
  return card;
}

function renderAppearance() {
  const state = getState();
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'გაფორმება' }));

  // Theme
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

  // Accent color
  card.appendChild(el('label', { text: 'აქცენტის ფერი', style: 'font-size:0.85rem;color:var(--text-muted);display:block;margin-bottom:6px' }));
  const swatchRow = el('div', { class: 'color-swatch-row' });
  ACCENT_PRESETS.forEach(color => {
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

  // Font size
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

  // Dashboard card order
  card.appendChild(el('label', { text: 'დეშბორდის ბარათების თანმიმდევრობა', style: 'font-size:0.85rem;color:var(--text-muted);display:block;margin:16px 0 6px' }));
  const orderList = el('div', { class: 'order-list' });
  function drawOrder() {
    const s = getState();
    orderList.innerHTML = '';
    s.settings.dashboardCardOrder.forEach((key, idx) => {
      const item = el('div', { class: 'order-list__item' }, [
        el('span', { text: CARD_LABELS[key] || key }),
        el('div', { class: 'order-list__buttons' }, [
          upBtn(idx), downBtn(idx, s.settings.dashboardCardOrder.length)
        ])
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

  btnRow.append(exportJsonBtn, importBtn, importInput, exportCsvBtn);
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
