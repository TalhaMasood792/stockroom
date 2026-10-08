// Deterministic demo data, generated relative to "today".
//
// The seed simulates ~90 days of warehouse activity in time order so every
// balance is consistent: opening counts, purchase order receipts, transfers,
// sales order shipments and adjustments. Shipments never exceed stock on hand,
// so the ledger is valid by construction (and the unit tests re-check it).
import { prng, addDays } from './format.js';
import { MANAGER_APPROVAL_LIMIT_CENTS } from './permissions.js';

export const WAREHOUSES = Object.freeze([
  { id: 'KHI', name: 'Karachi', site: 'Port Qasim DC, Karachi' },
  { id: 'LHE', name: 'Lahore', site: 'Sundar Industrial Estate, Lahore' },
  { id: 'DXB', name: 'Dubai', site: 'Jebel Ali Free Zone, Dubai' },
]);

export const CATEGORIES = Object.freeze(['Networking', 'Storage', 'Power', 'Cables', 'Computers', 'Displays', 'Tools', 'Accessories']);

const SUPPLIERS = [
  { id: 'SUP-01', name: 'Hualian Networking Co.', city: 'Shenzhen', country: 'China', leadTimeDays: 21, contact: 'Lily Chen', email: 'orders@hualian-net.example' },
  { id: 'SUP-02', name: 'Formosa Storage Technologies', city: 'Taipei', country: 'Taiwan', leadTimeDays: 18, contact: 'Kevin Lin', email: 'sales@formosa-storage.example' },
  { id: 'SUP-03', name: 'Gulf Power Systems FZE', city: 'Dubai', country: 'United Arab Emirates', leadTimeDays: 7, contact: 'Rashid Al Mansoori', email: 'orders@gulfpower.example' },
  { id: 'SUP-04', name: 'Indus Cable & Wire Industries', city: 'Karachi', country: 'Pakistan', leadTimeDays: 5, contact: 'Saad Memon', email: 'sales@induscable.example' },
  { id: 'SUP-05', name: 'Rheinwerk Werkzeuge GmbH', city: 'Wuppertal', country: 'Germany', leadTimeDays: 28, contact: 'Jonas Becker', email: 'export@rheinwerk.example' },
  { id: 'SUP-06', name: 'Neihu Display Corp.', city: 'Taipei', country: 'Taiwan', leadTimeDays: 20, contact: 'Grace Wu', email: 'b2b@neihu-display.example' },
  { id: 'SUP-07', name: 'Al Noor Computer Trading LLC', city: 'Dubai', country: 'United Arab Emirates', leadTimeDays: 6, contact: 'Imran Shaikh', email: 'trade@alnoor-computers.example' },
  { id: 'SUP-08', name: 'Pearl River Electronics Ltd.', city: 'Shenzhen', country: 'China', leadTimeDays: 25, contact: 'Zhang Wei', email: 'export@pearlriver.example' },
];

// [prefix, category, supplier, [[name, unit cost in cents], ...]]
const CATALOG = [
  ['NET-RTR', 'Networking', 'SUP-01', [['Dual-band Wi-Fi 6 router, AX1800', 4800], ['Tri-band Wi-Fi 6E router, AXE5400', 13900], ['Gigabit VPN router, 5 ports', 7600], ['LTE failover router, dual SIM', 11200], ['Edge router, 8 × SFP, 1U', 38500]]],
  ['NET-SWT', 'Networking', 'SUP-01', [['8-port gigabit unmanaged switch', 1650], ['16-port gigabit smart switch', 6400], ['24-port managed switch, 4 × SFP+', 21900], ['48-port PoE+ managed switch, 740 W', 64500], ['8-port 10GbE SFP+ aggregation switch', 42800], ['5-port gigabit PoE switch', 3900]]],
  ['NET-AP', 'Networking', 'SUP-01', [['Ceiling-mount Wi-Fi 6 access point', 9200], ['Outdoor Wi-Fi 6 access point, IP67', 16800], ['Wall-plate Wi-Fi 5 access point', 5400]]],
  ['NET-SFP', 'Networking', 'SUP-08', [['SFP+ 10G SR transceiver, 850 nm', 1850], ['SFP 1G LX transceiver, 10 km', 1150], ['QSFP28 100G SR4 transceiver', 8900]]],
  ['NET-FWL', 'Networking', 'SUP-01', [['Desktop firewall appliance, 5 ports', 32500], ['Rack firewall appliance, 1U, 8 ports', 89000]]],
  ['STO-SSD', 'Storage', 'SUP-02', [['SATA SSD 2.5", 500 GB', 3400], ['SATA SSD 2.5", 1 TB', 5900], ['SATA SSD 2.5", 2 TB', 11200], ['Enterprise SATA SSD, 3.84 TB', 38900]]],
  ['STO-NVM', 'Storage', 'SUP-02', [['NVMe M.2 SSD, PCIe 4.0, 1 TB', 6900], ['NVMe M.2 SSD, PCIe 4.0, 2 TB', 12400], ['NVMe M.2 SSD, PCIe 3.0, 512 GB', 3600], ['NVMe U.2 SSD, 7.68 TB', 89500]]],
  ['STO-HDD', 'Storage', 'SUP-02', [['3.5" NAS hard drive, 8 TB', 15800], ['3.5" NAS hard drive, 12 TB', 22400], ['3.5" surveillance hard drive, 4 TB', 8200], ['2.5" laptop hard drive, 1 TB', 4100]]],
  ['STO-NAS', 'Storage', 'SUP-02', [['4-bay NAS enclosure, diskless', 36500], ['2-bay NAS enclosure, diskless', 19800]]],
  ['STO-USB', 'Storage', 'SUP-08', [['USB-C portable SSD, 1 TB', 7400], ['USB 3.2 flash drive, 128 GB', 950], ['USB 3.2 flash drive, 64 GB', 620]]],
  ['STO-MEM', 'Storage', 'SUP-02', [['DDR4 SODIMM, 16 GB, 3200', 3100], ['DDR5 DIMM, 32 GB, 4800', 7800], ['DDR4 ECC RDIMM, 32 GB', 9900]]],
  ['PWR-UPS', 'Power', 'SUP-03', [['Line-interactive UPS, 1500 VA', 16500], ['Online UPS, 3 kVA, rack', 98000], ['Line-interactive UPS, 850 VA', 8900], ['Online UPS, 6 kVA, tower', 185000], ['Rack UPS, 2200 VA, 2U', 61500]]],
  ['PWR-BAT', 'Power', 'SUP-03', [['UPS battery, 12 V 9 Ah', 2400], ['UPS external battery pack, 48 V', 42000], ['UPS battery, 12 V 7 Ah', 1900]]],
  ['PWR-PDU', 'Power', 'SUP-03', [['Rack PDU, 8 outlets, 1U', 7800], ['Metered rack PDU, 24 outlets, 0U', 28500], ['Surge protector strip, 6 outlets', 1650]]],
  ['CBL-C6A', 'Cables', 'SUP-04', [['Cat6A patch cable, 1 m, blue', 210], ['Cat6A patch cable, 3 m, blue', 340], ['Cat6A patch cable, 5 m, grey', 480], ['Cat6 bulk cable, 305 m box, UTP', 12800], ['Cat6A bulk cable, 305 m box, S/FTP', 24500], ['Cat6 patch cable, 0.5 m, yellow', 160]]],
  ['CBL-FIB', 'Cables', 'SUP-04', [['LC-LC OM4 duplex fibre patch, 2 m', 780], ['LC-LC OS2 duplex fibre patch, 5 m', 920], ['MPO-12 OM4 trunk cable, 10 m', 8600]]],
  ['CBL-HDM', 'Cables', 'SUP-08', [['HDMI 2.1 cable, 2 m', 620], ['DisplayPort 1.4 cable, 2 m', 690], ['USB-C to USB-C cable, 100 W, 2 m', 540], ['USB-C to HDMI adapter, 4K60', 880]]],
  ['CBL-PWR', 'Cables', 'SUP-04', [['IEC C13 to C14 power cord, 1.8 m', 260], ['IEC C13 power cord, UK plug, 2 m', 310], ['IEC C19 to C20 power cord, 2 m', 640]]],
  ['CMP-LTP', 'Computers', 'SUP-07', [['Business laptop 14", Core i5, 16 GB', 72000], ['Business laptop 15.6", Core i7, 16 GB', 96500], ['Rugged laptop 14", Core i5, 16 GB', 168000], ['Thin-and-light laptop 13.3", 8 GB', 41000], ['Workstation laptop 16", 32 GB', 215000]]],
  ['CMP-DSK', 'Computers', 'SUP-07', [['Small form factor desktop, Core i5', 51000], ['Mini PC, Ryzen 5, 16 GB, 512 GB', 38500], ['Tower workstation, Xeon, 64 GB', 245000]]],
  ['CMP-SRV', 'Computers', 'SUP-07', [['1U rack server, dual Xeon, 128 GB', 612000], ['Tower server, single Xeon, 32 GB', 185000]]],
  ['DSP-MON', 'Displays', 'SUP-06', [['24" IPS monitor, 1080p, 75 Hz', 9800], ['27" IPS monitor, 1440p, USB-C', 21500], ['27" 4K monitor, USB-C 90 W', 32800], ['34" ultrawide monitor, 3440 × 1440', 41500], ['22" office monitor, 1080p', 7400], ['32" 4K monitor, factory calibrated', 58000]]],
  ['DSP-MNT', 'Displays', 'SUP-06', [['Dual monitor arm, desk clamp', 3900], ['Single monitor arm, gas spring', 2600]]],
  ['DSP-SIG', 'Displays', 'SUP-06', [['55" commercial display, 4K, 24/7', 62000]]],
  ['TLS-CRP', 'Tools', 'SUP-05', [['RJ45 crimping tool, ratchet', 2850], ['RJ45 pass-through crimper', 3600]]],
  ['TLS-TST', 'Tools', 'SUP-05', [['Network cable tester, RJ45/RJ11', 1950], ['Cable certifier, Cat6A, handheld', 148000], ['Digital multimeter, CAT III', 5200], ['Fibre visual fault locator, 10 mW', 2700]]],
  ['TLS-DRV', 'Tools', 'SUP-05', [['Precision screwdriver set, 32 bits', 2100], ['Torque screwdriver, 0.4–2 Nm', 8900], ['Insulated screwdriver set, 7 pieces', 4600]]],
  ['TLS-PNC', 'Tools', 'SUP-05', [['Punch-down tool, 110/Krone', 1450], ['Cable stripper, coax and twisted pair', 980]]],
  ['TLS-SDR', 'Tools', 'SUP-05', [['Soldering station, 80 W', 8400]]],
  ['ACC-KBD', 'Accessories', 'SUP-08', [['Wired keyboard, US layout', 1100], ['Wireless keyboard and mouse set', 2300]]],
  ['ACC-MSE', 'Accessories', 'SUP-08', [['Wired optical mouse', 450], ['Wireless ergonomic mouse', 2100]]],
  ['ACC-DCK', 'Accessories', 'SUP-08', [['USB-C dock, dual 4K, 100 W', 11800], ['USB-C travel hub, 7-in-1', 2900]]],
  ['ACC-AV', 'Accessories', 'SUP-08', [['USB headset, noise cancelling', 3400], ['Webcam, 1080p, USB', 2900]]],
  ['ACC-RCK', 'Accessories', 'SUP-04', [['Wall-mount network cabinet, 9U', 9600], ['Floor rack, 42U, 600 × 1000', 68000], ['Cat6 patch panel, 24 ports, 1U', 2700], ['Cable management panel, 1U', 850], ['Rack shelf, 1U, cantilever', 1250]]],
];

const CUSTOMERS = ['Crescent IT Services', 'Habib Systems Integration', 'Margalla Networks', 'Ravi Data Centre', 'Clifton Office Solutions', 'Desert Rose Hospitality', 'Al Safa Contracting', 'Shalimar Schools Trust', 'Indus Valley Clinics', 'Creek Logistics FZCO', 'Gulberg Tech Hub', 'Sea View Retail Group'];

const WH_FACTOR = { KHI: 1, LHE: 0.7, DXB: 0.5 };
const USERS = { admin: 'u_zainab', manager: 'u_hamza', clerk: 'u_fatima' };
const USER_META = {
  u_zainab: { who: 'Zainab Qureshi', role: 'admin' },
  u_hamza: { who: 'Hamza Iqbal', role: 'manager' },
  u_fatima: { who: 'Fatima Noor', role: 'clerk' },
};

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function buildSeed(today) {
  const r = prng(20261009);
  const D = (n) => addDays(today, n);
  const at = (day, h, m) => `${D(day)}T${pad(h)}:${pad(m)}:${pad(r.int(0, 59))}`;
  const whIds = WAREHOUSES.map((w) => w.id);
  const supplierById = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s]));

  // ---------- products ----------
  const products = [];
  const rate = {}; // demand units/day for the whole network
  for (const [prefix, category, supplierId, items] of CATALOG) {
    let n = r.int(3, 28);
    if (prefix === 'NET-RTR') n = 12; // keep the documented example SKU stable
    for (const [name, cost] of items) {
      const sku = `${prefix}-${pad(n, 4)}`;
      n += r.int(1, 4);
      products.push({ sku, name, category, supplierId, unitCostCents: cost, reorderPoint: 0, reorderQty: 0, createdAt: D(-140) });
      rate[sku] = Math.min(4, 90 / Math.sqrt(cost)) * (0.7 + r.next() * 0.6);
    }
  }
  const skus = products.map((p) => p.sku);
  const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

  // Pick SKUs that will end the period low or out of stock.
  const shuffled = [...skus].sort(() => 0).map((s) => [r.next(), s]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const outSet = new Set(shuffled.slice(0, 5));
  const lowSet = new Set(shuffled.slice(5, 19));
  const normal = skus.filter((s) => !outSet.has(s) && !lowSet.has(s));

  // ---------- purchase orders (plans; receipts are posted during the simulation) ----------
  const PLAN = [
    ['received', -86], ['received', -81], ['received', -75], ['received', -70], ['received', -64], ['received', -59],
    ['received', -53], ['received', -48], ['received', -44], ['received', -40], ['received', -36], ['received', -33],
    ['partially_received', -27], ['partially_received', -24], ['cancelled', -22],
    ['ordered', -19], ['ordered', -15], ['ordered', -12], ['approved', -9], ['approved', -7],
    ['pending', -5], ['draft', -4], ['draft', -3], ['pending', -2], ['pending', -1],
  ];
  const supplierCycle = ['SUP-04', 'SUP-02', 'SUP-01', 'SUP-06', 'SUP-03', 'SUP-08', 'SUP-07', 'SUP-04', 'SUP-02', 'SUP-05', 'SUP-01', 'SUP-03',
    'SUP-02', 'SUP-06', 'SUP-02', 'SUP-04', 'SUP-01', 'SUP-03', 'SUP-08', 'SUP-07', 'SUP-04', 'SUP-06', 'SUP-08', 'SUP-05', 'SUP-03'];
  const whCycle = ['KHI', 'KHI', 'LHE', 'KHI', 'DXB', 'LHE', 'KHI', 'DXB', 'KHI', 'LHE', 'KHI', 'DXB', 'KHI', 'LHE', 'KHI', 'KHI', 'DXB', 'LHE', 'KHI', 'KHI', 'LHE', 'KHI', 'DXB', 'KHI', 'KHI'];
  const pos = [];
  const receiptsByDay = new Map(); // day → [{po, sku, qty}]
  const addReceipt = (day, po, sku, qty) => {
    if (!receiptsByDay.has(day)) receiptsByDay.set(day, []);
    receiptsByDay.get(day).push({ po, sku, qty });
  };
  const roundQty = (q, cost) => (cost < 1500 ? Math.max(10, Math.round(q / 10) * 10) : Math.max(2, Math.round(q)));

  PLAN.forEach(([status, day], i) => {
    const id = `PO-2026-${pad(7 + i, 4)}`;
    const supplierId = supplierCycle[i];
    const sup = supplierById[supplierId];
    const warehouse = whCycle[i];
    const supSkus = skus.filter((s) => bySku[s].supplierId === supplierId);
    const isOpen = !['received', 'partially_received'].includes(status);
    let pool = supSkus.filter((s) => normal.includes(s));
    let lines = [];
    if (id === 'PO-2026-0031') {
      // The large PO waiting for Admin approval.
      const big = supSkus.filter((s) => bySku[s].unitCostCents >= 60000);
      lines = big.slice(0, 2).map((sku, j) => ({ sku, qty: j === 0 ? 3 : 2, unitCostCents: bySku[sku].unitCostCents }));
      lines.push({ sku: supSkus.find((s) => bySku[s].unitCostCents < 3000), qty: 20, unitCostCents: 0 });
      lines.at(-1).unitCostCents = bySku[lines.at(-1).sku].unitCostCents;
    } else {
      const n = Math.min(pool.length, r.int(2, 4));
      const chosen = new Set();
      // Open POs sometimes cover a low SKU (so it shows as "on order").
      if (isOpen && status !== 'cancelled' && i % 2 === 0) {
        const low = supSkus.find((s) => lowSet.has(s) && !pos.some((p) => p.lines.some((l) => l.sku === s)));
        if (low) chosen.add(low);
      }
      while (chosen.size < n + (chosen.size ? 0 : 0) && chosen.size < pool.length + 1) {
        const s = r.pick(pool);
        chosen.add(s);
        if (chosen.size >= n) break;
      }
      lines = [...chosen].map((sku) => {
        const p = bySku[sku];
        return { sku, qty: roundQty(rate[sku] * (isOpen ? r.int(28, 50) : r.int(70, 120)) * (status === 'received' || status === 'partially_received' ? 3 : 1), p.unitCostCents), unitCostCents: p.unitCostCents };
      });
      // Keep the approval-queue POs under the Manager limit, and most others realistic.
      const cap = status === 'pending' || status === 'draft' ? 420000 : isOpen ? 2400000 : 6000000;
      let total = lines.reduce((t, l) => t + l.qty * l.unitCostCents, 0);
      while (total > cap) {
        const big = lines.reduce((a, b) => (a.qty * a.unitCostCents >= b.qty * b.unitCostCents ? a : b));
        if (big.qty <= 1) {
          lines = lines.filter((l) => l !== big);
        } else big.qty = Math.max(1, Math.floor(big.qty * 0.6));
        total = lines.reduce((t, l) => t + l.qty * l.unitCostCents, 0);
      }
    }
    const total = lines.reduce((t, l) => t + l.qty * l.unitCostCents, 0);
    const creator = i % 3 === 2 ? USERS.manager : USERS.clerk;
    const approver = total > MANAGER_APPROVAL_LIMIT_CENTS ? USERS.admin : USERS.manager;
    const history = [{ status: 'draft', at: at(day, 9, r.int(5, 50)), by: creator }];
    const steps = { draft: 0, pending: 1, approved: 2, ordered: 3, partially_received: 4, received: 4, cancelled: 1 }[status];
    if (steps >= 1 && status !== 'draft') history.push({ status: 'pending', at: at(day, 10, r.int(0, 50)), by: creator });
    if (steps >= 2) history.push({ status: 'approved', at: at(Math.min(-1, day + 1), 11, r.int(0, 50)), by: approver });
    if (steps >= 3) history.push({ status: 'ordered', at: at(Math.min(-1, day + 2), 12, r.int(0, 50)), by: USERS.manager });
    let expected = D(day + 2 + sup.leadTimeDays);
    if (status === 'received' || status === 'partially_received') {
      const recvDay = Math.min(-1, day + 2 + sup.leadTimeDays);
      expected = D(recvDay);
      if (status === 'received') {
        const split = i % 4 === 0 && recvDay - 3 > day + 2;
        lines.forEach((l, j) => {
          if (split && j === 0 && l.qty > 1) {
            const first = Math.ceil(l.qty * 0.6);
            addReceipt(recvDay - 3, id, l.sku, first);
            addReceipt(recvDay, id, l.sku, l.qty - first);
          } else addReceipt(recvDay, id, l.sku, l.qty);
        });
      } else {
        lines.forEach((l, j) => {
          const q = j === 0 ? l.qty : j === 1 ? Math.max(1, Math.floor(l.qty / 2)) : 0;
          if (q > 0) addReceipt(recvDay, id, l.sku, q);
        });
      }
    }
    const po = {
      id, supplierId, warehouse, status, lines,
      createdAt: history[0].at, createdBy: creator, expectedDate: expected,
      note: i === 23 ? 'Restock for Q4 installer season.' : '',
      history, cancelReason: '',
    };
    if (status === 'cancelled') {
      po.cancelReason = 'Supplier quoted a 10-week lead time. Re-sourcing from a regional distributor.';
      history.push({ status: 'cancelled', at: at(day + 2, 15, r.int(0, 50)), by: USERS.admin, note: po.cancelReason });
    }
    pos.push(po);
  });

  // ---------- simulate 90 days ----------
  const bal = new Map();
  const k = (sku, wh) => `${sku}|${wh}`;
  const get = (sku, wh) => bal.get(k(sku, wh)) || 0;
  const add = (sku, wh, q) => bal.set(k(sku, wh), get(sku, wh) + q);
  const raw = [];
  const audit = [];
  const log = (stamp, by, action, entityType, entityId, entityLabel, changes = [], note = '') => {
    audit.push({ at: stamp, userId: by, ...USER_META[by], action, entityType, entityId, entityLabel, changes, note });
  };
  const move = (m) => {
    add(m.sku, m.warehouse, m.qty);
    raw.push(m);
  };

  // Opening counts, 90 days ago.
  const openAt = `${D(-90)}T07:30:00`;
  for (const sku of skus) {
    for (const wh of whIds) {
      const dr = rate[sku] * WH_FACTOR[wh];
      let q;
      if (outSet.has(sku)) q = Math.round(dr * 40 * (0.6 + r.next() * 0.4)) + 1;
      else if (lowSet.has(sku)) q = Math.round(dr * 82 * (0.85 + r.next() * 0.2)) + 2;
      else q = Math.round(dr * 90 * (0.9 + r.next() * 0.5)) + r.int(3, 10);
      if (q > 0) move({ type: 'adjustment', reason: 'cycle_count', sku, warehouse: wh, qty: q, at: openAt, by: USERS.admin, ref: '', note: 'Opening stock count' });
    }
  }
  log(`${D(-90)}T07:45:00`, USERS.admin, 'stock.opening', 'ledger', 'opening', 'Opening stock counts', [], `Loaded opening counts for ${skus.length} SKUs across ${whIds.length} warehouses.`);

  const transferDays = new Map();
  for (let t = 0; t < 16; t++) {
    const day = -84 + t * 5 + r.int(0, 3);
    transferDays.set(Math.min(-2, day), (transferDays.get(day) || 0) + 1);
  }
  const adjustDays = new Map();
  for (let a = 0; a < 42; a++) {
    const day = r.int(-88, -1);
    adjustDays.set(day, (adjustDays.get(day) || 0) + 1);
  }
  const transfers = [];
  let trSeq = 101;
  let soSeq = 4120;
  const NOTES = {
    cycle_count: ['Weekly cycle count, aisle B', 'Count variance after bin audit', 'Quarterly count correction', 'Recount after picking error'],
    damaged: ['Crushed carton found on receipt dock', 'Water damage from roof leak in bay 4', 'Dropped during picking', 'Failed QC on power-on test'],
    lost: ['Not found during bin audit', 'Missing after outbound consolidation'],
    found: ['Found in returns cage', 'Located in wrong bin during count'],
    return_to_stock: ['Customer return, unopened', 'RMA closed, unit tested OK', 'Sales order cancelled before dispatch'],
  };

  for (let day = -89; day <= -1; day++) {
    // 1. receipts
    for (const rc of receiptsByDay.get(day) || []) {
      const po = pos.find((p) => p.id === rc.po);
      const stamp = at(day, 8, r.int(5, 55));
      move({ type: 'receipt', sku: rc.sku, warehouse: po.warehouse, qty: rc.qty, at: stamp, by: USERS.clerk, ref: po.id, note: '' });
    }
    // Audit + history for receipts (one entry per PO per day).
    const byPo = new Map();
    for (const rc of receiptsByDay.get(day) || []) {
      if (!byPo.has(rc.po)) byPo.set(rc.po, []);
      byPo.get(rc.po).push(rc);
    }
    for (const [poId, rcs] of byPo) {
      const po = pos.find((p) => p.id === poId);
      const receivedSoFar = (sku) => raw.filter((m) => m.type === 'receipt' && m.ref === poId && m.sku === sku).reduce((t, m) => t + m.qty, 0);
      const complete = po.lines.every((l) => receivedSoFar(l.sku) >= l.qty);
      const prev = po.history.at(-1).status;
      const next = complete ? 'received' : 'partially_received';
      const stamp = at(day, 9, r.int(0, 30));
      po.history.push({ status: next, at: stamp, by: USERS.clerk });
      log(stamp, USERS.clerk, 'po.receive', 'po', poId, poId,
        [...rcs.map((rc) => ({ field: rc.sku, from: receivedSoFar(rc.sku) - rc.qty, to: receivedSoFar(rc.sku) })), ...(prev !== next ? [{ field: 'Status', from: prev, to: next }] : [])],
        `Received ${rcs.reduce((t, x) => t + x.qty, 0)} units into ${WAREHOUSES.find((w) => w.id === po.warehouse).name}.`);
    }
    // 2. transfers
    for (let t = 0; t < (transferDays.get(day) || 0); t++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const sku = r.pick(normal);
        const from = r.pick(whIds);
        const to = r.pick(whIds.filter((w) => w !== from));
        const have = get(sku, from);
        if (have < 8) continue;
        const qty = Math.max(2, Math.round(have * (0.15 + r.next() * 0.15)));
        const id = `TR-2026-${pad(trSeq++, 4)}`;
        const stamp = at(day, 10 + r.int(0, 1), r.int(0, 59));
        const by = r.chance(0.7) ? USERS.clerk : USERS.manager;
        const note = r.pick(['Rebalance for regional demand', 'Customer pickup in ' + WAREHOUSES.find((w) => w.id === to).name, 'Cover backorders', '']);
        move({ type: 'transfer_out', sku, warehouse: from, qty: -qty, at: stamp, by, ref: id, note });
        move({ type: 'transfer_in', sku, warehouse: to, qty, at: stamp, by, ref: id, note });
        transfers.push({ id, sku, from, to, qty, at: stamp, by, note });
        log(stamp, by, 'transfer.create', 'transfer', id, id, [{ field: 'Quantity', from: '', to: qty }], `${qty} × ${sku} from ${WAREHOUSES.find((w) => w.id === from).name} to ${WAREHOUSES.find((w) => w.id === to).name}.`);
        break;
      }
    }
    // 3. shipments
    for (const sku of skus) {
      for (const wh of whIds) {
        const dr = rate[sku] * WH_FACTOR[wh];
        const drain = outSet.has(sku) && day >= -4;
        const p = 0.05 + 0.2 * Math.min(1, dr / 4);
        if (!drain && !r.chance(p)) continue;
        const have = get(sku, wh);
        let qty = drain ? have : Math.min(have, Math.max(1, Math.round((dr / p) * (0.5 + r.next()))));
        if (qty <= 0) continue;
        move({ type: 'shipment', sku, warehouse: wh, qty: -qty, at: at(day, 12 + r.int(0, 4), r.int(0, 59)), by: 'system', ref: `SO-${soSeq++}`, note: '' });
      }
    }
    // 4. adjustments
    for (let a = 0; a < (adjustDays.get(day) || 0); a++) {
      const sku = r.pick(normal);
      const wh = r.pick(whIds);
      const have = get(sku, wh);
      const reason = r.pick(['cycle_count', 'cycle_count', 'damaged', 'damaged', 'lost', 'found', 'return_to_stock']);
      let qty;
      if (reason === 'cycle_count') qty = have >= 4 && r.chance(0.6) ? -r.int(1, 3) : r.int(1, 3);
      else if (reason === 'damaged' || reason === 'lost') qty = -Math.min(have, r.int(1, 2));
      else qty = r.int(1, 3);
      if (!qty) continue;
      const by = r.chance(0.75) ? USERS.clerk : USERS.manager;
      const stamp = at(day, 17, r.int(0, 59));
      const note = r.pick(NOTES[reason]);
      move({ type: 'adjustment', reason, sku, warehouse: wh, qty, at: stamp, by, ref: '', note });
      log(stamp, by, 'stock.adjust', 'product', sku, sku, [{ field: `On hand · ${WAREHOUSES.find((w) => w.id === wh).name}`, from: have, to: have + qty }], `${REASON_LABEL[reason]}: ${note}`);
    }
  }

  // ---------- open sales orders (allocations) ----------
  const salesOrders = [];
  const alloc = new Map();
  for (let s = 0; s < 22; s++) {
    const wh = r.pick(whIds);
    const lines = [];
    const n = r.int(1, 3);
    for (let j = 0; j < n * 4 && lines.length < n; j++) {
      const sku = r.chance(0.25) ? r.pick([...lowSet]) : r.pick(normal);
      const free = get(sku, wh) - (alloc.get(k(sku, wh)) || 0);
      if (free < 4 || lines.some((l) => l.sku === sku)) continue;
      const qty = r.int(1, Math.max(1, Math.floor(free * 0.3)));
      alloc.set(k(sku, wh), (alloc.get(k(sku, wh)) || 0) + qty);
      lines.push({ sku, qty });
    }
    if (lines.length) salesOrders.push({ id: `SO-${soSeq++}`, customer: r.pick(CUSTOMERS), warehouse: wh, status: 'open', date: D(-r.int(0, 6)), lines });
  }

  // ---------- reorder points from the final position ----------
  const reorderEdits = [];
  for (const p of products) {
    let avail = 0;
    for (const wh of whIds) avail += get(p.sku, wh) - (alloc.get(k(p.sku, wh)) || 0);
    const lead = supplierById[p.supplierId].leadTimeDays;
    const nice = (n) => (n > 40 ? Math.round(n / 5) * 5 : Math.round(n));
    let rp = Math.max(2, nice(rate[p.sku] * 2.2 * Math.min(lead, 14) * 0.6));
    if (lowSet.has(p.sku) && avail > 0) rp = Math.max(rp, nice(avail + Math.max(2, avail * (0.3 + r.next() * 0.6))));
    else if (!lowSet.has(p.sku) && !outSet.has(p.sku) && avail <= rp) rp = Math.max(1, nice(avail * 0.55));
    p.reorderPoint = rp;
    p.reorderQty = roundQty(Math.max(rp * 1.6, 4), p.unitCostCents);
  }
  // A few historical reorder-point edits, recorded so the audit trail matches the current values.
  for (let e = 0; e < 7; e++) {
    const p = bySku[shuffled[20 + e * 7]];
    const before = Math.max(1, p.reorderPoint + (e % 2 ? -r.int(2, 6) : r.int(3, 10)));
    const day = -60 + e * 8;
    log(at(day, 14, r.int(0, 59)), USERS.manager, 'product.reorder', 'product', p.sku, p.sku, [{ field: 'Reorder point', from: before, to: p.reorderPoint }], 'Adjusted to match current sell-through.');
    reorderEdits.push(p.sku);
  }
  log(at(-45, 15, 10), USERS.admin, 'supplier.update', 'supplier', 'SUP-05', SUPPLIERS[4].name, [{ field: 'Lead time (days)', from: 21, to: 28 }], 'Supplier confirmed longer sea-freight transit.');

  // PO lifecycle audit entries.
  const ACTION_FOR = { draft: 'po.create', pending: 'po.submit', approved: 'po.approve', ordered: 'po.order', cancelled: 'po.cancel' };
  const fmt = (c) => '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  for (const po of pos) {
    const total = po.lines.reduce((t, l) => t + l.qty * l.unitCostCents, 0);
    let prev = '';
    for (const h of po.history) {
      const action = ACTION_FOR[h.status];
      if (action) {
        const changes = h.status === 'draft' ? [{ field: 'Total', from: '', to: fmt(total) }] : [{ field: 'Status', from: prev, to: h.status }];
        log(h.at, h.by, action, 'po', po.id, po.id, changes, h.status === 'cancelled' ? po.cancelReason : h.status === 'draft' ? `${po.lines.length} lines from ${supplierById[po.supplierId].name}.` : '');
      }
      prev = h.status;
    }
  }

  // ---------- finalise ----------
  raw.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const movements = raw.map((m, i) => ({ id: `MV-${pad(i + 1, 6)}`, ...m }));
  audit.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  audit.forEach((a, i) => (a.id = `AU-${pad(i + 1, 5)}`));

  return {
    version: 1,
    seededFor: today,
    warehouses: WAREHOUSES.map((w) => ({ ...w })),
    categories: [...CATEGORIES],
    suppliers: SUPPLIERS.map((s) => ({ ...s, createdAt: D(-200) })),
    products,
    movements,
    salesOrders,
    purchaseOrders: pos,
    transfers,
    audit,
    seq: { movement: movements.length, audit: audit.length, po: 7 + PLAN.length - 1, transfer: trSeq - 1 },
  };
}

const REASON_LABEL = { cycle_count: 'Cycle count', damaged: 'Damaged', lost: 'Lost', found: 'Found', return_to_stock: 'Return to stock' };
