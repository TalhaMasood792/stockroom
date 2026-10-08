// Role-based access control. The store calls `assertCan` / `assertCanApprove`
// before every mutation; the UI calls `can` / `denyReason` to hide or disable
// controls with an explanation.

export const ROLE_LABELS = Object.freeze({ admin: 'Admin', manager: 'Manager', clerk: 'Clerk' });

export const USERS = Object.freeze([
  { id: 'u_zainab', name: 'Zainab Qureshi', role: 'admin', initials: 'ZQ' },
  { id: 'u_hamza', name: 'Hamza Iqbal', role: 'manager', initials: 'HI' },
  { id: 'u_fatima', name: 'Fatima Noor', role: 'clerk', initials: 'FN' },
]);

/** Managers may approve purchase orders up to and including this total. */
export const MANAGER_APPROVAL_LIMIT_CENTS = 500000;

const ALL = ['admin', 'manager', 'clerk'];
const MGR = ['admin', 'manager'];
const ADM = ['admin'];

const MATRIX = {
  'stock.adjust': { roles: ALL, verb: 'record stock adjustments' },
  'transfer.create': { roles: ALL, verb: 'create transfers' },
  'po.create': { roles: ALL, verb: 'create draft purchase orders' },
  'po.submit': { roles: ALL, verb: 'submit purchase orders for approval' },
  'po.receive': { roles: ALL, verb: 'receive purchase orders' },
  'po.approve': { roles: MGR, verb: 'approve purchase orders' },
  'po.order': { roles: MGR, verb: 'place orders with suppliers' },
  'po.cancel': { roles: ADM, verb: 'cancel purchase orders' },
  'product.edit': { roles: MGR, verb: 'edit products' },
  'product.reorder': { roles: MGR, verb: 'edit reorder points' },
  'product.import': { roles: MGR, verb: 'import reorder points' },
  'supplier.manage': { roles: ADM, verb: 'add or edit suppliers' },
};

export class PermissionError extends Error {
  constructor(message, permission) {
    super(message);
    this.name = 'PermissionError';
    this.permission = permission;
  }
}

export function can(user, permission) {
  const rule = MATRIX[permission];
  if (!rule) throw new Error(`Unknown permission: ${permission}`);
  return !!user && rule.roles.includes(user.role);
}

function joinRoles(roles) {
  if (roles.length === 3) return 'Everyone';
  const labels = roles.map((r) => ROLE_LABELS[r] + 's');
  if (labels.length === 1) return `Only ${labels[0]}`;
  return `Only ${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** e.g. "Only Admins can cancel purchase orders. You’re signed in as Manager." */
export function denyReason(user, permission) {
  const rule = MATRIX[permission];
  return `${joinRoles(rule.roles)} can ${rule.verb}. You’re signed in as ${ROLE_LABELS[user?.role] ?? 'nobody'}.`;
}

export function assertCan(user, permission) {
  if (!can(user, permission)) throw new PermissionError(denyReason(user, permission), permission);
}

/** Approval depends on both role and the PO total. */
export function canApprove(user, totalCents) {
  if (!can(user, 'po.approve')) return false;
  if (user.role === 'admin') return true;
  return totalCents <= MANAGER_APPROVAL_LIMIT_CENTS;
}
export function approveDenyReason(user, totalCents) {
  if (!can(user, 'po.approve')) return denyReason(user, 'po.approve');
  if (totalCents > MANAGER_APPROVAL_LIMIT_CENTS) return 'POs over $5,000 need Admin approval. Ask Zainab Qureshi (Admin) to approve this one.';
  return '';
}
export function assertCanApprove(user, totalCents) {
  if (!canApprove(user, totalCents)) throw new PermissionError(approveDenyReason(user, totalCents), 'po.approve');
}
