'use strict';

/**
 * Response-cloaking middleware — the safety net.
 *
 * The checkout routes are already written to return only the order number, but
 * this middleware guarantees it defensively: it inspects every outgoing JSON
 * body and scrubs any value that looks like a raw gateway transaction id,
 * replacing it with the request's order number when known, or a redaction
 * marker otherwise. This means that even if a future code path accidentally
 * leaks a gateway id into a customer response, the customer still never sees
 * it.
 *
 * Patterns matched (conservative, to avoid touching unrelated data):
 *   - PayPal capture/txn ids  : 17-char uppercase alphanumeric (e.g. 3C679366HH908993F)
 *   - Stripe charge ids       : ch_...
 *   - Stripe payment intents  : pi_...
 *   - Stripe balance txns     : txn_...
 *
 * Keys that legitimately carry the order number are left untouched.
 */

const GATEWAY_ID_PATTERNS = [
  /\bch_[A-Za-z0-9]{8,}\b/g, // Stripe charge
  /\bpi_[A-Za-z0-9]{8,}\b/g, // Stripe payment intent
  /\btxn_[A-Za-z0-9]{8,}\b/g, // Stripe balance transaction
  /\b[A-Z0-9]{17}\b/g, // PayPal capture/transaction id
];

// Response keys that must NEVER be sent to a customer, whatever their value.
const FORBIDDEN_KEYS = new Set([
  'transaction_id',
  'transactionId',
  'gateway_transaction_id',
  'gatewayTransactionId',
  'capture_id',
  'captureId',
  'charge_id',
  'chargeId',
  'balance_transaction',
  'paypal_transaction_id',
  'stripe_transaction_id',
]);

function scrubString(str, replacement) {
  let out = str;
  for (const re of GATEWAY_ID_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

function scrub(value, replacement) {
  if (value == null) return value;

  if (typeof value === 'string') {
    return scrubString(value, replacement);
  }

  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, replacement));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        // Drop the key entirely rather than exposing it.
        continue;
      }
      out[key] = scrub(val, replacement);
    }
    return out;
  }

  return value;
}

/**
 * Express middleware factory. Wraps res.json so every JSON response body is
 * scrubbed before it leaves the server.
 */
function cloakResponses() {
  return function cloakMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      // Prefer replacing leaked ids with the order number for this request,
      // falling back to a neutral redaction marker.
      const replacement =
        (body && (body.order_number || body.orderNumber)) ||
        res.locals.orderNumber ||
        '[REDACTED]';
      const safe = scrub(body, replacement);
      return originalJson(safe);
    };

    next();
  };
}

module.exports = { cloakResponses, scrub, FORBIDDEN_KEYS };
