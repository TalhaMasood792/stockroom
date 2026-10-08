import * as store from '../store.js';
import { esc, formatQty, formatMoney, centsToDecimal, plural, todayISO } from '../format.js';
import { STOCK_STATUS_LABELS } from '../ledger.js';
import { toCSV, validateReorderImport, IMPORT_TEMPLATE_HEADERS } from '../csv.js';
import { can } from '../permissions.js';
import { setTitle, icon, stockBadge, skuLink, qty, sortHeader, pager, downloadFile, permButton, openDialog, toast, errorMessage, debounce, emptyState } from '../ui.js';

const PAGE_SIZE = 25;
const WH_COLS = ['KHI', 'LHE', 'DXB'];
const STATUS_ORDER = { out: 0, low: 1, in: 2 };
const SORTS = {
  sku: (a, b) => a.sku.localeCompare(b.sku),
  name: (a, b) => a.name.localeCompare(b.name),
  category: (a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku),
  KHI: (a, b) => a.stock.KHI.onHand - b.stock.KHI.onHand,
  LHE: (a, b) => a.stock.LHE.onHand - b.stock.LHE.onHand,
  DXB: (a, b) => a.stock.DXB.onHand - b.stock.DXB.onHand,
  available: (a, b) => a.available - b.available,
  reorder: (a, b) => a.reorderPoint - b.reorderPoint,
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.available - a.reorderPoint - (b.available - b.reorderPoint),
};
const DEFAULT_DIR = { sku: 'asc', name: 'asc', category: 'asc', KHI: 'desc', LHE: 'desc', DXB: 'desc', available: 'desc', reorder: 'desc', status: 'asc' };

function readState(q) {
  const sort = SORTS[q.get('sort')] ? q.get('sort') : 'sku';
  const status = q.get('status') || '';
  return {
    q: q.get('q') || '',
    category: q.get('category') || '',
    status: ['in', 'low', 'out', 'reorder'].includes(status) ? status : '',
    warehouse: WH_COLS.includes(q.get('wh')) ? q.get('wh') : '',
    sort,
    dir: ['asc', 'desc'].includes(q.get('dir')) ? q.get('dir') : DEFAULT_DIR[sort],
    page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
  };
}
function writeState(s) {
  const q = new URLSearchParams();
  if (s.q) q.set('q', s.q);
  if (s.category) q.set('category', s.category);
  if (s.status) q.set('status', s.status);
  if (s.warehouse) q.set('wh', s.warehouse);
  if (s.sort !== 'sku' || s.dir !== 'asc') {
    q.set('sort', s.sort);
    q.set('dir', s.dir);
  }
  if (s.page > 1) q.set('page', s.page);
  const qs = q.toString();
  history.replaceState(null, '', '#/products' + (qs ? '?' + qs : ''));
}

function filterRows(all, s) {
  const needle = s.q.trim().toLowerCase();
  const reorderSet = s.status === 'reorder' ? new Set(store.getReorderSuggestions().items.map((i) => i.sku)) : null;
  const rows = all.filter((p) => {
    if (s.category && p.category !== s.category) return false;
    if (reorderSet && !reorderSet.has(p.sku)) return false;
    if (s.status && !reorderSet) {
      if (s.warehouse) {
        // With a warehouse selected, "Out" means nothing available at that site.
        const avail = p.stock[s.warehouse].available;
        const st = avail <= 0 ? 'out' : p.status === 'in' ? 'in' : 'low';
        if (st !== s.status) return false;
      } else if (p.status !== s.status) return false;
    }
    if (s.warehouse && !s.status && p.stock[s.warehouse].onHand <= 0) return false;
    if (needle && !`${p.sku} ${p.name} ${p.supplierName} ${p.category}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const cmp = SORTS[s.sort];
  rows.sort((a, b) => (s.dir === 'asc' ? cmp(a, b) : -cmp(a, b)) || a.sku.localeCompare(b.sku));
  return rows;
}

export function render(root, params) {
  setTitle('Products');
  const s = readState(params.query);
  const all = () => store.getProducts();
  const cats = store.getCategories();

  root.innerHTML = `
    <div class="page-head">
      <div><p class="eyebrow">Catalogue · stock derived from the movement ledger</p><h1>Products</h1></div>
      <div class="head-actions">
        <button type="button" class="btn" data-action="export">${icon('download')}<span>Export CSV</span></button>
        <span id="import-slot"></span>
      </div>
    </div>
    <form class="filters" role="search" aria-label="Filter products">
      <div class="field grow"><label for="p-q">Search</label>
        <div class="input-icon">${icon('search')}<input class="input" type="search" id="p-q" name="q" placeholder="SKU, name or supplier" value="${esc(s.q)}"></div></div>
      <div class="field"><label for="p-cat">Category</label>
        <select class="input" id="p-cat" name="category"><option value="">All categories</option>${cats.map((c) => `<option ${c === s.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="p-status">Status</label>
        <select class="input" id="p-status" name="status"><option value="">All statuses</option>
          ${['in', 'low', 'out'].map((k) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${STOCK_STATUS_LABELS[k]}</option>`).join('')}
          <option value="reorder" ${s.status === 'reorder' ? 'selected' : ''}>Needs reorder</option></select></div>
      <div class="field"><label for="p-wh">Warehouse</label>
        <select class="input" id="p-wh" name="wh"><option value="">All warehouses</option>${store.getWarehouses().map((w) => `<option value="${w.id}" ${w.id === s.warehouse ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
      <button type="button" class="btn btn-ghost" data-action="clear" ${s.q || s.category || s.status || s.warehouse ? '' : 'hidden'}>Clear filters</button>
    </form>
    <p class="result-count" id="result-count" aria-live="polite"></p>
    <div id="table-slot"></div>`;

  const drawImportBtn = () => {
    root.querySelector('#import-slot').innerHTML = permButton('product.import', { label: 'Import reorder points', cls: 'btn', action: 'import', iconName: 'upload' });
  };

  const draw = () => {
    writeState(s);
    const rows = filterRows(all(), s);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (s.page > pages) s.page = pages;
    const pageRows = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    root.querySelector('#result-count').textContent = `${plural(rows.length, 'product')} match${rows.length === 1 ? 'es' : ''}.`;
    root.querySelector('[data-action="clear"]').hidden = !(s.q || s.category || s.status || s.warehouse);
    const slot = root.querySelector('#table-slot');
    if (!rows.length) {
      slot.innerHTML = emptyState('No products match these filters', 'Try a shorter search, or clear the filters to see all products.', '<button type="button" class="btn" data-action="clear">Clear filters</button>');
      return;
    }
    const whs = store.getWarehouses();
    slot.innerHTML = `<div class="table-wrap" tabindex="0" role="region" aria-label="Products table, scrolls horizontally">
      <table class="table grid-table" id="products-table">
      <caption class="sr-only">Products, sorted by ${esc(s.sort)} ${s.dir === 'asc' ? 'ascending' : 'descending'}. On-hand quantity per warehouse.</caption>
      <thead><tr>
        ${sortHeader('sku', 'SKU', { key: s.sort, dir: s.dir })}
        ${sortHeader('name', 'Name', { key: s.sort, dir: s.dir })}
        ${sortHeader('category', 'Category', { key: s.sort, dir: s.dir }, { cls: 'hide-md' })}
        ${whs.map((w) => sortHeader(w.id, w.name, { key: s.sort, dir: s.dir }, { num: true, cls: `wh-col ${s.warehouse === w.id ? 'is-focus' : ''}` })).join('')}
        ${sortHeader('available', 'Available', { key: s.sort, dir: s.dir }, { num: true })}
        ${sortHeader('reorder', 'Reorder pt', { key: s.sort, dir: s.dir }, { num: true })}
        ${sortHeader('status', 'Status', { key: s.sort, dir: s.dir })}
      </tr></thead>
      <tbody>${pageRows.map((p) => `<tr>
        <td class="nowrap">${skuLink(p.sku)}</td>
        <td class="name-cell">${esc(p.name)}</td>
        <td class="hide-md">${esc(p.category)}</td>
        ${whs.map((w) => `<td class="num wh-col ${s.warehouse === w.id ? 'is-focus' : ''}">${qty(p.stock[w.id].onHand, p.stock[w.id].onHand === 0 ? 'zero' : '')}</td>`).join('')}
        <td class="num strong">${qty(p.available)}</td>
        <td class="num">${qty(p.reorderPoint, 'muted')}</td>
        <td>${stockBadge(p.status)}</td>
      </tr>`).join('')}</tbody></table></div>
      <ul class="card-list" aria-label="Products">${pageRows.map((p) => `<li class="pcard">
        <div class="pcard-top">${skuLink(p.sku)}${stockBadge(p.status)}</div>
        <div class="pcard-name">${esc(p.name)}</div>
        <dl class="pcard-stats">${whs.map((w) => `<div><dt>${esc(w.name)}</dt><dd>${qty(p.stock[w.id].onHand)}</dd></div>`).join('')}<div><dt>Avail.</dt><dd class="strong">${qty(p.available)}</dd></div><div><dt><abbr title="Reorder point">Reorder</abbr></dt><dd>${qty(p.reorderPoint)}</dd></div></dl>
      </li>`).join('')}</ul>
      ${pager({ page: s.page, pageSize: PAGE_SIZE, total: rows.length, label: 'products' })}`;
  };

  const form = root.querySelector('.filters');
  form.addEventListener('submit', (e) => e.preventDefault());
  const onSearch = debounce(() => {
    s.q = form.q.value;
    s.page = 1;
    draw();
  }, 150);
  form.q.addEventListener('input', onSearch);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'q') return;
    s.category = form.category.value;
    s.status = form.status.value;
    s.warehouse = form.wh.value;
    s.page = 1;
    draw();
  });
  root.addEventListener('click', (e) => {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const k = sortBtn.dataset.sort;
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
      root.querySelector('#products-table')?.scrollIntoView({ block: 'start' });
      return;
    }
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'clear') {
      Object.assign(s, { q: '', category: '', status: '', warehouse: '', page: 1 });
      form.q.value = '';
      form.category.value = '';
      form.status.value = '';
      form.wh.value = '';
      draw();
      form.q.focus();
    } else if (act === 'export') {
      const rows = filterRows(all(), s);
      const whs = store.getWarehouses();
      const csv = toCSV([
        ['sku', 'name', 'category', 'supplier', ...whs.map((w) => `on_hand_${w.id.toLowerCase()}`), 'allocated', 'available', 'reorder_point', 'reorder_qty', 'unit_cost', 'status'],
        ...rows.map((p) => [p.sku, p.name, p.category, p.supplierName, ...whs.map((w) => p.stock[w.id].onHand), p.allocated, p.available, p.reorderPoint, p.reorderQty, centsToDecimal(p.unitCostCents), STOCK_STATUS_LABELS[p.status]]),
      ]);
      downloadFile(`stockroom-products-${todayISO()}.csv`, csv);
      toast(`Exported ${plural(rows.length, 'product')} to CSV.`);
    } else if (act === 'import') {
      importDialog();
    }
  });

  drawImportBtn();
  draw();
  return {
    onStoreChange: () => {
      drawImportBtn();
      draw();
    },
  };
}

// ---------- CSV import ----------
function templateCSV() {
  const sample = store.getProducts().slice(0, 3);
  return toCSV([
    IMPORT_TEMPLATE_HEADERS,
    ...sample.map((p) => [p.sku, p.reorderPoint, p.reorderQty, '', '', '', '']),
    ['NET-SWT-0099', 12, 20, '16-port 2.5GbE switch', 'Networking', 'SUP-01', '189.00'],
  ]);
}

function importDialog() {
  const user = store.getCurrentUser();
  const canAddNew = can(user, 'product.edit');
  let result = null;
  const body = `
    <p class="lead">Upload a CSV with <code>sku</code> and <code>reorder_point</code> columns. <code>reorder_qty</code> is optional. Nothing changes until you apply the valid rows.</p>
    <div class="import-row">
      <div class="field grow"><label for="imp-file">CSV file</label>
        <input class="input" type="file" id="imp-file" name="file" accept=".csv,text/csv" aria-describedby="imp-hint">
        <p class="hint" id="imp-hint">UTF-8, comma-separated, header row first. Max 1 MB.</p></div>
      <button type="button" class="btn" data-action="template">${icon('download')}<span>Download template</span></button>
    </div>
    <label class="check-row inline"><input type="checkbox" name="allowNew" ${canAddNew ? '' : 'disabled'}> <span>Add new products for unknown SKUs <span class="muted small">(needs name, category, supplier_id, unit_cost${canAddNew ? '' : ' · Managers and Admins only'})</span></span></label>
    <div id="imp-preview" aria-live="polite"></div>`;
  openDialog({
    title: 'Import reorder points',
    body,
    wide: true,
    submitLabel: 'Apply valid rows',
    onOpen(dlg) {
      const fileInput = dlg.querySelector('#imp-file');
      const allow = dlg.querySelector('[name="allowNew"]');
      const submit = dlg.querySelector('button[type="submit"]');
      submit.disabled = true;
      let text = '';
      const preview = () => {
        const products = new Map(store.getProducts().map((p) => [p.sku, p]));
        result = validateReorderImport(text, { products, suppliers: new Set(store.getSuppliers().map((x) => x.id)), categories: store.getCategories(), allowNew: allow.checked });
        dlg.querySelector('#imp-preview').innerHTML = renderPreview(result);
        submit.disabled = !result.validCount;
        submit.textContent = result.validCount ? `Apply ${plural(result.validCount, 'valid row')}` : 'Apply valid rows';
      };
      dlg.querySelector('[data-action="template"]').addEventListener('click', () => downloadFile('stockroom-reorder-template.csv', templateCSV()));
      fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        if (!f) return;
        if (f.size > 1024 * 1024) {
          dlg.querySelector('#imp-preview').innerHTML = '<p class="err" role="alert">This file is larger than 1 MB. Split it into smaller files and upload them one at a time.</p>';
          submit.disabled = true;
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          text = String(reader.result);
          preview();
        };
        reader.onerror = () => {
          dlg.querySelector('#imp-preview').innerHTML = '<p class="err" role="alert">The file couldn’t be read. Check it isn’t open in another program, then choose it again.</p>';
        };
        reader.readAsText(f);
      });
      allow.addEventListener('change', () => text && preview());
    },
    onSubmit() {
      if (!result || !result.validCount) throw new store.ValidationError({ form: 'Choose a CSV file with at least one valid row.' });
      const r = store.applyReorderImport(result.rows);
      const parts = [];
      if (r.updated) parts.push(`updated ${plural(r.updated, 'product')}`);
      if (r.created) parts.push(`added ${plural(r.created, 'new product')}`);
      if (r.skipped) parts.push(`${r.skipped} already matched`);
      const invalid = result.rows.length - result.validCount;
      toast(`Import done: ${parts.join(', ') || 'no changes'}.${invalid ? ` ${plural(invalid, 'row')} with errors ${invalid === 1 ? 'was' : 'were'} skipped.` : ''}`);
      return r;
    },
  }).catch((e) => toast(errorMessage(e), { error: true }));
}

function renderPreview(res) {
  if (res.fileError) return `<p class="err callout" role="alert">${esc(res.fileError)}</p>`;
  const bad = res.rows.length - res.validCount;
  return `<div class="imp-summary"><span class="badge st-in"><span class="dot" aria-hidden="true"></span>${plural(res.validCount, 'valid row')}</span>${bad ? `<span class="badge st-out"><span class="dot" aria-hidden="true"></span>${plural(bad, 'row')} with errors</span>` : ''}<span class="muted small">Rows with errors are skipped. Fix them in the file and upload again to include them.</span></div>
    <div class="table-wrap imp-table"><table class="table compact grid-table">
    <caption class="sr-only">Import preview with validation results per row</caption>
    <thead><tr><th scope="col" class="num">Line</th><th scope="col">SKU</th><th scope="col">Change</th><th scope="col">Result</th></tr></thead>
    <tbody>${res.rows.map((r) => {
      const ok = !r.errors.length;
      let change = '';
      if (r.kind === 'new' && ok) change = `New: ${esc(r.values.name)} · point ${r.values.reorderPoint}, qty ${r.values.reorderQty} · ${esc(formatMoney(r.values.unitCostCents))}`;
      else if (r.before && r.values.reorderPoint !== undefined) change = `Point <span class="mono">${r.before.reorderPoint} → ${r.values.reorderPoint}</span>${r.values.reorderQty !== undefined ? ` · qty <span class="mono">${r.before.reorderQty} → ${r.values.reorderQty}</span>` : ''}`;
      else change = `<span class="muted">${esc(r.raw.reorder_point ?? '')}</span>`;
      return `<tr class="${ok ? '' : 'row-error'}"><td class="num mono">${r.line}</td><td class="mono nowrap">${esc(r.sku || '(blank)')}</td><td>${change}</td>
        <td>${ok ? `<span class="ok-text">${icon('check')} Ready</span>` : `<ul class="err-list">${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
