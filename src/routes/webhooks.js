'use strict';

const express = require('express');
const db = require('../db');
const paypal = require('../gateways/paypal');
const stripe = require('../gateways/stripe');

/**
 * Gateway webhook receivers.
 *
 * Webhooks are SERVER-TO-SERVER (PayPal/Stripe -> you). They are never seen by
 * the customer, so here we happily read the real gateway ids and persist them
 * to the mapping table. Nothing about payouts / disputes / refunds is altered —
 * we only observe events and keep our order-number <-> real-id map accurate.
 *
 * IMPORTANT: these routes must receive the RAW request body for signature
 * verification. server.js mounts them with express.raw() accordingly.
 */

const router = express.Router();

/* ----------------------------- Stripe ----------------------------------- */
router.post('/stripe', async (req, res) => {
  let event;
  try {
    event = stripe.constructWebhookEvent(
      req.body, // raw Buffer
      req.headers['stripe-signature']
    );
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.payment_failed'
    ) {
      const intent = event.data.object;
      const orderNumber = intent.metadata && intent.metadata.order_number;
      const mapping = orderNumber && db.getByOrderNumber(orderNumber);
      if (mapping) {
        const chargeId =
          typeof intent.latest_charge === 'string'
            ? intent.latest_charge
            : intent.latest_charge && intent.latest_charge.id;
        db.attachTransactionId({
          gateway: 'stripe',
          gatewayObjectId: intent.id,
          gatewayTransactionId: chargeId || mapping.gateway_transaction_id,
          status:
            event.type === 'payment_intent.succeeded'
              ? 'completed'
              : 'failed',
        });
      }
    }
    // Acknowledge quickly so Stripe stops retrying.
    return res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling error:', err);
    return res.status(500).json({ error: 'handler_failure' });
  }
});

/* ----------------------------- PayPal ----------------------------------- */
router.post('/paypal', async (req, res) => {
  // req.body is a raw Buffer here; PayPal verification needs the parsed event.
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).send('Invalid JSON');
  }

  const verified = await paypal.verifyWebhookSignature({
    headers: req.headers,
    body: event,
  });
  if (!verified) {
    console.error('PayPal webhook signature verification failed');
    return res.status(400).send('Signature verification failed');
  }

  try {
    // custom_id / invoice_id carry our order number back to us.
    const resource = event.resource || {};
    const orderNumber =
      resource.custom_id ||
      resource.invoice_id ||
      resource.purchase_units?.[0]?.custom_id;

    if (orderNumber) {
      const mapping = db.getByOrderNumber(orderNumber);
      if (mapping) {
        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
          db.attachTransactionId({
            gateway: 'paypal',
            gatewayObjectId: mapping.gateway_object_id,
            gatewayTransactionId: resource.id, // real capture id
            status: 'completed',
          });
        } else if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
          db.updateStatus({
            gateway: 'paypal',
            gatewayObjectId: mapping.gateway_object_id,
            status: 'failed',
          });
        }
      }
    }
    return res.json({ received: true });
  } catch (err) {
    console.error('PayPal webhook handling error:', err);
    return res.status(500).json({ error: 'handler_failure' });
  }
});

module.exports = router;
