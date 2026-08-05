'use strict';

const express = require('express');
const db = require('../db');
const { generateOrderNumber } = require('../orderNumber');
const paypal = require('../gateways/paypal');
const stripe = require('../gateways/stripe');

/**
 * Customer-facing checkout endpoints.
 *
 * Golden rule for everything in this file: responses returned to the browser
 * contain ONLY the order number. The real gateway ids are written to the
 * mapping table and never included in any customer-facing payload.
 */

const router = express.Router();

/**
 * Create an order number + gateway object up-front.
 * Body: { gateway: 'paypal'|'stripe', amount: <minor units>, currency? }
 */
router.post('/create', async (req, res, next) => {
  try {
    const { gateway, amount, currency } = req.body || {};
    if (!['paypal', 'stripe'].includes(gateway)) {
      return res.status(400).json({ error: 'Unsupported gateway' });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return res
        .status(400)
        .json({ error: 'amount must be a positive integer (minor units)' });
    }

    const orderNumber = generateOrderNumber();
    res.locals.orderNumber = orderNumber;

    if (gateway === 'paypal') {
      const order = await paypal.createOrder({
        orderNumber,
        amount,
        currency: (currency || 'USD').toUpperCase(),
      });
      db.createMapping({
        orderNumber,
        gateway,
        gatewayObjectId: order.id, // PayPal order id (private)
        amount,
        currency: (currency || 'USD').toUpperCase(),
        status: 'created',
      });
      // Customer gets: their order number + the PayPal order id needed by the
      // PayPal JS SDK to render the approval flow (that id is not the txn id).
      return res.json({
        order_number: orderNumber,
        gateway: 'paypal',
        paypal_order_id: order.id,
      });
    }

    // Stripe
    const intent = await stripe.createPaymentIntent({
      orderNumber,
      amount,
      currency: (currency || 'usd').toLowerCase(),
    });
    db.createMapping({
      orderNumber,
      gateway,
      gatewayObjectId: intent.id, // PaymentIntent id (private)
      amount,
      currency: (currency || 'usd').toLowerCase(),
      status: 'created',
    });
    // Customer gets: order number + client_secret (needed by Stripe.js to
    // confirm the payment). client_secret is not the transaction id.
    return res.json({
      order_number: orderNumber,
      gateway: 'stripe',
      client_secret: intent.clientSecret,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Capture a PayPal order after buyer approval.
 * Body: { order_number }
 * The real capture/transaction id is stored privately; response is just the
 * order number + a friendly status.
 */
router.post('/paypal/capture', async (req, res, next) => {
  try {
    const { order_number: orderNumber } = req.body || {};
    const mapping = orderNumber && db.getByOrderNumber(orderNumber);
    if (!mapping || mapping.gateway !== 'paypal') {
      return res.status(404).json({ error: 'Unknown order' });
    }
    res.locals.orderNumber = orderNumber;

    const result = await paypal.captureOrder(mapping.gateway_object_id);

    // Store the REAL transaction id privately.
    db.attachTransactionId({
      gateway: 'paypal',
      gatewayObjectId: mapping.gateway_object_id,
      gatewayTransactionId: result.transactionId,
      status: result.status === 'COMPLETED' ? 'completed' : result.status,
    });

    // Customer-facing response: order number only.
    return res.json({
      order_number: orderNumber,
      status: result.status === 'COMPLETED' ? 'paid' : 'pending',
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Lightweight status lookup for a receipt/confirmation page.
 * Returns ONLY the order number, amount and status — never a gateway id.
 */
router.get('/status/:orderNumber', (req, res) => {
  const mapping = db.getByOrderNumber(req.params.orderNumber);
  if (!mapping) return res.status(404).json({ error: 'Unknown order' });
  return res.json({
    order_number: mapping.order_number,
    amount: mapping.amount,
    currency: mapping.currency,
    status: mapping.status,
  });
});

module.exports = router;
