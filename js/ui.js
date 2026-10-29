// ui.js — shared small UI helpers: toast, confirm dialog, generic modal.

export function toast(message, variant = 'ok', { actionLabel = null, onAction = null, duration = 2200 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const div = document.createElement('div');
  div.className = `toast toast--${variant}`;
  const text = document.createElement('span');
  text.textContent = message;
  div.appendChild(text);
  let timer = null;
  const hide = () => {
    clearTimeout(timer);
    div.classList.remove('toast--visible');
    setTimeout(() => div.remove(), 250);
  };
  if (actionLabel && onAction) {
    div.classList.add('toast--action');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { hide(); onAction(); });
    div.appendChild(btn);
  }
  root.appendChild(div);
  requestAnimationFrame(() => div.classList.add('toast--visible'));
  timer = setTimeout(hide, actionLabel ? Math.max(duration, 6000) : duration);
}

/** "Deleted — ↩ undo" toast. */
export function undoToast(message, onUndo) {
  toast(message, 'ok', { actionLabel: '↩ დაბრუნება', onAction: onUndo, duration: 7000 });
}

export function savedToast() {
  toast('შენახულია ✓', 'ok');
}

// ---- Phone "back" closes the open dialog (not the page behind it) ----
// Each dialog adds a history entry; "back" pops it and closes the top dialog. A dialog closed
// by its own buttons removes its entry again (history.back), so no "empty" back press is left.
const openDialogs = [];
let skipPops = 0;
let afterPop = [];

function flushAfterPop() {
  const fns = afterPop; afterPop = [];
  fns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (skipPops > 0) { skipPops--; if (!skipPops) flushAfterPop(); return; }
    const top = openDialogs[openDialogs.length - 1];
    if (top) top(true);
  });
}

/** Runs fn once a pending dialog "back" has finished (so a page change is not undone by it). */
export function whenHistorySettled(fn) {
  if (!skipPops) { fn(); return; }
  afterPop.push(fn);
  setTimeout(() => { if (skipPops) { skipPops = 0; flushAfterPop(); } }, 400);
}

/** Renders a modal with custom body content (HTMLElement) and returns a close() function. */
export function openModal(bodyEl, { title = '', onClose } = {}) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  if (title) {
    const h = document.createElement('h2');
    h.className = 'modal__title';
    h.textContent = title;
    modal.appendChild(h);
  }
  modal.appendChild(bodyEl);
  overlay.appendChild(modal);
  root.appendChild(overlay);

  let closed = false;
  let pushed = false;
  try { history.pushState({ fbDialog: true }, ''); pushed = true; } catch { /* no history API */ }
  function close(fromBack = false) {
    if (closed) return;
    closed = true;
    const i = openDialogs.indexOf(close);
    if (i >= 0) openDialogs.splice(i, 1);
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
    if (fromBack !== true && pushed && history.state && history.state.fbDialog) { skipPops++; history.back(); }
    if (onClose) onClose();
  }
  openDialogs.push(close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  function escHandler(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', escHandler);

  return { close, modal };
}

/** Simple confirm dialog in Georgian. Returns a Promise<boolean>. */
export function confirmDialog(message, { confirmLabel = 'დიახ', cancelLabel = 'გაუქმება', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'confirm-dialog';
    const p = document.createElement('p');
    p.textContent = message;
    body.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'confirm-dialog__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn--secondary';
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = danger ? 'btn btn--danger' : 'btn btn--primary';
    confirmBtn.textContent = confirmLabel;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    body.appendChild(actions);

    const { close } = openModal(body, { onClose: () => resolve(false) });

    cancelBtn.addEventListener('click', () => { resolve(false); close(); });
    confirmBtn.addEventListener('click', () => { resolve(true); close(); });
  });
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
