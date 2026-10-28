// views/settings.js — Bucket CRUD, free-money split, appearance, data, sync, danger zone §5.5.

import { getState, updateState, wipeState, replaceState, snapshotCurrent, deviceName, setDeviceName } from '../state.js';
import { sumAllPercents, effectiveCardOrder } from '../calc.js';
import { el, confirmDialog, toast, openModal } from '../ui.js';
import { listSnapshots, getSnapshotData, saveSnapshot, summarizeState, SNAPSHOT_REASONS } from '../backup.js';
import { exportJson, importJson, exportCsv, importCsv } from '../exporter.js';
import { applyAppearance, checkBackupReminder, APP_VERSION } from '../app.js';
import { pickColor, COLOR_PRESETS } from '../components.js';
import * as sync from '../sync.js';

const CARD_LABELS = {
  summary: 'თვის მიმოხილვა', income: 'შემოსავალი', rate: 'კურსი', georgia: 'საქართველოში გადასარიცხი',
  free: 'თავისუფალი თანხა', planVsActual: 'დაგეგმილი vs რეალური', year: 'წლიური მიმოხილვა',
  due: 'ჯერ გადასახდელი', envelopes: 'ყოველდღიური ბიუჯეტები (კვება, საწვავი)', split: 'ხელფასის განაწილება'
};

function summaryText(sum) {
  if (!sum) return '—';
  return `${sum.templates} შაბლონი · ${sum.transactions} ტრანზაქცია · ${sum.months} თვე`;
}

function fmtDateTime(iso) {
  if (!iso || iso.startsWith('1970')) return '—';
  return new Date(iso).toLocaleString('ka-GE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function cardLabel(state, key) {
  if (CARD_LABELS[key]) return CARD_LABELS[key];
  return state.categories.find(c => c.id === key)?.name || key;
}

export function renderSettings(root) {
  const container = el('div', { class: 'settings-view' });
  root.appendChild(container);

  container.appendChild(renderBuckets());
  container.appendChild(renderSplitSettings());
  container.appendChild(renderAppearance());
  container.appendChild(renderSync());
  container.appendChild(renderRestore());
  container.appendChild(renderDataSection());
  container.appendChild(renderDangerZone());
  container.appendChild(el('p', { class: 'version-note', text: `აპის ვერსია ${APP_VERSION} · მონაცემების ფორმატი v${getState().version}. აპის განახლება მონაცემებს არ შლის: ისინი ამ მოწყობილობაზე და ღრუბელშია, ფორმატის ცვლილებამდე კი ავტომატურად იქმნება აღდგენის წერტილი „აპის განახლებამდე".` }));
}

// ---------------- Percent plan (over unified categories) + free-money split ----------------

function renderBuckets() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'პროცენტული გეგმა' }));
  card.appendChild(el('p', { class: 'card__sub', text: 'თითო ძირითად კატეგორიას აქვს სამიზნე პროცენტი შემოსავლიდან; ჯამი უნდა იყოს 100%. ახალი ბლოკი (მაგ. „ინვესტიცია" — მიზნის ტიპი „მინ.") — „კატეგორიები" გვერდზე „+ ახალი კატეგორია".' }));

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
      row.appendChild(el('span', { class: 'color-dot', style: `background:${cat.color};width:24px;height:24px` }));
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

// ---------------- Salary split + exchange rate ----------------

function renderSplitSettings() {
  const state = getState();
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'ახალი თვე, ხელფასის განაწილება და კურსი' }));

  card.appendChild(el('p', { class: 'card__sub', text: 'საერთო ხარჯი იყოფა 50/50. დეშბორდის ბარათი „ვინ რამდენი გადარიცხოს" ორ ვარიანტს აჩვენებს: ა) ჩამოსაჭრელს ანგარიშზე ვიტოვებთ, ბ) სრულად საერთოზე და მერე უკან.' }));

  const basisSelect = el('select', {}, [
    el('option', { value: 'actual', text: 'ზუსტად რეალური გადასახადები (შაბლონებიდან)' }),
    el('option', { value: 'plan', text: 'კატეგორიის % შემოსავლიდან (მაგ. 65%) — ზედმეტი საერთოზე რჩება' })
  ]);
  basisSelect.value = state.settings.contributionBasis || 'actual';
  basisSelect.addEventListener('change', () => {
    updateState(d => { d.settings.contributionBasis = basisSelect.value; return d; });
    toast('შენახულია ✓');
  });
  card.appendChild(el('div', { class: 'field' }, [el('label', { text: 'რამდენი გადაირიცხოს აუცილებელ ხარჯზე' }), basisSelect]));

  const modeNew = el('select', {}, [
    el('option', { value: 'wizard', text: '📅 მომზადების ფანჯრით — ჯერ ვნახავ სიას (რეკომენდებული)' }),
    el('option', { value: 'auto', text: 'ავტომატურად — შაბლონები თავისით ემატება, შეხსენების გარეშე' })
  ]);
  modeNew.value = state.settings.newMonthMode || 'wizard';
  modeNew.addEventListener('change', () => {
    updateState(d => { d.settings.newMonthMode = modeNew.value; return d; });
    toast('შენახულია ✓');
  });
  card.appendChild(el('div', { class: 'field' }, [el('label', { text: 'ახალი თვე როგორ შეივსოს' }), modeNew]));

  const autoBox = el('input', { type: 'checkbox' });
  autoBox.checked = state.settings.rateAuto !== false;
  autoBox.addEventListener('change', () => {
    updateState(d => { d.settings.rateAuto = autoBox.checked; return d; });
    toast('შენახულია ✓');
  });
  card.appendChild(el('label', { class: 'field checkbox-field' }, [
    autoBox,
    el('span', { text: 'მიმდინარე თვის კურსი ავტომატურად განახლდეს საქართველოს ბანკის ყიდვის კურსით (ევრო → ლარი). ხელით ჩაწერილ კურსს აპი არ შეცვლის; წარსულ თვეებს — არასდროს.' })
  ]));
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

  card.appendChild(el('label', { id: 'dashboard-layout', text: 'დეშბორდის ბლოკები — 👁 ჩვენება/დამალვა, ▲▼ თანმიმდევრობა', style: 'font-size:0.85rem;color:var(--text-muted);display:block;margin:16px 0 6px' }));
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
    const hidden = new Set(s.settings.hiddenCards || []);
    order.forEach((key, idx) => {
      const isHidden = hidden.has(key);
      const eye = el('button', { class: 'icon-btn order-list__eye', 'aria-pressed': String(!isHidden), 'aria-label': isHidden ? 'ჩვენება' : 'დამალვა', title: isHidden ? 'ჩვენება დეშბორდზე' : 'დამალვა დეშბორდიდან', text: isHidden ? '🚫' : '👁' });
      eye.addEventListener('click', () => {
        updateState(draft => {
          const list = new Set(draft.settings.hiddenCards || []);
          if (list.has(key)) list.delete(key); else list.add(key);
          draft.settings.hiddenCards = [...list];
          return draft;
        });
        drawOrder();
      });
      const up = el('button', { class: 'icon-btn', 'aria-label': 'ზემოთ', text: '▲' });
      if (idx === 0) up.disabled = true;
      up.addEventListener('click', () => moveCard(idx, -1));
      const down = el('button', { class: 'icon-btn', 'aria-label': 'ქვემოთ', text: '▼' });
      if (idx === order.length - 1) down.disabled = true;
      down.addEventListener('click', () => moveCard(idx, 1));
      orderList.appendChild(el('div', { class: 'order-list__item' + (isHidden ? ' order-list__item--hidden' : '') }, [
        el('span', { text: cardLabel(s, key) }),
        el('div', { class: 'order-list__buttons' }, [eye, up, down])
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
  card.appendChild(el('p', { class: 'card__sub', text: 'კომპიუტერი და სმარტფონი ერთმანეთს GitHub-ის პირადი Gist-ით უკავშირდება — ცვლილება ერთგან ავტომატურად აისახება მეორეზეც. ყოველი ატვირთვა ღრუბელში ცალკე ვერსიად ინახება, ამიტომ ძველ ვერსიაზე დაბრუნებაც შეიძლება.' }));

  card.appendChild(el('details', { class: 'help-details' }, [
    el('summary', { text: '📖 ინსტრუქცია ნაბიჯ-ნაბიჯ: როგორ დავაკავშირო?' }),
    el('ol', {}, [
      el('li', { text: 'გახსენი github.com და შედი ანგარიშზე.' }),
      el('li', { text: 'პროფილის ფოტო (ზედა მარჯვენა კუთხე) → Settings → მარცხენა მენიუს ბოლოში Developer settings → Personal access tokens → Tokens (classic).' }),
      el('li', { text: '„Generate new token (classic)". Note: „family-budget". Expiration: „No expiration". უფლებებიდან მონიშნე მხოლოდ „gist".' }),
      el('li', { text: '„Generate token" → დააკოპირე კოდი (ghp_-ით იწყება). ის მხოლოდ ერთხელ გამოჩნდება — შეინახე უსაფრთხოდ.' }),
      el('li', { text: 'ჩასვი token ქვემოთ და დააჭირე „დაკავშირებას". Gist ID-ის ჩაწერა საჭირო არ არის — აპი თავად იპოვის არსებულს ან შექმნის ახალს.' }),
      el('li', { text: 'მეორე მოწყობილობაზეც მხოლოდ იგივე token ჩაწერე და დააჭირე „დაკავშირებას". თუ ორივეგან სხვადასხვა მონაცემია, აპი გკითხავს, რომელი დატოვოს.' })
    ])
  ]));

  const cfg = sync.getSyncConfig();
  const tokenInput = el('input', { type: 'password', placeholder: 'GitHub token (ghp_...)', value: cfg.token || '', autocomplete: 'off' });
  const gistIdInput = el('input', { type: 'text', placeholder: 'არასავალდებულო — ცარიელი დატოვე', value: cfg.gistId || '' });

  const statusEl = el('div', { class: 'sync-status', role: 'status' });
  const STATE_TEXT = {
    off: 'სინქრონიზაცია გამორთულია.',
    ok: 'დაკავშირებულია ✓',
    syncing: 'სინქრონიზაცია მიმდინარეობს…',
    offline: 'ინტერნეტი არ არის — ცვლილებები აიტვირთება, როცა კავშირი აღდგება.',
    error: 'შეცდომა',
    blocked: '⚠️ ავტომატური სინქრონიზაცია შეჩერებულია — გადაწყვეტილება საჭიროა (იხ. ზედა ყვითელი ზოლი).'
  };
  const unsubscribe = sync.onSyncStatus((st) => {
    if (!statusEl.isConnected && statusEl.dataset.mounted) { unsubscribe(); return; }
    const c = sync.getSyncConfig();
    let text = STATE_TEXT[st.state] || '';
    if (st.state === 'error' && st.message) text += ': ' + st.message;
    if (sync.isConfigured(c) && c.lastSyncedAt && st.state !== 'blocked') text += ` · ბოლო შემოწმება: ${fmtDateTime(c.lastSyncedAt)}`;
    statusEl.textContent = text;
    statusEl.className = 'sync-status sync-status--' + st.state;
  });
  requestAnimationFrame(() => { statusEl.dataset.mounted = '1'; });

  const connectBtn = el('button', { class: 'btn btn--primary', text: cfg.gistId ? 'ხელახლა დაკავშირება' : 'დაკავშირება' });
  connectBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) { toast('ჩაწერე GitHub token', 'error'); return; }
    connectBtn.disabled = true;
    const label = connectBtn.textContent;
    connectBtn.textContent = 'დაკავშირება…';
    try {
      const r = await sync.connect(token, gistIdInput.value.trim());
      gistIdInput.value = r.gistId;
      const msg = {
        created: 'დაკავშირებულია ✓ — ღრუბელში შეიქმნა ახალი საცავი',
        pulled: 'დაკავშირებულია ✓ — მონაცემები ჩამოიტვირთა ღრუბლიდან',
        pushed: 'დაკავშირებულია ✓ — ამ მოწყობილობის მონაცემები აიტვირთა',
        none: 'დაკავშირებულია ✓ — ყველაფერი უკვე სინქრონშია',
        merged: 'დაკავშირებულია ✓ — მონაცემები გაერთიანდა',
        conflict: 'დაკავშირებულია — აირჩიე, როგორ გავაერთიანო მონაცემები (ზედა ზოლში)'
      }[r.action] || 'დაკავშირებულია ✓';
      toast(msg, r.action === 'conflict' ? 'error' : 'ok');
    } catch (e) {
      toast('შეცდომა: ' + e.message, 'error');
    }
    connectBtn.disabled = false;
    connectBtn.textContent = label;
  });

  const syncBtn = el('button', { class: 'btn btn--secondary', text: '🔄 ახლავე სინქრონიზაცია' });
  syncBtn.addEventListener('click', async () => {
    try {
      const r = await sync.syncNow();
      const msg = { pulled: 'ჩამოიტვირთა ცვლილებები ✓', pushed: 'აიტვირთა ✓', merged: 'გაერთიანდა და აიტვირთა ✓', none: 'უკვე სინქრონშია ✓', blocked: 'შეჩერდა — იხ. ზედა ზოლი', off: 'ჯერ დააკავშირე' }[r.action];
      toast(msg || 'მზადაა', r.action === 'blocked' || r.action === 'off' ? 'error' : 'ok');
    } catch (e) {
      toast('შეცდომა: ' + e.message, 'error');
    }
  });

  const backupBtn = el('button', { class: 'btn btn--secondary', text: '☁️ ღრუბელში შენახვა ახლავე' });
  backupBtn.addEventListener('click', async () => {
    try {
      const r = await sync.backupNow();
      toast(r.action === 'off' ? 'ჯერ დააკავშირე' : r.action === 'blocked' ? 'შეჩერდა — იხ. ზედა ზოლი' : 'შენახულია ღრუბელში ✓ (+ ამ თვის სარეზერვო ფაილი)', r.action === 'off' || r.action === 'blocked' ? 'error' : 'ok');
    } catch (e) {
      toast('შეცდომა: ' + e.message, 'error');
    }
  });

  const disconnectBtn = el('button', { class: 'btn btn--ghost btn--sm', style: 'margin-left:auto', text: 'გათიშვა' });
  disconnectBtn.addEventListener('click', async () => {
    const ok = await confirmDialog('გავთიშო სინქრონიზაცია ამ მოწყობილობაზე? მონაცემები არც აქ და არც ღრუბელში არ წაიშლება.', { confirmLabel: 'გათიშვა' });
    if (!ok) return;
    sync.disconnect();
    tokenInput.value = '';
    gistIdInput.value = '';
    toast('სინქრონიზაცია გათიშულია');
  });

  const nameInput = el('input', { type: 'text', placeholder: 'მაგ. გიორგი ან ნინო', value: deviceName(), maxlength: '30' });
  nameInput.addEventListener('change', () => { setDeviceName(nameInput.value); toast('შენახულია ✓'); });
  card.appendChild(el('div', { class: 'field' }, [
    el('label', { text: 'ვინ იყენებს ამ მოწყობილობას (ჩანს მეორე ტელეფონზე: „ნინო: ცვლილება მოვიდა")' }),
    nameInput
  ]));
  card.appendChild(el('div', { class: 'field' }, [el('label', { text: 'GitHub Personal Access Token (gist უფლებით)' }), tokenInput]));
  card.appendChild(el('details', { class: 'help-details' }, [
    el('summary', { text: 'Gist ID (მოწინავე)' }),
    el('div', { class: 'field', style: 'margin-top:6px' }, [gistIdInput])
  ]));
  card.appendChild(statusEl);
  card.appendChild(el('div', { class: 'btn-row', style: 'align-items:center' }, [connectBtn, syncBtn, backupBtn, disconnectBtn]));
  card.appendChild(el('p', { class: 'card__sub', text: '⚡ ცოცხალი რეჟიმი: შენი ცვლილება ~1 წამში იტვირთება, ხოლო სანამ აპი ეკრანზეა გახსნილი, მეორე ტელეფონის ცვლილებები ყოველ ~5 წამში მოდის (აპის დახურვისას ჩერდება და გახსნისთანავე ახლდება). ორივე მოწყობილობის ცვლილებები ერთიანდება ჩანაწერ-ჩანაწერ — ერთმანეთს არ გადაეწერება. დღეში ერთხელ ღრუბელში ცალკე სარეზერვო ფაილიც იქმნება (backup-წელი-თვე.json).' }));

  card.appendChild(el('details', { class: 'help-details' }, [
    el('summary', { text: '📲 ნინოს (ან სხვა მოწყობილობის) დაკავშირება' }),
    el('ol', {}, [
      el('li', {}, ['გიორგის GitHub-ში შექმენი ნინოსთვის ცალკე token: ', el('a', { href: 'https://github.com/settings/tokens/new?scopes=gist&description=family-budget-nino', target: '_blank', rel: 'noopener', text: 'ეს ბმული' }), ' უკვე მონიშნავს „gist"-ს — Expiration: „No expiration" → „Generate token".']),
      el('li', { text: 'ნინოს ტელეფონზე გახსენი https://bagdadishvili.github.io/SalEx/ და დაამატე მთავარ ეკრანზე (Safari: გაზიარება → „Add to Home Screen"; Android Chrome: მენიუ → „Install app").' }),
      el('li', { text: 'იქ: პარამეტრები → სინქრონიზაცია → ჩასვი ნინოს token → „დაკავშირება". აპი თავად იპოვის თქვენს მონაცემებს.' }),
      el('li', { text: 'ცალკე token-ის უპირატესობა: თუ ტელეფონი დაიკარგა, GitHub-ში მხოლოდ იმ token-ს წაშლი — შენი მოწყობილობები ისევ იმუშავებს.' }),
      el('li', { text: 'token-ს არავის გაუგზავნო ღია ჩატში; საუკეთესოა პირდაპირ ნინოს ტელეფონში ჩაწერა/ჩასმა.' })
    ])
  ]));
  return card;
}

// ---------------- Restore points (local snapshots + cloud history) ----------------

function renderRestore() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: '🛟 აღდგენის წერტილები' }));
  card.appendChild(el('p', { class: 'card__sub', text: 'აპი ავტომატურად ინახავს ასლს ყოველდღე და ყოველი სარისკო მოქმედების წინ (იმპორტი, სინქრონიზაციით ჩანაცვლება, წაშლა). აღდგენამდე მიმდინარე მდგომარეობაც შეინახება — ანუ აღდგენაც უსაფრთხოა.' }));

  const persistEl = el('div', { class: 'card__sub' });
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(p => {
      persistEl.textContent = p
        ? '✓ ბრაუზერმა დაადასტურა მუდმივი შენახვა — მონაცემებს თავისით არ წაშლის.'
        : 'ℹ️ ბრაუზერს მუდმივი შენახვა ჯერ არ დაუდასტურებია. ტელეფონზე აპი „მთავარ ეკრანზე" დაამატე — ასე მონაცემები უფრო დაცულია.';
    }).catch(() => {});
  }
  card.appendChild(persistEl);

  // Local snapshots
  card.appendChild(el('h3', { class: 'subsection-title', text: 'ამ მოწყობილობაზე შენახული ასლები' }));
  const localList = el('div', { class: 'restore-list' });
  card.appendChild(localList);
  const snapBtn = el('button', { class: 'btn btn--secondary btn--sm', text: '📦 ასლის შექმნა ახლა' });
  snapBtn.addEventListener('click', async () => {
    const saved = await saveSnapshot(getState(), 'manual');
    toast(saved ? 'ასლი შეიქმნა ✓' : 'ცვლილება არ ყოფილა — ბოლო ასლი უკვე იგივეა');
    drawLocal();
  });
  card.appendChild(el('div', { class: 'btn-row' }, [snapBtn]));

  async function drawLocal() {
    localList.innerHTML = '';
    const items = await listSnapshots();
    if (!items.length) {
      localList.appendChild(el('div', { class: 'card__sub', text: 'ჯერ ასლი არ არის.' }));
      return;
    }
    items.slice(0, 15).forEach(item => {
      const btn = el('button', { class: 'btn btn--secondary btn--sm', text: 'აღდგენა' });
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(`აღვადგინო ასლი ${fmtDateTime(item.createdAt)}-დან? (${summaryText(item.summary)})\nმიმდინარე მდგომარეობა ჯერ ცალკე ასლად შეინახება.`, { confirmLabel: 'აღდგენა' });
        if (!ok) return;
        try {
          const data = await getSnapshotData(item.id);
          replaceState(data, { reason: 'before-restore', stamp: true, source: 'restore' });
          toast('აღდგენილია ✓');
        } catch (e) {
          toast('შეცდომა: ' + e.message, 'error');
        }
      });
      localList.appendChild(restoreRow(fmtDateTime(item.createdAt), `${SNAPSHOT_REASONS[item.reason] || item.reason} · ${summaryText(item.summary)}`, btn));
    });
  }
  drawLocal();

  // Cloud history
  card.appendChild(el('h3', { class: 'subsection-title', text: 'ღრუბლის ისტორია (Gist-ის ვერსიები)' }));
  const cloudInfo = el('div', { class: 'card__sub', text: 'აქ ჩანს ღრუბელში ატვირთული ყველა ძველი ვერსია. თუ მონაცემები სადმე დაიკარგა, აქ შეგიძლია იპოვო ბოლო ვერსია, სადაც ყველაფერი იყო.' });
  card.appendChild(cloudInfo);
  const cloudList = el('div', { class: 'restore-list' });
  card.appendChild(cloudList);
  const loadCloudBtn = el('button', { class: 'btn btn--secondary btn--sm', text: '☁️ ღრუბლის ისტორიის ჩატვირთვა' });
  card.appendChild(el('div', { class: 'btn-row' }, [loadCloudBtn]));

  let page = 0;
  let lastSummaryKey = null;
  loadCloudBtn.addEventListener('click', async () => {
    if (!sync.isConfigured()) { toast('ჯერ დააკავშირე სინქრონიზაცია (ზემოთ)', 'error'); return; }
    loadCloudBtn.disabled = true;
    loadCloudBtn.textContent = 'იტვირთება…';
    try {
      page += 1;
      const versions = await sync.listCloudVersions(page);
      if (!versions.length) { toast('მეტი ვერსია აღარ არის'); loadCloudBtn.hidden = true; return; }
      for (const v of versions) {
        const btn = el('button', { class: 'btn btn--secondary btn--sm', text: 'აღდგენა', disabled: 'true' });
        const meta = el('span', { text: 'იტვირთება…' });
        const row = restoreRow(fmtDateTime(v.committedAt), meta, btn);
        cloudList.appendChild(row);
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog(`აღვადგინო ღრუბლის ვერსია ${fmtDateTime(v.committedAt)}-დან? ის გახდება უახლესი ვერსია ორივე მოწყობილობაზე. მიმდინარე მდგომარეობა ჯერ ასლად შეინახება.`, { confirmLabel: 'აღდგენა' });
          if (!ok) return;
          btn.disabled = true;
          try {
            await sync.restoreCloudVersion(v.version);
            toast('ღრუბლის ვერსია აღდგენილია ✓');
          } catch (e) {
            toast('შეცდომა: ' + e.message, 'error');
            btn.disabled = false;
          }
        });
        // Load the summary so the user can see which version still had the data.
        try {
          const data = await sync.getCloudVersion(v.version);
          const sum = data ? summarizeState(data) : null;
          const key = sum ? `${sum.templates}/${sum.transactions}/${sum.months}` : 'x';
          meta.textContent = sum ? summaryText(sum) : 'მონაცემები არ არის';
          if (sum) btn.removeAttribute('disabled');
          // Collapse runs of identical-size versions to keep the list readable.
          if (key === lastSummaryKey) row.classList.add('restore-row--same');
          lastSummaryKey = key;
        } catch (e) {
          meta.textContent = 'ვერ ჩაიტვირთა: ' + e.message;
        }
      }
      loadCloudBtn.textContent = 'კიდევ ძველი ვერსიები';
    } catch (e) {
      page -= 1;
      toast('შეცდომა: ' + e.message, 'error');
      loadCloudBtn.textContent = '☁️ ღრუბლის ისტორიის ჩატვირთვა';
    } finally {
      loadCloudBtn.disabled = false;
    }
  });

  return card;
}

function restoreRow(title, meta, actionBtn) {
  return el('div', { class: 'restore-row' }, [
    el('div', { class: 'restore-row__main' }, [
      el('div', { class: 'restore-row__title', text: title }),
      typeof meta === 'string' ? el('div', { class: 'restore-row__meta', text: meta }) : el('div', { class: 'restore-row__meta' }, [meta])
    ]),
    actionBtn
  ]);
}

// ---------------- Data (export/import) ----------------

function renderDataSection() {
  const state = getState();
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card__title', text: 'მონაცემები' }));

  const lastBackupText = state.settings.lastBackupAt
    ? `ბოლო ბექაფი: ${new Date(state.settings.lastBackupAt).toLocaleString('ka-GE', { hour12: false })}`
    : 'ბოლო ბექაფი: არასდროს';
  const backupInfo = el('div', { class: 'card__sub', text: lastBackupText });
  card.appendChild(backupInfo);

  const btnRow = el('div', { class: 'btn-row' });

  const exportJsonBtn = el('button', { class: 'btn btn--secondary', text: 'JSON ექსპორტი' });
  exportJsonBtn.addEventListener('click', () => {
    exportJson();
    toast('ბექაფი ჩამოტვირთულია ✓');
    checkBackupReminder();
    backupInfo.textContent = `ბოლო ბექაფი: ${new Date().toLocaleString('ka-GE', { hour12: false })}`;
  });

  const importInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
  const importBtn = el('button', { class: 'btn btn--secondary', text: 'JSON იმპორტი' });
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    const ok = await confirmDialog('იმპორტი ჩაანაცვლებს მიმდინარე მონაცემებს (მიმდინარე მდგომარეობა ჯერ აღდგენის წერტილად შეინახება). გავაგრძელო?', { danger: true, confirmLabel: 'დიახ, ჩავანაცვლო' });
    if (!ok) { importInput.value = ''; return; }
    try {
      await importJson(file);
      toast('მონაცემები აღდგენილია ✓ (ძველი მდგომარეობა აღდგენის წერტილად შეინახა)');
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
  zone.appendChild(el('p', { class: 'card__sub', text: 'ყველა მონაცემის წაშლა ამ მოწყობილობაზე. წაშლამდე აპი ავტომატურად შექმნის აღდგენის წერტილს, მაგრამ სჯობს JSON ექსპორტიც გააკეთო. ღრუბელში (თუ სინქრონიზაცია ჩართულია) მონაცემები ავტომატურად არ წაიშლება — აპი ჯერ გკითხავს.' }));
  const wipeBtn = el('button', { class: 'btn btn--danger', text: 'ყველაფრის წაშლა' });
  wipeBtn.addEventListener('click', async () => {
    const ok1 = await confirmDialog('ნამდვილად გსურთ ყველა მონაცემის წაშლა?', { danger: true, confirmLabel: 'დიახ' });
    if (!ok1) return;
    const ok2 = await confirmDialog('ეს მოქმედება საბოლოოა და ვერ გაუქმდება. საბოლოო დადასტურება?', { danger: true, confirmLabel: 'წავშალო ყველაფერი' });
    if (!ok2) return;
    await snapshotCurrent('before-wipe');
    wipeState();
    toast('ყველა მონაცემი წაიშალა (აღდგენის წერტილი შენახულია)');
  });
  zone.appendChild(el('div', { class: 'btn-row' }, [wipeBtn]));
  return zone;
}
