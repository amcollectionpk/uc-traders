# UC Traders — PUBG Mobile UC Store

A full-stack store for selling PUBG Mobile UC. Customers pick a UC pack,
enter their PUBG Character ID + in-game name + WhatsApp number, pay by
Easypaisa, and submit their Transaction ID. The admin confirms the payment
in the dashboard and the order status flips Pending → Successful, which the
customer can track from the home page.

- **Payment: Easypaisa only** — 03097214736, account title Mubeen Bibi.
  No JazzCash, no cash on delivery.
- **Admin:** login only (no sign-up). Login accepts the username **or** the
  store Gmail. Password is set from the environment and can be changed from
  the admin dashboard (old → new → confirm).
- **Orders:** numbered `UC-YYYYMMDD-001`, status Pending / Successful.

## Tech

Node.js + Express + PostgreSQL. The frontend (`public/`) is served by the
same server and calls the JSON API — no demo data, no localStorage orders.

## Deploy on Replit (free Starter plan)

1. **Create a Repl from GitHub:** Replit → Create Repl → Import from GitHub →
   paste `https://github.com/amcollectionpk/uc-traders` → Import.
2. **Add PostgreSQL:** in the Repl, Tools → Database → PostgreSQL → create it.
   Replit sets `DATABASE_URL` automatically.
3. **Set Secrets** (Tools → Secrets). Values are set by the store owner only:
   - `PGSSL` = `true`
   - `JWT_SECRET` = a long random secret (generate one, e.g. 32+ characters)
   - `ADMIN_USER` = `admin`
   - `ADMIN_EMAIL` = `amcollection874@gmail.com`
   - `ADMIN_PASSWORD` = the strong admin password already shared with the
     store owner in chat (never paste it anywhere public)
   - `STORE_PAYMENT_NUMBER` = `03097214736`
   - `STORE_PAYMENT_TITLE` = `Mubeen Bibi`
4. **Install + initialise the database** in the Replit Shell:
   `npm install` then `node scripts/init-db.js`
   (creates the tables, seeds the 10 UC packs and the admin account).
5. **Run:** click Run (or `npm start`). The store opens at the Repl URL.
6. **Publish:** Deployments → Publish (free on Starter). Note: a free
   published app expires after 30 days and can be re-published for free.

## Local run

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and the admin values
node scripts/init-db.js
npm start              # http://localhost:3000
```

## API

| Method | Route | Description |
|---|---|---|
| GET | /api/packs | List the 10 UC packs |
| GET | /api/payment | Easypaisa payment details |
| POST | /api/orders | Place an order (Pending) |
| GET | /api/orders/track?characterId=… | Customer order tracking |
| POST | /api/admin/login | Admin login (username or email) → JWT |
| GET | /api/admin/stats | (auth) order stats |
| GET | /api/admin/orders | (auth) all orders |
| POST | /api/admin/orders/:id/confirm | (auth) Pending → Successful |
| POST | /api/admin/orders/:id/revert | (auth) Successful → Pending |
| DELETE | /api/admin/orders/:id | (auth) delete an order |
| POST | /api/admin/change-password | (auth) old → new → confirm |

## Security notes

- The admin password lives in the environment only — never in code, docs,
  `.env.example`, or this repo. Change it from the admin dashboard.
- The store never asks for a customer's PUBG password or login — only the
  Character ID and in-game name. UC is delivered via the official Midasbuy
  top-up on the Character ID.
