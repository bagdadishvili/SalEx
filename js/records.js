// records.js — per-record change tracking + merge (lets two people edit on two phones
// without overwriting each other).
//
// Every template, category, transaction, month "head" (income, rate…) and the settings
// object carries `_u` = ISO time of its last change. Deletions leave a tombstone in
// `state.deleted[id] = time`. Merging two states keeps, per record, the newest version;
// a record disappears only if it was deleted AFTER its last change.

export const EPOCH = '1970-01-01T00:00:00.000Z';
const TOMBSTONE_TTL_DAYS = 400;

const strip = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const { _u, _uf, ...rest } = obj;
  return rest;
};
const same = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const byId = (list) => new Map((list || []).map(r => [r.id, r]));

function monthHead(m) {
  if (!m) return null;
  const { transactions, ...head } = m;
  return head;
}

const headFields = (h) => Object.keys(h || {}).filter(k => k !== '_u' && k !== '_uf');

/**
 * Month "head" (income, exchange rate, …) is stamped PER FIELD (`_uf`), so Nino changing
 * the income and Giorgi's phone refreshing the rate at the same time both survive.
 */
function stampHead(pm, m, now) {
  if (!m._uf || typeof m._uf !== 'object') m._uf = pm && pm._uf ? { ...pm._uf } : {};
  if (!pm) { if (!m._u) m._u = now; return; }
  let changed = false;
  new Set([...headFields(pm), ...headFields(m)]).forEach(k => {
    if (k === 'transactions') return;
    if (JSON.stringify(pm[k]) !== JSON.stringify(m[k])) { m._uf[k] = now; changed = true; }
  });
  m._u = changed ? now : (pm._u || m._u);
}

/** Settings as flat fields; each text is its own field (`texts.<key>`). */
function settingsFields(s) {
  const out = {};
  Object.keys(s || {}).forEach(k => {
    if (k === '_u' || k === '_uf') return;
    if (k === 'texts' && s.texts && typeof s.texts === 'object') Object.keys(s.texts).forEach(tk => { out[`texts.${tk}`] = s.texts[tk]; });
    else out[k] = s[k];
  });
  return out;
}

/**
 * Settings are stamped PER FIELD too (v16), every text separately: renaming a card on the
 * laptop survives a theme change or a backup made on the phone in the meantime.
 */
function stampSettings(ps, s, now) {
  if (!s) return;
  const base = (ps && ps._u) || s._u || EPOCH;
  s._uf = { ...((ps && ps._uf) || s._uf || {}) };
  if (!ps) { if (!s._u) s._u = now; return; }
  const a = settingsFields(ps), b = settingsFields(s);
  let changed = false;
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { s._uf[k] = now; changed = true; }
    else if (!s._uf[k]) s._uf[k] = base;
  });
  s._u = changed ? now : (ps._u || s._u);
}

function stampList(prevList, nextList, deleted, now) {
  const prevMap = byId(prevList);
  const nextIds = new Set();
  (nextList || []).forEach(r => {
    nextIds.add(r.id);
    const p = prevMap.get(r.id);
    if (!p) {
      if (!r._u) r._u = now;        // records created with a preset _u (e.g. generated) keep it
    } else if (!same(p, r)) {
      r._u = now;
    } else {
      r._u = p._u || r._u;
    }
    if (deleted[r.id] && r._u > deleted[r.id]) delete deleted[r.id];
  });
  prevMap.forEach((p, id) => { if (!nextIds.has(id)) deleted[id] = now; });
}

/** Called by updateState: stamps everything that changed between prev and next. */
export function stampChanges(prev, next, now = new Date().toISOString()) {
  if (!next.deleted || typeof next.deleted !== 'object') next.deleted = {};
  const deleted = next.deleted;
  stampList(prev.templates, next.templates, deleted, now);
  stampList(prev.categories, next.categories, deleted, now);
  stampSettings(prev.settings, next.settings, now);
  Object.entries(next.months || {}).forEach(([key, m]) => {
    const pm = prev.months && prev.months[key];
    stampHead(pm, m, now);
    stampList(pm ? pm.transactions : [], m.transactions, deleted, now);
  });
  // A whole month deleted by the user: tombstone the month and each of its transactions.
  Object.entries(prev.months || {}).forEach(([key, pm]) => {
    if (next.months && next.months[key]) return;
    deleted[`month:${key}`] = now;
    stampList(pm.transactions, [], deleted, now);
  });
  pruneTombstones(deleted, now);
  return next;
}

function pruneTombstones(deleted, now) {
  const limit = new Date(new Date(now).getTime() - TOMBSTONE_TTL_DAYS * 86400000).toISOString();
  Object.keys(deleted).forEach(id => { if (deleted[id] < limit) delete deleted[id]; });
}

/** Gives every record a fresh `_u` (used for import/restore so they beat old tombstones). */
export function restampAll(s, now = new Date().toISOString()) {
  (s.templates || []).forEach(r => { r._u = now; });
  (s.categories || []).forEach(r => { r._u = now; });
  if (s.settings) {
    s.settings._u = now;
    s.settings._uf = {};
    Object.keys(settingsFields(s.settings)).forEach(k => { s.settings._uf[k] = now; });
  }
  Object.values(s.months || {}).forEach(m => {
    m._u = now;
    m._uf = {};
    headFields(m).forEach(k => { if (k !== 'transactions') m._uf[k] = now; });
    (m.transactions || []).forEach(t => { t._u = now; });
  });
  s.deleted = {};
  return s;
}

/** Ensures every record has an `_u` (migration helper). */
export function fillMissingStamps(s, fallback) {
  const f = fallback || EPOCH;
  (s.templates || []).forEach(r => { if (!r._u) r._u = f; });
  (s.categories || []).forEach(r => { if (!r._u) r._u = f; });
  if (s.settings && !s.settings._u) s.settings._u = f;
  Object.values(s.months || {}).forEach(m => {
    if (!m._u) m._u = f;
    (m.transactions || []).forEach(t => { if (!t._u) t._u = f; });
  });
  if (!s.deleted || typeof s.deleted !== 'object') s.deleted = {};
  return s;
}

// ---------------- merge ----------------

function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ua = a._u || EPOCH, ub = b._u || EPOCH;
  if (ua !== ub) return ua > ub ? a : b;
  // Same timestamp: deterministic choice so both devices end up identical.
  return canonical(a) >= canonical(b) ? a : b;
}

function mergeList(la, lb, deleted) {
  const mb = byId(lb);
  const out = [];
  const seen = new Set();
  const consider = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const ra = (la || []).find(r => r.id === id);
    const r = pickNewer(ra, mb.get(id));
    const tomb = deleted[id];
    if (tomb && (r._u || EPOCH) <= tomb) return; // deleted after its last change
    out.push(r);
  };
  (la || []).forEach(r => consider(r.id));
  (lb || []).forEach(r => consider(r.id));
  return out;
}

function mergeHead(ha, hb) {
  if (!ha) return hb ? { ...hb } : {};
  if (!hb) return { ...ha };
  const out = { _uf: {} };
  new Set([...headFields(ha), ...headFields(hb)]).forEach(k => {
    const ta = (ha._uf && ha._uf[k]) || ha._u || EPOCH;
    const tb = (hb._uf && hb._uf[k]) || hb._u || EPOCH;
    let fromA;
    if (ta !== tb) fromA = ta > tb;
    else if (!(k in hb)) fromA = true;
    else if (!(k in ha)) fromA = false;
    else fromA = canonical(ha[k]) >= canonical(hb[k]);
    const src = fromA ? ha : hb;
    if (k in src) out[k] = src[k];
    out._uf[k] = fromA ? ta : tb;
  });
  out._u = (ha._u || EPOCH) >= (hb._u || EPOCH) ? ha._u : hb._u;
  return out;
}

/**
 * Per-field merge of the settings. A copy last written by an older app version (its `_u` is
 * newer than all its field stamps) counts as changed as a whole, like before v16.
 */
function mergeSettings(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (same(a, b)) return pickNewer(a, b);
  const stampOf = (s) => {
    const uf = s._uf && typeof s._uf === 'object' ? s._uf : {};
    const newest = Object.values(uf).reduce((m, v) => (v > m ? v : m), EPOCH);
    const legacy = (s._u || EPOCH) > newest;
    // a field this copy never had (and never deleted) has no stamp: the other side wins it
    return (k) => (legacy ? (s._u || EPOCH) : (uf[k] || EPOCH));
  };
  const ta = stampOf(a), tb = stampOf(b);
  const fa = settingsFields(a), fb = settingsFields(b);
  const out = { texts: {}, _uf: {} };
  new Set([...Object.keys(fa), ...Object.keys(fb)]).forEach(k => {
    const xa = ta(k), xb = tb(k);
    let fromA;
    if (xa !== xb) fromA = xa > xb;
    else if (!(k in fb)) fromA = true;
    else if (!(k in fa)) fromA = false;
    else fromA = canonical(fa[k]) >= canonical(fb[k]);
    const v = fromA ? fa[k] : fb[k];
    out._uf[k] = fromA ? xa : xb;
    if (v === undefined) return;
    if (k.startsWith('texts.')) out.texts[k.slice(6)] = v;
    else out[k] = v;
  });
  out._u = (a._u || EPOCH) >= (b._u || EPOCH) ? a._u : b._u;
  return out;
}

/** Two devices may generate the same template's transaction for a month — keep one. */
function dedupeGenerated(txns) {
  const groups = new Map();
  txns.forEach(t => {
    if (!t.templateId) return;
    if (!groups.has(t.templateId)) groups.set(t.templateId, []);
    groups.get(t.templateId).push(t);
  });
  const drop = new Set();
  groups.forEach(list => {
    if (list.length < 2) return;
    const score = (t) => [t.paid ? 1 : 0, (t.spends || []).length, t._u || EPOCH, t.id];
    list.sort((x, y) => {
      const a = score(x), b = score(y);
      for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] > b[i] ? -1 : 1; }
      return 0;
    });
    list.slice(1).forEach(t => drop.add(t.id));
  });
  return txns.filter(t => !drop.has(t.id));
}

/**
 * Record-level merge of two full states. Pure: returns a new object.
 * List order follows `a` (then records only in `b`) — sync passes the CLOUD copy as `a`,
 * so the cloud order is the single source of order and devices never ping-pong.
 */
export function mergeStates(a, b) {
  const A = JSON.parse(JSON.stringify(a));
  const B = JSON.parse(JSON.stringify(b));
  const deleted = { ...(A.deleted || {}) };
  Object.entries(B.deleted || {}).forEach(([id, t]) => { if (!deleted[id] || t > deleted[id]) deleted[id] = t; });

  const months = {};
  const keys = new Set([...Object.keys(A.months || {}), ...Object.keys(B.months || {})]);
  [...keys].sort().forEach(k => {
    const ma = A.months && A.months[k];
    const mb = B.months && B.months[k];
    const tomb = deleted[`month:${k}`];
    const alive = (m) => m && (!tomb || (m._u || EPOCH) > tomb);
    const ha = alive(ma) ? monthHead(ma) : null;
    const hb = alive(mb) ? monthHead(mb) : null;
    const txns = dedupeGenerated(mergeList(ma ? ma.transactions : [], mb ? mb.transactions : [], deleted));
    if (tomb && !ha && !hb && !txns.length) return; // month deleted on one of the devices
    const headSrc = (ha || hb) ? mergeHead(ha, hb)
      : { exchangeRate: 3, income: { giorgi: 0, nino: 0 }, plannedSavings: null, generatedFromTemplates: false, skipTemplates: [], _u: EPOCH, _uf: {} };
    months[k] = { ...headSrc, transactions: txns };
    if (tomb && (ha || hb)) delete deleted[`month:${k}`]; // re-opened after the deletion: forget the tombstone
  });

  const newerState = (A.updatedAt || EPOCH) >= (B.updatedAt || EPOCH) ? A : B;
  return {
    ...newerState,
    version: Math.max(A.version || 0, B.version || 0),
    updatedAt: (A.updatedAt || EPOCH) >= (B.updatedAt || EPOCH) ? A.updatedAt : B.updatedAt,
    settings: mergeSettings(A.settings, B.settings),
    categories: mergeList(A.categories, B.categories, deleted),
    templates: mergeList(A.templates, B.templates, deleted),
    months,
    deleted
  };
}

/** Stable JSON (sorted object keys) for "are these equal?" checks. */
export function canonical(value) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) out[k] = norm(v[k]); });
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}
