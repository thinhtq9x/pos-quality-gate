'use strict';
const { test, expect } = require('@playwright/test');
const { tokenFor, createOrder, act, CASHIER, MANAGER } = require('../support/api');

/**
 * WHY THESE TESTS
 * The settlement boundary is where a POS stops being reversible. Every test
 * here is an illegal transition that a UI will happily offer if nobody stops it.
 */
test.describe('Order lifecycle across the settlement boundary', () => {
  let cashier, manager;
  test.beforeAll(async ({ request }) => {
    cashier = await tokenFor(request, CASHIER.username, CASHIER.password);
    manager = await tokenFor(request, MANAGER.username, MANAGER.password);
  });

  const newOrder = (request, token) =>
    createOrder(request, token, [{ sku: 'BURGER', qty: 1 }]).then((r) => r.body);

  test('an open order can be voided', async ({ request }) => {
    const o = await newOrder(request, cashier);
    const { status, body } = await act(request, cashier, o.id, 'void');
    expect(status).toBe(200);
    expect(body.state).toBe('VOIDED');
  });

  test('a settled order can NOT be voided — the classic POS defect', async ({ request }) => {
    const o = await newOrder(request, cashier);
    await act(request, cashier, o.id, 'settle');
    const { status, body } = await act(request, cashier, o.id, 'void');
    expect(status).toBe(409);
    expect(body.error).toBe('ILLEGAL_TRANSITION');
    expect(body.from).toBe('SETTLED');
  });

  test('an open order can NOT be refunded — refund is a post-settlement act', async ({ request }) => {
    const o = await newOrder(request, manager);
    const { status } = await act(request, manager, o.id, 'refund', { amountCents: 100 });
    expect(status).toBe(409);
  });

  test('a voided order is terminal', async ({ request }) => {
    const o = await newOrder(request, manager);
    await act(request, manager, o.id, 'void');
    expect((await act(request, manager, o.id, 'settle')).status).toBe(409);
    expect((await act(request, manager, o.id, 'refund', { amountCents: 100 })).status).toBe(409);
  });

  test('refunds may not exceed the amount taken, in one go or cumulatively', async ({ request }) => {
    const o = await newOrder(request, manager);            // 1000 + 83 = 1083
    await act(request, manager, o.id, 'settle');

    const tooMuch = await act(request, manager, o.id, 'refund', { amountCents: o.totalCents + 1 });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toBe('REFUND_EXCEEDS_REMAINING');

    const part = await act(request, manager, o.id, 'refund', { amountCents: 600 });
    expect(part.status).toBe(200);
    expect(part.body.state).toBe('PARTIALLY_REFUNDED');

    const overflow = await act(request, manager, o.id, 'refund', { amountCents: o.totalCents - 600 + 1 });
    expect(overflow.status, 'two refunds must not add up to more than the original').toBe(422);

    const rest = await act(request, manager, o.id, 'refund', { amountCents: o.totalCents - 600 });
    expect(rest.body.state).toBe('REFUNDED');
    expect(rest.body.refundedCents).toBe(o.totalCents);
  });

  test('the same idempotency key never creates a second order', async ({ request }) => {
    const key = 'test-key-' + Date.now();
    const first = await createOrder(request, cashier, [{ sku: 'COLA', qty: 1 }], { 'idempotency-key': key });
    const second = await createOrder(request, cashier, [{ sku: 'COLA', qty: 1 }], { 'idempotency-key': key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id, 'a retry must return the original order').toBe(first.body.id);
  });
});
