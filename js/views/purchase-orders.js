import * as store from '../store.js';
import { esc, formatMoney, formatDate, plural, todayISO, centsToDecimal } from '../format.js';
import { toCSV } from '../csv.js';
import { setTitle, icon, poBadge, permButton, sortHeader, pager, downloadFile, toast, emptyState } from '../ui.js';
import { fromSuggestionsDialog } from './overview.js';

const PAGE_SIZE = 20;
const ORDER = ['pending', 'draft', 'approved', 'ordered', 'partially_received', 'received', 'cancelled'];
const SORTS = {
  id: (a, b) => a.id.localeCompare(b.id),
  supplier: (a, b) => a.supplierName.localeCompare(b.supplierName),
  warehouse: (a, b) => a.warehouseName.localeCompare(b.warehouseName),
  total: (a, b) => a.totalCents - b.totalCents,
  status: (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  expected: (a, b) => a.expectedDate.localeCompare(b.expectedDate),
};
const DEFAULT_DIR = { id: 'desc', supplier: 'asc', warehouse: 'asc', total: 'desc', status: 'asc', expected: 'asc' };

export function render(root, params) {
  setTitle('Purchase orders');
  const q = params.query;
  const sort = SORTS[q.get('sort')] ? q.get('sort') : 'id';
  const s = {
    q: q.get('q') || '',
    status: q.get('status') || '',
    supplier: q.get('supplier') || '',
    warehouse: q.get('wh') || '',
    sort,
    dir: ['asc', 'desc'].includes(q.get('dir')) ? q.get('dir') : DEFAULT_DIR[sort],
    page: 1,
  };
  const write = () => {
    const u = new URLSearchParams();
    if (s.q) u.set('q', s.q);
    if (s.status) u.set('status', s.status);
    if (s.supplier) u.set('supplier', s.supplier);
    if (s.warehouse) u.set('wh', s.warehouse);
    if (s.sort !== 'id' || s.dir !== 'desc') {
      u.set('sort', s.sort);
      u.set('dir', s.dir);
    }
    history.replaceState(null, '', '#/purchase-orders' + (u.toString() ? '?' + u : ''));
  };
  const filter = () => {
    const needle = s.q.trim().toLowerCase();
    const rows = store.getPurchaseOrders().filter((p) => {
      if (s.status === 'open' && !p.isOpen) return false;
      if (s.status && s.status !== 'open' && p.status !== s.status) return false;
      if (s.supplier && p.supplierId !== s.supplier) return false;
      if (s.warehouse && p.warehouse !== s.warehouse) return false;
      if (needle && !`${p.id} ${p.supplierName} ${p.lines.map((l) => l.sku).join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const cmp = SORTS[s.sort];
    return rows.sort((a, b) => (s.dir === 'asc' ? cmp(a, b) : -cmp(a, b)) || b.id.localeCompare(a.id));
  };

  const head = () => `
    <div class="page-head">
      <div><p class="eyebrow">Purchasing · approvals over $5,000 need an Admin</p><h1>Purchase orders</h1></div>
      <div class="head-actions">
        <button type="button" class="btn" data-action="export">${icon('download')}<span>Export CSV</span></button>
        ${permButton('po.create', { label: 'From reorder suggestions', cls: 'btn', action: 'suggest', iconName: 'adjust' })}
        ${store.can_('po.create') ? `<a class="btn btn-primary" href="#/purchase-orders/new">${icon('plus')}<span>New purchase order</span></a>` : permButton('po.create', { label: 'New purchase order', cls: 'btn btn-primary', iconName: 'plus' })}
      </div>
    </div>`;
  const counts = () => {
    const all = store.getPurchaseOrders();
    const c = (st) => all.filter((p) => p.status === st).length;
    return `<div class="seg" role="group" aria-label="Quick status filter">
      ${[['', 'All', all.length], ['open', 'Open', all.filter((p) => p.isOpen).length], ['pending', 'Pending approval', c('pending')], ['draft', 'Draft', c('draft')], ['ordered', 'Ordered', c('ordered')], ['partially_received', 'Partially received', c('partially_received')]]
        .map(([v, l, n]) => `<button type="button" class="seg-btn" data-status="${v}" aria-pressed="${s.status === v}">${l}<span class="mono seg-n">${n}</span></button>`).join('')}
    </div>`;
  };

  root.innerHTML = `<div id="po-head"></div>
    <div id="po-seg"></div>
    <form class="filters" role="search" aria-label="Filter purchase orders">
      <div class="field grow"><label for="po-q">Search</label><div class="input-icon">${icon('search')}<input class="input" type="search" id="po-q" name="q" placeholder="PO number, supplier or SKU" value="${esc(s.q)}"></div></div>
      <div class="field"><label for="po-status">Status</label><select class="input" id="po-status" name="status"><option value="">All statuses</option><option value="open">Open (not received or cancelled)</option>${ORDER.map((k) => `<option value="${k}">${store.PO_STATUS_LABELS[k]}</option>`).join('')}</select></div>
      <div class="field"><label for="po-sup">Supplier</label><select class="input" id="po-sup" name="supplier"><option value="">All suppliers</option>${store.getSuppliers().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="po-wh">Warehouse</label><select class="input" id="po-wh" name="wh"><option value="">All warehouses</option>${store.getWarehouses().map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>
    </form>
    <p class="result-count" id="po-count" aria-live="polite"></p>
    <div id="po-slot"></div>`;
  const form = root.querySelector('.filters');
  form.status.value = s.status;
  form.supplier.value = s.supplier;
  form.wh.value = s.warehouse;

  const draw = () => {
    write();
    root.querySelector('#po-head').innerHTML = head();
    root.querySelector('#po-seg').innerHTML = counts();
    const rows = filter();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (s.page > pages) s.page = pages;
    const pr = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    const total = rows.reduce((t, p) => t + p.totalCents, 0);
    root.querySelector('#po-count').textContent = `${plural(rows.length, 'purchase order')} · ${formatMoney(total)} total.`;
    const slot = root.querySelector('#po-slot');
    if (!rows.length) {
      slot.innerHTML = emptyState('No purchase orders match', 'Try a different status or supplier, or clear the search.');
      return;
    }
    const sh = (k, l, o) => sortHeader(k, l, { key: s.sort, dir: s.dir }, o);
    slot.innerHTML = `<div class="table-wrap"><table class="table grid-table" id="po-table">
      <caption class="sr-only">Purchase orders</caption>
      <thead><tr>${sh('id', 'PO number')}${sh('supplier', 'Supplier')}${sh('warehouse', 'Warehouse', { cls: 'hide-sm' })}${sh('total', 'Total', { num: true })}${sh('status', 'Status')}${sh('expected', 'Expected')}</tr></thead>
      <tbody>${pr.map((p) => `<tr>
        <td class="nowrap"><a class="mono strong-link" href="#/purchase-orders/${p.id}">${p.id}</a></td>
        <td>${esc(p.supplierName)}<div class="sub">${plural(p.lines.length, 'line')} · ${p.unitsReceived}/${p.unitsOrdered} units received</div></td>
        <td class="hide-sm">${esc(p.warehouseName)}</td>
        <td class="num mono nowrap">${esc(formatMoney(p.totalCents))}${p.totalCents > 500000 && p.status === 'pending' ? '<div class="sub">Needs Admin</div>' : ''}</td>
        <td>${poBadge(p.status)}</td>
        <td class="nowrap">${esc(formatDate(p.expectedDate))}${p.isLate ? '<div class="sub late">Overdue</div>' : ''}</td></tr>`).join('')}</tbody></table></div>
      ${pager({ page: s.page, pageSize: PAGE_SIZE, total: rows.length, label: 'purchase orders' })}`;
  };

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    if (e.target.name !== 'q') return;
    s.q = form.q.value;
    s.page = 1;
    draw();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'q') return;
    s.status = form.status.value;
    s.supplier = form.supplier.value;
    s.warehouse = form.wh.value;
    s.page = 1;
    draw();
  });
  root.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-status]');
    if (seg) {
      s.status = seg.dataset.status;
      form.status.value = s.status;
      s.page = 1;
      draw();
      root.querySelector(`[data-status="${s.status}"]`)?.focus();
      return;
    }
    const sb = e.target.closest('[data-sort]');
    if (sb) {
      const k = sb.dataset.sort;
      if (s.sort === k) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
      else {
        s.sort = k;
        s.dir = DEFAULT_DIR[k];
      }
      draw();
      root.querySelector(`[data-sort="${k}"]`)?.focus();
      return;
    }
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) {
      s.page = Number(pg.dataset.page);
      draw();
      return;
    }
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'suggest') {
      if (!store.getReorderSuggestions().items.length) toast('Nothing needs reordering right now. Every SKU is above its reorder point once open orders arrive.');
      else fromSuggestionsDialog();
    } else if (act === 'export') {
      const rows = filter();
      downloadFile(`stockroom-purchase-orders-${todayISO()}.csv`, toCSV([
        ['po_number', 'supplier', 'warehouse', 'status', 'lines', 'units_ordered', 'units_received', 'total', 'expected_date'],
        ...rows.map((p) => [p.id, p.supplierName, p.warehouseName, store.PO_STATUS_LABELS[p.status], p.lines.length, p.unitsOrdered, p.unitsReceived, centsToDecimal(p.totalCents), p.expectedDate]),
      ]));
      toast(`Exported ${plural(rows.length, 'purchase order')} to CSV.`);
    }
  });
  draw();
  return { onStoreChange: draw };
}
