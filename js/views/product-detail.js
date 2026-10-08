import * as store from '../store.js';
import { esc, formatQty, formatMoney, formatDateTime, centsToDecimal, parseAmount, parseIntStrict, plural } from '../format.js';
import { MOVEMENT_TYPES, ADJUSTMENT_REASONS } from '../ledger.js';
import { can } from '../permissions.js';
import { setTitle, icon, stockBadge, qty, permButton, openDialog, toast, errorMessage, errSlot, renderTimeline, emptyState, clearErrors, showErrors } from '../ui.js';
import { refLink } from './overview.js';
import * as notFound from './not-found.js';

const HIST_PAGE = 30;

export function render(root, params) {
  const sku = params.sku.toUpperCase();
  if (!store.getProduct(sku)) return notFound.render(root, { kind: 'product', id: params.sku, path: params.path });
  setTitle(sku);
  const f = { type: '', warehouse: '', limit: HIST_PAGE };

  const draw = () => {
    const p = store.getProduct(sku);
    const user = store.getCurrentUser();
    const sup = store.getSupplier(p.supplierId);
    const whs = store.getWarehouses();
    const openPOs = store.getPurchaseOrders().filter((po) => po.isOpen && po.lines.some((l) => l.sku === sku && l.outstanding > 0));
    root.innerHTML = `
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/products">Products</a><span aria-hidden="true">/</span><span class="mono" aria-current="page">${esc(sku)}</span></nav>
      <div class="page-head">
        <div><p class="eyebrow mono-eyebrow">${esc(sku)} · ${esc(p.category)}</p><h1>${esc(p.name)}</h1></div>
        <div class="head-actions">
          ${stockBadge(p.status)}
          ${permButton('product.edit', { label: 'Edit product', cls: 'btn', action: 'edit', iconName: 'edit' })}
          ${permButton('stock.adjust', { label: 'Adjust stock', cls: 'btn btn-primary', action: 'adjust', iconName: 'adjust' })}
        </div>
      </div>
      <div class="detail-grid">
        <section class="card span-2" aria-labelledby="stock-h">
          <div class="card-head"><h2 id="stock-h">Stock by warehouse</h2><span class="muted small">Derived from ${plural(store.getMovementHistory(sku).length, 'movement')}</span></div>
          <div class="table-wrap"><table class="table grid-table stock-table" id="stock-table">
            <caption class="sr-only">On hand, allocated and available units per warehouse</caption>
            <thead><tr><th scope="col">Warehouse</th><th scope="col" class="num">On hand</th><th scope="col" class="num">Allocated</th><th scope="col" class="num">Available</th></tr></thead>
            <tbody>${whs.map((w) => {
              const s = p.stock[w.id];
              return `<tr data-wh="${w.id}"><th scope="row"><span class="mono wh-code">${w.id}</span> ${esc(w.name)}</th><td class="num" data-col="onhand">${qty(s.onHand)}</td><td class="num">${qty(s.allocated, 'muted')}</td><td class="num strong" data-col="available">${qty(s.available)}</td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr><th scope="row">All warehouses</th><td class="num" data-col="total-onhand">${qty(p.onHand)}</td><td class="num">${qty(p.allocated)}</td><td class="num strong">${qty(p.available)}</td></tr></tfoot>
          </table></div>
          <p class="card-foot muted small">Available = on hand − allocated to open sales orders.${p.onOrder ? ` <strong>${formatQty(p.onOrder)}</strong> more on open purchase orders.` : ''}</p>
        </section>
        <section class="card" aria-labelledby="re-h">
          <div class="card-head"><h2 id="re-h">Replenishment</h2></div>
          <form class="card-body stack" id="reorder-form" novalidate>
            <p class="form-error err" role="alert" hidden></p>
            <div class="field-row">
              <div class="field"><label for="rp">Reorder point</label><input class="input mono-input" id="rp" name="reorderPoint" inputmode="numeric" value="${p.reorderPoint}" ${can(user, 'product.reorder') ? '' : 'readonly aria-readonly="true"'}>${errSlot('reorderPoint')}</div>
              <div class="field"><label for="rq">Reorder qty</label><input class="input mono-input" id="rq" name="reorderQty" inputmode="numeric" value="${p.reorderQty}" ${can(user, 'product.reorder') ? '' : 'readonly aria-readonly="true"'}>${errSlot('reorderQty')}</div>
            </div>
            ${can(user, 'product.reorder') ? '<button type="submit" class="btn">Save reorder settings</button>' : `<p class="note">${icon('lock')} Only Managers and Admins can edit reorder points. You’re signed in as ${store.ROLE_LABELS[user.role]}.</p>`}
            <dl class="kv">
              <dt>Supplier</dt><dd>${sup ? `<a href="#/suppliers?q=${encodeURIComponent(sup.name)}">${esc(sup.name)}</a>` : 'Unknown'}</dd>
              <dt>Lead time</dt><dd>${sup ? plural(sup.leadTimeDays, 'day') : '—'}</dd>
              <dt>Unit cost</dt><dd class="mono">${esc(formatMoney(p.unitCostCents))}</dd>
              <dt>Stock value</dt><dd class="mono">${esc(formatMoney(p.valueCents))}</dd>
              <dt>On order</dt><dd>${openPOs.length ? openPOs.map((po) => `<a class="mono" href="#/purchase-orders/${po.id}">${po.id}</a>`).join(', ') : 'None'}</dd>
            </dl>
          </form>
        </section>
      </div>
      <section class="card" aria-labelledby="hist-h">
        <div class="card-head wrap"><h2 id="hist-h">Movement history</h2>
          <form class="filters inline-filters" aria-label="Filter movement history">
            <div class="field"><label for="h-type">Type</label><select class="input" id="h-type" name="type"><option value="">All types</option>${Object.entries(MOVEMENT_TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
            <div class="field"><label for="h-wh">Warehouse</label><select class="input" id="h-wh" name="warehouse"><option value="">All warehouses</option>${whs.map((w) => `<option value="${w.id}" ${f.warehouse === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
          </form></div>
        <div id="hist-slot"></div>
      </section>
      <section class="card" aria-labelledby="act-h">
        <div class="card-head"><h2 id="act-h">Activity</h2><span class="muted small">From the audit log</span></div>
        ${renderTimeline(store.getAuditFor('product', sku).slice(-12), 'No changes recorded for this product yet.')}
      </section>`;
    drawHistory();
    wire();
  };

  const drawHistory = () => {
    const hist = store.getMovementHistory(sku).filter((m) => (!f.type || m.type === f.type) && (!f.warehouse || m.warehouse === f.warehouse)).reverse();
    const slot = root.querySelector('#hist-slot');
    if (!hist.length) {
      slot.innerHTML = emptyState('No movements match', 'Pick a different type or warehouse to see more history.');
      return;
    }
    const shown = hist.slice(0, f.limit);
    slot.innerHTML = `<div class="table-wrap"><table class="table grid-table" id="history-table">
      <caption class="sr-only">Movement history, newest first, with the running balance at each warehouse after the movement</caption>
      <thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">Warehouse</th><th scope="col">Reference</th><th scope="col" class="num">Change</th><th scope="col" class="num">Balance after</th><th scope="col" class="hide-sm">By · note</th></tr></thead>
      <tbody>${shown.map((m) => `<tr>
        <td class="nowrap small"><time datetime="${esc(m.at)}">${esc(formatDateTime(m.at))}</time></td>
        <td><span class="mv-tag mv-${m.type}">${esc(MOVEMENT_TYPES[m.type].label)}</span>${m.reason ? `<div class="sub">${esc(ADJUSTMENT_REASONS[m.reason]?.label)}</div>` : ''}</td>
        <td>${esc(store.warehouseName(m.warehouse))}</td>
        <td>${m.ref ? refLink(m.ref) : '<span class="muted">—</span>'}</td>
        <td class="num">${qty(m.qty, 'signed')}</td>
        <td class="num strong">${qty(m.balanceAfter)}</td>
        <td class="hide-sm small">${esc(store.userName(m.by))}${m.note ? `<div class="sub">${esc(m.note)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${hist.length > shown.length ? `<p class="card-foot"><button type="button" class="btn btn-sm" data-action="more">Show ${Math.min(HIST_PAGE, hist.length - shown.length)} more</button> <span class="muted small">${shown.length} of ${hist.length} shown</span></p>` : `<p class="card-foot muted small">${plural(hist.length, 'movement')}</p>`}`;
  };

  const wire = () => {
    root.querySelector('[data-action="adjust"]')?.addEventListener('click', () => adjustDialog(sku));
    root.querySelector('[data-action="edit"]')?.addEventListener('click', () => editDialog(sku));
    const hf = root.querySelector('.inline-filters');
    hf.addEventListener('change', () => {
      f.type = hf.type.value;
      f.warehouse = hf.warehouse.value;
      f.limit = HIST_PAGE;
      drawHistory();
    });
    root.querySelector('#hist-slot').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="more"]')) {
        f.limit += HIST_PAGE;
        drawHistory();
      }
    });
    const rf = root.querySelector('#reorder-form');
    rf.addEventListener('submit', (e) => {
      e.preventDefault();
      clearErrors(rf);
      const rp = parseIntStrict(rf.reorderPoint.value);
      const rq = parseIntStrict(rf.reorderQty.value);
      try {
        store.updateReorder(sku, { reorderPoint: rp ?? NaN, reorderQty: rq ?? NaN });
        toast(`Saved reorder settings for ${sku}.`);
      } catch (err) {
        if (err instanceof store.ValidationError) showErrors(rf, err.errors);
        else toast(errorMessage(err), { error: true });
      }
    });
  };

  draw();
  return { onStoreChange: draw };
}


export function adjustDialog(sku, presetWarehouse = '') {
  const p = store.getProduct(sku);
  const whs = store.getWarehouses();
  const body = `
    <p class="lead"><span class="mono">${esc(sku)}</span> · ${esc(p.name)}</p>
    <div class="field"><label for="adj-wh">Warehouse</label>
      <select class="input" id="adj-wh" name="warehouse" required><option value="">Choose a warehouse</option>${whs.map((w) => `<option value="${w.id}" ${presetWarehouse === w.id ? 'selected' : ''}>${esc(w.name)} — ${formatQty(p.stock[w.id].onHand)} on hand</option>`).join('')}</select>${errSlot('warehouse')}</div>
    <div class="field-row">
      <div class="field"><label for="adj-dir">Direction</label>
        <select class="input" id="adj-dir" name="direction"><option value="-1">Remove stock (−)</option><option value="1">Add stock (+)</option></select></div>
      <div class="field"><label for="adj-qty">Quantity</label>
        <input class="input mono-input" id="adj-qty" name="qty" inputmode="numeric" autocomplete="off" aria-describedby="adj-qty-hint" data-hint="adj-qty-hint"><p class="hint" id="adj-qty-hint">Whole units.</p>${errSlot('qty')}</div>
    </div>
    <div class="field"><label for="adj-reason">Reason code</label>
      <select class="input" id="adj-reason" name="reason" required><option value="">Choose a reason</option>${Object.entries(ADJUSTMENT_REASONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>${errSlot('reason')}</div>
    <div class="field"><label for="adj-note">Note <span class="muted small" id="adj-note-req">(optional)</span></label>
      <textarea class="input" id="adj-note" name="note" rows="2" maxlength="200" placeholder="What happened, for example “Recount of bin B-14”"></textarea>${errSlot('note')}</div>
    <p class="preview-line" id="adj-preview" aria-live="polite"></p>`;
  return openDialog({
    title: 'Adjust stock',
    body,
    submitLabel: 'Post adjustment',
    onOpen(dlg) {
      const form = dlg.querySelector('form');
      const update = () => {
        const reason = form.reason.value;
        const sign = ADJUSTMENT_REASONS[reason]?.sign;
        if (sign === 'in') form.direction.value = '1';
        if (sign === 'out') form.direction.value = '-1';
        form.direction.disabled = sign === 'in' || sign === 'out';
        dlg.querySelector('#adj-note-req').textContent = reason === 'damaged' || reason === 'lost' ? '(required)' : '(optional)';
        const wh = form.warehouse.value;
        const n = parseIntStrict(form.qty.value);
        const out = dlg.querySelector('#adj-preview');
        if (wh && n && n > 0) {
          const before = p.stock[wh].onHand;
          const after = before + Number(form.direction.value) * n;
          out.innerHTML = `${esc(store.warehouseName(wh))} on hand: <span class="mono">${formatQty(before)}</span> → <span class="mono ${after < 0 ? 'neg' : ''}">${after < 0 ? '−' + formatQty(-after) : formatQty(after)}</span>${after < 0 ? ' <span class="err-inline">— below zero, this will be rejected</span>' : ''}`;
        } else out.textContent = '';
      };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
    },
    onSubmit(form) {
      const raw = form.qty.value.trim();
      let n = parseIntStrict(raw.replace(/^[−-]/, ''));
      const errors = {};
      if (!raw) errors.qty = 'Enter how many units to add or remove.';
      else if (n === null || n <= 0) errors.qty = 'Enter a whole number above zero, for example 3. Use Direction to choose add or remove.';
      if (Object.keys(errors).length) throw new store.ValidationError(errors);
      const sign = Number(form.direction.value);
      const m = store.adjustStock({ sku, warehouse: form.warehouse.value, qty: sign * n, reason: form.reason.value, note: form.note.value });
      toast(`Posted adjustment of ${sign > 0 ? '+' : '−'}${n} for ${sku} at ${store.warehouseName(m.warehouse)}.`);
      return m;
    },
  });
}

function editDialog(sku) {
  const p = store.getProduct(sku);
  const body = `
    <div class="field"><label for="ed-name">Name</label><input class="input" id="ed-name" name="name" value="${esc(p.name)}" maxlength="120">${errSlot('name')}</div>
    <div class="field-row">
      <div class="field"><label for="ed-cat">Category</label><select class="input" id="ed-cat" name="category">${store.getCategories().map((c) => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>${errSlot('category')}</div>
      <div class="field"><label for="ed-cost">Unit cost (USD)</label><input class="input mono-input" id="ed-cost" name="unitCost" inputmode="decimal" value="${centsToDecimal(p.unitCostCents)}">${errSlot('unitCost')}</div>
    </div>
    <div class="field"><label for="ed-sup">Supplier</label><select class="input" id="ed-sup" name="supplierId">${store.getSuppliers().map((s) => `<option value="${s.id}" ${s.id === p.supplierId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>${errSlot('supplierId')}</div>
    <p class="hint">Stock quantities can’t be edited here. Use “Adjust stock” so the change is recorded in the ledger.</p>`;
  openDialog({
    title: `Edit ${sku}`,
    body,
    submitLabel: 'Save product',
    onSubmit(form) {
      const cents = parseAmount(form.unitCost.value);
      store.updateProduct(sku, { name: form.name.value, category: form.category.value, supplierId: form.supplierId.value, unitCostCents: cents ?? NaN });
      toast(`Saved ${sku}.`);
      return true;
    },
  });
}
