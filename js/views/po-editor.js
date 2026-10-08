import * as store from '../store.js';
import { esc, formatMoney, centsToDecimal, parseAmount, parseIntStrict, addDays, plural } from '../format.js';
import { can, denyReason, MANAGER_APPROVAL_LIMIT_CENTS } from '../permissions.js';
import { setTitle, icon, toast, errorMessage, errSlot, clearErrors, showErrors, resolveSku } from '../ui.js';
import * as notFound from './not-found.js';

export function render(root, params) {
  const editing = params.mode === 'edit';
  const existing = editing ? store.getPurchaseOrder(params.id) : null;
  if (editing && !existing) return notFound.render(root, { kind: 'po', id: params.id, path: params.path });
  setTitle(editing ? `Edit ${params.id}` : 'New purchase order');
  const user = store.getCurrentUser();
  if (!can(user, 'po.create')) {
    root.innerHTML = `<div class="nf"><h1>You can’t create purchase orders</h1><p>${esc(denyReason(user, 'po.create'))}</p><a class="btn" href="#/purchase-orders">Back to purchase orders</a></div>`;
    return {};
  }
  if (editing && existing.status !== 'draft') {
    root.innerHTML = `<div class="nf"><h1>Only drafts can be edited</h1><p><span class="mono">${esc(existing.id)}</span> is ${esc(store.PO_STATUS_LABELS[existing.status].toLowerCase())}. Return it to draft first if it needs changes.</p><a class="btn btn-primary" href="#/purchase-orders/${existing.id}">View ${esc(existing.id)}</a></div>`;
    return {};
  }

  const suppliers = store.getSuppliers();
  const products = store.getProducts();
  const presetSup = params.query.get('supplier');
  let lines = existing
    ? existing.lines.map((l) => ({ sku: l.sku, qty: String(l.qty), cost: centsToDecimal(l.unitCostCents) }))
    : [{ sku: '', qty: '', cost: '' }];
  const head = {
    supplierId: existing?.supplierId ?? (suppliers.some((s) => s.id === presetSup) ? presetSup : ''),
    warehouse: existing?.warehouse ?? 'KHI',
    expectedDate: existing?.expectedDate ?? '',
    note: existing?.note ?? '',
  };

  root.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/purchase-orders">Purchase orders</a><span aria-hidden="true">/</span><span aria-current="page">${editing ? esc(existing.id) : 'New'}</span></nav>
    <div class="page-head"><div><p class="eyebrow">${editing ? 'Edit draft' : `Will be numbered <span class="mono">${esc(store.nextPONumber())}</span>`}</p><h1>${editing ? `Edit ${esc(existing.id)}` : 'New purchase order'}</h1></div></div>
    <form id="po-form" class="po-form" novalidate>
      <p class="form-error err callout" role="alert" hidden></p>
      <section class="card"><div class="card-head"><h2>Order details</h2></div>
        <div class="card-body form-grid">
          <div class="field"><label for="pe-sup">Supplier</label><select class="input" id="pe-sup" name="supplierId"><option value="">Choose a supplier</option>${suppliers.map((s) => `<option value="${s.id}" ${s.id === head.supplierId ? 'selected' : ''}>${esc(s.name)} · ${s.leadTimeDays} d lead time</option>`).join('')}</select>${errSlot('supplierId')}</div>
          <div class="field"><label for="pe-wh">Receiving warehouse</label><select class="input" id="pe-wh" name="warehouse">${store.getWarehouses().map((w) => `<option value="${w.id}" ${w.id === head.warehouse ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>${errSlot('warehouse')}</div>
          <div class="field"><label for="pe-date">Expected delivery</label><input class="input" type="date" id="pe-date" name="expectedDate" value="${esc(head.expectedDate)}" aria-describedby="pe-date-hint" data-hint="pe-date-hint"><p class="hint" id="pe-date-hint">Defaults to today plus the supplier’s lead time.</p>${errSlot('expectedDate')}</div>
          <div class="field span-all"><label for="pe-note">Note to approver <span class="muted small">(optional)</span></label><input class="input" id="pe-note" name="note" maxlength="200" value="${esc(head.note)}"></div>
        </div></section>
      <section class="card"><div class="card-head"><h2 id="lines-h">Lines</h2><span class="muted small" id="sup-hint"></span></div>
        <datalist id="pe-skus"></datalist>
        <div class="table-wrap"><table class="table grid-table line-editor" aria-labelledby="lines-h">
          <thead><tr><th scope="col">Product</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Unit cost (USD)</th><th scope="col" class="num">Line total</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
          <tbody id="line-rows"></tbody></table></div>
        <p class="err" data-for="lines" id="err-lines"></p>
        <div class="card-foot line-foot"><button type="button" class="btn" data-action="add-line">${icon('plus')}<span>Add line</span></button>
          <dl class="totals"><dt>Units</dt><dd class="mono" id="t-units">0</dd><dt>Total</dt><dd class="mono strong" id="t-total">$0.00</dd></dl></div>
        <p class="card-foot approval-note" id="approval-note" aria-live="polite"></p>
      </section>
      <div class="form-actions">
        <a class="btn btn-ghost" href="${editing ? `#/purchase-orders/${existing.id}` : '#/purchase-orders'}">Cancel</a>
        <button type="submit" class="btn" name="save" value="draft">Save as draft</button>
        ${can(user, 'po.submit') ? '<button type="submit" class="btn btn-primary" name="save" value="submit">Save and submit for approval</button>' : ''}
      </div>
    </form>`;

  const form = root.querySelector('#po-form');
  const tbody = root.querySelector('#line-rows');

  const fillDatalist = () => {
    const sup = form.supplierId.value;
    const list = sup ? products.filter((p) => p.supplierId === sup) : products;
    root.querySelector('#pe-skus').innerHTML = list.map((p) => `<option value="${esc(p.sku)}">${esc(p.name)} · ${esc(formatMoney(p.unitCostCents))}</option>`).join('');
    root.querySelector('#sup-hint').textContent = sup ? `${plural(list.length, 'product')} from this supplier` : 'Choose a supplier to narrow the product list';
  };

  const drawLines = () => {
    tbody.innerHTML = lines.map((l, i) => {
      const p = store.getProduct(resolveSku(l.sku));
      return `<tr data-i="${i}">
        <td><label class="sr-only" for="ln-sku-${i}">Product for line ${i + 1}</label><input class="input mono-input" id="ln-sku-${i}" name="lines.${i}.sku" list="pe-skus" value="${esc(l.sku)}" placeholder="SKU or name" autocomplete="off">
          <div class="sub" id="ln-name-${i}">${p ? esc(p.name) + ` · ${p.available} available, point ${p.reorderPoint}` : ''}</div>${errSlot(`lines.${i}.sku`)}</td>
        <td class="num"><label class="sr-only" for="ln-qty-${i}">Quantity for line ${i + 1}</label><input class="input mono-input qty-input" id="ln-qty-${i}" name="lines.${i}.qty" inputmode="numeric" value="${esc(l.qty)}" autocomplete="off">${errSlot(`lines.${i}.qty`)}</td>
        <td class="num"><label class="sr-only" for="ln-cost-${i}">Unit cost for line ${i + 1}</label><input class="input mono-input cost-input" id="ln-cost-${i}" name="lines.${i}.unitCost" inputmode="decimal" value="${esc(l.cost)}" autocomplete="off">${errSlot(`lines.${i}.unitCost`)}</td>
        <td class="num mono" id="ln-total-${i}">—</td>
        <td><button type="button" class="btn btn-ghost btn-icon" data-remove="${i}" aria-label="Remove line ${i + 1}" ${lines.length === 1 ? 'disabled' : ''}>${icon('trash')}</button></td></tr>`;
    }).join('');
    recalc();
  };

  const recalc = () => {
    let total = 0;
    let units = 0;
    lines.forEach((l, i) => {
      const q = parseIntStrict(l.qty);
      const c = parseAmount(l.cost);
      const cell = root.querySelector(`#ln-total-${i}`);
      if (q && q > 0 && c) {
        total += q * c;
        units += q;
        cell.textContent = formatMoney(q * c);
      } else cell.textContent = '—';
    });
    root.querySelector('#t-total').textContent = formatMoney(total);
    root.querySelector('#t-units').textContent = String(units);
    const note = root.querySelector('#approval-note');
    note.innerHTML = total > MANAGER_APPROVAL_LIMIT_CENTS
      ? `${icon('lock')} Over $5,000: this PO will need Admin approval.`
      : total > 0 ? 'Within $5,000: a Manager or Admin can approve it.' : '';
    note.classList.toggle('is-over', total > MANAGER_APPROVAL_LIMIT_CENTS);
  };

  form.supplierId.addEventListener('change', () => {
    fillDatalist();
    const s = suppliers.find((x) => x.id === form.supplierId.value);
    if (s && !form.expectedDate.value) form.expectedDate.value = addDays(store.today(), s.leadTimeDays);
  });
  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const i = Number(tr.dataset.i);
    const name = e.target.name.split('.')[2];
    if (name === 'sku') {
      lines[i].sku = e.target.value;
      const p = store.getProduct(resolveSku(e.target.value));
      root.querySelector(`#ln-name-${i}`).textContent = p ? `${p.name} · ${p.available} available, point ${p.reorderPoint}` : '';
      if (p) {
        if (!lines[i].cost) {
          lines[i].cost = centsToDecimal(p.unitCostCents);
          root.querySelector(`#ln-cost-${i}`).value = lines[i].cost;
        }
        if (!lines[i].qty) {
          lines[i].qty = String(p.reorderQty);
          root.querySelector(`#ln-qty-${i}`).value = lines[i].qty;
        }
        if (!form.supplierId.value) {
          form.supplierId.value = p.supplierId;
          form.supplierId.dispatchEvent(new Event('change'));
        }
      }
    }
    if (name === 'qty') lines[i].qty = e.target.value;
    if (name === 'unitCost') lines[i].cost = e.target.value;
    recalc();
  });
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      lines.splice(Number(rm.dataset.remove), 1);
      drawLines();
      tbody.querySelector('input')?.focus();
      return;
    }
    if (e.target.closest('[data-action="add-line"]')) {
      lines.push({ sku: '', qty: '', cost: '' });
      drawLines();
      root.querySelector(`#ln-sku-${lines.length - 1}`).focus();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(form);
    root.querySelector('#err-lines').textContent = '';
    const submit = e.submitter?.value === 'submit';
    const input = {
      supplierId: form.supplierId.value,
      warehouse: form.warehouse.value,
      expectedDate: form.expectedDate.value,
      note: form.note.value,
      lines: lines.map((l) => {
        const q = parseIntStrict(l.qty);
        const c = parseAmount(l.cost);
        return { sku: resolveSku(l.sku), qty: l.qty.trim() === '' ? (l.sku ? NaN : 0) : q ?? NaN, unitCostCents: l.cost.trim() === '' ? (l.sku ? NaN : 0) : c ?? NaN };
      }),
    };
    try {
      let id;
      if (editing) {
        store.updateDraftPO(existing.id, input);
        id = existing.id;
        if (submit) store.submitPO(id);
      } else {
        id = store.createPurchaseOrder(input, { submit }).id;
      }
      toast(submit ? `${id} saved and submitted for approval.` : `${id} saved as a draft.`);
      location.hash = `#/purchase-orders/${id}`;
    } catch (err) {
      if (err instanceof store.ValidationError) {
        // Keep blank rows out of the index mapping: errors refer to input order.
        showErrors(form, err.errors);
        if (err.errors.lines) root.querySelector('#err-lines').textContent = err.errors.lines;
      } else toast(errorMessage(err), { error: true });
    }
  });

  fillDatalist();
  drawLines();
  return {};
}
