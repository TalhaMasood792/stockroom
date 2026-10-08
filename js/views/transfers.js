import * as store from '../store.js';
import { esc, formatQty, formatDateTime, parseIntStrict, plural } from '../format.js';
import { can } from '../permissions.js';
import { setTitle, icon, qty, skuLink, toast, errorMessage, errSlot, clearErrors, showErrors, pager, productPicker, resolveSku, denyReasonText, emptyState } from '../ui.js';

const PAGE_SIZE = 20;

export function render(root, params) {
  setTitle('Transfers');
  const s = { q: params.query.get('q') || '', page: 1 };
  const preset = params.query.get('sku') || '';
  const user = () => store.getCurrentUser();

  root.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Move stock between warehouses</p><h1>Transfers</h1></div></div>
    <div class="transfer-layout">
      <section class="card" aria-labelledby="new-h">
        <div class="card-head"><h2 id="new-h">New transfer</h2></div>
        <div id="form-slot"></div>
      </section>
      <section class="card" aria-labelledby="list-h">
        <div class="card-head wrap center"><h2 id="list-h">Transfer history</h2>
          <div class="field compact-field"><label for="t-q" class="sr-only">Search transfers</label><div class="input-icon">${icon('search')}<input class="input" type="search" id="t-q" placeholder="Transfer ID or SKU" value="${esc(s.q)}"></div></div></div>
        <div id="list-slot"></div>
      </section>
    </div>`;

  const drawForm = () => {
    const slot = root.querySelector('#form-slot');
    if (!can(user(), 'transfer.create')) {
      slot.innerHTML = `<p class="note card-body">${icon('lock')} ${esc(denyReasonText('transfer.create'))}</p>`;
      return;
    }
    const whs = store.getWarehouses();
    slot.innerHTML = `<form class="card-body stack" id="transfer-form" novalidate>
      <p class="form-error err" role="alert" hidden></p>
      ${productPicker({ id: 'tr-sku', value: preset })}
      <div class="field-row">
        <div class="field"><label for="tr-from">From</label><select class="input" id="tr-from" name="from"><option value="">Choose source</option>${whs.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>${errSlot('from')}</div>
        <div class="field"><label for="tr-to">To</label><select class="input" id="tr-to" name="to"><option value="">Choose destination</option>${whs.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>${errSlot('to')}</div>
      </div>
      <div class="field"><label for="tr-qty">Quantity</label><input class="input mono-input" id="tr-qty" name="qty" inputmode="numeric" autocomplete="off" aria-describedby="tr-avail" data-hint="tr-avail"><p class="hint" id="tr-avail" aria-live="polite">Choose a product and source to see what’s available.</p>${errSlot('qty')}</div>
      <div class="field"><label for="tr-note">Note <span class="muted small">(optional)</span></label><input class="input" id="tr-note" name="note" maxlength="140" placeholder="e.g. Rebalance for Lahore installer orders"></div>
      <div class="avail-grid" id="tr-grid" aria-live="polite"></div>
      <button type="submit" class="btn btn-primary">${icon('transfers')}<span>Post transfer</span></button>
      <p class="hint">Posts immediately as a paired Transfer out and Transfer in with the same transfer ID.</p>
    </form>`;
    const form = slot.querySelector('form');
    const update = () => {
      const sku = resolveSku(form.sku.value);
      const p = store.getProduct(sku);
      const hint = slot.querySelector('#tr-avail');
      const grid = slot.querySelector('#tr-grid');
      if (!p) {
        hint.textContent = 'Choose a product and source to see what’s available.';
        grid.innerHTML = '';
        return;
      }
      grid.innerHTML = `<p class="sub"><span class="mono">${esc(p.sku)}</span> · ${esc(p.name)}</p><table class="table compact grid-table"><caption class="sr-only">Availability by warehouse</caption><thead><tr><th scope="col">Warehouse</th><th scope="col" class="num">On hand</th><th scope="col" class="num">Available</th></tr></thead><tbody>${store.getWarehouses().map((w) => `<tr class="${form.from.value === w.id ? 'is-src' : ''}"><td>${esc(w.name)}</td><td class="num">${qty(p.stock[w.id].onHand)}</td><td class="num strong">${qty(p.stock[w.id].available)}</td></tr>`).join('')}</tbody></table>`;
      hint.textContent = form.from.value ? `${formatQty(Math.max(0, p.stock[form.from.value].available))} available at ${store.warehouseName(form.from.value)}.` : 'Choose a source warehouse.';
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearErrors(form);
      const sku = resolveSku(form.sku.value);
      const raw = form.qty.value.trim();
      const n = parseIntStrict(raw);
      try {
        if (!sku) throw new store.ValidationError({ sku: 'Choose a product to transfer.' });
        if (!raw) throw new store.ValidationError({ qty: 'Enter how many units to move.' });
        if (n === null) throw new store.ValidationError({ qty: 'Enter a whole number of units, such as 12.' });
        const tr = store.createTransfer({ sku, from: form.from.value, to: form.to.value, qty: n, note: form.note.value });
        form.qty.value = '';
        form.note.value = '';
        toast(`Posted ${tr.id}: ${tr.qty} × ${tr.sku} from ${store.warehouseName(tr.from)} to ${store.warehouseName(tr.to)}.`);
      } catch (err) {
        if (err instanceof store.ValidationError) showErrors(form, err.errors);
        else toast(errorMessage(err), { error: true });
      }
    });
  };

  const drawList = () => {
    const needle = s.q.trim().toLowerCase();
    const rows = store.getTransfers().filter((t) => !needle || `${t.id} ${t.sku}`.toLowerCase().includes(needle));
    const slot = root.querySelector('#list-slot');
    if (!rows.length) {
      slot.innerHTML = emptyState('No transfers match', 'Check the transfer ID or SKU, or clear the search.');
      return;
    }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (s.page > pages) s.page = pages;
    const pr = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    slot.innerHTML = `<div class="table-wrap"><table class="table grid-table" id="transfers-table">
      <caption class="sr-only">Transfers, newest first</caption>
      <thead><tr><th scope="col">Transfer</th><th scope="col">SKU</th><th scope="col">Route</th><th scope="col" class="num">Qty</th><th scope="col">Status</th><th scope="col" class="hide-sm">Posted</th></tr></thead>
      <tbody>${pr.map((t) => `<tr><td class="mono nowrap">${esc(t.id)}</td><td class="nowrap">${skuLink(t.sku)}</td>
        <td class="nowrap"><span class="mono wh-code">${t.from}</span> → <span class="mono wh-code">${t.to}</span></td><td class="num">${qty(t.qty)}</td>
        <td><span class="badge po-received">Posted</span></td>
        <td class="hide-sm small nowrap">${esc(formatDateTime(t.at))}<div class="sub">${esc(store.userName(t.by))}</div></td></tr>`).join('')}</tbody></table></div>
      ${pager({ page: s.page, pageSize: PAGE_SIZE, total: rows.length, label: 'transfers' })}`;
  };

  root.querySelector('#t-q').addEventListener('input', (e) => {
    s.q = e.target.value;
    s.page = 1;
    drawList();
  });
  root.querySelector('#list-slot').addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) {
      s.page = Number(pg.dataset.page);
      drawList();
    }
  });

  drawForm();
  drawList();
  let lastUser = user().id;
  return {
    onStoreChange() {
      if (user().id !== lastUser) {
        lastUser = user().id;
        drawForm();
      } else {
        // Keep the form's typed values; refresh availability numbers.
        root.querySelector('#transfer-form')?.dispatchEvent(new Event('change'));
      }
      drawList();
    },
  };
}
