// exporter.js — JSON export/import and CSV export (UTF-8 with BOM) per master-prompt §5.5.

import { getState, replaceState, updateState, ensureMonth } from './state.js';
import { txnAmountEur } from './calc.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson() {
  const state = getState();
  const json = JSON.stringify(state, null, 2);
  downloadBlob(json, `family-budget-backup-${todayISO()}.json`, 'application/json');
  updateState(draft => { draft.settings.lastBackupAt = new Date().toISOString(); return draft; });
}

/** Reads a File object (from <input type=file>), validates, and replaces state. Returns a Promise. */
export function importJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (typeof parsed.version !== 'number') {
          reject(new Error('არასწორი ფაილის ფორმატი — „version“ ველი ვერ მოიძებნა.'));
          return;
        }
        replaceState(parsed);
        resolve(parsed);
      } catch (e) {
        reject(new Error('ფაილის წაკითხვა ვერ მოხერხდა — დარწმუნდით, რომ ეს სწორი JSON ბექაფია.'));
      }
    };
    reader.onerror = () => reject(new Error('ფაილის წაკითხვის შეცდომა.'));
    reader.readAsText(file, 'UTF-8');
  });
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCsv() {
  const state = getState();
  const { categories, settings, months } = state;
  const bucketNameOf = (id) => {
    const cat = categories.find(c => c.id === id);
    if (!cat) return '';
    if (cat.bucketId === 'free') return 'თავისუფალი ხარჯვა';
    return settings.buckets.find(b => b.id === cat.bucketId)?.name || '';
  };
  const nameOf = (id) => categories.find(c => c.id === id)?.name || '';
  const georgiaOf = (id) => (categories.find(c => c.id === id)?.georgiaTransfer ? 'yes' : 'no');

  const headers = ['month', 'name', 'category', 'bucket', 'georgia_transfer', 'owner', 'currency', 'amount_planned', 'amount_actual', 'amount_eur', 'rate_used', 'paid', 'paid_at', 'due_date', 'note'];
  const rows = [headers.join(',')];

  Object.keys(months).sort().forEach(monthKey => {
    const month = months[monthKey];
    month.transactions.forEach(t => {
      const amountEur = txnAmountEur(t, month.exchangeRate);
      const rateUsed = t.currency === 'GEL' ? (t.paid && t.rateAtPayment ? t.rateAtPayment : month.exchangeRate) : '';
      const row = [
        monthKey,
        t.name,
        nameOf(t.categoryId),
        bucketNameOf(t.categoryId),
        georgiaOf(t.categoryId),
        t.owner,
        t.currency,
        t.amountPlanned,
        t.amountActual ?? '',
        amountEur.toFixed(2),
        rateUsed,
        t.paid ? 'yes' : 'no',
        t.paidAt || '',
        t.dueDate || '',
        t.note || ''
      ].map(csvEscape).join(',');
      rows.push(row);
    });
  });

  const csv = rows.join('\r\n');
  const BOM = '﻿';
  downloadBlob(BOM + csv, `family-budget-transactions-${todayISO()}.csv`, 'text/csv;charset=utf-8');
}

// ---- CSV import (accepts the CSV this app exports) ----

function parseCsvText(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/**
 * Imports transactions from a CSV previously exported by this app.
 * ADDS transactions to their months (skips exact duplicates), never deletes anything.
 * Unknown category names are created automatically (in the free-spending bucket).
 * Resolves to { added, skipped }.
 */
export function importCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let text = String(reader.result);
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const rows = parseCsvText(text);
        if (rows.length < 2) throw new Error('ფაილში ჩანაწერები ვერ მოიძებნა.');

        const header = rows[0].map(h => h.trim());
        const col = (name) => header.indexOf(name);
        const iMonth = col('month'), iName = col('name'), iPlanned = col('amount_planned');
        if (iMonth < 0 || iName < 0 || iPlanned < 0) {
          throw new Error('ფორმატი ვერ ამოიცნო — გამოიყენეთ ამ აპლიკაციიდან ექსპორტირებული CSV.');
        }
        const iCat = col('category'), iGeo = col('georgia_transfer'), iOwner = col('owner'),
          iCur = col('currency'), iActual = col('amount_actual'), iRate = col('rate_used'),
          iPaid = col('paid'), iPaidAt = col('paid_at'), iDue = col('due_date'), iNote = col('note');
        const get = (r, i) => (i >= 0 && r[i] !== undefined ? String(r[i]).trim() : '');

        let added = 0, skipped = 0;
        updateState(draft => {
          rows.slice(1).forEach(r => {
            const monthK = get(r, iMonth);
            const name = get(r, iName);
            const amountPlanned = Number(get(r, iPlanned).replace(',', '.')) || 0;
            if (!/^\d{4}-\d{2}$/.test(monthK) || !name) { skipped++; return; }

            const m = ensureMonth(draft, monthK);
            const dueDate = get(r, iDue) || null;
            if (m.transactions.some(t =>
              t.name === name && Math.abs(t.amountPlanned - amountPlanned) < 0.005 && (t.dueDate || '') === (dueDate || '')
            )) { skipped++; return; }

            const catName = get(r, iCat);
            let cat = draft.categories.find(c => c.name === catName);
            if (!cat && catName) {
              cat = { id: uid('cat'), name: catName, bucketId: 'free', georgiaTransfer: get(r, iGeo) === 'yes' };
              draft.categories.push(cat);
            }

            const currency = get(r, iCur).toUpperCase() === 'GEL' ? 'GEL' : 'EUR';
            const paid = get(r, iPaid) === 'yes';
            const actualRaw = get(r, iActual).replace(',', '.');
            const rateRaw = get(r, iRate).replace(',', '.');

            m.transactions.push({
              id: uid('txn'), templateId: null, name,
              categoryId: cat ? cat.id : (draft.categories[0]?.id || null),
              owner: ['giorgi', 'nino', 'shared'].includes(get(r, iOwner)) ? get(r, iOwner) : 'shared',
              currency, amountPlanned,
              amountActual: actualRaw !== '' ? Number(actualRaw) : (paid ? amountPlanned : null),
              paid,
              paidAt: paid ? (get(r, iPaidAt) || null) : null,
              rateAtPayment: paid && currency === 'GEL' && rateRaw !== '' ? Number(rateRaw) : null,
              dueDate, note: get(r, iNote)
            });
            added++;
          });
          return draft;
        });
        resolve({ added, skipped });
      } catch (e) {
        reject(e instanceof Error ? e : new Error('CSV-ის წაკითხვა ვერ მოხერხდა.'));
      }
    };
    reader.onerror = () => reject(new Error('ფაილის წაკითხვის შეცდომა.'));
    reader.readAsText(file, 'UTF-8');
  });
}
