-- PostgreSQL schema for the order-number <-> real-transaction-id mapping.
-- Apply with:  psql "$DATABASE_URL" -f schema/postgres.sql

CREATE TABLE IF NOT EXISTS order_mappings (
    id                     BIGSERIAL PRIMARY KEY,
    order_number           TEXT        NOT NULL UNIQUE,
    gateway                TEXT        NOT NULL,       -- 'paypal' | 'stripe'
    gateway_transaction_id TEXT,                       -- REAL id, kept private
    gateway_object_id      TEXT,                       -- order / payment-intent id
    amount                 BIGINT,                     -- minor units (cents)
    currency               TEXT,
    status                 TEXT        NOT NULL DEFAULT 'created',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_map_txn
    ON order_mappings (gateway, gateway_transaction_id);
CREATE INDEX IF NOT EXISTS idx_map_object
    ON order_mappings (gateway, gateway_object_id);
