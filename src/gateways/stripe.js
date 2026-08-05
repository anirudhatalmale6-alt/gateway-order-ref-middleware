'use strict';

const Stripe = require('stripe');
const config = require('../config');

/**
 * Stripe client wrapper.
 *
 * Responsibilities:
 *   - create a PaymentIntent tagged with YOUR order number via metadata and a
 *     statement descriptor suffix (so your reference shows in the Stripe
 *     dashboard and, where supported, on the card statement),
 *   - surface the REAL charge/transaction id (the balance-transaction / charge
 *     id) for private storage — never to the customer,
 *   - construct + verify webhook events.
 */

const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: '2024-06-20',
});

/**
 * Create a PaymentIntent. `orderNumber` is stored in metadata (queryable in
 * the dashboard) and used as the statement-descriptor suffix.
 * @returns {{ id: string, clientSecret: string, status: string, raw: object }}
 */
async function createPaymentIntent({
  orderNumber,
  amount,
  currency = 'usd',
  customer = undefined,
}) {
  const intent = await stripe.paymentIntents.create({
    amount, // minor units (cents)
    currency,
    customer,
    metadata: { order_number: orderNumber },
    // Suffix shows after your merchant prefix on the customer's statement.
    statement_descriptor_suffix: sanitizeDescriptor(
      config.stripe.statementDescriptorSuffix
    ),
    automatic_payment_methods: { enabled: true },
  });

  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
    raw: intent,
  };
}

/**
 * Retrieve the REAL transaction id for a PaymentIntent. For Stripe the durable
 * "transaction id" is the latest charge id (ch_...). Stored privately.
 * @returns {{ transactionId: string|null, status: string, raw: object }}
 */
async function getTransactionId(paymentIntentId) {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  });
  const charge = intent.latest_charge;
  const transactionId =
    charge && typeof charge === 'object' ? charge.id : charge || null;
  return { transactionId, status: intent.status, raw: intent };
}

/** Verify + parse a Stripe webhook from the raw request body. */
function constructWebhookEvent(rawBody, signatureHeader) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    config.stripe.webhookSecret
  );
}

// Statement descriptors allow only a limited charset and length (<= 22).
function sanitizeDescriptor(value) {
  return (value || 'ORDER')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .slice(0, 22)
    .trim();
}

module.exports = {
  stripe,
  createPaymentIntent,
  getTransactionId,
  constructWebhookEvent,
};
