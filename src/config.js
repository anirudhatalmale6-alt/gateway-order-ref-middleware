'use strict';

/**
 * Centralised configuration, loaded once from environment variables.
 * Fails fast at startup if a required secret is missing so you never
 * discover a misconfiguration in the middle of a live checkout.
 */

require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val || val.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`
    );
  }
  return val.trim();
}

function optional(name, fallback) {
  const val = process.env[name];
  return val && val.trim() !== '' ? val.trim() : fallback;
}

const config = {
  port: parseInt(optional('PORT', '3000'), 10),

  orderNumber: {
    prefix: optional('ORDER_NUMBER_PREFIX', 'ORD'),
    pattern: optional('ORDER_NUMBER_PATTERN', '{PREFIX}-{DATE}-{RAND}'),
  },

  paypal: {
    env: optional('PAYPAL_ENV', 'sandbox'), // 'sandbox' | 'live'
    clientId: required('PAYPAL_CLIENT_ID'),
    clientSecret: required('PAYPAL_CLIENT_SECRET'),
    webhookId: optional('PAYPAL_WEBHOOK_ID', ''),
    get baseUrl() {
      return this.env === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    },
  },

  stripe: {
    secretKey: required('STRIPE_SECRET_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET', ''),
    statementDescriptorSuffix: optional(
      'STRIPE_STATEMENT_DESCRIPTOR_SUFFIX',
      'ORDER'
    ),
  },

  db: {
    file: optional('DB_FILE', './data/mapping.db'),
  },
};

module.exports = config;
