// ui.js — shared small UI helpers: toast, confirm dialog, generic modal.

export function toast(message, variant = 'ok') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const div = document.createElement('div');
  div.className = `toast toast--${variant}`;
  div.textContent = message;
  root.appendChild(div);
  requestAnimationFrame(() => div.classList.add('toast--visible'));
  setTimeout(() => {
    div.classList.remove('toast--visible');
    setTimeout(() => div.remove(), 250);
  }, 2200);
}

export function savedToast() {
  toast('შენახულია ✓', 'ok');
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
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
    if (onClose) onClose();
  }

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
