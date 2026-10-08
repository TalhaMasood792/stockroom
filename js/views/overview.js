import * as store from '../store.js';
import { esc, formatMoney, formatMoneyCompact, formatQty, formatDate, formatDateShort, formatDateTime, plural } from '../format.js';
import { MOVEMENT_TYPES, ADJUSTMENT_REASONS } from '../ledger.js';
import { setTitle, icon, stockBadge, skuLink, qty, permButton, openDialog, toast, errorMessage } from '../ui.js';
import { can } from '../permissions.js';

export function render(root) {
  setTitle('Overview');
  const draw = () => {
    const k = store.getKpis();
    const sug = store.getReorderSuggestions();
    root.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">Network overview · 3 warehouses</p><h1>Overview</h1></div>
        <div class="head-actions">
          <a class="btn" href="#/transfers">${icon('transfers')}<span>New transfer</span></a>
          ${permButton('po.create', { label: 'Create PO from suggestions', cls: 'btn btn-primary', action: 'from-suggestions', iconName: 'pos', allowed: can(store.getCurrentUser(), 'po.create') && sug.items.length > 0, reason: sug.items.length ? '' : 'Nothing needs reordering right now.' })}
        </div>
      </div>
      <section class="kpis" aria-label="Key figures">
        ${kpi('Inventory value at cost', formatMoney(k.inventoryValueCents), `${formatQty(k.unitsOnHand)} units on hand`, '', '#/products')}
        ${kpi('SKUs below reorder point', formatQty(k.belowReorder), `of ${k.skuCount} active SKUs`, k.belowReorder ? 'low' : '', '#/products?status=low')}
        ${kpi('Out-of-stock SKUs', formatQty(k.outOfStock), k.outOfStock ? 'Nothing available to sell' : 'Every SKU has stock', k.outOfStock ? 'out' : '', '#/products?status=out')}
        ${kpi('Open PO value', formatMoney(k.openPoValueCents), `${plural(k.openPoCount, 'open order')} · ${k.awaitingApproval} awaiting approval`, '', '#/purchase-orders?status=open')}
      </section>
      <div class="grid-2">
        <section class="card" aria-labelledby="wh-h">
          <div class="card-head"><h2 id="wh-h">Inventory value by warehouse</h2><span class="muted small">At unit cost</span></div>
          <div class="card-body">${warehouseChart()}</div>
        </section>
        <section class="card" aria-labelledby="flow-h">
          <div class="card-head"><h2 id="flow-h">Units in vs out, last 30 days</h2>
            <div class="legend" aria-hidden="true"><span><i class="sw sw-in"></i>In</span><span><i class="sw sw-out"></i>Out</span></div></div>
          <div class="card-body">${flowChart()}</div>
        </section>
      </div>
      <div class="grid-2 grid-2-wide">
        <section class="card" aria-labelledby="sug-h">
          <div class="card-head"><h2 id="sug-h">Reorder suggestions</h2><span class="muted small">${plural(sug.items.length, 'SKU')} · ${plural(sug.groups.length, 'supplier')}</span></div>
          ${suggestions(sug)}
        </section>
        <section class="card" aria-labelledby="feed-h">
          <div class="card-head"><h2 id="feed-h">Recent movements</h2><a class="small" href="#/audit">Audit log</a></div>
          ${feed()}
        </section>
      </div>`;
    wireChart(root);
    root.querySelector('[data-action="from-suggestions"]')?.addEventListener('click', () => fromSuggestionsDialog());
  };
  draw();
  return { onStoreChange: draw };
}

function kpi(label, value, sub, tone, href) {
  return `<a class="kpi ${tone ? 'kpi-' + tone : ''}" href="${href}">
    <span class="kpi-label">${esc(label)}</span>
    <span class="kpi-value mono">${esc(value)}</span>
    <span class="kpi-sub">${esc(sub)}</span></a>`;
}

function warehouseChart() {
  const data = store.getValueByWarehouse();
  const max = Math.max(...data.map((d) => d.valueCents), 1);
  const nice = niceMax(max / 100) * 100;
  const total = data.reduce((t, d) => t + d.valueCents, 0);
  const rows = data.map((d) => {
    const pct = (d.valueCents / nice) * 100;
    const share = total ? Math.round((d.valueCents / total) * 100) : 0;
    return `<div class="hbar-row" data-tip="${esc(`${d.name}: ${formatMoney(d.valueCents)} · ${formatQty(d.units)} units · ${share}% of total`)}" tabindex="0" role="img" aria-label="${esc(`${d.name}: ${formatMoney(d.valueCents)}, ${share}% of inventory value`)}">
      <span class="hbar-label"><span class="mono wh-code">${esc(d.id)}</span> ${esc(d.name)}</span>
      <span class="hbar-track">${[25, 50, 75, 100].map((g) => `<span class="gl" style="left:${g}%"></span>`).join('')}<span class="hbar-fill" style="width:${pct.toFixed(2)}%"></span></span>
      <span class="hbar-val mono">${esc(formatMoneyCompact(d.valueCents))}<span class="muted"> · ${share}%</span></span>
    </div>`;
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${esc(formatMoneyCompact(nice * f))}</span>`).join('');
  const products = store.getProducts();
  const stats = `<div class="table-wrap wh-stats"><table class="table compact grid-table">
    <caption class="sr-only">Stock health by warehouse</caption>
    <thead><tr><th scope="col">Warehouse</th><th scope="col" class="num">Units</th><th scope="col" class="num">Allocated</th><th scope="col" class="num"><abbr title="SKUs with zero on hand">At zero</abbr></th></tr></thead>
    <tbody>${data.map((d) => `<tr><td>${esc(d.name)}</td><td class="num mono">${formatQty(d.units)}</td><td class="num mono">${formatQty(products.reduce((t, p) => t + p.stock[d.id].allocated, 0))}</td><td class="num mono">${products.filter((p) => p.stock[d.id].onHand <= 0).length}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="hbar" data-chart>${rows}<div class="hbar-axis" aria-hidden="true"><span class="hbar-label"></span><span class="hbar-ticks">${ticks}</span><span class="hbar-val"></span></div><div class="chart-tip" role="presentation" hidden></div></div>${stats}`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function flowChart() {
  const days = store.getDailyFlows(30);
  const W = 640, H = 240, padL = 44, padR = 8, padT = 12, padB = 26;
  const maxIn = niceMax(Math.max(...days.map((d) => d.in), 1));
  const maxOut = niceMax(Math.max(...days.map((d) => d.out), 1));
  const top = Math.max(maxIn, maxOut);
  const plotH = H - padT - padB;
  const zeroY = padT + plotH / 2;
  const scale = (plotH / 2) / top;
  const slot = (W - padL - padR) / days.length;
  const bw = Math.max(3, slot - 4);
  let bars = '';
  let hits = '';
  days.forEach((d, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    const hIn = d.in * scale;
    const hOut = d.out * scale;
    if (d.in) bars += `<path class="bar-in" d="${roundedBar(x, zeroY - 1 - hIn, bw, hIn, 'up')}"/>`;
    if (d.out) bars += `<path class="bar-out" d="${roundedBar(x, zeroY + 1, bw, hOut, 'down')}"/>`;
    hits += `<rect class="hit" x="${(padL + i * slot).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH}" data-i="${i}" data-tip="${esc(`${formatDate(d.date)} — In ${formatQty(d.in)} · Out ${formatQty(d.out)} · Net ${d.in - d.out >= 0 ? '+' : '−'}${formatQty(Math.abs(d.in - d.out))}`)}"/>`;
  });
  const grid = [top, top / 2, 0, -top / 2, -top].map((v) => {
    const y = zeroY - v * scale;
    return `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text class="tick" x="${padL - 6}" y="${y + 4}" text-anchor="end">${formatQty(Math.abs(v))}</text>`;
  }).join('');
  const xt = days.map((d, i) => (i % 7 === 0 && i < days.length - 4) || i === days.length - 1 ? `<text class="tick" x="${padL + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(formatDateShort(d.date))}</text>` : '').join('');
  const totIn = days.reduce((t, d) => t + d.in, 0);
  const totOut = days.reduce((t, d) => t + d.out, 0);
  const table = `<details class="chart-table"><summary>Show data as a table</summary><div class="table-wrap"><table class="table compact">
    <caption class="sr-only">Units received and shipped per day, last 30 days</caption>
    <thead><tr><th scope="col">Date</th><th scope="col" class="num">In</th><th scope="col" class="num">Out</th><th scope="col" class="num">Net</th></tr></thead>
    <tbody>${days.map((d) => `<tr><td>${esc(formatDate(d.date))}</td><td class="num mono">${formatQty(d.in)}</td><td class="num mono">${formatQty(d.out)}</td><td class="num mono">${d.in - d.out >= 0 ? '+' : '−'}${formatQty(Math.abs(d.in - d.out))}</td></tr>`).join('')}</tbody></table></div></details>`;
  return `<div class="flow-summary"><span><span class="eyebrow">In</span> <span class="mono">${formatQty(totIn)}</span></span><span><span class="eyebrow">Out</span> <span class="mono">${formatQty(totOut)}</span></span><span class="muted small">Receipts and positive adjustments vs shipments and write-offs. Transfers are internal and excluded.</span></div>
    <div class="flow" data-chart><svg viewBox="0 0 ${W} ${H}" class="flow-svg" role="img" aria-label="Daily units in versus out over the last 30 days: ${formatQty(totIn)} in, ${formatQty(totOut)} out. A data table follows.">
      <text class="axis-cap" x="${padL}" y="${padT + 10}" dx="4">In ↑</text><text class="axis-cap" x="${padL}" y="${H - padB - 4}" dx="4">Out ↓</text>
      ${grid}${bars}<rect class="hover-col" x="0" y="${padT}" width="${slot}" height="${plotH}"/>${xt}${hits}</svg>
      <div class="chart-tip" role="presentation" hidden></div></div>${table}`;
}

/** Bar path with 2px rounded data-end, square at the baseline. */
function roundedBar(x, y, w, h, dir) {
  const r = Math.min(2, h / 2, w / 2);
  if (h <= 0) return '';
  if (dir === 'up') return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
}

function wireChart(root) {
  root.querySelectorAll('[data-chart]').forEach((host) => {
    const tip = host.querySelector('.chart-tip');
    const col = host.querySelector('.hover-col');
    const show = (target, clientX, clientY) => {
      tip.textContent = target.dataset.tip;
      tip.hidden = false;
      const box = host.getBoundingClientRect();
      let x = clientX - box.left + 12;
      const y = clientY - box.top - 36;
      const w = tip.offsetWidth;
      if (x + w > box.width) x = clientX - box.left - w - 12;
      tip.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
      if (col && target.dataset.i !== undefined) {
        col.setAttribute('x', target.getAttribute('x'));
        col.classList.add('on');
      }
    };
    const hide = () => {
      tip.hidden = true;
      if (col) col.classList.remove('on');
    };
    host.addEventListener('pointermove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t) show(t, e.clientX, e.clientY);
      else hide();
    });
    host.addEventListener('pointerleave', hide);
    host.addEventListener('focusin', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return;
      const r = t.getBoundingClientRect();
      show(t, r.left + r.width / 2, r.top + 20);
    });
    host.addEventListener('focusout', hide);
  });
}

function suggestions(sug) {
  if (!sug.items.length) return '<p class="empty-inline">Every SKU is above its reorder point once open orders arrive. Nothing to reorder.</p>';
  const rows = sug.items.slice(0, 8).map((s) => `<tr>
      <td>${skuLink(s.sku)}<div class="sub">${esc(s.name)}</div></td>
      <td class="hide-sm">${esc(s.supplierName)}</td>
      <td class="num">${qty(s.available)}<span class="muted small"> / ${formatQty(s.reorderPoint)}</span></td>
      <td class="num">${qty(s.qty)}</td>
      <td>${stockBadge(s.status)}</td></tr>`).join('');
  return `<div class="table-wrap"><table class="table compact sug-table">
    <caption class="sr-only">SKUs at or below their reorder point, including stock already on order</caption>
    <thead><tr><th scope="col">SKU</th><th scope="col" class="hide-sm">Supplier</th><th scope="col" class="num">Avail. / pt</th><th scope="col" class="num">Suggest</th><th scope="col">Status</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${sug.items.length > 8 ? `<p class="card-foot"><a href="#/products?status=reorder">See all ${sug.items.length} SKUs to reorder</a></p>` : ''}`;
}

function feed() {
  const mv = store.getMovements().slice(-9).reverse();
  return `<ol class="feed">${mv.map((m) => {
    const t = MOVEMENT_TYPES[m.type];
    const label = m.type === 'adjustment' ? `${t.label} · ${ADJUSTMENT_REASONS[m.reason]?.label ?? ''}` : t.label;
    return `<li><span class="mv-tag mv-${m.type}">${esc(label)}</span>
      <span class="feed-main">${skuLink(m.sku)} <span class="muted">at ${esc(store.warehouseName(m.warehouse))}</span>${m.ref ? ` <span class="muted">·</span> ${refLink(m.ref)}` : ''}</span>
      <span class="feed-qty">${qty(m.qty, 'signed')}</span>
      <span class="feed-when muted small"><time datetime="${esc(m.at)}">${esc(formatDateTime(m.at))}</time></span></li>`;
  }).join('')}</ol>`;
}
export function refLink(ref) {
  if (ref.startsWith('PO-')) return `<a class="mono small" href="#/purchase-orders/${encodeURIComponent(ref)}">${esc(ref)}</a>`;
  if (ref.startsWith('TR-')) return `<a class="mono small" href="#/transfers?q=${encodeURIComponent(ref)}">${esc(ref)}</a>`;
  return `<span class="mono small">${esc(ref)}</span>`;
}

/** Dialog: pick suppliers and a receiving warehouse; creates one draft PO per supplier. */
export function fromSuggestionsDialog() {
  const { groups } = store.getReorderSuggestions();
  const whs = store.getWarehouses();
  const body = `<p class="lead">Each supplier becomes one draft PO with the suggested quantities (the product’s reorder qty). You can edit drafts before submitting them.</p>
    <fieldset class="field"><legend>Suppliers</legend>
    <div class="check-list">${groups.map((g) => `<label class="check-row"><input type="checkbox" name="supplier" value="${esc(g.supplierId)}" checked>
      <span><strong>${esc(g.supplierName)}</strong><span class="sub">${plural(g.items.length, 'SKU')}: ${g.items.map((i) => esc(i.sku)).join(', ')}</span></span>
      <span class="mono">${esc(formatMoney(g.totalCents))}</span></label>`).join('')}</div></fieldset>
    <div class="field"><label for="sg-wh">Receiving warehouse</label>
      <select class="input" id="sg-wh" name="warehouse">${whs.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></div>`;
  openDialog({
    title: 'Create POs from reorder suggestions',
    body,
    wide: true,
    submitLabel: 'Create draft POs',
    onSubmit(form) {
      const supplierIds = [...form.querySelectorAll('input[name="supplier"]:checked')].map((i) => i.value);
      const ids = store.createPOsFromSuggestions({ supplierIds, warehouse: form.warehouse.value });
      return ids;
    },
  }).then((ids) => {
    if (!ids) return;
    toast(`Created ${plural(ids.length, 'draft PO')}: ${ids.join(', ')}.`);
    location.hash = ids.length === 1 ? `#/purchase-orders/${ids[0]}` : '#/purchase-orders?status=draft';
  }).catch((e) => toast(errorMessage(e), { error: true }));
}
