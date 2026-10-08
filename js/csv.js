// CSV parsing, writing and import validation. Pure functions, unit-tested under Node.

/**
 * RFC 4180-style parser. Handles quoted fields, commas and newlines inside
 * quotes, doubled quotes ("") as an escaped quote, CRLF / LF / CR line endings,
 * a leading UTF-8 BOM, and a trailing newline. Returns an array of string arrays.
 * Throws if a quoted field is never closed.
 */
export function parseCSV(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  let quoteStartLine = 0;
  let line = 1;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (c === '\n') line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      quoteStartLine = line;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (c === '\r' && s[i + 1] === '\n') i++;
      i++;
      line++;
      continue;
    }
    field += c;
    i++;
  }
  if (inQuotes) throw new Error(`A quoted value starting on line ${quoteStartLine} is never closed. Add the missing closing quote (") and upload again.`);
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully blank lines (e.g. trailing empty rows from spreadsheets).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === '') && !r.every((v) => v.trim() === ''));
}

/** Serialise rows to CSV with CRLF line endings; neutralises spreadsheet formulas. */
export function toCSV(rows) {
  const cell = (v) => {
    let str = String(v ?? '');
    if (/^[=+@\t\r]/.test(str) || (/^-/.test(str) && !/^-\d+(\.\d+)?$/.test(str))) str = "'" + str;
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Parse rows into objects keyed by normalised header ("Reorder point" → "reorder_point"). */
export function rowsToObjects(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(normaliseHeader);
  const records = rows.slice(1).map((r, idx) => {
    const obj = { _line: idx + 2 };
    headers.forEach((h, j) => {
      if (h) obj[h] = (r[j] ?? '').trim();
    });
    return obj;
  });
  return { headers, records };
}
export function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export const IMPORT_TEMPLATE_HEADERS = ['sku', 'reorder_point', 'reorder_qty', 'name', 'category', 'supplier_id', 'unit_cost'];
export const SKU_PATTERN = /^[A-Z]{3}-[A-Z]{2,4}-\d{4}$/;

const intOrNull = (v) => (/^\d+$/.test(v) ? Number(v) : null);
const moneyToCents = (v) => {
  const s = String(v).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
};

/**
 * Validate a reorder-point import.
 * ctx: { products: Map<sku, product>, suppliers: Set<id>, categories: string[], allowNew: boolean }
 * Returns { fileError, rows: [{ line, sku, kind: 'update'|'new', values, errors: [] }], validCount }
 */
export function validateReorderImport(text, ctx) {
  let parsed;
  try {
    parsed = parseCSV(text);
  } catch (e) {
    return { fileError: e.message, rows: [], validCount: 0 };
  }
  if (!parsed.length) return { fileError: 'The file is empty. Download the template, fill in at least one row and upload it again.', rows: [], validCount: 0 };
  const { headers, records } = rowsToObjects(parsed);
  const missing = ['sku', 'reorder_point'].filter((h) => !headers.includes(h));
  if (missing.length) {
    return {
      fileError: `The header row is missing the ${missing.map((m) => `“${m}”`).join(' and ')} column${missing.length > 1 ? 's' : ''}. The first row must include sku and reorder_point — download the template to see the expected layout.`,
      rows: [], validCount: 0, headers,
    };
  }
  if (!records.length) return { fileError: 'The file has a header row but no data rows. Add at least one SKU below the header.', rows: [], validCount: 0, headers };
  const seen = new Map();
  const catLower = new Map(ctx.categories.map((c) => [c.toLowerCase(), c]));
  const rows = records.map((r) => {
    const errors = [];
    const sku = (r.sku || '').toUpperCase();
    const out = { line: r._line, sku, kind: 'update', values: {}, errors, raw: r };
    if (!sku) {
      errors.push('SKU is blank. Fill in the SKU or delete the row.');
      return out;
    }
    if (seen.has(sku)) errors.push(`Duplicate of line ${seen.get(sku)}. Keep one row per SKU.`);
    else seen.set(sku, r._line);
    const existing = ctx.products.get(sku);
    if (!existing) {
      if (!ctx.allowNew) {
        errors.push('Unknown SKU. Check for typos, or turn on “Add new products” and include name, category, supplier_id and unit_cost.');
      } else {
        out.kind = 'new';
        if (!SKU_PATTERN.test(sku)) errors.push('New SKUs must look like NET-RTR-0012 (3 letters, 2–4 letters, 4 digits).');
        if (!r.name) errors.push('Name is required for a new product.');
        if (!r.category) errors.push('Category is required for a new product.');
        else if (!catLower.has(r.category.toLowerCase())) errors.push(`Category “${r.category}” isn’t recognised. Use one of: ${ctx.categories.join(', ')}.`);
        else out.values.category = catLower.get(r.category.toLowerCase());
        const sup = (r.supplier_id || '').toUpperCase();
        if (!sup) errors.push('supplier_id is required for a new product.');
        else if (!ctx.suppliers.has(sup)) errors.push(`Supplier “${r.supplier_id}” doesn’t exist. Use an ID from the Suppliers page, such as SUP-01.`);
        else out.values.supplierId = sup;
        const cost = r.unit_cost === undefined || r.unit_cost === '' ? null : moneyToCents(r.unit_cost);
        if (cost === null || cost <= 0) errors.push('unit_cost must be a positive amount, such as 42.50.');
        else out.values.unitCostCents = cost;
        if (r.name) out.values.name = r.name;
      }
    }
    const rp = intOrNull(r.reorder_point ?? '');
    if (r.reorder_point === undefined || r.reorder_point === '') errors.push('reorder_point is blank. Enter a whole number of units, such as 25.');
    else if (rp === null) errors.push(`reorder_point “${r.reorder_point}” isn’t a whole number. Use digits only, such as 25.`);
    else out.values.reorderPoint = rp;
    if (r.reorder_qty !== undefined && r.reorder_qty !== '') {
      const rq = intOrNull(r.reorder_qty);
      if (rq === null || rq === 0) errors.push(`reorder_qty “${r.reorder_qty}” must be a whole number above zero.`);
      else out.values.reorderQty = rq;
    } else if (out.kind === 'new') {
      errors.push('reorder_qty is required for a new product.');
    }
    if (existing && out.values.reorderPoint !== undefined) {
      out.before = { reorderPoint: existing.reorderPoint, reorderQty: existing.reorderQty };
    }
    return out;
  });
  return { fileError: null, rows, validCount: rows.filter((r) => !r.errors.length).length, headers };
}
