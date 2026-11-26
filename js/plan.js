// plan.js — changing plan targets per month (v18).
// Before v18 a category's target (% or €) was one global value, so lowering December's savings
// also rewrote November. Now every change says FROM which month it applies:
//   scope 'forward' (default): the chosen month and every later month + the default for new months;
//   scope 'only': just the chosen month.
// Months before the chosen one keep the value they had (it is frozen into month.plan first).

import { planCfg } from './calc.js';

function refGet(draftOrState, ref) {
  if (ref.free) return (draftOrState.settings.planFree || {})[ref.free] || {};
  return draftOrState.categories.find(c => c.id === ref.cat) || {};
}

function monthGet(m, ref) {
  const p = m.plan || {};
  return ref.free ? (p.free || {})[ref.free] : (p.cats || {})[ref.cat];
}

function monthSet(m, ref, cfg) {
  const p = m.plan ? JSON.parse(JSON.stringify(m.plan)) : {};
  const bag = ref.free ? (p.free = p.free || {}) : (p.cats = p.cats || {});
  bag[ref.free || ref.cat] = planCfg(cfg);
  m.plan = p;
}

/**
 * Sets a target (ref = {cat:id} or {free:'giorgi'|'nino'}; cfg = {targetType, percent?, amount?})
 * from month `fromKey` on. Mutates the draft (call inside updateState).
 */
export function setPlanTarget(draft, ref, cfg, fromKey, scope = 'forward') {
  const global = planCfg(refGet(draft, ref));
  const next = planCfg({ ...global, ...cfg });
  Object.keys(draft.months || {}).forEach(k => {
    const m = draft.months[k];
    if (k < fromKey) {
      if (!monthGet(m, ref)) monthSet(m, ref, global); // keep what that month had
    } else if (k === fromKey || scope === 'forward') {
      monthSet(m, ref, next);
    } else if (!monthGet(m, ref)) {
      monthSet(m, ref, global); // 'only': later months keep the old value
    }
  });
  if (scope === 'forward') {
    const target = refGet(draft, ref);
    Object.assign(target, next);
  }
}

/** The plan config in force for one month (its own copy or the global one). */
export function planInMonth(state, ref, key) {
  const m = state.months[key];
  return { ...planCfg(refGet(state, ref)), ...(m && monthGet(m, ref) ? monthGet(m, ref) : {}) };
}

/** True if this month has its own copy of the target. */
export function monthHasOwnPlan(state, ref, key) {
  const m = state.months[key];
  return !!(m && monthGet(m, ref));
}
