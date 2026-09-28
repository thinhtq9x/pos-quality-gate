'use strict';
const { test, expect } = require('@playwright/test');

/**
 * WHY THESE TESTS
 * Only four UI tests, and each one covers something the API layer cannot see:
 * what the person at the till is actually shown, and whether the controls
 * offered match what the server will allow.
 */

async function signIn(page, username, password) {
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a locked account gets a message a cashier can act on', async ({ page }) => {
  await signIn(page, 'locked', 'locked123');
  await expect(page.locator('#msg')).toHaveText(/locked/i);
  await expect(page.locator('#posPane')).toBeHidden();
});

test('a wrong password does not reveal whether the user exists', async ({ page }) => {
  await signIn(page, 'cashier', 'wrong-password');
  const text = await page.locator('#msg').innerText();
  expect(text).toMatch(/not correct/i);
  expect(text, 'the message must not distinguish a bad user from a bad password')
    .not.toMatch(/no such user|does not exist|unknown user/i);
});

test('the totals shown at the till match the priced order', async ({ page }) => {
  await signIn(page, 'cashier', 'cashier123');
  await page.locator('#qty-BURGER').fill('1');
  await page.locator('#qty-FRIES').fill('2');
  await page.getByRole('button', { name: 'Create order' }).click();

  await expect(page.locator('#subtotal')).toHaveText('$19.00');
  await expect(page.locator('#tax')).toHaveText('$1.57');
  await expect(page.locator('#total')).toHaveText('$20.57');
});

test('Void disappears once the order settles, and Refund needs a manager', async ({ page }) => {
  await signIn(page, 'cashier', 'cashier123');
  await page.locator('#qty-COLA').fill('1');
  await page.getByRole('button', { name: 'Create order' }).click();

  await expect(page.getByRole('button', { name: 'Void' })).toBeEnabled();
  await page.getByRole('button', { name: 'Settle' }).click();

  await expect(page.locator('#stateVal')).toHaveText('SETTLED');
  await expect(page.getByRole('button', { name: 'Void' }),
    'offering Void after settlement is the defect this test exists for').toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refund all' }),
    'a cashier must not be offered a refund').toBeDisabled();
});

test('a manager can refund a settled order end to end', async ({ page }) => {
  await signIn(page, 'manager', 'manager123');
  await page.locator('#qty-COFFEE').fill('1');
  await page.getByRole('button', { name: 'Create order' }).click();
  await page.getByRole('button', { name: 'Settle' }).click();
  await page.getByRole('button', { name: 'Refund all' }).click();

  await expect(page.locator('#stateVal')).toHaveText('REFUNDED');
  await expect(page.locator('#msg')).toHaveText(/refund completed/i);
});
