// Data layer: owns state, persistence, permission checks and the audit log.
// Every mutation goes through `mutate()`, which (1) checks the signed-in
// user's permission, (2) validates, (3) applies the change on a snapshot,
// (4) appends an audit entry, and (5) persists and notifies subscribers.
// Stock is never written directly: it is derived from the movement ledger.
import { buildSeed, WAREHOUSES } from './seed.js';
import { USERS, ROLE_LABELS, assertCan, assertCanApprove, PermissionError, can } from './permissions.js';
import * as L from './ledger.js';
import { todayISO, nowStamp, isISODate, formatMoney, addDays, daysBetween } from './format.js';

const DATA_KEY = 'stockroom:data:v1';
const USER_KEY = 'stockroom:user';

export class ValidationError extends Error {
  constructor(errors, message) {
    super(message || Object.values(errors)[0] || 'Some fields need attention.');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}
export { PermissionError };

export const PO_STATUS_LABELS = Object.freeze({
  draft: 'Draft', pending: 'Pending approval', approved: 'Approved', ordered: 'Ordered',
  partially_received: 'Partially received', received: 'Received', cancelled: 'Cancelled',
});
export const PO_FLOW = ['draft', 'pending', 'approved', 'ordered', 'partially_received', 'received'];
export const OPEN_PO_STATUSES = ['draft', 'pending', 'approved', 'ordered', 'partially_received'];

export const ACTION_LABELS = Object.freeze({
  'stock.opening': 'Opening stock loaded',
  'stock.adjust': 'Stock adjusted',
  'transfer.create': 'Transfer posted',
  'po.create': 'Purchase order created',
  'po.update': 'Draft purchase order edited',
  'po.submit': 'Submitted for approval',
  'po.approve': 'Purchase order approved',
  'po.return': 'Returned to draft',
  'po.order': 'Order placed with supplier',
  'po.receive': 'Goods received',
  'po.cancel': 'Purchase order cancelled',
  'product.create': 'Product added',
  'product.update': 'Product edited',
  'product.reorder': 'Reorder settings changed',
  'product.import': 'Reorder points imported',
  'supplier.create': 'Supplier added',
  'supplier.update': 'Supplier edited',
});

// ---------- safe storage ----------
const memory = new Map();
let storageOk = true;
function readStorage(k) {
  try {
    const v = globalThis.localStorage.getItem(k);
    return v ?? memory.get(k) ?? null;
  } catch {
    storageOk = false;
    return memory.get(k) ?? null;
  }
}
function writeStorage(k, value) {
  memory.set(k, value);
  try {
    globalThis.localStorage.setItem(k, value);
  } catch {
    storageOk = false;
  }
}
function removeStorage(k) {
  memory.delete(k);
  try {
    globalThis.localStorage.removeItem(k);
  } catch {
    storageOk = false;
  }
}
export function isPersistent() {
  return storageOk;
}

// ---------- state ----------
let state = null;
let currentUserId = USERS[0].id;
let version = 0;
const listeners = new Set();
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function isValidState(s) {
  return s && s.version === 1 && ['products', 'movements', 'purchaseOrders', 'suppliers', 'audit', 'salesOrders', 'transfers'].every((k) => Array.isArray(s[k]));
}

export function init() {
  const raw = readStorage(DATA_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) state = parsed;
    } catch {
      /* corrupted: reseed below */
    }
  }
  if (!state) {
    state = buildSeed(todayISO());
    persist();
  }
  const uid = readStorage(USER_KEY);
  if (uid && USERS.some((u) => u.id === uid)) currentUserId = uid;
  version++;
}
function persist() {
  writeStorage(DATA_KEY, JSON.stringify(state));
}
function emit(evt) {
  for (const fn of listeners) {
    try {
      fn(evt);
    } catch (e) {
      console.error(e);
    }
  }
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function resetDemoData() {
  removeStorage(DATA_KEY);
  state = buildSeed(todayISO());
  persist();
  version++;
  emit({ type: 'reset' });
}

// ---------- users ----------
export function getUsers() {
  return USERS;
}
export function getCurrentUser() {
  return USERS.find((u) => u.id === currentUserId) ?? USERS[0];
}
export function setCurrentUser(id) {
  if (!USERS.some((u) => u.id === id)) throw new Error('Unknown user');
  currentUserId = id;
  writeStorage(USER_KEY, id);
  emit({ type: 'user' });
}
export function userName(id) {
  if (id === 'system') return 'Sales order sync';
  return USERS.find((u) => u.id === id)?.name ?? 'Unknown user';
}
export function can_(perm) {
  return can(getCurrentUser(), perm);
}

// ---------- audit + mutation ----------
function audit(action, entityType, entityId, entityLabel, changes = [], note = '') {
  const u = getCurrentUser();
  state.seq.audit += 1;
  const entry = {
    id: `AU-${String(state.seq.audit).padStart(5, '0')}`,
    at: nowStamp(), userId: u.id, who: u.name, role: u.role,
    action, entityType, entityId, entityLabel, changes, note,
  };
  state.audit.push(entry);
  return entry;
}

/** Permission-checked, atomic mutation: on any error the state is rolled back. */
function mutate(permission, fn) {
  if (permission) assertCan(getCurrentUser(), permission);
  const snapshot = clone(state);
  try {
    const result = fn();
    version++;
    persist();
    emit({ type: 'change', permission });
    return result;
  } catch (e) {
    state = snapshot;
    version++;
    throw e;
  }
}

// ---------- derived stock (memoised per state version) ----------
let cache = { v: -1 };
function derived() {
  if (cache.v === version) return cache;
  const balances = L.computeBalances(state.movements);
  const allocations = L.computeAllocations(state.salesOrders);
  const onOrder = new Map(); // sku → outstanding units on approved/ordered/partial POs
  for (const po of state.purchaseOrders) {
    if (!['pending', 'approved', 'ordered', 'partially_received', 'draft'].includes(po.status)) continue;
    for (const l of po.lines) {
      const out = l.qty - receivedQty(po, l.sku);
      if (out > 0) onOrder.set(l.sku, (onOrder.get(l.sku) || 0) + out);
    }
  }
  cache = { v: version, balances, allocations, onOrder, products: null };
  return cache;
}
function receivedQty(po, sku) {
  let t = 0;
  for (const m of state.movements) if (m.type === 'receipt' && m.ref === po.id && m.sku === sku) t += m.qty;
  return t;
}
const whIds = () => state.warehouses.map((w) => w.id);
const whNames = () => Object.fromEntries(state.warehouses.map((w) => [w.id, w.name]));

// ---------- reads ----------
export function today() {
  return todayISO();
}
export function getWarehouses() {
  return state.warehouses;
}
export function warehouseName(id) {
  return state.warehouses.find((w) => w.id === id)?.name ?? id;
}
export function getCategories() {
  return state.categories;
}
export function getSuppliers() {
  const pos = getPurchaseOrders();
  return state.suppliers.map((s) => ({
    ...s,
    productCount: state.products.filter((p) => p.supplierId === s.id).length,
    openPoValueCents: pos.filter((p) => p.supplierId === s.id && p.isOpen).reduce((t, p) => t + p.outstandingValueCents, 0),
    openPoCount: pos.filter((p) => p.supplierId === s.id && p.isOpen).length,
  }));
}
export function getSupplier(id) {
  return getSuppliers().find((s) => s.id === id) ?? null;
}
function supplierName(id) {
  return state.suppliers.find((s) => s.id === id)?.name ?? 'Unknown supplier';
}

/** Products enriched with derived stock position and status. */
export function getProducts() {
  const d = derived();
  if (d.products) return d.products;
  const ids = whIds();
  d.products = state.products.map((p) => {
    const pos = L.stockPosition(d.balances, d.allocations, p.sku, ids);
    return {
      ...p,
      supplierName: supplierName(p.supplierId),
      stock: pos.byWarehouse,
      onHand: pos.total.onHand,
      allocated: pos.total.allocated,
      available: pos.total.available,
      onOrder: d.onOrder.get(p.sku) || 0,
      status: L.stockStatus(pos.total.available, p.reorderPoint),
      valueCents: pos.total.onHand * p.unitCostCents,
    };
  });
  return d.products;
}
export function getProduct(sku) {
  return getProducts().find((p) => p.sku === sku) ?? null;
}
export function getMovements() {
  return state.movements;
}
/** Chronological movement history for a SKU with running balance per warehouse. */
export function getMovementHistory(sku) {
  return L.runningBalances(state.movements, sku);
}
export function getTransfers() {
  return [...state.transfers].sort((a, b) => (a.at < b.at ? 1 : -1));
}
export function getSalesOrders() {
  return state.salesOrders;
}
export function getAudit() {
  return state.audit;
}
export function getAuditFor(entityType, entityId) {
  return state.audit.filter((a) => a.entityType === entityType && a.entityId === entityId);
}

function poView(po) {
  const lines = po.lines.map((l) => {
    const received = receivedQty(po, l.sku);
    const product = state.products.find((p) => p.sku === l.sku);
    return { ...l, name: product?.name ?? 'Unknown product', received, outstanding: Math.max(0, l.qty - received), lineTotalCents: l.qty * l.unitCostCents };
  });
  const totalCents = lines.reduce((t, l) => t + l.lineTotalCents, 0);
  const receivedValueCents = lines.reduce((t, l) => t + Math.min(l.received, l.qty) * l.unitCostCents, 0);
  const isOpen = OPEN_PO_STATUSES.includes(po.status);
  return {
    ...po, lines, totalCents,
    supplierName: supplierName(po.supplierId),
    warehouseName: warehouseName(po.warehouse),
    unitsOrdered: lines.reduce((t, l) => t + l.qty, 0),
    unitsReceived: lines.reduce((t, l) => t + Math.min(l.qty, l.received), 0),
    isOpen,
    outstandingValueCents: isOpen ? totalCents - receivedValueCents : 0,
    isLate: ['approved', 'ordered', 'partially_received'].includes(po.status) && po.expectedDate < todayISO(),
  };
}
export function getPurchaseOrders() {
  return state.purchaseOrders.map(poView).sort((a, b) => (a.id < b.id ? 1 : -1));
}
export function getPurchaseOrder(id) {
  const po = state.purchaseOrders.find((p) => p.id === id);
  return po ? poView(po) : null;
}
function rawPO(id) {
  const po = state.purchaseOrders.find((p) => p.id === id);
  if (!po) throw new NotFoundError(`Purchase order ${id} doesn’t exist.`);
  return po;
}

/**
 * SKUs that need reordering: available + already on order ≤ reorder point.
 * Grouped by supplier; suggested qty is the product's reorder qty (topped up
 * if one reorder qty wouldn't lift it back above the reorder point).
 */
export function getReorderSuggestions() {
  const items = getProducts()
    .filter((p) => p.available + p.onOrder <= p.reorderPoint)
    .map((p) => {
      const gap = p.reorderPoint - (p.available + p.onOrder);
      const qty = Math.max(p.reorderQty, gap + 1);
      return { sku: p.sku, name: p.name, supplierId: p.supplierId, supplierName: p.supplierName, available: p.available, onOrder: p.onOrder, reorderPoint: p.reorderPoint, qty, unitCostCents: p.unitCostCents, status: p.status };
    })
    .sort((a, b) => a.available - a.reorderPoint - (b.available - b.reorderPoint));
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.supplierId)) groups.set(it.supplierId, { supplierId: it.supplierId, supplierName: it.supplierName, items: [], totalCents: 0 });
    const g = groups.get(it.supplierId);
    g.items.push(it);
    g.totalCents += it.qty * it.unitCostCents;
  }
  return { items, groups: [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.supplierName.localeCompare(b.supplierName)) };
}

export function getKpis() {
  const products = getProducts();
  const pos = getPurchaseOrders();
  return {
    inventoryValueCents: products.reduce((t, p) => t + p.valueCents, 0),
    unitsOnHand: products.reduce((t, p) => t + p.onHand, 0),
    belowReorder: products.filter((p) => p.status === 'low').length,
    outOfStock: products.filter((p) => p.status === 'out').length,
    skuCount: products.length,
    openPoValueCents: pos.filter((p) => p.isOpen && p.status !== 'draft').reduce((t, p) => t + p.outstandingValueCents, 0),
    openPoCount: pos.filter((p) => p.isOpen && p.status !== 'draft').length,
    awaitingApproval: pos.filter((p) => p.status === 'pending').length,
  };
}
export function getValueByWarehouse() {
  const products = getProducts();
  return state.warehouses.map((w) => ({
    id: w.id, name: w.name,
    valueCents: products.reduce((t, p) => t + p.stock[w.id].onHand * p.unitCostCents, 0),
    units: products.reduce((t, p) => t + p.stock[w.id].onHand, 0),
  }));
}
export function getDailyFlows(days = 30) {
  const t = todayISO();
  return L.dailyFlows(state.movements, addDays(t, -(days - 1)), t);
}

// ---------- stock mutations ----------
function postMovements(batch) {
  const d = derived();
  state.movements = L.appendMovements(state.movements, batch, { balances: d.balances, names: whNames() });
}
function nextMovementId() {
  state.seq.movement += 1;
  return `MV-${String(state.seq.movement).padStart(6, '0')}`;
}
function requireProduct(sku) {
  const p = state.products.find((x) => x.sku === sku);
  if (!p) throw new ValidationError({ sku: `SKU ${sku || '(blank)'} doesn’t exist. Pick a product from the list.` });
  return p;
}
function wrapLedger(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof L.LedgerError) throw new ValidationError({ [e.field || 'form']: e.message });
    throw e;
  }
}

/** Adjustment: signed qty with a reason code. Note is required for Damaged and Lost. */
export function adjustStock({ sku, warehouse, qty, reason, note = '' }) {
  return mutate('stock.adjust', () => {
    const errors = {};
    const product = state.products.find((x) => x.sku === sku);
    if (!product) errors.sku = 'Pick a product.';
    if (!whIds().includes(warehouse)) errors.warehouse = 'Choose the warehouse where the count changed.';
    if (!L.ADJUSTMENT_REASONS[reason]) errors.reason = 'Choose a reason code. Every adjustment needs one for the audit trail.';
    if (!Number.isInteger(qty) || qty === 0) errors.qty = 'Enter a whole number other than zero. Use a minus sign to remove stock, for example −3.';
    if ((reason === 'damaged' || reason === 'lost') && !String(note).trim()) errors.note = 'Add a short note explaining what happened, for example “Dropped during picking”.';
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const before = L.onHand(null, sku, warehouse, derived().balances);
    const m = { id: nextMovementId(), type: 'adjustment', reason, sku, warehouse, qty, at: nowStamp(), by: getCurrentUser().id, ref: '', note: String(note).trim() };
    wrapLedger(() => postMovements([m]));
    audit('stock.adjust', 'product', sku, sku, [{ field: `On hand · ${warehouseName(warehouse)}`, from: before, to: before + qty }], `${L.ADJUSTMENT_REASONS[reason].label}${m.note ? ': ' + m.note : ''}`);
    return m;
  });
}

export function createTransfer({ sku, from, to, qty, note = '' }) {
  return mutate('transfer.create', () => {
    requireProduct(sku);
    const d = derived();
    const avail = from ? L.position(d.balances, d.allocations, sku, from).available : 0;
    state.seq.transfer += 1;
    const id = `TR-2026-${String(state.seq.transfer).padStart(4, '0')}`;
    const at = nowStamp();
    const by = getCurrentUser().id;
    const pair = wrapLedger(() => L.buildTransfer({ id, sku, from, to, qty, at, by, note: String(note).trim() }, avail, whNames()));
    pair.forEach((m) => (m.id = nextMovementId()));
    wrapLedger(() => postMovements(pair));
    const tr = { id, sku, from, to, qty, at, by, note: String(note).trim() };
    state.transfers.push(tr);
    audit('transfer.create', 'transfer', id, id, [{ field: 'Quantity', from: '', to: qty }], `${qty} × ${sku} from ${warehouseName(from)} to ${warehouseName(to)}.`);
    return tr;
  });
}

// ---------- products ----------
export function updateReorder(sku, { reorderPoint, reorderQty }) {
  return mutate('product.reorder', () => {
    const p = requireProduct(sku);
    const errors = {};
    if (!Number.isInteger(reorderPoint) || reorderPoint < 0) errors.reorderPoint = 'Enter a whole number of units, 0 or more.';
    if (!Number.isInteger(reorderQty) || reorderQty < 1) errors.reorderQty = 'Enter a whole number of units, 1 or more.';
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const changes = [];
    if (p.reorderPoint !== reorderPoint) changes.push({ field: 'Reorder point', from: p.reorderPoint, to: reorderPoint });
    if (p.reorderQty !== reorderQty) changes.push({ field: 'Reorder qty', from: p.reorderQty, to: reorderQty });
    if (!changes.length) return p;
    p.reorderPoint = reorderPoint;
    p.reorderQty = reorderQty;
    audit('product.reorder', 'product', sku, sku, changes);
    return p;
  });
}

export function updateProduct(sku, { name, category, supplierId, unitCostCents }) {
  return mutate('product.edit', () => {
    const p = requireProduct(sku);
    const errors = {};
    if (!String(name || '').trim()) errors.name = 'Enter a product name.';
    if (!state.categories.includes(category)) errors.category = 'Choose a category.';
    if (!state.suppliers.some((s) => s.id === supplierId)) errors.supplierId = 'Choose a supplier.';
    if (!Number.isInteger(unitCostCents) || unitCostCents <= 0) errors.unitCost = 'Enter a unit cost above zero, such as 42.50.';
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const changes = [];
    const set = (field, label, val, show = (v) => v) => {
      if (p[field] !== val) {
        changes.push({ field: label, from: show(p[field]), to: show(val) });
        p[field] = val;
      }
    };
    set('name', 'Name', String(name).trim());
    set('category', 'Category', category);
    set('supplierId', 'Supplier', supplierId, supplierName);
    set('unitCostCents', 'Unit cost', unitCostCents, formatMoney);
    if (changes.length) audit('product.update', 'product', sku, sku, changes);
    return p;
  });
}

/** Apply validated import rows (from csv.validateReorderImport). Only error-free rows are applied. */
export function applyReorderImport(rows) {
  const valid = rows.filter((r) => !r.errors.length);
  const hasNew = valid.some((r) => r.kind === 'new');
  return mutate('product.import', () => {
    if (hasNew) assertCan(getCurrentUser(), 'product.edit');
    if (!valid.length) throw new ValidationError({ form: 'There are no valid rows to apply. Fix the errors in the file and upload it again.' });
    let updated = 0;
    let created = 0;
    for (const r of valid) {
      if (r.kind === 'new') {
        if (state.products.some((p) => p.sku === r.sku)) throw new ValidationError({ form: `${r.sku} already exists. Upload the file again to refresh the preview.` });
        state.products.push({ sku: r.sku, name: r.values.name, category: r.values.category, supplierId: r.values.supplierId, unitCostCents: r.values.unitCostCents, reorderPoint: r.values.reorderPoint, reorderQty: r.values.reorderQty, createdAt: todayISO() });
        audit('product.create', 'product', r.sku, r.sku, [{ field: 'Reorder point', from: '', to: r.values.reorderPoint }, { field: 'Unit cost', from: '', to: formatMoney(r.values.unitCostCents) }], `Added by CSV import: ${r.values.name}.`);
        created++;
      } else {
        const p = requireProduct(r.sku);
        const changes = [];
        if (p.reorderPoint !== r.values.reorderPoint) changes.push({ field: 'Reorder point', from: p.reorderPoint, to: r.values.reorderPoint });
        if (r.values.reorderQty !== undefined && p.reorderQty !== r.values.reorderQty) changes.push({ field: 'Reorder qty', from: p.reorderQty, to: r.values.reorderQty });
        if (!changes.length) continue;
        p.reorderPoint = r.values.reorderPoint;
        if (r.values.reorderQty !== undefined) p.reorderQty = r.values.reorderQty;
        audit('product.import', 'product', r.sku, r.sku, changes, 'Updated by CSV import.');
        updated++;
      }
    }
    return { updated, created, skipped: valid.length - updated - created };
  });
}

// ---------- purchase orders ----------
function validatePOInput({ supplierId, warehouse, expectedDate, lines }) {
  const errors = {};
  if (!state.suppliers.some((s) => s.id === supplierId)) errors.supplierId = 'Choose a supplier.';
  if (!whIds().includes(warehouse)) errors.warehouse = 'Choose the warehouse that will receive the goods.';
  if (!isISODate(expectedDate || '')) errors.expectedDate = 'Enter the expected delivery date.';
  const clean = [];
  const seen = new Set();
  (lines || []).forEach((l, i) => {
    if (!l.sku && !l.qty && !l.unitCostCents) return; // ignore fully blank rows
    if (!state.products.some((p) => p.sku === l.sku)) errors[`lines.${i}.sku`] = 'Choose a product for this line.';
    else if (seen.has(l.sku)) errors[`lines.${i}.sku`] = `${l.sku} is already on another line. Combine the quantities into one line.`;
    seen.add(l.sku);
    if (!Number.isInteger(l.qty) || l.qty <= 0) errors[`lines.${i}.qty`] = 'Enter a whole number of units above zero.';
    if (!Number.isInteger(l.unitCostCents) || l.unitCostCents <= 0) errors[`lines.${i}.unitCost`] = 'Enter a unit cost above zero.';
    clean.push({ sku: l.sku, qty: l.qty, unitCostCents: l.unitCostCents });
  });
  if (!clean.length && !Object.keys(errors).some((k) => k.startsWith('lines'))) errors.lines = 'Add at least one line with a product, quantity and unit cost.';
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return clean;
}
const poTotal = (lines) => lines.reduce((t, l) => t + l.qty * l.unitCostCents, 0);

export function nextPONumber() {
  return `PO-2026-${String(state.seq.po + 1).padStart(4, '0')}`;
}

/** Create a PO as a draft, or submit it straight for approval with `submit: true`. */
export function createPurchaseOrder(input, { submit = false } = {}) {
  return mutate('po.create', () => {
    if (submit) assertCan(getCurrentUser(), 'po.submit');
    const lines = validatePOInput(input);
    state.seq.po += 1;
    const id = `PO-2026-${String(state.seq.po).padStart(4, '0')}`;
    const at = nowStamp();
    const by = getCurrentUser().id;
    const po = {
      id, supplierId: input.supplierId, warehouse: input.warehouse, status: 'draft', lines,
      createdAt: at, createdBy: by, expectedDate: input.expectedDate, note: String(input.note || '').trim(),
      history: [{ status: 'draft', at, by }], cancelReason: '',
    };
    state.purchaseOrders.push(po);
    audit('po.create', 'po', id, id, [{ field: 'Total', from: '', to: formatMoney(poTotal(lines)) }], `${lines.length} line${lines.length === 1 ? '' : 's'} from ${supplierName(po.supplierId)}.`);
    if (submit) transition(po, 'pending', 'po.submit');
    return po;
  });
}

export function updateDraftPO(id, input) {
  return mutate('po.create', () => {
    const po = rawPO(id);
    if (po.status !== 'draft') throw new ValidationError({ form: `Only drafts can be edited. ${id} is ${PO_STATUS_LABELS[po.status].toLowerCase()}.` });
    const lines = validatePOInput(input);
    const before = poTotal(po.lines);
    Object.assign(po, { supplierId: input.supplierId, warehouse: input.warehouse, expectedDate: input.expectedDate, note: String(input.note || '').trim(), lines });
    audit('po.update', 'po', id, id, before !== poTotal(lines) ? [{ field: 'Total', from: formatMoney(before), to: formatMoney(poTotal(lines)) }] : []);
    return po;
  });
}

function transition(po, to, action, note = '') {
  const from = po.status;
  po.status = to;
  po.history.push({ status: to, at: nowStamp(), by: getCurrentUser().id, ...(note ? { note } : {}) });
  audit(action, 'po', po.id, po.id, [{ field: 'Status', from, to }], note);
}
function requireStatus(po, allowed, verb) {
  if (!allowed.includes(po.status)) {
    throw new ValidationError({ form: `${po.id} is ${PO_STATUS_LABELS[po.status].toLowerCase()}, so it can’t be ${verb}. Reload the page to see its current status.` });
  }
}

export function submitPO(id) {
  return mutate('po.submit', () => {
    const po = rawPO(id);
    requireStatus(po, ['draft'], 'submitted');
    if (!po.lines.length) throw new ValidationError({ form: 'Add at least one line before submitting.' });
    transition(po, 'pending', 'po.submit');
    return po;
  });
}
export function approvePO(id) {
  return mutate('po.approve', () => {
    const po = rawPO(id);
    assertCanApprove(getCurrentUser(), poTotal(po.lines));
    requireStatus(po, ['pending'], 'approved');
    transition(po, 'approved', 'po.approve');
    return po;
  });
}
export function returnPOToDraft(id, reason) {
  return mutate('po.approve', () => {
    const po = rawPO(id);
    requireStatus(po, ['pending'], 'returned to draft');
    if (!String(reason || '').trim()) throw new ValidationError({ reason: 'Tell the requester what to change, for example “Reduce SSD quantity to 40”.' });
    transition(po, 'draft', 'po.return', String(reason).trim());
    return po;
  });
}
export function markOrdered(id) {
  return mutate('po.order', () => {
    const po = rawPO(id);
    requireStatus(po, ['approved'], 'marked as ordered');
    transition(po, 'ordered', 'po.order');
    return po;
  });
}
export function cancelPO(id, reason) {
  return mutate('po.cancel', () => {
    const po = rawPO(id);
    if (po.status === 'partially_received') throw new ValidationError({ form: `${id} has already been partly received, so it can’t be cancelled. Receive the remaining units, or ask the supplier for a credit note.` });
    requireStatus(po, ['draft', 'pending', 'approved', 'ordered'], 'cancelled');
    if (!String(reason || '').trim()) throw new ValidationError({ reason: 'Enter a reason. It’s shown on the PO and in the audit log.' });
    po.cancelReason = String(reason).trim();
    transition(po, 'cancelled', 'po.cancel', po.cancelReason);
    return po;
  });
}

/** Receive goods: `quantities` maps SKU → units received now (0 to skip). */
export function receivePO(id, quantities) {
  return mutate('po.receive', () => {
    const po = rawPO(id);
    requireStatus(po, ['ordered', 'partially_received'], 'received');
    const errors = {};
    const batch = [];
    const changes = [];
    const at = nowStamp();
    let units = 0;
    po.lines.forEach((l, i) => {
      const q = quantities[l.sku] ?? 0;
      const already = receivedQty(po, l.sku);
      const outstanding = l.qty - already;
      if (!Number.isInteger(q) || q < 0) errors[`recv.${i}`] = 'Enter a whole number, 0 or more.';
      else if (q > outstanding) errors[`recv.${i}`] = `Only ${outstanding} outstanding. Enter ${outstanding} or fewer; record extra units as a separate adjustment.`;
      else if (q > 0) {
        batch.push({ id: nextMovementId(), type: 'receipt', sku: l.sku, warehouse: po.warehouse, qty: q, at, by: getCurrentUser().id, ref: po.id, note: '' });
        changes.push({ field: `${l.sku} received`, from: already, to: already + q });
        units += q;
      }
    });
    if (Object.keys(errors).length) throw new ValidationError(errors);
    if (!batch.length) throw new ValidationError({ form: 'Enter a received quantity for at least one line.' });
    wrapLedger(() => postMovements(batch));
    const complete = po.lines.every((l) => receivedQty(po, l.sku) >= l.qty);
    const next = complete ? 'received' : 'partially_received';
    const from = po.status;
    if (from !== next) {
      po.status = next;
      po.history.push({ status: next, at, by: getCurrentUser().id });
      changes.push({ field: 'Status', from, to: next });
    } else {
      po.history.push({ status: next, at, by: getCurrentUser().id, note: `Received ${units} more` });
    }
    audit('po.receive', 'po', po.id, po.id, changes, `Received ${units} unit${units === 1 ? '' : 's'} into ${warehouseName(po.warehouse)}.`);
    return { status: next, units };
  });
}

/** Create one draft PO per supplier from current reorder suggestions. */
export function createPOsFromSuggestions({ supplierIds, warehouse }) {
  return mutate('po.create', () => {
    const { groups } = getReorderSuggestions();
    const chosen = groups.filter((g) => supplierIds.includes(g.supplierId));
    if (!chosen.length) throw new ValidationError({ form: 'Select at least one supplier.' });
    if (!whIds().includes(warehouse)) throw new ValidationError({ warehouse: 'Choose the receiving warehouse.' });
    const created = [];
    for (const g of chosen) {
      const lead = state.suppliers.find((s) => s.id === g.supplierId).leadTimeDays;
      const lines = g.items.map((it) => ({ sku: it.sku, qty: it.qty, unitCostCents: it.unitCostCents }));
      state.seq.po += 1;
      const id = `PO-2026-${String(state.seq.po).padStart(4, '0')}`;
      const at = nowStamp();
      const by = getCurrentUser().id;
      state.purchaseOrders.push({ id, supplierId: g.supplierId, warehouse, status: 'draft', lines, createdAt: at, createdBy: by, expectedDate: addDays(todayISO(), lead), note: 'Created from reorder suggestions.', history: [{ status: 'draft', at, by }], cancelReason: '' });
      audit('po.create', 'po', id, id, [{ field: 'Total', from: '', to: formatMoney(poTotal(lines)) }], `From reorder suggestions: ${lines.length} SKU${lines.length === 1 ? '' : 's'} from ${g.supplierName}.`);
      created.push(id);
    }
    return created;
  });
}

// ---------- suppliers ----------
function validateSupplier(input, selfId = null) {
  const errors = {};
  const name = String(input.name || '').trim();
  if (!name) errors.name = 'Enter the supplier’s company name.';
  else if (state.suppliers.some((s) => s.id !== selfId && s.name.toLowerCase() === name.toLowerCase())) errors.name = `A supplier called “${name}” already exists. Edit that one instead.`;
  if (!String(input.city || '').trim()) errors.city = 'Enter the city the supplier ships from.';
  if (!String(input.country || '').trim()) errors.country = 'Enter the country.';
  if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 1 || input.leadTimeDays > 180) errors.leadTimeDays = 'Enter a lead time between 1 and 180 days.';
  const email = String(input.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter an email like orders@example.com, or leave it blank.';
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { name, city: String(input.city).trim(), country: String(input.country).trim(), leadTimeDays: input.leadTimeDays, contact: String(input.contact || '').trim(), email };
}
export function createSupplier(input) {
  return mutate('supplier.manage', () => {
    const v = validateSupplier(input);
    const n = state.suppliers.reduce((m, s) => Math.max(m, Number(s.id.slice(4)) || 0), 0) + 1;
    const s = { id: `SUP-${String(n).padStart(2, '0')}`, ...v, createdAt: todayISO() };
    state.suppliers.push(s);
    audit('supplier.create', 'supplier', s.id, s.name, [{ field: 'Lead time (days)', from: '', to: s.leadTimeDays }], `${s.city}, ${s.country}.`);
    return s;
  });
}
export function updateSupplier(id, input) {
  return mutate('supplier.manage', () => {
    const s = state.suppliers.find((x) => x.id === id);
    if (!s) throw new NotFoundError(`Supplier ${id} doesn’t exist.`);
    const v = validateSupplier(input, id);
    const labels = { name: 'Name', city: 'City', country: 'Country', leadTimeDays: 'Lead time (days)', contact: 'Contact', email: 'Email' };
    const changes = [];
    for (const [k, label] of Object.entries(labels)) {
      if (s[k] !== v[k]) changes.push({ field: label, from: s[k], to: v[k] });
    }
    Object.assign(s, v);
    if (changes.length) audit('supplier.update', 'supplier', id, s.name, changes);
    return s;
  });
}

export { ROLE_LABELS, daysBetween };
