-- UC Traders — PostgreSQL schema
-- Run with: node scripts/init-db.js

CREATE TABLE IF NOT EXISTS packs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  uc_amount INTEGER NOT NULL,
  sale_price INTEGER NOT NULL,
  original_price INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL DEFAULT 0,
  is_free BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  pack_id INTEGER NOT NULL REFERENCES packs(id),
  character_id TEXT NOT NULL,
  ign TEXT NOT NULL,
  contact TEXT NOT NULL,
  txn_id TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'Easypaisa',
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Successful')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_character_id ON orders (character_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
