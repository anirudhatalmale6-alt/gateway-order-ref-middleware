'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scrub } = require('../src/middleware/cloak');

/*
 * These tests prove the safety-net cloaking: even if a raw gateway id sneaks
 * into an outgoing payload, the customer response is scrubbed. They run with
 * `npm test` and need no gateway credentials or network.
 */

test('drops forbidden transaction-id keys entirely', () => {
  const input = {
    order_number: 'ORD-20260805-ABCD1234',
    transaction_id: '3C679366HH908993F',
    charge_id: 'ch_3PabcXYZ123456',
    amount: 4200,
  };
  const out = scrub(input, input.order_number);
  assert.strictEqual(out.transaction_id, undefined);
  assert.strictEqual(out.charge_id, undefined);
  assert.strictEqual(out.order_number, 'ORD-20260805-ABCD1234');
  assert.strictEqual(out.amount, 4200);
});

test('rewrites PayPal-style ids embedded in free-text strings', () => {
  const input = {
    order_number: 'ORD-1',
    message: 'Your payment 3C679366HH908993F was received',
  };
  const out = scrub(input, input.order_number);
  assert.ok(!/3C679366HH908993F/.test(out.message));
  assert.ok(out.message.includes('ORD-1'));
});

test('rewrites Stripe-style ids embedded in strings', () => {
  const input = {
    order_number: 'ORD-2',
    note: 'ref pi_3PabcdEfGhIjKlmn and ch_3PabcdEfGhIjKlmn',
  };
  const out = scrub(input, input.order_number);
  assert.ok(!/pi_3Pabcd/.test(out.note));
  assert.ok(!/ch_3Pabcd/.test(out.note));
});

test('leaves clean payloads untouched', () => {
  const input = { order_number: 'ORD-3', status: 'paid', amount: 999 };
  const out = scrub(input, input.order_number);
  assert.deepStrictEqual(out, input);
});

test('recurses into nested arrays/objects', () => {
  const input = {
    order_number: 'ORD-4',
    items: [{ charge_id: 'ch_deadbeef1234', name: 'Widget' }],
  };
  const out = scrub(input, input.order_number);
  assert.strictEqual(out.items[0].charge_id, undefined);
  assert.strictEqual(out.items[0].name, 'Widget');
});
