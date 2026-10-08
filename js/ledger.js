// Event-sourced stock ledger. Pure functions only: no DOM, no storage.
//
// Stock on hand is never stored. It is the sum of signed movement quantities
// for a SKU at a warehouse. Movements are append-only; a mistake is corrected
// by posting a new adjustment, never by editing or deleting a row.

export const MOVEMENT_TYPES = Object.freeze({
  receipt: { label: 'Receipt', direction: 'in' },
  shipment: { label: 'Shipment', direction: 'out' },
  transfer_out: { label: 'Transfer out', direction: 'out' },
  transfer_in: { label: 'Transfer in', direction: 'in' },
  adjustment: { label: 'Adjustment', direction: 'either' },
});

/** Adjustment reason codes and the sign each one allows. */
export const ADJUSTMENT_REASONS = Object.freeze({
  cycle_count: { label: 'Cycle count', sign: 'either' },
  damaged: { label: 'Damaged', sign: 'out' },
  lost: { label: 'Lost', sign: 'out' },
  found: { label: 'Found', sign: 'in' },
  return_to_stock: { label: 'Return to stock', sign: 'in' },
});

export class LedgerError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'LedgerError';
    this.field = field;
  }
}

export const key = (sku, warehouse) => `${sku}|${warehouse}`;

/** Map of "SKU|WH" → on-hand quantity, folded from every movement. */
export function computeBalances(movements) {
  const map = new Map();
  for (const m of movements) {
    const k = key(m.sku, m.warehouse);
    map.set(k, (map.get(k) || 0) + m.qty);
  }
  return map;
}

export function onHand(movements, sku, warehouse, balances = null) {
  if (balances) return balances.get(key(sku, warehouse)) || 0;
  let total = 0;
  for (const m of movements) if (m.sku === sku && m.warehouse === warehouse) total += m.qty;
  return total;
}

/** Map of "SKU|WH" → quantity reserved by open sales orders. */
export function computeAllocations(salesOrders) {
  const map = new Map();
  for (const so of salesOrders) {
    if (so.status !== 'open') continue;
    for (const line of so.lines) {
      const k = key(line.sku, so.warehouse);
      map.set(k, (map.get(k) || 0) + line.qty);
    }
  }
  return map;
}

/** { onHand, allocated, available } for one SKU at one warehouse. available = on hand − allocated. */
export function position(balances, allocations, sku, warehouse) {
  const oh = balances.get(key(sku, warehouse)) || 0;
  const allocated = allocations.get(key(sku, warehouse)) || 0;
  return { onHand: oh, allocated, available: oh - allocated };
}

/** Per-warehouse positions plus a network total. */
export function stockPosition(balances, allocations, sku, warehouseIds) {
  const byWarehouse = {};
  const total = { onHand: 0, allocated: 0, available: 0 };
  for (const wh of warehouseIds) {
    const p = position(balances, allocations, sku, wh);
    byWarehouse[wh] = p;
    total.onHand += p.onHand;
    total.allocated += p.allocated;
    total.available += p.available;
  }
  return { byWarehouse, total };
}

/** Shape check for a single movement; throws LedgerError with a fix-it message. */
export function validateMovement(m) {
  if (!m || typeof m !== 'object') throw new LedgerError('Movement is missing.');
  if (!MOVEMENT_TYPES[m.type]) throw new LedgerError(`Unknown movement type “${m.type}”.`, 'type');
  if (!m.sku) throw new LedgerError('Choose a SKU.', 'sku');
  if (!m.warehouse) throw new LedgerError('Choose a warehouse.', 'warehouse');
  if (!Number.isInteger(m.qty) || m.qty === 0) throw new LedgerError('Enter a whole-number quantity other than zero.', 'qty');
  const dir = MOVEMENT_TYPES[m.type].direction;
  if (dir === 'in' && m.qty < 0) throw new LedgerError(`${MOVEMENT_TYPES[m.type].label} quantities must be positive.`, 'qty');
  if (dir === 'out' && m.qty > 0) throw new LedgerError(`${MOVEMENT_TYPES[m.type].label} quantities must be negative.`, 'qty');
  if (m.type === 'adjustment') {
    const reason = ADJUSTMENT_REASONS[m.reason];
    if (!reason) throw new LedgerError('Choose a reason code for the adjustment.', 'reason');
    if (reason.sign === 'out' && m.qty > 0) throw new LedgerError(`“${reason.label}” can only remove stock. Enter a negative quantity, or pick “Found” or “Return to stock”.`, 'qty');
    if (reason.sign === 'in' && m.qty < 0) throw new LedgerError(`“${reason.label}” can only add stock. Enter a positive quantity, or pick “Damaged”, “Lost” or “Cycle count”.`, 'qty');
  }
  if ((m.type === 'transfer_out' || m.type === 'transfer_in') && !m.ref) throw new LedgerError('Transfer movements need a transfer ID.', 'ref');
  return true;
}

/**
 * Append movements to the ledger. Validates every movement and the combined
 * effect of the batch: if any SKU/warehouse would go below zero on hand, the
 * whole batch is rejected and the original array is untouched.
 * Returns a NEW array (the input is never mutated).
 */
export function appendMovements(movements, batch, { balances = null, names = {} } = {}) {
  const bal = balances || computeBalances(movements);
  const delta = new Map();
  for (const m of batch) {
    validateMovement(m);
    const k = key(m.sku, m.warehouse);
    delta.set(k, (delta.get(k) || 0) + m.qty);
  }
  for (const [k, d] of delta) {
    const current = bal.get(k) || 0;
    if (current + d < 0) {
      const [sku, wh] = k.split('|');
      const whName = names[wh] || wh;
      throw new LedgerError(
        `This would take ${sku} at ${whName} below zero: ${current} on hand, change of ${d}. Enter a quantity of at most ${current} to remove.`,
        'qty',
      );
    }
  }
  return movements.concat(batch.map((m) => Object.freeze({ ...m })));
}

/**
 * Build the paired movements for a transfer. Both share the transfer ID as ref.
 * `available` is the available quantity at the source (on hand − allocated).
 */
export function buildTransfer({ id, sku, from, to, qty, at, by, note = '' }, available, names = {}) {
  if (!sku) throw new LedgerError('Choose a SKU to transfer.', 'sku');
  if (!from || !to) throw new LedgerError('Choose both a source and a destination warehouse.', from ? 'to' : 'from');
  if (from === to) throw new LedgerError('Source and destination must be different warehouses.', 'to');
  if (!Number.isInteger(qty) || qty <= 0) throw new LedgerError('Enter a whole number of units greater than zero.', 'qty');
  if (qty > available) {
    throw new LedgerError(
      available > 0
        ? `Only ${available} available at ${names[from] || from}. Enter ${available} or fewer.`
        : `Nothing is available to transfer at ${names[from] || from}. Pick another source warehouse.`,
      'qty',
    );
  }
  const base = { sku, at, by, ref: id, note };
  return [
    { ...base, id: `${id}-OUT`, type: 'transfer_out', warehouse: from, qty: -qty },
    { ...base, id: `${id}-IN`, type: 'transfer_in', warehouse: to, qty },
  ];
}

/**
 * Movement history for one SKU in chronological order, each row annotated
 * with the running balance at its warehouse after the movement.
 */
export function runningBalances(movements, sku) {
  const rows = movements.filter((m) => m.sku === sku).sort(byTime);
  const bal = {};
  return rows.map((m) => {
    bal[m.warehouse] = (bal[m.warehouse] || 0) + m.qty;
    return { ...m, balanceAfter: bal[m.warehouse] };
  });
}

export function byTime(a, b) {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Daily units in vs out across the network between two ISO dates (inclusive).
 * Transfers are internal and excluded; adjustments count by their sign.
 */
export function dailyFlows(movements, fromISO, toISO) {
  const days = [];
  const index = new Map();
  for (let d = fromISO; d <= toISO; d = nextDay(d)) {
    index.set(d, days.length);
    days.push({ date: d, in: 0, out: 0 });
  }
  for (const m of movements) {
    if (m.type === 'transfer_in' || m.type === 'transfer_out') continue;
    const i = index.get(m.at.slice(0, 10));
    if (i === undefined) continue;
    if (m.qty > 0) days[i].in += m.qty;
    else days[i].out += -m.qty;
  }
  return days;
}
function nextDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** In stock / Low / Out from total available and the reorder point. */
export function stockStatus(available, reorderPoint) {
  if (available <= 0) return 'out';
  if (available <= reorderPoint) return 'low';
  return 'in';
}
export const STOCK_STATUS_LABELS = Object.freeze({ in: 'In stock', low: 'Low', out: 'Out' });
