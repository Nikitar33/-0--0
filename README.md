# PayPilot

Demo fintech wallet and payments app for a digital banking MVP.

## Features
- wallet balance and transaction dashboard
- transfer between users
- top-up flow for wallet demo
- admin overview panel
- Russian-language interface
- local JSON persistence for demo data

## Local run

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
node server.js
```

3. Open:

- http://localhost:3001

## Public deployment

The repository includes `render.yaml` for Render. It provisions a PostgreSQL database and connects it through `DATABASE_URL`. Set a strong random `JWT_SECRET` environment variable. Render supplies `PORT` automatically, and the app listens on it.

## Demo credentials

- Admin: admin@paypilot.io / admin123
- User: demo@paypilot.io / demo123

## Notes

This is a demo fintech MVP without real banking, KYC, or payment gateway integration. Local development uses `data/store.json`; when `DATABASE_URL` is set, the app persists its state in PostgreSQL. The current database layer is a migration bridge using one JSONB state row; use normalized tables and real payment controls before treating this as a production financial service.
