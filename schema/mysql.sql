-- MySQL / MariaDB schema for the order-number <-> real-transaction-id mapping.
-- Apply with:  mysql your_db < schema/mysql.sql

CREATE TABLE IF NOT EXISTS order_mappings (
    id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_number           VARCHAR(64)  NOT NULL UNIQUE,
    gateway                VARCHAR(16)  NOT NULL,        -- 'paypal' | 'stripe'
    gateway_transaction_id VARCHAR(128),                 -- REAL id, kept private
    gateway_object_id      VARCHAR(128),                 -- order / payment-intent id
    amount                 BIGINT,                       -- minor units (cents)
    currency               VARCHAR(8),
    status                 VARCHAR(32)  NOT NULL DEFAULT 'created',
    created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_map_txn (gateway, gateway_transaction_id),
    INDEX idx_map_object (gateway, gateway_object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
