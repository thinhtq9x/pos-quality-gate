'use strict';
const { test, expect } = require('@playwright/test');
const { login, tokenFor, bearer, createOrder, act, CASHIER, MANAGER, LOCKED } = require('../support/api');

/**
 * WHY THESE TESTS
 * Authorisation is checked per action on the server, never by hiding a button.
 * These call the endpoints directly with tokens that should not be allowed.
 */
test.describe('Authentication and authorisation', () => {
  test('401 is "who are you", 403 is "not allowed" — they are different answers', async ({ request }) => {
    expect((await login(request, 'cashier', 'wrong')).status).toBe(401);
    expect((await login(request, 'nobody', 'x')).status).toBe(401);

    const locked = await login(request, LOCKED.username, LOCKED.password);
    expect(locked.status, 'correct password on a locked account is 403, not 401').toBe(403);
    expect(locked.body.error).toBe('ACCOUNT_LOCKED');
  });

  test('order endpoints reject a request with no session', async ({ request }) => {
    const res = await request.post('/api/orders', { data: { lines: [{ sku: 'FRIES', qty: 1 }] } });
    expect(res.status()).toBe(401);
  });

  test('a forged token is rejected', async ({ request }) => {
    const res = await request.post('/api/orders', {
      data: { lines: [{ sku: 'FRIES', qty: 1 }] },
      headers: bearer('00000000-0000-0000-0000-000000000000'),
    });
    expect(res.status()).toBe(401);
  });

  test('a cashier cannot refund even by calling the endpoint directly', async ({ request }) => {
    const manager = await tokenFor(request, MANAGER.username, MANAGER.password);
    const cashier = await tokenFor(request, CASHIER.username, CASHIER.password);

    const { body: order } = await createOrder(request, manager, [{ sku: 'BURGER', qty: 1 }]);
    await act(request, manager, order.id, 'settle');

    const attempt = await act(request, cashier, order.id, 'refund', { amountCents: 100 });
    expect(attempt.status, 'the rule must live on the server, not in a hidden button').toBe(403);

    const allowed = await act(request, manager, order.id, 'refund', { amountCents: 100 });
    expect(allowed.status).toBe(200);
  });

  test('an unknown order is 404 and does not leak whether it ever existed', async ({ request }) => {
    const token = await tokenFor(request, CASHIER.username, CASHIER.password);
    const res = await request.get('/api/orders/11111111-2222-3333-4444-555555555555', { headers: bearer(token) });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'ORDER_NOT_FOUND' });
  });

  test('malformed JSON is a 400, never a 500', async ({ request }) => {
    const token = await tokenFor(request, CASHIER.username, CASHIER.password);
    // NOTE: pass a Buffer, not a string. Playwright JSON-encodes a string, so
    // the server would receive perfectly valid JSON and the test would pass for
    // the wrong reason. There is no `body` option — raw bytes go in `data`.
    const res = await request.post('/api/orders', {
      headers: { ...bearer(token), 'content-type': 'application/json' },
      data: Buffer.from('{ this is not json'),
    });
    expect(res.status(), 'bad input is the client\'s fault; a 500 here would be a defect').toBe(400);
  });
});
