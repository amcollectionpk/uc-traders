/* UC Traders — PUBG Mobile UC store backend (Node.js + Express + PostgreSQL)
 *
 * Endpoints:
 *   GET  /api/packs                     list the 10 UC packs
 *   GET  /api/payment                  public Easypaisa payment details
 *   POST /api/orders                   place an order (status Pending)
 *   GET  /api/orders/track?characterId=...   customer order tracking
 *   POST /api/admin/login              admin login (username OR email) -> JWT
 *   GET  /api/admin/stats              (auth) order stats
 *   GET  /api/admin/orders             (auth) all orders, newest first
 *   POST /api/admin/orders/:id/confirm (auth) Pending -> Successful
 *   POST /api/admin/orders/:id/revert  (auth) Successful -> Pending
 *   DELETE /api/admin/orders/:id       (auth) delete an order
 *   POST /api/admin/change-password    (auth) old -> new -> confirm
 *
 * Config comes from the environment only. Never put a credential value in
 * this file. Required: DATABASE_URL, JWT_SECRET. Optional: PORT, PGSSL,
 * STORE_PAYMENT_NUMBER, STORE_PAYMENT_TITLE.
 */
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const PAYMENT_NUMBER = process.env.STORE_PAYMENT_NUMBER || '03097214736';
const PAYMENT_TITLE = process.env.STORE_PAYMENT_TITLE || 'Mubeen Bibi';
const PAYMENT_METHOD = 'Easypaisa';

if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired login' });
  }
}

/* ---------- public API ---------- */

app.get('/api/packs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM packs ORDER BY id');
    res.json({ packs: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load packs' });
  }
});

app.get('/api/payment', (req, res) => {
  res.json({ method: PAYMENT_METHOD, number: PAYMENT_NUMBER, title: PAYMENT_TITLE });
});

async function createOrder(client, packId, characterId, ign, contact, txnId) {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `UC-${ymd}-`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM orders WHERE order_number LIKE $1',
      [prefix + '%']
    );
    const orderNumber = prefix + String(rows[0].n + 1).padStart(3, '0');
    try {
      const inserted = await client.query(
        `INSERT INTO orders (order_number, pack_id, character_id, ign, contact, txn_id, payment_method, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending')
         RETURNING *`,
        [orderNumber, packId, characterId, ign, contact, txnId, PAYMENT_METHOD]
      );
      return inserted.rows[0];
    } catch (e) {
      if (e.code === '23505') continue; // order number race — retry with the next number
      throw e;
    }
  }
  throw new Error('Could not allocate an order number');
}

app.post('/api/orders', async (req, res) => {
  const { packId, characterId, ign, contact, txnId } = req.body || {};
  if (!Number.isInteger(packId)) return res.status(400).json({ error: 'Please select a pack' });
  if (!isNonEmptyString(characterId)) return res.status(400).json({ error: 'Character ID is required' });
  if (!isNonEmptyString(ign)) return res.status(400).json({ error: 'In-game name is required' });
  if (!isNonEmptyString(contact)) return res.status(400).json({ error: 'WhatsApp / contact number is required' });
  if (!isNonEmptyString(txnId)) return res.status(400).json({ error: 'Transaction ID is required' });
  try {
    const pack = await pool.query('SELECT * FROM packs WHERE id = $1', [packId]);
    if (pack.rows.length === 0) return res.status(400).json({ error: 'Invalid pack selected' });
    const order = await createOrder(
      pool, packId,
      characterId.trim(), ign.trim(), contact.trim(), txnId.trim()
    );
    res.status(201).json({ order });
  } catch (e) {
    res.status(500).json({ error: 'Could not place the order' });
  }
});

app.get('/api/orders/track', async (req, res) => {
  const characterId = (req.query.characterId || '').trim();
  if (!characterId) return res.status(400).json({ error: 'Character ID is required' });
  try {
    const { rows } = await pool.query(
      `SELECT o.*, p.name AS pack_name, p.uc_amount, p.sale_price, p.original_price
       FROM orders o JOIN packs p ON p.id = o.pack_id
       WHERE o.character_id = $1 ORDER BY o.created_at DESC`,
      [characterId]
    );
    res.json({ orders: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load your orders' });
  }
});

/* ---------- admin auth ---------- */

app.post('/api/admin/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!isNonEmptyString(identifier) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM admins WHERE username = $1 OR email = $1',
      [identifier.trim()]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Login failed — check username/email and password' });
    const admin = rows[0];
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Login failed — check username/email and password' });
    const token = jwt.sign(
      { adminId: admin.id, username: admin.username },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, username: admin.username });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

/* ---------- admin API (auth required) ---------- */

app.get('/api/admin/stats', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_orders,
         COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending_orders,
         COUNT(*) FILTER (WHERE status = 'Successful')::int AS successful_orders,
         COALESCE(SUM(p.sale_price) FILTER (WHERE o.status = 'Successful'), 0)::int AS successful_sales
       FROM orders o JOIN packs p ON p.id = o.pack_id`
    );
    res.json({ stats: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Could not load stats' });
  }
});

app.get('/api/admin/orders', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, p.name AS pack_name, p.uc_amount, p.sale_price, p.original_price
       FROM orders o JOIN packs p ON p.id = o.pack_id
       ORDER BY o.created_at DESC`
    );
    res.json({ orders: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load orders' });
  }
});

async function setOrderStatus(req, res, status) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order' });
  try {
    const { rows } = await pool.query(
      "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [status, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ order: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Could not update the order' });
  }
}

app.post('/api/admin/orders/:id/confirm', auth, (req, res) => setOrderStatus(req, res, 'Successful'));
app.post('/api/admin/orders/:id/revert', auth, (req, res) => setOrderStatus(req, res, 'Pending'));

app.delete('/api/admin/orders/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order' });
  try {
    const { rows } = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ deleted: id });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete the order' });
  }
});

app.post('/api/admin/change-password', auth, async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body || {};
  if (!isNonEmptyString(oldPassword) || !isNonEmptyString(newPassword) || !isNonEmptyString(confirmPassword)) {
    return res.status(400).json({ error: 'Old, new and confirm password are all required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirm password do not match' });
  }
  if (newPassword === oldPassword) {
    return res.status(400).json({ error: 'New password must be different from the old password' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM admins WHERE id = $1', [req.admin.adminId]);
    if (rows.length === 0) return res.status(401).json({ error: 'Admin not found' });
    const ok = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: 'Old password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admins SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.admin.adminId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not change the password' });
  }
});

/* ---------- frontend ---------- */

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`UC Traders running on port ${PORT}`);
});
