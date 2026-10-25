// views/templates.js — Templates CRUD per master-prompt §5.3.

import { getState, updateState, FREE_BUCKET_ID } from '../state.js';
import { isTemplateDueInMonth, resolveTopCategory, gelToEur, formatMoney, parseAmountInput, ACCOUNT_LABELS } from '../calc.js';
import { parseTemplatePack, addStarterTemplates } from '../starterPack.js';
import { el, openModal, confirmDialog, toast, formatDate } from '../ui.js';
import { monthKey } from '../state.js';
import { getSelectedMonth, setSelectedMonth, monthLabel, shiftMonthKey } from '../monthNav.js';
import { openPrepareWizard } from '../prepare.js';
import { monthIsPrepared } from '../monthEngine.js';
import { navigate } from '../app.js';
import { bucketChip, freePseudoCategory } from '../components.js';

function bucketOfCategory(state, category) {
  if (!category) return null;
  const top = resolveTopCategory(state.categories, category.id);
  if (!top) return null;
  return top.parentId === FREE_BUCKET_ID ? freePseudoCategory() : top;
}

const TYPE_LABELS = { fixed: 'ფიქსირებული', variable: 'ცვლადი', envelope: '🛒 ბიუჯეტი (ნელ-ნელა იხარჯება)' };

const CYCLE_OPTIONS = [
  { value: 1, label: 'ყოველ თვე' },
  { value: 2, label: '2 თვეში ერთხელ' },
  { value: 3, label: '3 თვეში ერთხელ' },
  { value: 6, label: '6 თვეში ერთხელ' },
  { value: 12, label: 'წელიწადში ერთხელ' }
];

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextDueMonth(tpl) {
  let cursor = monthKey();
  for (let i = 0; i < 36; i++) {
    if (isTemplateDueInMonth(tpl, cursor)) return cursor;
    const [y, m] = cursor.split('-').map(Number);
    const idx = y * 12 + (m - 1) + 1;
    cursor = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  }
  return null;
}

export function renderTemplates(root) {
  const container = el('div', { class: 'templates-view' });
  root.appendChild(container);

  const header = el('div', { class: 'btn-row' });
  const addBtn = el('button', { class: 'btn btn--primary', text: '+ ახალი შაბლონი' });

  // Visual month preparation: opens on the current month if it isn't prepared yet, else the next one.
  const nextBtn = el('button', { class: 'btn btn--secondary', text: '📅 თვის მომზადება' });
  nextBtn.addEventListener('click', () => {
    const cur = monthKey();
    const target = monthIsPrepared(getState(), cur) ? shiftMonthKey(cur, 1) : cur;
    openPrepareWizard(target, () => navigate('dashboard'));
  });
  header.append(addBtn, nextBtn);
  container.appendChild(header);

  // Bulk-add templates from a private JSON file (kept outside the public repo).
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  const fileBtn = el('button', { class: 'btn btn--ghost btn--sm', text: '📂 შაბლონების ფაილიდან დამატება' });
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('ფაილის წაკითხვა ვერ მოხერხდა'));
        r.readAsText(file, 'UTF-8');
      });
      const list = parseTemplatePack(JSON.parse(text));
      openStarterDialog(list, () => draw());
    } catch (e) {
      toast(e instanceof SyntaxError ? 'ფაილი არ არის სწორი JSON' : e.message, 'error');
    }
  });
  container.appendChild(el('div', { class: 'btn-row' }, [fileBtn, fileInput]));
  container.appendChild(el('p', {
    class: 'card__sub',
    text: 'შაბლონი = ყოველთვიური (ან 2/3/6/12 თვეში ერთხელ) ხარჯის ნიმუში. ყოველი თვის დასაწყისში „📅 თვის მომზადება" გაჩვენებს, რომელი შაბლონები მოდის იმ თვეში — მონიშნავ, საჭიროებისამებრ შეცვლი თანხას და ერთი დაჭერით შექმნი. შექმნილი ხარჯები გადახდამდე თავისუფლად რედაქტირდება.'
  }));

  const list = el('div', { class: 'list' });
  container.appendChild(list);

  function draw() {
    const state = getState();
    list.innerHTML = '';
    if (state.templates.length === 0) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state__icon', text: '🧾' }),
        el('div', { text: 'დაამატე პირველი შაბლონი — მაგალითად ქირა ან დაზღვევა' })
      ]));
      return;
    }

    const previewRate = (state.months[getSelectedMonth()] || state.months[monthKey()] || {}).exchangeRate || 3;
    state.templates.forEach(tpl => {
      const category = state.categories.find(c => c.id === tpl.categoryId);
      const cycleLabel = tpl.oneTime ? 'ერთჯერადი' : (CYCLE_OPTIONS.find(c => c.value === tpl.cycleMonths)?.label || `${tpl.cycleMonths} თვეში ერთხელ`);
      const ownerLabel = { giorgi: 'გიორგი', nino: 'ნინო', shared: 'საერთო' }[tpl.owner];
      const nextMonth = tpl.active ? nextDueMonth(tpl) : null;

      const row = el('div', { class: 'row' + (tpl.active ? '' : ' row--paid') });
      const main = el('div', { class: 'row__main' }, [
        el('div', { class: 'row__name', text: tpl.name }),
        el('div', { class: 'row__meta' }, [
          bucketChip(bucketOfCategory(state, category)),
          el('span', { class: 'chip', text: category ? category.name : '—' }),
          category?.georgiaTransfer ? el('span', { class: 'chip chip--georgia', text: '🇬🇪' }) : null,
          el('span', { class: 'chip', text: TYPE_LABELS[tpl.type] || tpl.type }),
          tpl.account && tpl.account !== 'shared' ? el('span', { class: 'chip chip--account', text: `🏦 ${ACCOUNT_LABELS[tpl.account].replace(' ანგარიში', '')}` }) : null,
          el('span', { class: 'chip', text: cycleLabel }),
          el('span', { class: 'chip', text: ownerLabel })
        ]),
        el('div', { class: 'row__meta', text: nextMonth ? `შემდეგი: ${monthLabel(nextMonth)}` : (tpl.active ? '' : 'გამორთულია') })
      ]);

      const amount = el('div', { class: 'row__amount tabular-nums' }, [
        el('div', { text: formatMoney(tpl.amount, tpl.currency) }),
        tpl.currency === 'GEL' ? el('div', { class: 'row__amount-sub tabular-nums', text: `≈ ${formatMoney(gelToEur(tpl.amount, previewRate), 'EUR')}` }) : null
      ]);

      const actions = el('div', { class: 'row__actions' });
      const toggleBtn = el('button', {
        class: 'icon-btn',
        'aria-label': tpl.active ? 'გამორთვა' : 'ჩართვა',
        text: tpl.active ? '⏸' : '▶'
      });
      toggleBtn.addEventListener('click', () => {
        updateState(draft => {
          const t = draft.templates.find(x => x.id === tpl.id);
          t.active = !t.active;
          return draft;
        });
        toast(tpl.active ? 'შაბლონი გამორთულია' : 'შაბლონი ჩართულია');
        draw();
      });

      const editBtn = el('button', { class: 'icon-btn', 'aria-label': 'რედაქტირება', text: '✎' });
      editBtn.addEventListener('click', () => openTemplateForm(tpl, draw));

      const deleteBtn = el('button', { class: 'icon-btn', 'aria-label': 'წაშლა', text: '🗑' });
      deleteBtn.addEventListener('click', async () => {
        const ok = await confirmDialog(
          'შაბლონის წაშლა შეაჩერებს მომავალ თვეებში ტრანზაქციების გენერაციას. უკვე შექმნილი ტრანზაქციები წარსულ/მიმდინარე თვეებში დარჩება უცვლელი. დარწმუნებული ხართ?',
          { danger: true, confirmLabel: 'წაშლა' }
        );
        if (!ok) return;
        updateState(draft => {
          draft.templates = draft.templates.filter(x => x.id !== tpl.id);
          return draft;
        });
        toast('შაბლონი წაიშალა');
        draw();
      });

      actions.append(toggleBtn, editBtn, deleteBtn);
      row.append(main, amount, actions);
      list.appendChild(row);
    });
  }

  addBtn.addEventListener('click', () => openTemplateForm(null, draw));

  draw();
}

function openStarterDialog(fileList, onDone) {
  const form = el('form', {});
  const names = new Set(getState().templates.map(t => t.name));
  const missing = fileList.filter(t => !names.has(t.name));
  const already = fileList.length - missing.length;
  form.appendChild(el('p', { class: 'card__sub', text: `ფაილში ${fileList.length} შაბლონია${already ? `; ${already} უკვე გაქვს (იგივე სახელით) და არ გაორმაგდება` : ''}. ყველაფერი შემდეგ თავისუფლად იცვლება.` }));
  const list = el('ul', { class: 'starter-list' });
  missing.forEach(t => list.appendChild(el('li', { class: 'tabular-nums', text: `${t.name} — ${formatMoney(t.amount, t.currency, 0)}${t.cycleMonths > 1 ? ` · ${t.cycleMonths} თვეში ერთხელ` : ''}${t.firstDueDate ? ` · პირველად ${t.firstDueDate.slice(0, 7)}` : ''}${t.type === 'envelope' ? ' · 🛒 ბიუჯეტი' : ''}${t.account !== 'shared' ? ` · 🏦 ${ACCOUNT_LABELS[t.account].replace(' ანგარიში', '')}` : ''}` })));
  form.appendChild(list);
  const startInput = el('input', { type: 'month', value: monthKey() });
  form.appendChild(el('div', { class: 'field' }, [el('label', { text: 'რომელი თვიდან დაიწყოს (სადაც ფაილში თარიღი არ წერია)' }), startInput]));
  form.appendChild(el('p', { class: 'card__sub', text: 'გადახდის დღე = 1-ლი რიცხვი, თუ ფაილში სხვა არ წერია. ტრანზაქციები შეიქმნება „📅 თვის მომზადებისას".' }));
  const actions = el('div', { class: 'btn-row' });
  actions.appendChild(el('button', { class: 'btn btn--primary', type: 'submit', text: `დამატება (${missing.length})`, ...(missing.length ? {} : { disabled: 'true' }) }));
  form.appendChild(actions);
  const { close } = openModal(form, { title: '📂 შაბლონები ფაილიდან' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const start = /^\d{4}-\d{2}$/.test(startInput.value) ? startInput.value : monthKey();
    let added = 0;
    updateState(draft => { added = addStarterTemplates(draft, start, missing); return draft; });
    toast(`დაემატა ${added} შაბლონი ✓`);
    close();
    onDone();
  });
}

function openTemplateForm(existing, onSaved) {
  const state = getState();
  const isEdit = !!existing;
  const form = el('form', { class: 'template-form' });

  const nameField = fieldInput('სახელი', 'text', existing?.name || '');
  const categorySelect = el('select', {}, state.categories.map(c => el('option', { value: c.id, text: c.name })));
  if (existing) categorySelect.value = existing.categoryId;

  const typeSelect = el('select', {}, Object.entries(TYPE_LABELS).map(([v, t]) => el('option', { value: v, text: t })));
  typeSelect.value = existing?.type || 'fixed';
  const typeHint = el('div', { class: 'card__sub' });
  const syncTypeHint = () => {
    typeHint.textContent = {
      fixed: 'ყოველთვე ერთი და იგივე თანხა — ერთი დაჭერით გადახდილად მოინიშნება.',
      variable: 'თანხა იცვლება (მაგ. დენი) — გადახდისას რეალურ თანხას ჩაწერ.',
      envelope: 'თვის ბიუჯეტი, რომელიც ნელ-ნელა იხარჯება (კვება, საწვავი). ჩაწერ ცალკეულ ხარჯს ან უბრალოდ ანგარიშზე დარჩენილ თანხას.'
    }[typeSelect.value];
  };
  typeSelect.addEventListener('change', syncTypeHint);
  syncTypeHint();

  const accountSelect = el('select', {}, Object.entries(ACCOUNT_LABELS).map(([v, t]) => el('option', { value: v, text: t })));
  accountSelect.value = existing?.account || 'shared';

  const amountInput = fieldInputRaw('text', (existing?.amount ?? 0).toFixed(2).replace('.', ','));
  const currencySelect = el('select', {}, [
    el('option', { value: 'EUR', text: 'EUR' }),
    el('option', { value: 'GEL', text: 'GEL' })
  ]);
  currencySelect.value = existing?.currency || 'EUR';

  const eurPreview = el('div', { class: 'card__sub' });
  const month = state.months[getSelectedMonth()] || Object.values(state.months)[0];
  function updatePreview() {
    if (currencySelect.value === 'GEL') {
      const amt = parseAmountInput(amountInput.value);
      const rate = month ? month.exchangeRate : 3;
      eurPreview.textContent = `≈ ${formatMoney(gelToEur(amt, rate), 'EUR')} (მიმდინარე კურსით)`;
      eurPreview.hidden = false;
    } else {
      eurPreview.hidden = true;
    }
  }
  currencySelect.addEventListener('change', updatePreview);
  amountInput.addEventListener('input', updatePreview);

  const cycleSelect = el('select', {}, [
    ...CYCLE_OPTIONS.map(c => el('option', { value: c.value, text: c.label })),
    el('option', { value: 'oneTime', text: 'ერთჯერადი' })
  ]);
  cycleSelect.value = existing ? (existing.oneTime ? 'oneTime' : String(existing.cycleMonths)) : '1';

  const dateInput = fieldInputRaw('date', existing?.firstDueDate || monthKey() + '-01');

  const ownerSelect = el('select', {}, [
    el('option', { value: 'shared', text: 'საერთო' }),
    el('option', { value: 'giorgi', text: 'გიორგი' }),
    el('option', { value: 'nino', text: 'ნინო' })
  ]);
  ownerSelect.value = existing?.owner || 'shared';

  // Opt-in: carry the edit into already generated, still unpaid transactions (this month onward).
  const applyExisting = el('input', { type: 'checkbox' });
  const applyField = isEdit ? el('label', { class: 'field checkbox-field' }, [
    applyExisting,
    el('span', { text: 'ცვლილება აისახოს უკვე შექმნილ, გადაუხდელ ტრანზაქციებზეც (მიმდინარე და მომავალი თვეები). გადახდილი და წარსული თვეები არ შეიცვლება.' })
  ]) : null;

  form.append(
    labeledField('სახელი', nameField),
    labeledField('კატეგორია', categorySelect),
    labeledField('ტიპი', typeSelect),
    typeHint,
    labeledField('თანხა', amountInput),
    labeledField('ვალუტა', currencySelect),
    eurPreview,
    labeledField('ციკლი', cycleSelect),
    labeledField('პირველი გადახდა', dateInput),
    labeledField('ვისი ხარჯია', ownerSelect),
    labeledField('საიდან იჭრება (ანგარიში)', accountSelect),
    applyField
  );

  const actions = el('div', { class: 'btn-row' });
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit', text: isEdit ? 'შენახვა' : 'დამატება' });
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  updatePreview();

  const { close } = openModal(form, { title: isEdit ? 'შაბლონის რედაქტირება' : 'ახალი შაბლონი' });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameField.value.trim();
    if (!name) { toast('შეავსეთ სახელი', 'error'); return; }
    const amount = parseAmountInput(amountInput.value);
    if (amount <= 0) { toast('შეიყვანეთ სწორი თანხა', 'error'); return; }
    if (!dateInput.value) { toast('აირჩიეთ თარიღი', 'error'); return; }

    const oneTime = cycleSelect.value === 'oneTime';
    const cycleMonths = oneTime ? 1 : Number(cycleSelect.value);

    let updatedCount = 0;
    updateState(draft => {
      if (isEdit) {
        const t = draft.templates.find(x => x.id === existing.id);
        Object.assign(t, {
          name, categoryId: categorySelect.value, type: typeSelect.value,
          amount, currency: currencySelect.value, cycleMonths,
          firstDueDate: dateInput.value, owner: ownerSelect.value, account: accountSelect.value, oneTime
        });
        if (applyExisting.checked) {
          const fromKey = monthKey();
          Object.keys(draft.months).filter(k => k >= fromKey).forEach(k => {
            draft.months[k].transactions
              .filter(tx => tx.templateId === t.id && !tx.paid)
              .forEach(tx => {
                Object.assign(tx, { name, categoryId: t.categoryId, owner: t.owner, account: t.account, currency: t.currency, amountPlanned: amount });
                if (t.type === 'envelope' && tx.kind !== 'envelope') { tx.kind = 'envelope'; tx.spends = tx.spends || []; }
                updatedCount += 1;
              });
          });
        }
      } else {
        draft.templates.push({
          id: uid('tpl'), name, categoryId: categorySelect.value, type: typeSelect.value,
          amount, currency: currencySelect.value, cycleMonths,
          firstDueDate: dateInput.value, owner: ownerSelect.value, account: accountSelect.value, active: true, oneTime
        });
      }
      return draft;
    });
    toast(updatedCount ? `შენახულია ✓ — განახლდა ${updatedCount} ტრანზაქცია` : 'შენახულია ✓');
    close();
    onSaved();
  });
}

function fieldInput(label, type, value) {
  return el('input', { type, value });
}
function fieldInputRaw(type, value) {
  return el('input', { type, value });
}
function labeledField(label, inputEl) {
  return el('div', { class: 'field' }, [el('label', { text: label }), inputEl]);
}
