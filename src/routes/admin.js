'use strict';

const express = require('express');
const db = require('../db');

/**
 * Back-office reconciliation endpoints (SERVER-SIDE / staff only).
 *
 * These DO return the real gateway transaction id — that is the whole point of
 * the mapping table: you look up an order number and get the real id to refund,
 * reconcile or dispute inside PayPal/Stripe. Protect this router behind your
 * own auth. A simple shared-secret guard is included as a baseline; replace it
 * with your real admin auth in production.
 */

const router = express.Router();

// Baseline guard: require a static admin token via header. Replace with real
// authentication (session, JWT, IP allow-list) for production.
router.use((req, res, next) => {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    return res
      .status(503)
      .json({ error: 'ADMIN_API_TOKEN not configured; admin API disabled' });
  }
  if (req.headers['x-admin-token'] !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
});

/** Resolve an order number to the full private mapping (incl. real txn id). */
router.get('/resolve/:orderNumber', (req, res) => {
  const mapping = db.getByOrderNumber(req.params.orderNumber);
  if (!mapping) return res.status(404).json({ error: 'Unknown order' });
  return res.json(mapping);
});

/** Reverse lookup: real gateway transaction id -> your order number. */
router.get('/reverse/:gateway/:transactionId', (req, res) => {
  const { gateway, transactionId } = req.params;
  const mapping = db.getByTransactionId(gateway, transactionId);
  if (!mapping) return res.status(404).json({ error: 'Unknown transaction' });
  return res.json(mapping);
});

module.exports = router;
