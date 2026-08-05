'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

/**
 * Mapping store.
 *
 * This is the heart of the design: it keeps the private link between YOUR
 * order number and the gateway's REAL transaction id. Customers never see
 * this table; your backoffice/reconciliation reads it.
 *
 * SQLite is used here for a zero-setup, portable default that is perfect for
 * sandbox testing and small/medium production loads. For Postgres or MySQL,
 * the equivalent schema lives in schema/ — the public functions below are the
 * only surface you'd need to re-point at a different driver.
 */

const dbFile = path.resolve(process.cwd(), config.db.file);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS order_mappings (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number           TEXT    NOT NULL UNIQUE,
    gateway                TEXT    NOT NULL,          -- 'paypal' | 'stripe'
    gateway_transaction_id TEXT,                      -- REAL id, private
    gateway_object_id      TEXT,                      -- order/intent id
    amount                 INTEGER,                   -- minor units (cents)
    currency               TEXT,
    status                 TEXT    NOT NULL DEFAULT 'created',
    created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_map_txn
    ON order_mappings (gateway, gateway_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_map_object
    ON order_mappings (gateway, gateway_object_id);
`);

const stmts = {
  insert: db.prepare(`
    INSERT INTO order_mappings
      (order_number, gateway, gateway_object_id, amount, currency, status)
    VALUES
      (@order_number, @gateway, @gateway_object_id, @amount, @currency, @status)
  `),
  attachTxnByObject: db.prepare(`
    UPDATE order_mappings
       SET gateway_transaction_id = @gateway_transaction_id,
           status = @status,
           updated_at = datetime('now')
     WHERE gateway = @gateway AND gateway_object_id = @gateway_object_id
  `),
  updateStatusByObject: db.prepare(`
    UPDATE order_mappings
       SET status = @status, updated_at = datetime('now')
     WHERE gateway = @gateway AND gateway_object_id = @gateway_object_id
  `),
  byOrderNumber: db.prepare(
    `SELECT * FROM order_mappings WHERE order_number = ?`
  ),
  byObjectId: db.prepare(
    `SELECT * FROM order_mappings WHERE gateway = ? AND gateway_object_id = ?`
  ),
  byTransactionId: db.prepare(
    `SELECT * FROM order_mappings WHERE gateway = ? AND gateway_transaction_id = ?`
  ),
};

/**
 * Create a new mapping row when a payment is initiated.
 * @returns {object} the stored row
 */
function createMapping({
  orderNumber,
  gateway,
  gatewayObjectId = null,
  amount = null,
  currency = null,
  status = 'created',
}) {
  stmts.insert.run({
    order_number: orderNumber,
    gateway,
    gateway_object_id: gatewayObjectId,
    amount,
    currency,
    status,
  });
  return stmts.byOrderNumber.get(orderNumber);
}

/** Attach the REAL transaction id (learned at capture/webhook time). */
function attachTransactionId({
  gateway,
  gatewayObjectId,
  gatewayTransactionId,
  status = 'completed',
}) {
  stmts.attachTxnByObject.run({
    gateway,
    gateway_object_id: gatewayObjectId,
    gateway_transaction_id: gatewayTransactionId,
    status,
  });
  return stmts.byObjectId.get(gateway, gatewayObjectId);
}

function updateStatus({ gateway, gatewayObjectId, status }) {
  stmts.updateStatusByObject.run({
    gateway,
    gateway_object_id: gatewayObjectId,
    status,
  });
  return stmts.byObjectId.get(gateway, gatewayObjectId);
}

const getByOrderNumber = (orderNumber) => stmts.byOrderNumber.get(orderNumber);
const getByObjectId = (gateway, objectId) =>
  stmts.byObjectId.get(gateway, objectId);
const getByTransactionId = (gateway, txnId) =>
  stmts.byTransactionId.get(gateway, txnId);

module.exports = {
  db,
  createMapping,
  attachTransactionId,
  updateStatus,
  getByOrderNumber,
  getByObjectId,
  getByTransactionId,
};
