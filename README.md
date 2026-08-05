# Gateway Order-Reference Middleware (PayPal REST + Stripe)

Express middleware that puts **your own order number** in front of every
payment, so that:

- **Customers** (browser responses, receipt pages, confirmation emails) only
  ever see your order number — e.g. `ORD-20260805-7KQ4P2ZM`. The raw
  PayPal/Stripe transaction id never appears in any customer-facing payload.
- **Your PayPal / Stripe dashboards** show that same order number tagged onto
  each transaction (PayPal `invoice_id` + `custom_id`, Stripe `metadata` +
  statement-descriptor suffix), so you can eyeball-match a customer's order to a
  gateway record instantly.
- **You keep full operational power.** The gateway's own real transaction id is
  generated and retained by the gateway (as always) *and* mirrored into your
  private mapping table, so refunds, payouts, reconciliation and disputes work
  exactly as before — one lookup gets you the real id.

> Design note: this middleware does **not** hide, fake, or alter transaction
> ids inside PayPal/Stripe, and it does not interfere with webhooks, payouts or
> dispute handling. It simply ensures the *customer-facing* reference is your
> order number, while the real id stays private to you. That keeps you fully
> compliant with both gateways' terms while giving you the privacy you want.

---

## How it works

```
                    ┌──────────────────────────────────────────────┐
  Browser  ──POST──▶│ /checkout/create   (order number generated)  │
                    │  · PayPal: create order (invoice_id=ORDER#)  │
                    │  · Stripe: PaymentIntent (metadata.order#)   │
                    │  → response to browser = ORDER NUMBER ONLY   │
                    └───────────────┬──────────────────────────────┘
                                    │ writes mapping
                                    ▼
                        ┌────────────────────────┐
                        │  order_mappings table  │  ← private
                        │  order# ⇄ real txn id  │
                        └────────────────────────┘
                                    ▲
  PayPal/Stripe ──webhook──▶ /webhooks/*  (server-to-server; stores real id)
```

- `src/gateways/paypal.js` – PayPal REST: OAuth, create order (tagged with your
  order number), capture, webhook signature verification.
- `src/gateways/stripe.js` – Stripe: PaymentIntent (tagged), real charge-id
  retrieval, webhook verification.
- `src/routes/checkout.js` – customer-facing endpoints; responses carry the
  order number only.
- `src/routes/webhooks.js` – server-to-server receivers that persist the real
  ids; **webhooks/payouts/disputes remain untouched**.
- `src/routes/admin.js` – guarded back-office lookups that DO return the real id
  (that's the point of the mapping) for reconciliation/refunds/disputes.
- `src/middleware/cloak.js` – defensive safety net that scrubs any raw gateway
  id out of customer responses even if a future code path leaks one.
- `src/db.js` – SQLite mapping store (Postgres/MySQL schema in `schema/`).

---

## Requirements

- Node.js 18+ (uses the built-in `fetch`).
- A PayPal REST app (sandbox + live) and a Stripe account (test + live keys).

---

## Quick start (sandbox)

```bash
git clone <your-fork-url> gateway-order-ref-middleware
cd gateway-order-ref-middleware
npm install
cp .env.example .env      # then fill in sandbox keys (see below)
npm start                 # boots on PORT (default 3000)
```

### Filling in `.env`

| Variable | Where to get it |
| --- | --- |
| `PAYPAL_ENV` | `sandbox` while testing, `live` in production |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal Developer → Apps & Credentials |
| `PAYPAL_WEBHOOK_ID` | PayPal Developer → your app → Webhooks (create one pointing at `https://YOURHOST/webhooks/paypal`) |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → your endpoint (`whsec_...`) pointing at `https://YOURHOST/webhooks/stripe` |
| `ADMIN_API_TOKEN` | any long random string; required to enable `/admin/*` |
| `ORDER_NUMBER_PREFIX` / `ORDER_NUMBER_PATTERN` | your order-number style |

---

## API

### `POST /checkout/create`
Body: `{ "gateway": "paypal"|"stripe", "amount": 4200, "currency": "USD" }`
(`amount` is in **minor units** — 4200 = $42.00.)

- PayPal → `{ "order_number": "...", "gateway": "paypal", "paypal_order_id": "..." }`
  (`paypal_order_id` is the id the PayPal JS SDK needs to render approval — it is
  **not** the transaction id.)
- Stripe → `{ "order_number": "...", "gateway": "stripe", "client_secret": "..." }`
  (`client_secret` is what Stripe.js needs to confirm the card — **not** the
  transaction id.)

### `POST /checkout/paypal/capture`
Body: `{ "order_number": "..." }` → `{ "order_number": "...", "status": "paid" }`
Captures the approved PayPal order; the real capture id is stored privately.

### `GET /checkout/status/:orderNumber`
Returns `{ order_number, amount, currency, status }` — **never** a gateway id.
Use this for the receipt/confirmation page.

### `POST /webhooks/stripe` and `POST /webhooks/paypal`
Server-to-server. Signature-verified. Persist the real ids; not customer-facing.

### `GET /admin/resolve/:orderNumber` and `GET /admin/reverse/:gateway/:txnId`
Staff-only (needs `x-admin-token`). **Returns the real transaction id** for
reconciliation, refunds and disputes.

```bash
curl -H "x-admin-token: $ADMIN_API_TOKEN" \
     https://YOURHOST/admin/resolve/ORD-20260805-7KQ4P2ZM
```

---

## Frontend wiring (the important bit)

Your existing checkout keeps its PayPal Buttons / Stripe Elements. The only
change is: **display `order_number` on your success page and in your
confirmation email — nothing else from the gateway.**

- PayPal Buttons: in `createOrder`, call `POST /checkout/create` and return the
  `paypal_order_id`; in `onApprove`, call `POST /checkout/paypal/capture` with
  the `order_number` and show `order_number` on success.
- Stripe Elements: call `POST /checkout/create`, confirm with the returned
  `client_secret`, then show `order_number` on success.

---

## Production deployment (standard Linux stack)

1. **Provision** a Linux box (Ubuntu 22.04+). Install Node 18+.
2. **Clone + install**: `npm ci --omit=dev`.
3. **Configure** `.env` with **live** keys, `PAYPAL_ENV=live`, a strong
   `ADMIN_API_TOKEN`, and (recommended) a Postgres/MySQL setup — apply
   `schema/postgres.sql` or `schema/mysql.sql` and point `src/db.js` at it.
4. **Run under a process manager** (systemd unit or pm2) so it restarts on
   boot/crash. Example systemd unit:

   ```ini
   [Unit]
   Description=Gateway Order-Reference Middleware
   After=network.target

   [Service]
   WorkingDirectory=/opt/gateway-order-ref-middleware
   ExecStart=/usr/bin/node src/server.js
   EnvironmentFile=/opt/gateway-order-ref-middleware/.env
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```

5. **Front with Nginx + TLS** (Let's Encrypt). Proxy `https://pay.yourdomain`
   → `http://127.0.0.1:3000`. **Do not** expose `/admin` publicly — restrict by
   IP / VPN / internal network.
6. **Register webhooks** in PayPal and Stripe pointing at
   `https://pay.yourdomain/webhooks/paypal` and `.../webhooks/stripe`.
7. **Back up** the mapping database — it is your reconciliation ledger.

---

## Tests

```bash
npm test        # unit tests for the cloaking safety net (no network/keys)
```

See `TEST_PLAN.md` for the full sandbox acceptance test across both gateways.
