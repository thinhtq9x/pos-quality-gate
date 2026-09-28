'use strict';
/**
 * Mini POS — a deliberately small checkout service used as a test target.
 * No framework, no database: everything is in memory so the suite is
 * hermetic and reruns identically. Start with:  npm run app
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./rules');

const PORT = Number(process.env.PORT || 3100);

/** @type {Map<string,{user:string,role:string}>} */
const sessions = new Map();
/** @type {Map<string,object>} */
const orders = new Map();

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('TOO_LARGE'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });

const auth = (req) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return token ? sessions.get(token) || null : null;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // ---------- static ----------
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // ---------- auth ----------
    if (req.method === 'POST' && p === '/api/login') {
      const { username, password } = await readBody(req);
      const u = R.USERS[username];
      if (!u || u.password !== password) {
        return json(res, 401, { error: 'INVALID_CREDENTIALS' });
      }
      if (u.locked) {
        return json(res, 403, { error: 'ACCOUNT_LOCKED' });
      }
      const token = crypto.randomUUID();
      sessions.set(token, { user: username, role: u.role });
      return json(res, 200, { token, role: u.role });
    }

    if (req.method === 'GET' && p === '/api/items') {
      return json(res, 200, { items: R.CATALOG });
    }

    // Everything below needs a session.
    const who = auth(req);
    if (p.startsWith('/api/orders')) {
      if (!who) return json(res, 401, { error: 'NOT_AUTHENTICATED' });
    }

    // ---------- create order ----------
    if (req.method === 'POST' && p === '/api/orders') {
      const body = await readBody(req);
      const lines = body.lines;
      if (!Array.isArray(lines) || lines.length === 0) {
        return json(res, 422, { error: 'NO_LINES' });
      }
      let priced;
      try {
        priced = R.priceOrder(lines);
      } catch (e) {
        return json(res, 422, { error: String(e.message) });
      }
      // Idempotency: the same key must never create a second order.
      const key = req.headers['idempotency-key'];
      if (key) {
        const existing = [...orders.values()].find((o) => o.idempotencyKey === key);
        if (existing) return json(res, 200, existing);
      }
      const order = {
        id: crypto.randomUUID(),
        state: 'OPEN',
        lines,
        ...priced,
        refundedCents: 0,
        idempotencyKey: key || null,
      };
      orders.set(order.id, order);
      return json(res, 201, order);
    }

    const m = p.match(/^\/api\/orders\/([^/]+)(?:\/(settle|void|refund|split))?$/);
    if (m) {
      const order = orders.get(m[1]);
      if (!order) return json(res, 404, { error: 'ORDER_NOT_FOUND' });
      const action = m[2];

      if (req.method === 'GET' && !action) return json(res, 200, order);

      if (req.method === 'POST' && action === 'split') {
        const { payers } = await readBody(req);
        try {
          return json(res, 200, { parts: R.splitEvenly(order.totalCents, payers) });
        } catch {
          return json(res, 422, { error: 'BAD_SPLIT' });
        }
      }

      if (req.method === 'POST' && action === 'settle') {
        if (!R.canTransition('settle', order.state)) {
          return json(res, 409, { error: 'ILLEGAL_TRANSITION', from: order.state, action });
        }
        order.state = 'SETTLED';
        return json(res, 200, order);
      }

      if (req.method === 'POST' && action === 'void') {
        if (!R.ROLES[who.role].canVoid) return json(res, 403, { error: 'FORBIDDEN' });
        if (!R.canTransition('void', order.state)) {
          return json(res, 409, { error: 'ILLEGAL_TRANSITION', from: order.state, action });
        }
        order.state = 'VOIDED';
        return json(res, 200, order);
      }

      if (req.method === 'POST' && action === 'refund') {
        if (!R.ROLES[who.role].canRefund) return json(res, 403, { error: 'FORBIDDEN' });
        if (!R.canTransition('refund', order.state)) {
          return json(res, 409, { error: 'ILLEGAL_TRANSITION', from: order.state, action });
        }
        const { amountCents } = await readBody(req);
        if (!Number.isInteger(amountCents) || amountCents < 1) {
          return json(res, 422, { error: 'BAD_AMOUNT' });
        }
        const remaining = order.totalCents - order.refundedCents;
        if (amountCents > remaining) {
          return json(res, 422, { error: 'REFUND_EXCEEDS_REMAINING', remaining });
        }
        order.refundedCents += amountCents;
        order.state = order.refundedCents === order.totalCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        return json(res, 200, order);
      }
    }

    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg === 'BAD_JSON') return json(res, 400, { error: 'BAD_JSON' });
    return json(res, 500, { error: 'INTERNAL', detail: msg });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`mini-POS listening on http://localhost:${PORT}`));
}

module.exports = server;
