// views/templates.js — Templates CRUD per master-prompt §5.3.

import { getState, updateState, FREE_BUCKET_ID } from '../state.js';
import { isTemplateDueInMonth, resolveTopCategory, gelToEur, formatMoney, parseAmountInput } from '../calc.js';
import { el, openModal, confirmDialog, toast, formatDate } from '../ui.js';
import { monthKey } from '../state.js';
import { getSelectedMonth, setSelectedMonth, monthLabel } from '../monthNav.js';
import { navigate } from '../app.js';
import { bucketChip, freePseudoCategory } from '../components.js';

function bucketOfCategory(state, category) {
  if (!category) return null;
  const top = resolveTopCategory(state.categories, category.id);
  if (!top) return null;
  return top.parentId === FREE_BUCKET_ID ? freePseudoCategory() : top;
}

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

  // One-tap "prepare next month": jump to next month — transactions generate
  // there automatically from active templates and stay editable until paid.
  const nextKey = (() => {
    const [y, m] = monthKey().split('-').map(Number);
    const idx = y * 12 + (m - 1) + 1;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  })();
  const nextBtn = el('button', { class: 'btn btn--secondary', text: `📅 ${monthLabel(nextKey)}-ის მომზადება` });
  nextBtn.addEventListener('click', () => {
    setSelectedMonth(nextKey);
    navigate('transactions');
    toast(`${monthLabel(nextKey)} დაგენერირდა შაბლონებიდან — შეგიძლია შეცვალო ან დაამატო ✓`);
  });

  header.append(addBtn, nextBtn);
  container.appendChild(header);
  container.appendChild(el('p', {
    class: 'card__sub',
    text: 'შაბლონები ავტომატურად იქცევა ტრანზაქციებად, როგორც კი თვეზე გადახვალ (აქტიური შაბლონებიდან, ციკლის მიხედვით). გენერირებული ტრანზაქციები თავისუფლად რედაქტირდება გადახდამდე.'
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
          el('span', { class: 'chip', text: tpl.type === 'fixed' ? 'ფიქსირებული' : 'ცვლადი' }),
          el('span', { class: 'chip', text: cycleLabel }),
          el('span', { class: 'chip', text: ownerLabel })
        ]),
        el('div', { class: 'row__meta', text: nextMonth ? `შემდეგი: ${monthLabel(nextMonth)}` : (tpl.active ? '' : 'გამორთულია') })
      ]);

      const amount = el('div', { class: 'row__amount tabular-nums' }, [
        el('div', { text: formatMoney(tpl.amount, tpl.currency) }),
        tpl.currency === 'GEL' ? el('div', { class: 'row__amount-sub tabular-nums' }) : null
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

function openTemplateForm(existing, onSaved) {
  const state = getState();
  const isEdit = !!existing;
  const form = el('form', { class: 'template-form' });

  const nameField = fieldInput('სახელი', 'text', existing?.name || '');
  const categorySelect = el('select', {}, state.categories.map(c => el('option', { value: c.id, text: c.name })));
  if (existing) categorySelect.value = existing.categoryId;

  const typeSelect = el('select', {}, [
    el('option', { value: 'fixed', text: 'ფიქსირებული' }),
    el('option', { value: 'variable', text: 'ცვლადი' })
  ]);
  typeSelect.value = existing?.type || 'fixed';

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

  form.append(
    labeledField('სახელი', nameField),
    labeledField('კატეგორია', categorySelect),
    labeledField('ტიპი', typeSelect),
    labeledField('თანხა', amountInput),
    labeledField('ვალუტა', currencySelect),
    eurPreview,
    labeledField('ციკლი', cycleSelect),
    labeledField('პირველი გადახდა', dateInput),
    labeledField('ვისი ხარჯია', ownerSelect)
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

    updateState(draft => {
      if (isEdit) {
        const t = draft.templates.find(x => x.id === existing.id);
        Object.assign(t, {
          name, categoryId: categorySelect.value, type: typeSelect.value,
          amount, currency: currencySelect.value, cycleMonths,
          firstDueDate: dateInput.value, owner: ownerSelect.value, oneTime
        });
      } else {
        draft.templates.push({
          id: uid('tpl'), name, categoryId: categorySelect.value, type: typeSelect.value,
          amount, currency: currencySelect.value, cycleMonths,
          firstDueDate: dateInput.value, owner: ownerSelect.value, active: true, oneTime
        });
      }
      return draft;
    });
    toast('შენახულია ✓');
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
