# Test Plan — Sandbox Acceptance (PayPal + Stripe)

Goal: prove that a completed sandbox purchase on **both** gateways shows the
customer **only the order number**, while the **real transaction id** remains
visible in each gateway's own dashboard and in your private mapping table.

## Prerequisites

- `.env` filled with **sandbox** PayPal + **test** Stripe keys, a
  `PAYPAL_WEBHOOK_ID`, a `STRIPE_WEBHOOK_SECRET`, and an `ADMIN_API_TOKEN`.
- Server running and reachable over HTTPS (use a tunnel like `ngrok`/`cloudflared`
  during testing so PayPal/Stripe can reach your webhooks).
- Webhooks registered in both dashboards pointing at your `/webhooks/*` URLs.

Set a shell variable for convenience:

```bash
BASE=https://your-tunnel-host    # e.g. https://abc123.ngrok.app
TOKEN=your_admin_api_token
```

---

## A. Automated unit check (no network)

```bash
npm test
```

**Pass:** all cloak tests green — confirms customer responses are scrubbed of
gateway ids even if one leaks.

---

## B. Stripe end-to-end (sandbox / test mode)

1. **Create the payment**

   ```bash
   curl -s -X POST $BASE/checkout/create \
     -H 'content-type: application/json' \
     -d '{"gateway":"stripe","amount":4200,"currency":"usd"}'
   ```

   **Expect:** JSON containing `order_number` and `client_secret` and **no**
   `ch_...`, `pi_...`, or `txn_...` value. Record the `order_number` (call it
   `ORD#`).

2. **Complete the card payment** using the `client_secret` with Stripe.js /
   Stripe Elements and test card `4242 4242 4242 4242` (any future expiry, any
   CVC). Alternatively confirm it from the Stripe dashboard.

3. **Customer receipt/confirmation view**

   ```bash
   curl -s $BASE/checkout/status/ORD#
   ```

   **Expect:** `{ order_number, amount, currency, status: "completed" }` and
   **no gateway id anywhere**. ✅ (customer sees only the order number)

4. **Stripe dashboard** → Payments → open the payment.
   **Expect:** the real charge id `ch_...` is present, and `order_number = ORD#`
   appears under **Metadata**. ✅ (real id still visible to you)

5. **Your private mapping** (staff only)

   ```bash
   curl -s -H "x-admin-token: $TOKEN" $BASE/admin/resolve/ORD#
   ```

   **Expect:** the row shows `gateway_transaction_id` = the same `ch_...` from
   the dashboard. ✅ (reconciliation link intact)

---

## C. PayPal end-to-end (sandbox)

1. **Create the order**

   ```bash
   curl -s -X POST $BASE/checkout/create \
     -H 'content-type: application/json' \
     -d '{"gateway":"paypal","amount":4200,"currency":"USD"}'
   ```

   **Expect:** JSON with `order_number` and `paypal_order_id`, and **no** 17-char
   transaction id. Record `ORD#` and `paypal_order_id`.

2. **Approve** the order as a sandbox buyer (via the PayPal Buttons SDK using
   `paypal_order_id`, logging in with a sandbox buyer account).

3. **Capture**

   ```bash
   curl -s -X POST $BASE/checkout/paypal/capture \
     -H 'content-type: application/json' \
     -d '{"order_number":"ORD#"}'
   ```

   **Expect:** `{ "order_number": "ORD#", "status": "paid" }` — and **no**
   transaction id in the response. ✅

4. **Customer receipt view**

   ```bash
   curl -s $BASE/checkout/status/ORD#
   ```

   **Expect:** order number + status only; no gateway id. ✅

5. **PayPal dashboard** (sandbox) → Activity → open the transaction.
   **Expect:** the real transaction id (17-char) is present, and your
   `ORD#` shows as the **Invoice ID / Custom field**. ✅

6. **Your private mapping**

   ```bash
   curl -s -H "x-admin-token: $TOKEN" $BASE/admin/resolve/ORD#
   ```

   **Expect:** `gateway_transaction_id` = the real PayPal capture id from the
   dashboard. ✅

7. **Webhook path (independent confirmation)** — after capture, PayPal fires
   `PAYMENT.CAPTURE.COMPLETED` to `/webhooks/paypal`. Re-run step 6 if you tested
   capture purely via webhook; the real id should be populated either way.

---

## D. Reverse lookup (dispute / refund workflow)

Given a real id from a gateway dispute notification, find your order:

```bash
curl -s -H "x-admin-token: $TOKEN" \
  $BASE/admin/reverse/stripe/ch_XXXXXXXXXXXX
curl -s -H "x-admin-token: $TOKEN" \
  $BASE/admin/reverse/paypal/3XXXXXXXXXXXXXXXX
```

**Expect:** the matching `order_number`. ✅ (disputes/refunds resolve with one
lookup)

---

## Acceptance summary

| Check | Customer sees | Gateway dashboard | Your DB |
| --- | --- | --- | --- |
| Stripe purchase | order number only | real `ch_...` + order# metadata | order# ⇄ `ch_...` |
| PayPal purchase | order number only | real 17-char id + order# invoice | order# ⇄ real id |

All boxes ticked = acceptance criteria met: sandbox purchases on both gateways
complete successfully, the browser/receipt shows only the masked order number,
and the true id remains visible in each gateway plus your reconciliation table.
