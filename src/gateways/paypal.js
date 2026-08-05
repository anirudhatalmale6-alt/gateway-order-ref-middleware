'use strict';

const config = require('../config');

/**
 * Thin PayPal REST client using the built-in `fetch` (Node 18+).
 *
 * Responsibilities:
 *   - obtain + cache an OAuth2 access token,
 *   - create an order tagged with YOUR order number (invoice_id + custom_id)
 *     so PayPal's own dashboard shows your reference alongside its txn id,
 *   - capture an order and surface the REAL capture/transaction id to the
 *     backend (which stores it privately) — never to the customer.
 */

let cachedToken = null; // { access_token, expires_at }

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at - 60_000 > now) {
    return cachedToken.access_token;
  }

  const creds = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`
  ).toString('base64');

  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: now + data.expires_in * 1000,
  };
  return cachedToken.access_token;
}

/**
 * Create a PayPal order. The order number is written into BOTH invoice_id and
 * custom_id so it appears in the PayPal dashboard and on webhook events.
 * @returns {{ id: string, status: string, raw: object }}
 */
async function createOrder({ orderNumber, amount, currency = 'USD' }) {
  const token = await getAccessToken();

  const res = await fetch(`${config.paypal.baseUrl}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          // Your order number, visible to YOU inside PayPal — not a secret,
          // just your own reference. The customer never sees PayPal's txn id.
          invoice_id: orderNumber,
          custom_id: orderNumber,
          amount: {
            currency_code: currency,
            value: (amount / 100).toFixed(2), // amount is in minor units
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(
      `PayPal create order failed: ${res.status} ${await res.text()}`
    );
  }
  const data = await res.json();
  return { id: data.id, status: data.status, raw: data };
}

/**
 * Capture a previously-approved PayPal order.
 * Returns the REAL capture/transaction id for private storage.
 * @returns {{ transactionId: string|null, status: string, raw: object }}
 */
async function captureOrder(paypalOrderId) {
  const token = await getAccessToken();

  const res = await fetch(
    `${config.paypal.baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    throw new Error(
      `PayPal capture failed: ${res.status} ${await res.text()}`
    );
  }

  const data = await res.json();
  // The real transaction id lives at purchase_units[].payments.captures[].id
  const capture =
    data.purchase_units?.[0]?.payments?.captures?.[0] || null;

  return {
    transactionId: capture ? capture.id : null,
    status: data.status,
    raw: data,
  };
}

/**
 * Verify a PayPal webhook signature so we only trust genuine events.
 * Returns true when PayPal confirms the signature is valid.
 */
async function verifyWebhookSignature({ headers, body }) {
  if (!config.paypal.webhookId) {
    // No webhook id configured — refuse to trust the event.
    return false;
  }
  const token = await getAccessToken();

  const res = await fetch(
    `${config.paypal.baseUrl}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: config.paypal.webhookId,
        webhook_event: body,
      }),
    }
  );

  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}

module.exports = {
  getAccessToken,
  createOrder,
  captureOrder,
  verifyWebhookSignature,
};
