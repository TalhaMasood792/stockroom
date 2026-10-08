// Shared UI helpers: icons, badges, toasts, dialogs, permission-aware buttons,
// sortable headers, pagination and file download.
import { esc, formatMoney, formatDateTime, formatQty } from './format.js';
import { can, denyReason, ROLE_LABELS } from './permissions.js';
import { STOCK_STATUS_LABELS } from './ledger.js';
import * as store from './store.js';

const P = {
  overview: '<path d="M3 21V10l9-6 9 6v11"/><path d="M7 21v-7h10v7M7 17h10"/>',
  products: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  transfers: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  pos: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  suppliers: '<path d="M2 17V7h11v10M13 10h4l4 4v3h-8"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  audit: '<path d="M9 4h6v3H9z"/><path d="M15 5h3v16H6V5h3"/><path d="M9 12h6M9 16h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/>',
  print: '<path d="M7 9V3h10v6M7 18H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  adjust: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  truck: '<path d="M2 17V7h11v10M13 10h4l4 4v3h-8"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  arrowLeft: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

export function stockBadge(status) {
  return `<span class="badge st-${status}"><span class="dot" aria-hidden="true"></span>${STOCK_STATUS_LABELS[status]}</span>`;
}
export function poBadge(status) {
  return `<span class="badge po-${status}">${esc(store.PO_STATUS_LABELS[status])}</span>`;
}
export function qty(n, cls = '') {
  return `<span class="mono qty ${cls} ${n < 0 ? 'neg' : ''}">${n < 0 ? '−' + formatQty(-n) : formatQty(n)}</span>`;
}
export function money(cents) {
  return `<span class="mono">${esc(formatMoney(cents))}</span>`;
}
export function skuLink(sku) {
  return `<a class="sku" href="#/products/${encodeURIComponent(sku)}">${esc(sku)}</a>`;
}

/** Button that respects permissions: disabled-but-focusable with a reason when not allowed. */
export function permButton(perm, { label, cls = 'btn', action = '', attrs = '', iconName = '', allowed = null, reason = '' }) {
  const user = store.getCurrentUser();
  const ok = allowed ?? can(user, perm);
  const ic = iconName ? icon(iconName) : '';
  if (ok) return `<button type="button" class="${cls}" ${action ? `data-action="${action}"` : ''} ${attrs}>${ic}<span>${esc(label)}</span></button>`;
  const why = reason || denyReason(user, perm);
  const id = `why-${Math.random().toString(36).slice(2, 8)}`;
  return `<button type="button" class="${cls}" aria-disabled="true" data-denied="${esc(why)}" title="${esc(why)}" aria-describedby="${id}">${icon('lock')}<span>${esc(label)}</span></button><span id="${id}" class="sr-only">${esc(why)}</span>`;
}

export function denyReasonText(perm) {
  return denyReason(store.getCurrentUser(), perm);
}

// ---------- toasts ----------
export function toast(message, { error = false, timeout = 6000 } = {}) {
  const host = document.getElementById(error ? 'toasts-alert' : 'toasts');
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' is-error' : '');
  el.innerHTML = `<span>${esc(message)}</span><button type="button" class="t-close" aria-label="Dismiss notification">${icon('x')}</button>`;
  const close = () => el.remove();
  el.querySelector('.t-close').addEventListener('click', close);
  stack.appendChild(el);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  // Announce through a dedicated live region so screen readers read it once.
  if (host) {
    host.textContent = '';
    setTimeout(() => (host.textContent = message), 30);
  }
  setTimeout(close, timeout);
}

export function errorMessage(e) {
  if (e instanceof store.ValidationError) return Object.values(e.errors)[0] || e.message;
  return e?.message || 'Something went wrong. Reload the page and try again.';
}

// ---------- dialogs ----------
/**
 * Modal <dialog>. `body` is HTML; `onSubmit(form)` may throw ValidationError
 * to show field errors. Resolves with the submit result, or null if cancelled.
 */
export function openDialog({ title, body, submitLabel, submitClass = 'btn btn-primary', cancelLabel = 'Cancel', wide = false, onSubmit, onOpen, hideSubmit = false }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const dlg = document.createElement('dialog');
    if (wide) dlg.classList.add('wide');
    const tid = 'dlg-' + Math.random().toString(36).slice(2, 8);
    dlg.setAttribute('aria-labelledby', tid);
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-head"><h2 id="${tid}">${esc(title)}</h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close dialog">${icon('x')}</button></div>
      <div class="dlg-body"><p class="err form-error" role="alert" hidden></p>${body}</div>
      <div class="dlg-foot"><button type="button" class="btn" data-close>${esc(cancelLabel)}</button>${hideSubmit ? '' : `<button type="submit" class="${submitClass}">${esc(submitLabel)}</button>`}</div>
    </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    let result = null;
    const finish = () => dlg.close();
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
      resolve(result);
    });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', finish));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      clearErrors(form);
      try {
        result = onSubmit ? onSubmit(form) : true;
        if (result === false) {
          result = null;
          return;
        }
        finish();
      } catch (e) {
        result = null;
        if (e instanceof store.ValidationError) showErrors(form, e.errors);
        else showFormError(form, errorMessage(e));
      }
    });
    dlg.showModal();
    onOpen?.(dlg);
    const first = dlg.querySelector('[autofocus]') || dlg.querySelector('.dlg-body input:not([type=hidden]), .dlg-body select, .dlg-body textarea') || dlg.querySelector('button[type="submit"]');
    first?.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel, danger = false, extraBody = '', onConfirm }) {
  return openDialog({
    title,
    body: `<p class="lead">${message}</p>${extraBody}`,
    submitLabel: confirmLabel,
    submitClass: danger ? 'btn btn-danger' : 'btn btn-primary',
    onSubmit: onConfirm || (() => true),
  });
}

export function showFormError(root, msg) {
  const box = root.querySelector('.form-error');
  if (box) {
    box.textContent = msg;
    box.hidden = false;
  }
}
export function clearErrors(root) {
  root.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  root.querySelectorAll('.err[data-for]').forEach((el) => (el.textContent = ''));
  root.querySelectorAll('.form-error').forEach((el) => {
    el.textContent = '';
    el.hidden = true;
  });
}
/** Show field errors keyed by input name; focus the first invalid field in DOM order. */
export function showErrors(root, errors) {
  for (const [k, msg] of Object.entries(errors)) {
    const input = root.querySelector(`[name="${CSS.escape(k)}"]`);
    const slot = root.querySelector(`.err[data-for="${CSS.escape(k)}"]`);
    if (slot) slot.textContent = msg;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (slot?.id) input.setAttribute('aria-describedby', [input.dataset.hint, slot.id].filter(Boolean).join(' '));
    }
    if (!slot && !input) showFormError(root, msg);
  }
  const first = root.querySelector('[aria-invalid="true"]');
  if (first) first.focus();
  else root.querySelector('.form-error:not([hidden])')?.scrollIntoView?.({ block: 'nearest' });
}
let errSeq = 0;
export function errSlot(name) {
  const id = 'err-' + name.replace(/[^a-z0-9]/gi, '-') + '-' + ++errSeq;
  return `<p class="err" data-for="${esc(name)}" id="${id}"></p>`;
}

// ---------- tables ----------
export function sortHeader(k, label, sort, { num = false, cls = '' } = {}) {
  const active = sort.key === k;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
  return `<th scope="col" class="${num ? 'num' : ''} ${cls}" aria-sort="${ariaSort}"><button type="button" class="sort-btn" data-sort="${k}">${esc(label)}<span class="arrow" aria-hidden="true">${arrow}</span></button></th>`;
}
export function pager({ page, pageSize, total, label }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  let btns = '';
  for (let p = 1; p <= pages; p++) {
    if (pages > 7 && p !== 1 && p !== pages && Math.abs(p - page) > 1) {
      if (p === 2 || p === pages - 1) btns += '<span class="gap" aria-hidden="true">…</span>';
      continue;
    }
    btns += `<button type="button" class="btn btn-sm pg" data-page="${p}" ${p === page ? 'aria-current="page"' : ''} aria-label="Page ${p}">${p}</button>`;
  }
  return `<nav class="pager" aria-label="Pagination">
    <span class="pager-info">Showing <span class="mono">${from}–${to}</span> of <span class="mono">${total}</span> ${esc(label)}</span>
    <div class="pages">
      <button type="button" class="btn btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      ${btns}
      <button type="button" class="btn btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
    </div></nav>`;
}

export function downloadFile(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- audit rendering ----------
const STATUS_WORDS = store.PO_STATUS_LABELS;
function renderValue(v) {
  if (typeof v === 'string' && STATUS_WORDS[v]) return esc(STATUS_WORDS[v]);
  if (typeof v === 'number') return `<span class="mono">${esc(formatQty(v))}</span>`;
  return esc(v);
}
export function renderChanges(changes) {
  return (changes || [])
    .map((c) => {
      if (c.from === '' || c.from == null) return `<span class="change">${esc(c.field)}: ${renderValue(c.to)}</span>`;
      return `<span class="change">${esc(c.field)}: <span class="from">${renderValue(c.from)}</span> <span class="arrow" aria-label="changed to">→</span> ${renderValue(c.to)}</span>`;
    })
    .join('');
}
export function renderTimeline(entries, empty = 'No activity yet.') {
  if (!entries.length) return `<p class="empty-inline">${esc(empty)}</p>`;
  return `<ol class="timeline">${[...entries]
    .reverse()
    .map((a) => `<li><div class="t-what">${esc(store.ACTION_LABELS[a.action] || a.action)}</div>
        <div class="t-meta">${esc(a.who)} · ${esc(ROLE_LABELS[a.role])} · <time datetime="${esc(a.at)}">${esc(formatDateTime(a.at))}</time></div>
        ${a.changes?.length ? `<div class="t-change">${renderChanges(a.changes)}</div>` : ''}
        ${a.note ? `<div class="t-note">${esc(a.note)}</div>` : ''}</li>`)
    .join('')}</ol>`;
}

export function setTitle(t) {
  document.title = t ? `${t} · Stockroom` : 'Stockroom';
}

export function emptyState(title, body, action = '') {
  return `<div class="empty"><div class="empty-ic">${icon('inbox')}</div><p class="empty-title">${esc(title)}</p><p>${body}</p>${action}</div>`;
}

/** Debounce for search inputs. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Shared “select a product” control: a datalist-backed text input that resolves to a SKU. */
export function productPicker({ name = 'sku', id, value = '', required = true, label = 'Product', hint = 'Type a SKU or part of the name.' }) {
  const listId = `${id}-list`;
  const products = store.getProducts();
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <input class="input mono-input" id="${id}" name="${name}" list="${listId}" value="${esc(value)}" autocomplete="off" ${required ? 'required' : ''} aria-describedby="${id}-hint" data-hint="${id}-hint" placeholder="e.g. NET-SWT-0014">
    <datalist id="${listId}">${products.map((p) => `<option value="${esc(p.sku)}">${esc(p.name)}</option>`).join('')}</datalist>
    <p class="hint" id="${id}-hint">${esc(hint)}</p>
    ${errSlot(name)}
  </div>`;
}
/** Resolve typed picker text to a SKU (exact SKU, or a unique name match). */
export function resolveSku(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const up = t.toUpperCase();
  const products = store.getProducts();
  if (products.some((p) => p.sku === up)) return up;
  const lower = t.toLowerCase();
  const matches = products.filter((p) => p.name.toLowerCase().includes(lower));
  return matches.length === 1 ? matches[0].sku : up;
}
