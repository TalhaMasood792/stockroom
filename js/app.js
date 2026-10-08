// App shell + hash router. Each view exports `render(root, params)` which draws
// into `root` and may return { onStoreChange(), destroy() }.
import * as store from './store.js';
import { ROLE_LABELS } from './permissions.js';
import { icon, toast, confirmDialog } from './ui.js';
import { formatDate } from './format.js';
import * as overview from './views/overview.js';
import * as products from './views/products.js';
import * as productDetail from './views/product-detail.js';
import * as transfers from './views/transfers.js';
import * as poList from './views/purchase-orders.js';
import * as poDetail from './views/po-detail.js';
import * as poEditor from './views/po-editor.js';
import * as suppliers from './views/suppliers.js';
import * as auditView from './views/audit.js';
import * as notFound from './views/not-found.js';

const ROUTES = [
  { re: /^\/?$/, redirect: '/overview' },
  { re: /^\/overview$/, view: overview, nav: 'overview' },
  { re: /^\/products$/, view: products, nav: 'products' },
  { re: /^\/products\/([^/]+)$/, view: productDetail, nav: 'products', params: (m) => ({ sku: decodeURIComponent(m[1]) }) },
  { re: /^\/transfers$/, view: transfers, nav: 'transfers' },
  { re: /^\/purchase-orders$/, view: poList, nav: 'pos' },
  { re: /^\/purchase-orders\/new$/, view: poEditor, nav: 'pos', params: () => ({ mode: 'new' }) },
  { re: /^\/purchase-orders\/([^/]+)\/edit$/, view: poEditor, nav: 'pos', params: (m) => ({ mode: 'edit', id: decodeURIComponent(m[1]) }) },
  { re: /^\/purchase-orders\/([^/]+)$/, view: poDetail, nav: 'pos', params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { re: /^\/suppliers$/, view: suppliers, nav: 'suppliers' },
  { re: /^\/audit$/, view: auditView, nav: 'audit' },
];

const NAV = [
  { id: 'overview', label: 'Overview', href: '#/overview', ic: 'overview' },
  { id: 'products', label: 'Products', href: '#/products', ic: 'products' },
  { id: 'transfers', label: 'Transfers', href: '#/transfers', ic: 'transfers' },
  { id: 'pos', label: 'Purchase orders', href: '#/purchase-orders', ic: 'pos' },
  { id: 'suppliers', label: 'Suppliers', href: '#/suppliers', ic: 'suppliers' },
  { id: 'audit', label: 'Audit log', href: '#/audit', ic: 'audit' },
];

let current = null;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: new URLSearchParams(query) };
}

function navHTML(active) {
  const k = store.getKpis();
  const counts = { pos: k.awaitingApproval, products: k.outOfStock };
  const countLabel = { pos: 'awaiting approval', products: 'out of stock' };
  return NAV.map((n) => {
    const c = counts[n.id];
    return `<a href="${n.href}" ${n.id === active ? 'aria-current="page"' : ''}>${icon(n.ic)}<span>${n.label}</span>${c ? `<span class="nav-count" title="${c} ${countLabel[n.id]}"><span class="sr-only">, ${c} ${countLabel[n.id]}</span><span aria-hidden="true">${c}</span></span>` : ''}</a>`;
  }).join('');
}
function renderNav(active) {
  document.getElementById('side-nav').innerHTML = navHTML(active);
  document.getElementById('mobile-nav').innerHTML = navHTML(active) + '<div class="mobile-nav-foot"><p>Demo data is stored in your browser.</p><button type="button" class="linklike" data-action="reset-demo">Reset demo data</button></div>';
}

function renderUser() {
  const u = store.getCurrentUser();
  const sel = document.getElementById('user-select');
  sel.innerHTML = store.getUsers().map((x) => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${x.name} · ${ROLE_LABELS[x.role]}</option>`).join('');
  const av = document.getElementById('user-avatar');
  av.textContent = u.initials;
  av.dataset.role = u.role;
}

function setMobileNav(open) {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('nav-toggle');
  nav.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

function route() {
  const { path, query } = parseHash();
  let match = null;
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      match = { r, m };
      break;
    }
  }
  if (match?.r.redirect) {
    history.replaceState(null, '', '#' + match.r.redirect);
    return route();
  }
  current?.handle?.destroy?.();
  setMobileNav(false);
  const main = document.getElementById('main');
  const root = document.createElement('div');
  root.className = 'view';
  main.replaceChildren(root);
  const view = match ? match.r.view : notFound;
  const params = match?.r.params ? match.r.params(match.m) : {};
  params.query = query;
  params.path = path;
  const samePage = current?.path === path;
  renderNav(match?.r.nav);
  let handle;
  try {
    handle = view.render(root, params) || {};
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="nf"><h1>This page couldn’t load</h1><p>${String(e.message || e)}</p><a class="btn btn-primary" href="#/overview">Go to overview</a></div>`;
    handle = {};
  }
  current = { path, handle, nav: match?.r.nav };
  if (!samePage) {
    window.scrollTo(0, 0);
    const h1 = root.querySelector('h1');
    if (h1 && !root.querySelector('[autofocus]')) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }
}

function rerender() {
  if (!current) return;
  renderNav(current.nav);
  if (current.handle?.onStoreChange) {
    current.handle.onStoreChange();
    return;
  }
  const y = window.scrollY;
  const active = document.activeElement?.id;
  route();
  window.scrollTo(0, y);
  if (active) document.getElementById(active)?.focus({ preventScroll: true });
}

function boot() {
  store.init();
  renderUser();
  document.getElementById('topbar-date').innerHTML = `<span class="eyebrow">Today</span> <time datetime="${store.today()}">${formatDate(store.today())}</time>`;
  document.getElementById('user-select').addEventListener('change', (e) => {
    store.setCurrentUser(e.target.value);
    renderUser();
    const u = store.getCurrentUser();
    toast(`Signed in as ${u.name} (${ROLE_LABELS[u.role]}).`, { timeout: 3500 });
  });
  document.getElementById('nav-toggle').addEventListener('click', () => setMobileNav(document.getElementById('mobile-nav').hidden));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('mobile-nav').hidden) {
      setMobileNav(false);
      document.getElementById('nav-toggle').focus();
    }
  });
  document.addEventListener('click', async (e) => {
    const denied = e.target.closest('[aria-disabled="true"][data-denied]');
    if (denied) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toast(denied.dataset.denied, { error: true });
      return;
    }
    if (e.target.closest('[data-action="reset-demo"]')) {
      const ok = await confirmDialog({
        title: 'Reset demo data?',
        message: 'This replaces every product, movement, purchase order, supplier and audit entry in this browser with fresh demo data. Changes you made will be lost.',
        confirmLabel: 'Reset demo data',
        danger: true,
      });
      if (ok) {
        store.resetDemoData();
        toast('Demo data reset.');
        location.hash = '#/overview';
      }
    }
  }, true);
  store.subscribe((evt) => {
    if (evt.type === 'reset') {
      current = null;
      route();
    } else rerender();
  });
  window.addEventListener('hashchange', () => route());
  if (!store.isPersistent()) toast('Your browser is blocking local storage, so changes will be lost when you close this tab.', { timeout: 10000 });
  route();
}

boot();
