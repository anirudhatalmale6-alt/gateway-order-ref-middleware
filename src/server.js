'use strict';

const express = require('express');
const config = require('./config');
const { cloakResponses } = require('./middleware/cloak');

const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');

const app = express();

/*
 * Webhooks MUST be mounted BEFORE the JSON body parser, because both Stripe and
 * PayPal signature verification require the raw, unmodified request body.
 */
app.use('/webhooks', express.raw({ type: '*/*' }), webhookRoutes);

// Everything else uses parsed JSON.
app.use(express.json());

// Cloak safety-net on customer-facing responses (checkout + status).
// NOTE: not applied to /admin, which intentionally returns real ids to staff.
app.use('/checkout', cloakResponses(), checkoutRoutes);

// Back-office reconciliation (guarded; returns real ids to staff only).
app.use('/admin', adminRoutes);

// Health check.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Central error handler — never leak internals to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(
      `Gateway order-reference middleware listening on :${config.port} ` +
        `(PayPal env: ${config.paypal.env})`
    );
  });
}

module.exports = app;
