#!/usr/bin/env node
/* UC Traders — database init + seed.
 * Creates tables from database/schema.sql, seeds the 10 UC packs and the
 * admin account from environment variables.
 *
 * Required env vars:
 *   DATABASE_URL, ADMIN_USER, ADMIN_EMAIL, ADMIN_PASSWORD
 * Optional: PGSSL (set to "true" when the database requires SSL, e.g. Replit)
 *
 * The admin password is NEVER written to a file or the repo — it comes from
 * the environment only. Run:  node scripts/init-db.js
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const PACKS = [
  { id: 1,  name: 'Pack 1',  uc_amount: 0,      sale_price: 0,     original_price: 0,     discount_pct: 0,  is_free: true  },
  { id: 2,  name: 'Pack 2',  uc_amount: 80000,  sale_price: 3000,  original_price: 4000,  discount_pct: 25, is_free: false },
  { id: 3,  name: 'Pack 3',  uc_amount: 160000, sale_price: 6000,  original_price: 9250,  discount_pct: 35, is_free: false },
  { id: 4,  name: 'Pack 4',  uc_amount: 240000, sale_price: 9000,  original_price: 13850, discount_pct: 35, is_free: false },
  { id: 5,  name: 'Pack 5',  uc_amount: 300000, sale_price: 12000, original_price: 18450, discount_pct: 35, is_free: false },
  { id: 6,  name: 'Pack 6',  uc_amount: 400000, sale_price: 15000, original_price: 23050, discount_pct: 35, is_free: false },
  { id: 7,  name: 'Pack 7',  uc_amount: 480000, sale_price: 18000, original_price: 27700, discount_pct: 35, is_free: false },
  { id: 8,  name: 'Pack 8',  uc_amount: 560000, sale_price: 21000, original_price: 32300, discount_pct: 35, is_free: false },
  { id: 9,  name: 'Pack 9',  uc_amount: 640000, sale_price: 24000, original_price: 36900, discount_pct: 35, is_free: false },
  { id: 10, name: 'Pack 10', uc_amount: 720000, sale_price: 27000, original_price: 41550, discount_pct: 35, is_free: false },
];

async function main() {
  const { DATABASE_URL, PGSSL, ADMIN_USER, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!ADMIN_USER || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_USER, ADMIN_EMAIL and ADMIN_PASSWORD must all be set in the environment');
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('schema applied');

    for (const p of PACKS) {
      await client.query(
        `INSERT INTO packs (id, name, uc_amount, sale_price, original_price, discount_pct, is_free)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, uc_amount = EXCLUDED.uc_amount,
           sale_price = EXCLUDED.sale_price, original_price = EXCLUDED.original_price,
           discount_pct = EXCLUDED.discount_pct, is_free = EXCLUDED.is_free`,
        [p.id, p.name, p.uc_amount, p.sale_price, p.original_price, p.discount_pct, p.is_free]
      );
    }
    console.log(`seeded ${PACKS.length} packs`);

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await client.query(
      `INSERT INTO admins (username, email, password_hash)
       VALUES ($1,$2,$3)
       ON CONFLICT (username) DO UPDATE SET
         email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
         updated_at = NOW()`,
      [ADMIN_USER, ADMIN_EMAIL, hash]
    );
    console.log(`admin seeded: username=${ADMIN_USER} email=${ADMIN_EMAIL}`);
    console.log('init-db done');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('init-db failed:', err.message);
  process.exit(1);
});
