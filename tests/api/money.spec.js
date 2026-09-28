'use strict';
const { test, expect } = require('@playwright/test');
const { tokenFor, createOrder, act, CASHIER } = require('../support/api');

/**
 * WHY THESE TESTS
 * Money arithmetic is the one thing a checkout can get wrong without anybody
 * noticing for weeks. Each case here is a rule someone could change by accident.
 */
test.describe('Money arithmetic', () => {
  let token;
  test.beforeAll(async ({ request }) => {
    token = await tokenFor(request, CASHIER.username, CASHIER.password);
  });

  test('total equals subtotal plus tax, to the cent', async ({ request }) => {
    const { status, body } = await createOrder(request, token, [
      { sku: 'BURGER', qty: 1 },  // 1000
      { sku: 'FRIES', qty: 2 },   //  900
    ]);
    expect(status).toBe(201);
    expect(body.subtotalCents).toBe(1900);
    expect(body.taxCents).toBe(157);            // 1900 * 8.25% = 156.75 -> 157
    expect(body.totalCents).toBe(body.subtotalCents + body.taxCents);
  });

  test('tax rounds half-up, not towards zero', async ({ request }) => {
    // COFFEE 399 -> 399 * 8.25% = 32.9175 -> 33
    const { body } = await createOrder(request, token, [{ sku: 'COFFEE', qty: 1 }]);
    expect(body.taxCents).toBe(33);
  });

  test('splitting a bill loses no cent and invents none', async ({ request }) => {
    const { body: order } = await createOrder(request, token, [{ sku: 'COLA', qty: 1 }]); // 325 + 27 = 352
    const { status, body } = await act(request, token, order.id, 'split', { payers: 3 });
    expect(status).toBe(200);
    expect(body.parts).toHaveLength(3);
    expect(body.parts.reduce((a, b) => a + b, 0)).toBe(order.totalCents);
    // Remainder goes to the earlier payers, and no share differs by more than a cent.
    expect(Math.max(...body.parts) - Math.min(...body.parts)).toBeLessThanOrEqual(1);
  });

  test('a quantity that is not a positive integer is refused', async ({ request }) => {
    for (const qty of [0, -1, 1.5]) {
      const { status } = await createOrder(request, token, [{ sku: 'FRIES', qty }]);
      expect(status, `qty=${qty} must be refused`).toBe(422);
    }
  });

  test('an unknown SKU is refused rather than priced as zero', async ({ request }) => {
    const { status, body } = await createOrder(request, token, [{ sku: 'NOT_A_THING', qty: 1 }]);
    expect(status).toBe(422);
    expect(body.error).toContain('UNKNOWN_SKU');
  });
});
