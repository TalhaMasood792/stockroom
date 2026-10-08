import * as store from '../store.js';
import { esc, formatDateTime, plural, isISODate, todayISO } from '../format.js';
import { ROLE_LABELS } from '../permissions.js';
import { toCSV } from '../csv.js';
import { setTitle, icon, renderChanges, pager, downloadFile, toast, emptyState, debounce } from '../ui.js';

const PAGE_SIZE = 30;
const ENTITY_LABELS = { product: 'Product', po: 'Purchase order', transfer: 'Transfer', supplier: 'Supplier', ledger: 'Ledger' };

function entityLink(a) {
  if (a.entityType === 'product') return `<a class="mono" href="#/products/${encodeURIComponent(a.entityId)}">${esc(a.entityLabel)}</a>`;
  if (a.entityType === 'po') return `<a class="mono" href="#/purchase-orders/${encodeURIComponent(a.entityId)}">${esc(a.entityLabel)}</a>`;
  if (a.entityType === 'transfer') return `<a class="mono" href="#/transfers?q=${encodeURIComponent(a.entityId)}">${esc(a.entityLabel)}</a>`;
  if (a.entityType === 'supplier') return `<a href="#/suppliers?q=${encodeURIComponent(a.entityLabel)}">${esc(a.entityLabel)}</a>`;
  return esc(a.entityLabel);
}

export function render(root, params) {
  setTitle('Audit log');
  const q = params.query;
  const s = { q: q.get('q') || '', user: q.get('user') || '', action: q.get('action') || '', entity: q.get('entity') || '', from: '', to: '', page: 1 };
  root.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Every change, who made it and what it was before</p><h1>Audit log</h1></div>
      <div class="head-actions"><button type="button" class="btn" data-action="export">${icon('download')}<span>Export CSV</span></button></div></div>
    <form class="filters" role="search" aria-label="Filter audit log">
      <div class="field grow"><label for="a-q">Search</label><div class="input-icon">${icon('search')}<input class="input" type="search" id="a-q" name="q" value="${esc(s.q)}" placeholder="SKU, PO number, note"></div></div>
      <div class="field"><label for="a-user">Who</label><select class="input" id="a-user" name="user"><option value="">Everyone</option>${store.getUsers().map((u) => `<option value="${u.id}">${esc(u.name)} · ${ROLE_LABELS[u.role]}</option>`).join('')}</select></div>
      <div class="field"><label for="a-ent">Entity</label><select class="input" id="a-ent" name="entity"><option value="">All entities</option>${Object.entries(ENTITY_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label for="a-act">Action</label><select class="input" id="a-act" name="action"><option value="">All actions</option>${Object.entries(store.ACTION_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="a-from">From</label><input class="input" type="date" id="a-from" name="from"></div>
      <div class="field"><label for="a-to">To</label><input class="input" type="date" id="a-to" name="to"></div>
    </form>
    <p class="result-count" id="a-count" aria-live="polite"></p>
    <div id="a-slot"></div>`;
  const form = root.querySelector('.filters');
  form.user.value = s.user;
  form.entity.value = s.entity;
  form.action.value = s.action;

  const filter = () => {
    const needle = s.q.trim().toLowerCase();
    return store.getAudit().filter((a) => {
      if (s.user && a.userId !== s.user) return false;
      if (s.entity && a.entityType !== s.entity) return false;
      if (s.action && a.action !== s.action) return false;
      if (s.from && a.at.slice(0, 10) < s.from) return false;
      if (s.to && a.at.slice(0, 10) > s.to) return false;
      if (needle) {
        const hay = `${a.entityLabel} ${a.entityId} ${a.note} ${a.who} ${store.ACTION_LABELS[a.action] || ''} ${(a.changes || []).map((c) => `${c.field} ${c.from} ${c.to}`).join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }).reverse();
  };
  const draw = () => {
    const rows = filter();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (s.page > pages) s.page = pages;
    const pr = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    root.querySelector('#a-count').textContent = `${plural(rows.length, 'entry', 'entries')}.`;
    const slot = root.querySelector('#a-slot');
    if (!rows.length) {
      slot.innerHTML = emptyState('No audit entries match', 'Widen the date range or clear a filter.');
      return;
    }
    slot.innerHTML = `<div class="table-wrap"><table class="table grid-table audit-table" id="audit-table"><caption class="sr-only">Audit log, newest first</caption>
      <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Before → after</th></tr></thead>
      <tbody>${pr.map((a) => `<tr>
        <td class="nowrap small"><time datetime="${esc(a.at)}">${esc(formatDateTime(a.at))}</time><div class="sub mono">${esc(a.id)}</div></td>
        <td class="nowrap">${esc(a.who)}<div class="sub"><span class="role-tag role-${a.role}">${esc(ROLE_LABELS[a.role])}</span></div></td>
        <td>${esc(store.ACTION_LABELS[a.action] || a.action)}</td>
        <td class="nowrap">${entityLink(a)}<div class="sub">${esc(ENTITY_LABELS[a.entityType] || a.entityType)}</div></td>
        <td class="changes-cell">${renderChanges(a.changes)}${a.note ? `<div class="sub">${esc(a.note)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${pager({ page: s.page, pageSize: PAGE_SIZE, total: rows.length, label: 'entries' })}`;
  };
  const onSearch = debounce(() => {
    s.q = form.q.value;
    s.page = 1;
    draw();
  }, 150);
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => e.target.name === 'q' && onSearch());
  form.addEventListener('change', (e) => {
    if (e.target.name === 'q') return;
    s.user = form.user.value;
    s.entity = form.entity.value;
    s.action = form.action.value;
    s.from = isISODate(form.from.value) ? form.from.value : '';
    s.to = isISODate(form.to.value) ? form.to.value : '';
    s.page = 1;
    draw();
  });
  root.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) {
      s.page = Number(pg.dataset.page);
      draw();
      root.querySelector('#audit-table')?.scrollIntoView({ block: 'start' });
      return;
    }
    if (e.target.closest('[data-action="export"]')) {
      const rows = filter();
      downloadFile(`stockroom-audit-${todayISO()}.csv`, toCSV([
        ['id', 'timestamp', 'user', 'role', 'action', 'entity_type', 'entity', 'changes', 'note'],
        ...rows.map((a) => [a.id, a.at, a.who, ROLE_LABELS[a.role], store.ACTION_LABELS[a.action] || a.action, a.entityType, a.entityLabel, (a.changes || []).map((c) => `${c.field}: ${c.from ?? ''} -> ${c.to ?? ''}`).join('; '), a.note || '']),
      ]));
      toast(`Exported ${plural(rows.length, 'entry', 'entries')} to CSV.`);
    }
  });
  draw();
  return { onStoreChange: draw };
}
