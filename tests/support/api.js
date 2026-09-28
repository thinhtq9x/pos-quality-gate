'use strict';
/** Small helpers so the tests read like intent, not plumbing. */

async function login(request, username, password) {
  const res = await request.post('/api/login', { data: { username, password } });
  return { status: res.status(), body: await res.json() };
}

async function tokenFor(request, username, password) {
  const { body } = await login(request, username, password);
  return body.token;
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

async function createOrder(request, token, lines, extraHeaders = {}) {
  const res = await request.post('/api/orders', {
    data: { lines },
    headers: { ...bearer(token), ...extraHeaders },
  });
  return { status: res.status(), body: await res.json() };
}

async function act(request, token, id, action, data) {
  const res = await request.post(`/api/orders/${id}/${action}`, {
    headers: bearer(token),
    ...(data ? { data } : {}),
  });
  return { status: res.status(), body: await res.json() };
}

const CASHIER = { username: 'cashier', password: 'cashier123' };
const MANAGER = { username: 'manager', password: 'manager123' };
const LOCKED = { username: 'locked', password: 'locked123' };

module.exports = { login, tokenFor, bearer, createOrder, act, CASHIER, MANAGER, LOCKED };
