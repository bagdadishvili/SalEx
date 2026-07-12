// exporter.js — JSON export/import and CSV export (UTF-8 with BOM) per master-prompt §5.5.

import { getState, replaceState, updateState } from './state.js';
import { txnAmountEur } from './calc.js';

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
