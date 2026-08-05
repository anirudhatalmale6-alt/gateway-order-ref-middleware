'use strict';

const crypto = require('crypto');
const config = require('./config');

/**
 * Order-number generator.
 *
 * The order number is the ONLY payment reference that customers and gateway
 * dashboards are shown. It must be:
 *   - unique (collision-resistant),
 *   - non-sequential (so nobody can guess order volume or enumerate orders),
 *   - stable and human-readable for support/reconciliation.
 *
 * Format is driven by ORDER_NUMBER_PATTERN, e.g. "{PREFIX}-{DATE}-{RAND}"
 *   {PREFIX} -> config.orderNumber.prefix   (e.g. "ORD")
 *   {DATE}   -> UTC YYYYMMDD
 *   {RAND}   -> Crockford-ish base32, unambiguous chars only
 */

// Base32 alphabet without easily-confused chars (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomChunk(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function utcDateStamp(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Generate a fresh order number. Callers should persist it (see db.js) which
 * enforces uniqueness at the storage layer; on the astronomically unlikely
 * event of a collision, generate again.
 */
function generateOrderNumber() {
  return config.orderNumber.pattern
    .replace('{PREFIX}', config.orderNumber.prefix)
    .replace('{DATE}', utcDateStamp())
    .replace('{RAND}', randomChunk(8));
}

module.exports = { generateOrderNumber, randomChunk };
