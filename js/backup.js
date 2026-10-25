// backup.js — local "restore points" (automatic snapshots) stored in IndexedDB.
// Separate from localStorage on purpose: bigger quota, and a bad sync/import can
// never overwrite these. NOTE: clearing the browser's site data deletes them too —
// that's why the cloud history (Gist) and JSON exports still matter.

const DB_NAME = 'familyBudget.backups';
const STORE = 'snapshots';
const MAX_SNAPSHOTS = 40;

export const SNAPSHOT_REASONS = {
  daily: 'ავტომატური (დღიური)',
  'before-sync': 'სინქრონიზაციამდე',
  'before-import': 'იმპორტამდე',
  'before-wipe': 'წაშლამდე',
  'before-restore': 'აღდგენამდე',
  'before-update': 'აპის განახლებამდე',
  manual: 'ხელით შექმნილი'
};

/** Small, comparable description of how much real data a state holds. */
export function summarizeState(s) {
  const months = s && s.months && typeof s.months === 'object' ? s.months : {};
  let transactions = 0, paid = 0, monthsWithData = 0;
  Object.values(months).forEach(m => {
    const txns = Array.isArray(m.transactions) ? m.transactions : [];
    transactions += txns.length;
    paid += txns.filter(t => t.paid).length;
    const income = (m.income?.giorgi || 0) + (m.income?.nino || 0);
    if (txns.length || income > 0) monthsWithData += 1;
  });
  return {
    templates: Array.isArray(s?.templates) ? s.templates.length : 0,
    transactions,
    paid,
    months: monthsWithData,
    updatedAt: s?.updatedAt || null
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function allRecords(db) {
  const tx = db.transaction(STORE, 'readonly');
  return reqToPromise(tx.objectStore(STORE).getAll());
}

/**
 * Saves a snapshot of `stateObj` (pass a clone if the caller keeps mutating it).
 * Skips if the newest snapshot holds identical data. Resolves true if saved.
 */
export async function saveSnapshot(stateObj, reason = 'manual') {
  try {
    const data = JSON.stringify(stateObj);
    const db = await openDb();
    const records = await allRecords(db);
    records.sort((a, b) => b.id - a.id);
    if (records[0] && records[0].data === data) return false;

    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.add({ createdAt: new Date().toISOString(), reason, summary: summarizeState(stateObj), data });
    // Keep the newest MAX_SNAPSHOTS.
    records.slice(MAX_SNAPSHOTS - 1).forEach(r => store.delete(r.id));
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    return true;
  } catch (e) {
    console.warn('[backup] snapshot failed', e);
    return false;
  }
}

/** Newest first, without the (large) data payload. */
export async function listSnapshots() {
  try {
    const db = await openDb();
    const records = await allRecords(db);
    return records
      .sort((a, b) => b.id - a.id)
      .map(({ id, createdAt, reason, summary }) => ({ id, createdAt, reason, summary }));
  } catch (e) {
    console.warn('[backup] list failed', e);
    return [];
  }
}

export async function getSnapshotData(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const rec = await reqToPromise(tx.objectStore(STORE).get(id));
  if (!rec) throw new Error('ასლი ვერ მოიძებნა');
  return JSON.parse(rec.data);
}

/** Saves a snapshot only if none was made in the last `hours` hours. */
export async function saveSnapshotIfDue(stateObj, reason = 'daily', hours = 20) {
  const list = await listSnapshots();
  const last = list[0];
  if (last && (Date.now() - new Date(last.createdAt).getTime()) < hours * 3600000) return false;
  return saveSnapshot(stateObj, reason);
}
