import * as store from '../store.js';
import { esc, formatMoney, parseIntStrict, plural } from '../format.js';
import { setTitle, icon, permButton, openDialog, toast, errSlot, sortHeader, emptyState } from '../ui.js';

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  country: (a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city),
  lead: (a, b) => a.leadTimeDays - b.leadTimeDays,
  open: (a, b) => a.openPoValueCents - b.openPoValueCents,
  products: (a, b) => a.productCount - b.productCount,
};

export function render(root, params) {
  setTitle('Suppliers');
  const s = { q: params.query.get('q') || '', sort: 'name', dir: 'asc' };
  root.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Vendors and lead times</p><h1>Suppliers</h1></div>
      <div class="head-actions" id="sup-actions"></div></div>
    <form class="filters" role="search" aria-label="Search suppliers"><div class="field grow"><label for="s-q">Search</label><div class="input-icon">${icon('search')}<input class="input" type="search" id="s-q" name="q" value="${esc(s.q)}" placeholder="Name, city or country"></div></div></form>
    <div id="sup-slot"></div>`;
  const draw = () => {
    root.querySelector('#sup-actions').innerHTML = permButton('supplier.manage', { label: 'Add supplier', cls: 'btn btn-primary', action: 'add', iconName: 'plus' });
    const needle = s.q.trim().toLowerCase();
    const rows = store.getSuppliers().filter((x) => !needle || `${x.id} ${x.name} ${x.city} ${x.country}`.toLowerCase().includes(needle));
    const cmp = SORTS[s.sort];
    rows.sort((a, b) => (s.dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
    const slot = root.querySelector('#sup-slot');
    if (!rows.length) {
      slot.innerHTML = emptyState('No suppliers match', 'Try a shorter search.');
      return;
    }
    const manage = store.can_('supplier.manage');
    const sh = (k, l, o) => sortHeader(k, l, { key: s.sort, dir: s.dir }, o);
    slot.innerHTML = `<div class="table-wrap"><table class="table grid-table" id="suppliers-table"><caption class="sr-only">Suppliers</caption>
      <thead><tr>${sh('name', 'Supplier')}${sh('country', 'Location')}${sh('lead', 'Lead time', { num: true })}${sh('open', 'Open PO value', { num: true })}${sh('products', 'Products', { num: true })}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((x) => `<tr>
        <td><strong>${esc(x.name)}</strong><div class="sub"><span class="mono">${esc(x.id)}</span>${x.contact ? ' · ' + esc(x.contact) : ''}</div></td>
        <td>${esc(x.city)}<div class="sub">${esc(x.country)}</div></td>
        <td class="num mono nowrap">${x.leadTimeDays} d</td>
        <td class="num mono nowrap">${x.openPoValueCents ? `<a href="#/purchase-orders?supplier=${x.id}&status=open">${esc(formatMoney(x.openPoValueCents))}</a>` : '<span class="muted">$0.00</span>'}${x.openPoCount ? `<div class="sub">${plural(x.openPoCount, 'open PO')}</div>` : ''}</td>
        <td class="num"><a class="mono" href="#/products?q=${encodeURIComponent(x.name)}">${x.productCount}</a></td>
        <td class="nowrap">${manage ? `<button type="button" class="btn btn-sm" data-edit="${x.id}" aria-label="Edit ${esc(x.name)}">${icon('edit')}<span>Edit</span></button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${manage ? '' : `<p class="note">${icon('lock')} Only Admins can add or edit suppliers. You’re signed in as ${store.ROLE_LABELS[store.getCurrentUser().role]}.</p>`}`;
  };
  root.querySelector('#s-q').addEventListener('input', (e) => {
    s.q = e.target.value;
    draw();
  });
  root.querySelector('.filters').addEventListener('submit', (e) => e.preventDefault());
  root.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-sort]');
    if (sb) {
      const k = sb.dataset.sort;
      s.dir = s.sort === k && s.dir === 'asc' ? 'desc' : 'asc';
      s.sort = k;
      draw();
      root.querySelector(`[data-sort="${k}"]`)?.focus();
      return;
    }
    if (e.target.closest('[data-action="add"]')) supplierDialog();
    const ed = e.target.closest('[data-edit]');
    if (ed) supplierDialog(store.getSuppliers().find((x) => x.id === ed.dataset.edit));
  });
  draw();
  return { onStoreChange: draw };
}

function supplierDialog(sup = null) {
  const v = sup || { name: '', city: '', country: '', leadTimeDays: '', contact: '', email: '' };
  openDialog({
    title: sup ? `Edit ${sup.name}` : 'Add supplier',
    submitLabel: sup ? 'Save supplier' : 'Add supplier',
    body: `
      <div class="field"><label for="sp-name">Company name</label><input class="input" id="sp-name" name="name" value="${esc(v.name)}" maxlength="80">${errSlot('name')}</div>
      <div class="field-row">
        <div class="field"><label for="sp-city">City</label><input class="input" id="sp-city" name="city" value="${esc(v.city)}" maxlength="60">${errSlot('city')}</div>
        <div class="field"><label for="sp-country">Country</label><input class="input" id="sp-country" name="country" value="${esc(v.country)}" maxlength="60" list="sp-countries">${errSlot('country')}
          <datalist id="sp-countries"><option>China</option><option>Taiwan</option><option>United Arab Emirates</option><option>Pakistan</option><option>Germany</option></datalist></div>
      </div>
      <div class="field"><label for="sp-lead">Lead time (days)</label><input class="input mono-input" id="sp-lead" name="leadTimeDays" inputmode="numeric" value="${esc(v.leadTimeDays)}" aria-describedby="sp-lead-hint" data-hint="sp-lead-hint"><p class="hint" id="sp-lead-hint">Order to delivery at our dock. Used to suggest PO delivery dates.</p>${errSlot('leadTimeDays')}</div>
      <div class="field-row">
        <div class="field"><label for="sp-contact">Contact <span class="muted small">(optional)</span></label><input class="input" id="sp-contact" name="contact" value="${esc(v.contact)}" maxlength="60"></div>
        <div class="field"><label for="sp-email">Email <span class="muted small">(optional)</span></label><input class="input" type="email" id="sp-email" name="email" value="${esc(v.email)}" maxlength="80">${errSlot('email')}</div>
      </div>`,
    onSubmit(form) {
      const input = { name: form.name.value, city: form.city.value, country: form.country.value, leadTimeDays: parseIntStrict(form.leadTimeDays.value) ?? NaN, contact: form.contact.value, email: form.email.value };
      const r = sup ? store.updateSupplier(sup.id, input) : store.createSupplier(input);
      toast(sup ? `Saved ${r.name}.` : `Added ${r.name} as ${r.id}.`);
      return r;
    },
  });
}
