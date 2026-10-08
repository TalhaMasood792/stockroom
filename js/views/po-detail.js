import * as store from '../store.js';
import { esc, formatMoney, formatDate, formatDateTime, formatQty, parseIntStrict, plural } from '../format.js';
import { can, canApprove, approveDenyReason, MANAGER_APPROVAL_LIMIT_CENTS } from '../permissions.js';
import { setTitle, icon, poBadge, qty, skuLink, permButton, openDialog, confirmDialog, toast, errorMessage, errSlot, renderTimeline } from '../ui.js';
import * as notFound from './not-found.js';

const STEPS = ['draft', 'pending', 'approved', 'ordered', 'partially_received', 'received'];

export function render(root, params) {
  if (!store.getPurchaseOrder(params.id)) return notFound.render(root, { kind: 'po', id: params.id, path: params.path });
  setTitle(params.id);

  const draw = () => {
    const po = store.getPurchaseOrder(params.id);
    const user = store.getCurrentUser();
    const sup = store.getSupplier(po.supplierId);
    const wh = store.getWarehouses().find((w) => w.id === po.warehouse);
    root.innerHTML = `
      <nav class="crumbs no-print" aria-label="Breadcrumb"><a href="#/purchase-orders">Purchase orders</a><span aria-hidden="true">/</span><span class="mono" aria-current="page">${esc(po.id)}</span></nav>
      <div class="page-head">
        <div><p class="eyebrow">Purchase order</p><h1 class="mono-h1">${esc(po.id)}</h1></div>
        <div class="head-actions no-print">${poBadge(po.status)}${actions(po, user)}</div>
      </div>
      ${banner(po, user)}
      ${stepper(po)}
      <div class="po-doc card">
        <div class="po-doc-head">
          <div class="print-only print-brand">Stockroom · Qasim Electronics Distribution</div>
          <div class="po-parties">
            <div><span class="eyebrow">Supplier</span><strong>${esc(po.supplierName)}</strong><span>${esc(sup?.city ?? '')}, ${esc(sup?.country ?? '')}</span>${sup?.contact ? `<span>${esc(sup.contact)}${sup.email ? ' · ' + esc(sup.email) : ''}</span>` : ''}</div>
            <div><span class="eyebrow">Deliver to</span><strong>${esc(wh?.name ?? po.warehouse)} warehouse</strong><span>${esc(wh?.site ?? '')}</span></div>
            <div><span class="eyebrow">Dates</span><span>Raised ${esc(formatDate(po.createdAt))}</span><span>Expected <strong>${esc(formatDate(po.expectedDate))}</strong>${po.isLate ? ' <span class="late">· overdue</span>' : ''}</span><span>By ${esc(store.userName(po.createdBy))}</span></div>
          </div>
          ${po.note ? `<p class="po-note"><span class="eyebrow">Note</span> ${esc(po.note)}</p>` : ''}
          ${po.status === 'cancelled' ? `<p class="callout callout-danger"><strong>Cancelled.</strong> ${esc(po.cancelReason)}</p>` : ''}
        </div>
        <div class="table-wrap"><table class="table grid-table po-lines" id="po-lines">
          <caption class="sr-only">Lines on ${esc(po.id)} with ordered, received and outstanding quantities</caption>
          <thead><tr><th scope="col">SKU</th><th scope="col">Description</th><th scope="col" class="num">Ordered</th><th scope="col" class="num">Received</th><th scope="col" class="num">Outstanding</th><th scope="col" class="num">Unit cost</th><th scope="col" class="num">Line total</th></tr></thead>
          <tbody>${po.lines.map((l) => `<tr data-sku="${esc(l.sku)}"><td class="nowrap">${skuLink(l.sku)}</td><td>${esc(l.name)}</td>
            <td class="num">${qty(l.qty)}</td><td class="num" data-col="received">${qty(l.received)}</td><td class="num strong" data-col="outstanding">${qty(l.outstanding, l.outstanding ? '' : 'muted')}</td>
            <td class="num mono">${esc(formatMoney(l.unitCostCents))}</td><td class="num mono">${esc(formatMoney(l.lineTotalCents))}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row" colspan="2">Total · ${plural(po.lines.length, 'line')}</th><td class="num">${qty(po.unitsOrdered)}</td><td class="num">${qty(po.unitsReceived)}</td><td class="num">${qty(po.unitsOrdered - po.unitsReceived)}</td><td></td><td class="num mono strong" id="po-total">${esc(formatMoney(po.totalCents))}</td></tr></tfoot>
        </table></div>
      </div>
      <div class="grid-2 no-print">
        <section class="card" aria-labelledby="hist-h"><div class="card-head"><h2 id="hist-h">Status timeline</h2></div>
          <ol class="status-tl">${po.history.map((h) => `<li class="s-${h.status}"><span class="tl-dot" aria-hidden="true"></span><div><strong>${esc(store.PO_STATUS_LABELS[h.status])}</strong>${h.note ? ` <span class="muted">· ${esc(h.note)}</span>` : ''}<div class="t-meta">${esc(store.userName(h.by))} · <time datetime="${esc(h.at)}">${esc(formatDateTime(h.at))}</time></div></div></li>`).join('')}</ol>
        </section>
        <section class="card" aria-labelledby="act-h"><div class="card-head"><h2 id="act-h">Audit trail</h2></div>
          ${renderTimeline(store.getAuditFor('po', po.id))}</section>
      </div>`;
    wire(po);
  };

  const wire = (po) => {
    const on = (a, fn) => root.querySelector(`[data-action="${a}"]`)?.addEventListener('click', fn);
    const run = (fn, msg) => {
      try {
        fn();
        toast(msg);
      } catch (e) {
        toast(errorMessage(e), { error: true });
      }
    };
    on('submit', () => run(() => store.submitPO(po.id), `${po.id} submitted for approval.`));
    on('approve', () => confirmDialog({
      title: `Approve ${po.id}?`,
      message: `This approves ${esc(formatMoney(po.totalCents))} with ${esc(po.supplierName)}. Next step is placing the order with the supplier.`,
      confirmLabel: 'Approve purchase order',
      onConfirm: () => store.approvePO(po.id),
    }).then((r) => r && toast(`${po.id} approved.`)));
    on('return', () => openDialog({
      title: `Return ${po.id} to draft`,
      body: `<p class="lead">The requester can edit and resubmit it.</p><div class="field"><label for="ret-r">What should change?</label><textarea class="input" id="ret-r" name="reason" rows="3" maxlength="200"></textarea>${errSlot('reason')}</div>`,
      submitLabel: 'Return to draft',
      onSubmit: (f) => store.returnPOToDraft(po.id, f.reason.value),
    }).then((r) => r && toast(`${po.id} returned to draft.`)));
    on('order', () => run(() => store.markOrdered(po.id), `${po.id} marked as ordered with ${po.supplierName}.`));
    on('receive', () => receiveDialog(po.id));
    on('cancel', () => openDialog({
      title: `Cancel ${po.id}?`,
      body: `<p class="lead">Cancelling can’t be undone. The PO stays in the list for the record.</p><div class="field"><label for="can-r">Reason for cancelling</label><textarea class="input" id="can-r" name="reason" rows="3" maxlength="200" placeholder="e.g. Supplier can’t meet the delivery date"></textarea>${errSlot('reason')}</div>`,
      submitLabel: 'Cancel purchase order',
      submitClass: 'btn btn-danger',
      cancelLabel: 'Keep purchase order',
      onSubmit: (f) => store.cancelPO(po.id, f.reason.value),
    }).then((r) => r && toast(`${po.id} cancelled.`)));
    on('print', () => window.print());
  };

  draw();
  return { onStoreChange: draw };
}

function actions(po, user) {
  const b = [];
  if (po.status === 'draft') {
    b.push(store.can_('po.create') ? `<a class="btn" href="#/purchase-orders/${po.id}/edit">${icon('edit')}<span>Edit draft</span></a>` : '');
    b.push(permButton('po.submit', { label: 'Submit for approval', cls: 'btn btn-primary', action: 'submit', iconName: 'send' }));
  }
  if (po.status === 'pending') {
    if (can(user, 'po.approve')) b.push(permButton('po.approve', { label: 'Return to draft', cls: 'btn', action: 'return', iconName: 'undo' }));
    b.push(permButton('po.approve', { label: 'Approve', cls: 'btn btn-primary', action: 'approve', iconName: 'check', allowed: canApprove(user, po.totalCents), reason: approveDenyReason(user, po.totalCents) }));
  }
  if (po.status === 'approved') b.push(permButton('po.order', { label: 'Mark as ordered', cls: 'btn btn-primary', action: 'order', iconName: 'send' }));
  if (po.status === 'ordered' || po.status === 'partially_received') b.push(permButton('po.receive', { label: 'Receive goods', cls: 'btn btn-primary', action: 'receive', iconName: 'inbox' }));
  if (['draft', 'pending', 'approved', 'ordered'].includes(po.status)) b.push(permButton('po.cancel', { label: 'Cancel PO', cls: 'btn btn-danger-ghost', action: 'cancel', iconName: 'ban' }));
  b.push(`<button type="button" class="btn btn-ghost" data-action="print">${icon('print')}<span>Print</span></button>`);
  return b.join('');
}

function banner(po, user) {
  if (po.status !== 'pending') return '';
  const over = po.totalCents > MANAGER_APPROVAL_LIMIT_CENTS;
  if (canApprove(user, po.totalCents)) {
    return `<div class="callout callout-action no-print" role="note">${icon('check')}<span><strong>Waiting for your approval.</strong> ${over ? 'This PO is over $5,000, so only an Admin can approve it.' : `Total is within the ${user.role === 'manager' ? 'Manager' : ''} approval limit of $5,000.`}</span></div>`;
  }
  return `<div class="callout callout-warn no-print" role="note">${icon('lock')}<span><strong>${esc(approveDenyReason(user, po.totalCents))}</strong></span></div>`;
}

function stepper(po) {
  if (po.status === 'cancelled') return '';
  const idx = STEPS.indexOf(po.status);
  const labels = { draft: 'Draft', pending: 'Pending approval', approved: 'Approved', ordered: 'Ordered', partially_received: 'Partially received', received: 'Received' };
  return `<ol class="stepper no-print" aria-label="Purchase order progress">${STEPS.map((s, i) => {
    const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
    if (s === 'partially_received' && po.status !== 'partially_received' && i > idx) return `<li class="todo dim"><span>${labels[s]}</span></li>`;
    return `<li class="${state}" ${state === 'current' ? 'aria-current="step"' : ''}><span>${labels[s]}</span>${state === 'done' ? '<span class="sr-only"> (done)</span>' : ''}</li>`;
  }).join('')}</ol>`;
}

export function receiveDialog(id) {
  const po = store.getPurchaseOrder(id);
  const body = `<p class="lead">Enter what arrived at <strong>${esc(po.warehouseName)}</strong>. Each line posts a Receipt movement. Leave a line at 0 if nothing arrived.</p>
    <div class="table-wrap"><table class="table grid-table recv-table"><caption class="sr-only">Quantities to receive</caption>
    <thead><tr><th scope="col">SKU</th><th scope="col" class="num">Outstanding</th><th scope="col" class="num">Receive now</th></tr></thead>
    <tbody>${po.lines.map((l, i) => l.outstanding > 0 ? `<tr><td><span class="mono">${esc(l.sku)}</span><div class="sub">${esc(l.name)}</div></td><td class="num">${qty(l.outstanding)}</td>
      <td class="num"><label class="sr-only" for="rcv-${i}">Receive now for ${esc(l.sku)}, up to ${l.outstanding}</label><input class="input mono-input qty-input" id="rcv-${i}" name="recv.${i}" data-sku="${esc(l.sku)}" data-max="${l.outstanding}" inputmode="numeric" value="0" autocomplete="off">${errSlot(`recv.${i}`)}</td></tr>` : '').join('')}</tbody></table></div>
    <div class="dlg-tools"><button type="button" class="btn btn-sm" data-fill>Fill all outstanding</button><span class="muted small" id="rcv-sum" aria-live="polite"></span></div>`;
  return openDialog({
    title: `Receive ${po.id}`,
    body,
    wide: true,
    submitLabel: 'Post receipt',
    onOpen(dlg) {
      const sum = () => {
        const t = [...dlg.querySelectorAll('[data-sku]')].reduce((a, i) => a + (parseIntStrict(i.value) || 0), 0);
        dlg.querySelector('#rcv-sum').textContent = `${formatQty(t)} unit${t === 1 ? '' : 's'} to receive.`;
      };
      dlg.querySelector('[data-fill]').addEventListener('click', () => {
        dlg.querySelectorAll('[data-sku]').forEach((i) => (i.value = i.dataset.max));
        sum();
      });
      dlg.addEventListener('input', sum);
      dlg.querySelectorAll('[data-sku]').forEach((i) => i.addEventListener('focus', () => i.select()));
      sum();
    },
    onSubmit(form) {
      const q = {};
      const errors = {};
      form.querySelectorAll('[data-sku]').forEach((i) => {
        const raw = i.value.trim() || '0';
        const n = parseIntStrict(raw);
        if (n === null || n < 0) errors[i.name] = 'Enter a whole number, 0 or more.';
        else q[i.dataset.sku] = n;
      });
      if (Object.keys(errors).length) throw new store.ValidationError(errors);
      const r = store.receivePO(id, q);
      toast(`Received ${plural(r.units, 'unit')} on ${id}. Status: ${store.PO_STATUS_LABELS[r.status].toLowerCase()}.`);
      return r;
    },
  });
}
