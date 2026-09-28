'use strict';
/**
 * Business rules for the mini POS.
 * Money is ALWAYS handled as integer cents. Never floating point.
 */

const TAX_RATE_BP = 825; // 8.25% expressed in basis points

const CATALOG = [
  { sku: 'BURGER', name: 'Cheeseburger', cents: 1000 },
  { sku: 'FRIES', name: 'Fries', cents: 450 },
  { sku: 'COLA', name: 'Cola', cents: 325 },
  { sku: 'COFFEE', name: 'Coffee', cents: 399 },
];

const ROLES = {
  cashier: { canVoid: true, canRefund: false },
  manager: { canVoid: true, canRefund: true },
};

const USERS = {
  cashier: { password: 'cashier123', role: 'cashier' },
  manager: { password: 'manager123', role: 'manager' },
  locked: { password: 'locked123', role: 'cashier', locked: true },
};

/** Round half-up. Math.round() rounds -0.5 towards zero, so do it explicitly. */
function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

function taxCents(subtotalCents) {
  return roundHalfUp((subtotalCents * TAX_RATE_BP) / 10000);
}

function priceOrder(lines) {
  const subtotal = lines.reduce((sum, l) => {
    const item = CATALOG.find((c) => c.sku === l.sku);
    if (!item) throw new Error('UNKNOWN_SKU:' + l.sku);
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new Error('BAD_QTY');
    return sum + item.cents * l.qty;
  }, 0);
  const tax = taxCents(subtotal);
  return { subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
}

/**
 * Split a total evenly across n payers with no cent lost or invented.
 * The remainder goes to the first payers, one cent each.
 */
function splitEvenly(totalCents, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('BAD_SPLIT');
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Order state machine.
 *   OPEN      -> SETTLED (settle)   | VOIDED (void)
 *   SETTLED   -> REFUNDED / PARTIALLY_REFUNDED (refund)
 *   VOIDED    -> terminal
 * A void after settlement is the classic POS defect; it must be refused.
 */
const TRANSITIONS = {
  settle: ['OPEN'],
  void: ['OPEN'],
  refund: ['SETTLED', 'PARTIALLY_REFUNDED'],
};

function canTransition(action, state) {
  return (TRANSITIONS[action] || []).includes(state);
}

module.exports = {
  TAX_RATE_BP, CATALOG, ROLES, USERS,
  roundHalfUp, taxCents, priceOrder, splitEvenly, canTransition,
};
