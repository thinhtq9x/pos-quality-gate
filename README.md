# POS Quality Gate

A small Playwright suite around a mini point-of-sale checkout — twenty-two tests, five seconds, no external dependencies.

The point of this repository is not that it contains automated tests. It is **which twenty-two tests, and why those and not fifty.**

```bash
npm install
npx playwright install chromium
npm test          # whole suite
npm run api       # API layer only
npm run ui        # browser layer only
npm run app       # run the app by itself at http://localhost:3100
```

Everything runs locally. The app under test ships with the repo, holds state in memory, and needs no network, no database and no credentials — so the suite gives the same answer on any machine, including a clean CI runner.

---

## What is under test

`app/` is a deliberately small checkout service with the rules that make a POS a POS:

| Rule | Where |
|---|---|
| Money is integer cents, never floating point | `app/rules.js` |
| Tax is 8.25%, rounded **half-up** | `taxCents()` |
| Splitting a bill loses no cent and invents none | `splitEvenly()` |
| An order is a state machine: `OPEN → SETTLED → REFUNDED` | `canTransition()` |
| **Void is legal before settlement, never after** | `TRANSITIONS` |
| Refund is legal only after settlement, never above the amount taken | `/api/orders/:id/refund` |
| Cashiers may void; only managers may refund | `ROLES` |
| The same idempotency key never creates a second order | `POST /api/orders` |

Two users: `cashier / cashier123` and `manager / manager123`. A third, `locked / locked123`, has the right password on a locked account — which is a 403, not a 401.

---

## Why these tests

I picked them by asking one question of each candidate test: **if this broke, how much money moves, whose, and how long before anyone notices?** That ranks very differently from "what features exist".

### The settlement boundary — 6 tests

A POS stops being reversible when the batch settles. Before it, a mistake is a void: instant, free, invisible to the customer. After it, the only routes are a refund that costs money and takes days, or a chargeback.

So the most valuable tests are not on the payment screen. They are: create an order, cross the boundary, and then attempt every modification the system still offers. `tests/api/lifecycle.spec.js` does exactly that — void after settle, refund before settle, anything at all after a void.

The classic field defect this catches: the UI still shows **Void** on a settled transaction. Staff press it, the screen says success, the money never comes back, and nobody finds out for three days.

### Money arithmetic — 5 tests

A rounding rule is one line of code and nobody reviews it twice. `tests/api/money.spec.js` pins the tax rounding to half-up, checks that a three-way split adds back to exactly the total, and refuses quantities and SKUs that would otherwise price as zero.

A one-cent error is not a low-severity bug at scale. It is one cent times every transaction, every day, surfacing as a reconciliation complaint that costs more to answer than the cent was worth.

### Authorisation, checked on the server — 6 tests

`tests/api/access.spec.js` calls the endpoints directly with tokens that should not be allowed, because a rule enforced by hiding a button is not enforced. A cashier who cannot see the Refund button can still send the request.

It also separates **401** (I don't know who you are) from **403** (I know, and no), and asserts that malformed input returns 400 rather than 500 — for a tester, every 500 is a defect.

### The browser layer — 5 tests, and only five

Everything provable at the API layer is tested there: faster, steadier, cheaper to keep alive. The browser tests cover only what the API cannot see — what the person at the till is actually shown, and whether the controls offered match what the server will permit.

That is why `Void disappears once the order settles` exists at the UI layer while the same rule is also tested through the API. They are different questions: *is the rule enforced* and *is the rule visible*. Both have been production incidents in real POS products.

---

## What is deliberately absent

Being able to say what you chose **not** to automate matters as much as the suite itself.

- **No page object layer.** Four UI tests do not need one. Adding the abstraction before the duplication exists is a cost with no return; it earns its place somewhere around fifteen or twenty tests.
- **No visual regression.** It would fail on font rendering long before it caught a defect that mattered here.
- **No performance assertions.** Timing on a developer laptop is not a measurement.
- **No exhaustive catalogue coverage.** Four items exercise the same pricing path; testing all of them tests the loop, not the rule.
- **No retries beyond one, in CI only.** A test needing three attempts is not flaky, it is wrong. Retries hide that.

---

## Notes a reviewer might look for

**A test that found a bug in itself.** `malformed JSON is a 400, never a 500` failed the first time it ran — not because the app was wrong, but because Playwright JSON-encodes a string passed as `data`, so the server received perfectly valid JSON. Passing a `Buffer` sends the raw bytes. The comment is still in the test, because a test that passes for the wrong reason is worse than no test.

**Failure messages say what is wrong, not what was expected.** Compare `expect(status).toBe(403)` with the same assertion carrying *"the rule must live on the server, not in a hidden button"*. The second tells whoever is looking at a red build at 6pm why the test exists.

**The suite is fast on purpose.** Twenty-two tests in about five seconds, in parallel. A suite people wait for is a suite people stop running.

---

## CI

`.github/workflows/tests.yml` runs the whole suite on every push and pull request, and keeps the HTML report as an artifact for seven days. It installs only Chromium — three browsers would triple the run time to cover a risk this application does not have.

---

## Structure

```
app/                  the system under test
  rules.js            business rules, isolated and unit-testable
  server.js           HTTP API
  index.html          the till UI
tests/
  api/                money, lifecycle, access
  ui/                 what the cashier sees
  support/api.js      helpers, so tests read as intent not plumbing
playwright.config.js  two projects: api and ui
```
