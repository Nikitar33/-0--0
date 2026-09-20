const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'paypilot-demo-secret';
const DATABASE_URL = process.env.DATABASE_URL || '';
const dbPool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }) : null;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(`${password}:${JWT_SECRET}`).digest('hex');
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function getDefaultState() {
  const nowIso = now();
  const adminId = 'user_admin_1';
  const demoId = 'user_demo_1';
  const adminToken = `token_${crypto.randomBytes(12).toString('hex')}`;
  const demoToken = `token_${crypto.randomBytes(12).toString('hex')}`;

  return {
    users: [
      {
        id: adminId,
        name: 'Admin User',
        email: 'admin@paypilot.io',
        passwordHash: hashPassword('admin123'),
        role: 'admin',
        token: adminToken,
        createdAt: nowIso
      },
      {
        id: demoId,
        name: 'Demo Client',
        email: 'demo@paypilot.io',
        passwordHash: hashPassword('demo123'),
        role: 'user',
        token: demoToken,
        createdAt: nowIso
      }
    ],
    wallets: [
      { id: 'wallet_admin_1', userId: adminId, currency: 'USD', balance: 25000, status: 'active', createdAt: nowIso },
      { id: 'wallet_demo_1', userId: demoId, currency: 'USD', balance: 1500, status: 'active', createdAt: nowIso }
    ],
    cards: [
      { id: 'card_admin_1', userId: adminId, walletId: 'wallet_admin_1', holder: 'Admin User', maskedNumber: '**** 4242', provider: 'Visa', status: 'active', createdAt: nowIso },
      { id: 'card_demo_1', userId: demoId, walletId: 'wallet_demo_1', holder: 'Demo Client', maskedNumber: '**** 8181', provider: 'Mastercard', status: 'active', createdAt: nowIso }
    ],
    transfers: [
      { id: 'transfer_1', fromUserId: demoId, toUserId: adminId, amount: 150, currency: 'USD', note: 'Demo top-up', createdAt: nowIso }
    ],
    transactions: [
      { id: 'txn_1', userId: demoId, walletId: 'wallet_demo_1', type: 'credit', direction: 'in', amount: 1500, currency: 'USD', status: 'completed', referenceId: 'welcome-credit', metadata: { source: 'welcome' }, createdAt: nowIso },
      { id: 'txn_2', userId: adminId, walletId: 'wallet_admin_1', type: 'credit', direction: 'in', amount: 25000, currency: 'USD', status: 'completed', referenceId: 'admin-topup', metadata: { source: 'internal' }, createdAt: nowIso }
    ],
    notifications: [
      { id: 'n_1', userId: demoId, type: 'welcome', title: 'Welcome to PayPilot', message: 'Your wallet is ready. You have $1500 available.', isRead: false, createdAt: nowIso },
      { id: 'n_2', userId: adminId, type: 'system', title: 'System online', message: 'Admin panel is running and ready.', isRead: false, createdAt: nowIso }
    ],
    paymentEvents: [
      { id: 'pay_1', provider: 'demo', eventType: 'payment.success', userId: demoId, amount: 100, currency: 'USD', status: 'completed', createdAt: nowIso }
    ],
    auditLogs: [
      { id: 'audit_1', adminUserId: adminId, action: 'system.start', entityType: 'system', entityId: 'app', metadata: { message: 'PayPilot initialized' }, createdAt: nowIso }
    ]
  };
}

function readStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(getDefaultState(), null, 2), 'utf8');
  }

  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    const fallback = getDefaultState();
    fs.writeFileSync(STORE_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

let store = readStore();

function saveStore() {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  if (dbPool) {
    dbPool.query(
      `INSERT INTO app_state (id, state, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [JSON.stringify(store)]
    ).catch((error) => console.error('PostgreSQL save failed:', error.message));
  }
}

async function initializePersistence() {
  if (!dbPool) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const result = await dbPool.query('SELECT state FROM app_state WHERE id = 1');
  if (result.rows[0]?.state) {
    store = result.rows[0].state;
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } else {
    await dbPool.query('INSERT INTO app_state (id, state) VALUES (1, $1::jsonb)', [JSON.stringify(store)]);
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, token, ...safe } = user;
  return safe;
}

function getWalletForUser(userId) {
  return store.wallets.find((wallet) => wallet.userId === userId && wallet.status === 'active');
}

function getCardsForUser(userId) {
  return store.cards.filter((card) => card.userId === userId && card.status === 'active').map((card) => {
    if (!card.cardNumber) {
      const suffix = String(card.maskedNumber || '8181').replace(/\D/g, '').slice(-4).padStart(4, '0');
      card.cardNumber = `400012345678${suffix}`;
      card.expiry = '12/29';
      card.cvv = '123';
    }
    return card;
  });
}

function getExchangeRate(fromCurrency, toCurrency) {
  const ratesToUsd = { USD: 1, EUR: 1.09, GBP: 1.27 };
  return ratesToUsd[fromCurrency] / ratesToUsd[toCurrency];
}

function findUserByToken(token) {
  return store.users.find((user) => user.token === token);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ ok: false, error: 'Token missing' });

  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }
  next();
}

function createNotification(userId, type, title, message) {
  const notification = {
    id: uid('n'),
    userId,
    type,
    title,
    message,
    isRead: false,
    createdAt: now()
  };
  store.notifications.unshift(notification);
  return notification;
}

function createTransaction({ userId, walletId, type, direction, amount, currency, status, referenceId, metadata = {} }) {
  const record = {
    id: uid('txn'),
    userId,
    walletId,
    type,
    direction,
    amount: Number(amount),
    currency,
    status,
    referenceId,
    metadata,
    createdAt: now()
  };
  store.transactions.unshift(record);
  return record;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'PayPilot', mode: 'demo-fintech-mvp' });
});

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();

  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, error: 'Name, email and password are required' });
  }

  if (store.users.some((user) => user.email === email)) {
    return res.status(409).json({ ok: false, error: 'User already exists' });
  }

  const user = {
    id: uid('user'),
    name,
    email,
    passwordHash: hashPassword(password),
    role: 'user',
    token: `token_${crypto.randomBytes(12).toString('hex')}`,
    createdAt: now()
  };

  const wallet = {
    id: uid('wallet'),
    userId: user.id,
    currency: 'USD',
    balance: 1000,
    status: 'active',
    createdAt: now()
  };

  store.users.push(user);
  store.wallets.push(wallet);
  store.transactions.unshift({
    id: uid('txn'),
    userId: user.id,
    walletId: wallet.id,
    type: 'credit',
    direction: 'in',
    amount: 1000,
    currency: 'USD',
    status: 'completed',
    referenceId: 'welcome-credit',
    metadata: { source: 'welcome' },
    createdAt: now()
  });
  createNotification(user.id, 'welcome', 'Wallet created', 'Your wallet was created and funded with $1000.');

  saveStore();
  res.json({ ok: true, user: sanitizeUser(user), wallet, token: user.token });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();

  const user = store.users.find((entry) => entry.email === email && entry.passwordHash === hashPassword(password));
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  user.token = `token_${crypto.randomBytes(12).toString('hex')}`;
  saveStore();

  const wallet = getWalletForUser(user.id);
  res.json({ ok: true, user: sanitizeUser(user), wallet, token: user.token });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const wallet = getWalletForUser(req.user.id);
  res.json({ ok: true, user: sanitizeUser(req.user), wallet });
});

app.get('/api/wallets', requireAuth, (req, res) => {
  const wallets = store.wallets.filter((wallet) => wallet.userId === req.user.id && wallet.status === 'active');
  res.json({ ok: true, wallet: wallets[0] || null, wallets });
});

app.post('/api/wallets', requireAuth, (req, res) => {
  const currency = String(req.body?.currency || 'EUR').trim().toUpperCase();
  if (!['USD', 'EUR', 'GBP'].includes(currency)) {
    return res.status(400).json({ ok: false, error: 'Unsupported currency' });
  }

  const wallet = {
    id: uid('wallet'),
    userId: req.user.id,
    currency,
    balance: 0,
    status: 'active',
    createdAt: now()
  };

  store.wallets.push(wallet);
  createNotification(req.user.id, 'account', 'Счёт открыт', `Новый счёт в ${currency} готов к использованию.`);
  saveStore();
  res.json({ ok: true, wallet });
});

app.patch('/api/wallets/:walletId', requireAuth, (req, res) => {
  const wallet = store.wallets.find((item) => item.id === req.params.walletId && item.userId === req.user.id && item.status === 'active');
  if (!wallet) return res.status(404).json({ ok: false, error: 'Wallet not found' });
  if (wallet.id === getWalletForUser(req.user.id)?.id) {
    return res.status(400).json({ ok: false, error: 'Основной счёт нельзя изменить' });
  }

  const currency = String(req.body?.currency || '').trim().toUpperCase();
  if (!['USD', 'EUR', 'GBP'].includes(currency)) {
    return res.status(400).json({ ok: false, error: 'Unsupported currency' });
  }
  if (Number(wallet.balance) !== 0) {
    return res.status(400).json({ ok: false, error: 'Сначала обнулите баланс счёта' });
  }

  wallet.currency = currency;
  createNotification(req.user.id, 'account', 'Счёт изменён', `Валюта счёта изменена на ${currency}.`);
  saveStore();
  res.json({ ok: true, wallet });
});

app.delete('/api/wallets/:walletId', requireAuth, (req, res) => {
  const wallet = store.wallets.find((item) => item.id === req.params.walletId && item.userId === req.user.id && item.status === 'active');
  if (!wallet) return res.status(404).json({ ok: false, error: 'Wallet not found' });
  if (wallet.id === getWalletForUser(req.user.id)?.id) {
    return res.status(400).json({ ok: false, error: 'Основной счёт нельзя закрыть' });
  }
  if (Number(wallet.balance) !== 0) {
    return res.status(400).json({ ok: false, error: 'Сначала обнулите баланс счёта' });
  }

  wallet.status = 'closed';
  store.cards.forEach((card) => {
    if (card.walletId === wallet.id) card.status = 'closed';
  });
  createNotification(req.user.id, 'account', 'Счёт закрыт', `Счёт ${wallet.currency} закрыт.`);
  saveStore();
  res.json({ ok: true, wallet });
});

app.get('/api/cards', requireAuth, (req, res) => {
  const cards = getCardsForUser(req.user.id);
  res.json({ ok: true, cards });
});

app.post('/api/cards', requireAuth, (req, res) => {
  const walletId = String(req.body?.walletId || '').trim();
  const wallet = store.wallets.find((item) => item.id === walletId && item.userId === req.user.id && item.status === 'active') || getWalletForUser(req.user.id);
  if (!wallet) return res.status(404).json({ ok: false, error: 'Wallet not found' });

  const card = {
    id: uid('card'),
    userId: req.user.id,
    walletId: wallet.id,
    holder: req.user.name,
    maskedNumber: `**** ${String(Math.floor(1000 + Math.random() * 9000))}`,
    cardNumber: `400012345678${String(Math.floor(1000 + Math.random() * 9000))}`,
    expiry: '12/29',
    cvv: String(Math.floor(100 + Math.random() * 900)),
    provider: Math.random() > 0.5 ? 'Visa' : 'Mastercard',
    status: 'active',
    createdAt: now()
  };

  store.cards.push(card);
  createNotification(req.user.id, 'card', 'Карта выпущена', `${card.provider} ${card.maskedNumber} привязана к счёту ${wallet.currency}.`);
  saveStore();
  res.json({ ok: true, card });
});

app.delete('/api/cards/:cardId', requireAuth, (req, res) => {
  const card = store.cards.find((item) => item.id === req.params.cardId && item.userId === req.user.id && item.status === 'active');
  if (!card) return res.status(404).json({ ok: false, error: 'Карта не найдена' });

  card.status = 'closed';
  createNotification(req.user.id, 'card', 'Карта закрыта', `${card.provider} ${card.maskedNumber} закрыта.`);
  saveStore();
  res.json({ ok: true, card });
});

app.get('/api/summary', requireAuth, (req, res) => {
  const wallet = getWalletForUser(req.user.id);
  const cards = getCardsForUser(req.user.id);
  const outgoing = store.transactions
    .filter((txn) => txn.userId === req.user.id && txn.direction === 'out')
    .reduce((sum, txn) => sum + Number(txn.amount || 0), 0);
  const incoming = store.transactions
    .filter((txn) => txn.userId === req.user.id && txn.direction === 'in')
    .reduce((sum, txn) => sum + Number(txn.amount || 0), 0);

  res.json({
    ok: true,
    summary: {
      balance: Number(wallet?.balance || 0),
      available: Number(wallet?.balance || 0) * 0.82,
      cashback: Number(wallet?.balance || 0) * 0.03,
      cards: cards.length,
      incoming,
      outgoing,
      lastActivity: store.transactions.filter((txn) => txn.userId === req.user.id)[0] || null
    }
  });
});

app.post('/api/wallets/topup', requireAuth, (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Valid amount required' });
  }

  const wallet = getWalletForUser(req.user.id);
  if (!wallet) return res.status(404).json({ ok: false, error: 'Wallet not found' });

  wallet.balance = Number(wallet.balance) + amount;
  const transaction = createTransaction({
    userId: req.user.id,
    walletId: wallet.id,
    type: 'credit',
    direction: 'in',
    amount,
    currency: wallet.currency,
    status: 'completed',
    referenceId: `topup_${uid('pay')}`,
    metadata: { source: 'payment_provider_demo' }
  });
  createNotification(req.user.id, 'payment', 'Top-up completed', `You added $${amount.toFixed(2)} to your wallet.`);

  saveStore();
  res.json({ ok: true, wallet, transaction });
});

app.post('/api/transfers', requireAuth, (req, res) => {
  const targetEmail = String(req.body?.email || '').trim().toLowerCase();
  const amount = Number(req.body?.amount || 0);
  const note = String(req.body?.note || '').trim() || 'Transfer';

  if (!targetEmail || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Valid target email and amount required' });
  }

  if (targetEmail === req.user.email) {
    return res.status(400).json({ ok: false, error: 'You cannot send money to yourself' });
  }

  const senderWallet = getWalletForUser(req.user.id);
  if (!senderWallet) return res.status(404).json({ ok: false, error: 'Sender wallet not found' });
  if (Number(senderWallet.balance) < amount) {
    return res.status(400).json({ ok: false, error: 'Insufficient funds' });
  }

  const targetUser = store.users.find((user) => user.email === targetEmail);
  if (!targetUser) {
    return res.status(404).json({ ok: false, error: 'Receiver not found' });
  }

  const receiverWallet = getWalletForUser(targetUser.id);
  if (!receiverWallet) return res.status(404).json({ ok: false, error: 'Receiver wallet not found' });

  senderWallet.balance = Number(senderWallet.balance) - amount;
  receiverWallet.balance = Number(receiverWallet.balance) + amount;

  const transfer = {
    id: uid('transfer'),
    fromUserId: req.user.id,
    toUserId: targetUser.id,
    amount,
    currency: senderWallet.currency,
    note,
    createdAt: now()
  };
  store.transfers.unshift(transfer);

  createTransaction({
    userId: req.user.id,
    walletId: senderWallet.id,
    type: 'debit',
    direction: 'out',
    amount,
    currency: senderWallet.currency,
    status: 'completed',
    referenceId: transfer.id,
    metadata: { toEmail: targetEmail, note }
  });

  createTransaction({
    userId: targetUser.id,
    walletId: receiverWallet.id,
    type: 'credit',
    direction: 'in',
    amount,
    currency: receiverWallet.currency,
    status: 'completed',
    referenceId: transfer.id,
    metadata: { fromEmail: req.user.email, note }
  });

  createNotification(req.user.id, 'transfer', 'Transfer sent', `You sent $${amount.toFixed(2)} to ${targetEmail}.`);
  createNotification(targetUser.id, 'transfer', 'Transfer received', `You received $${amount.toFixed(2)} from ${req.user.email}.`);

  saveStore();
  res.json({ ok: true, transfer, senderWallet, receiverWallet });
});

app.post('/api/wallets/transfer', requireAuth, (req, res) => {
  const fromWalletId = String(req.body?.fromWalletId || '').trim();
  const toWalletId = String(req.body?.toWalletId || '').trim();
  const amount = Number(req.body?.amount || 0);
  const note = String(req.body?.note || '').trim() || 'Перевод между своими счетами';
  const wallets = store.wallets.filter((wallet) => wallet.userId === req.user.id && wallet.status === 'active');
  const fromWallet = wallets.find((wallet) => wallet.id === fromWalletId);
  const toWallet = wallets.find((wallet) => wallet.id === toWalletId);

  if (!fromWallet || !toWallet) return res.status(404).json({ ok: false, error: 'Счёт не найден' });
  if (fromWallet.id === toWallet.id) return res.status(400).json({ ok: false, error: 'Выберите разные счета' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Введите корректную сумму' });
  if (Number(fromWallet.balance) < amount) return res.status(400).json({ ok: false, error: 'Недостаточно средств' });

  const exchangeRate = getExchangeRate(fromWallet.currency, toWallet.currency);
  const creditedAmount = Number((amount * exchangeRate).toFixed(2));
  fromWallet.balance = Number(fromWallet.balance) - amount;
  toWallet.balance = Number(toWallet.balance) + creditedAmount;
  const transferId = uid('internal_transfer');
  createTransaction({ userId: req.user.id, walletId: fromWallet.id, type: 'internal_debit', direction: 'out', amount, currency: fromWallet.currency, status: 'completed', referenceId: transferId, metadata: { toWalletId, note } });
  createTransaction({ userId: req.user.id, walletId: toWallet.id, type: 'internal_credit', direction: 'in', amount: creditedAmount, currency: toWallet.currency, status: 'completed', referenceId: transferId, metadata: { fromWalletId, note, exchangeRate } });
  store.transfers.unshift({ id: transferId, fromUserId: req.user.id, toUserId: req.user.id, fromWalletId, toWalletId, amount, creditedAmount, currency: fromWallet.currency, targetCurrency: toWallet.currency, exchangeRate, note, createdAt: now(), internal: true });
  createNotification(req.user.id, 'transfer', 'Перевод между счетами', `${amount.toFixed(2)} ${fromWallet.currency} переведено на счёт: +${creditedAmount.toFixed(2)} ${toWallet.currency}.`);
  saveStore();
  res.json({ ok: true, transferId, fromWallet, toWallet, exchangeRate, creditedAmount });
});

app.get('/api/transactions', requireAuth, (req, res) => {
  const records = store.transactions.filter((txn) => txn.userId === req.user.id).slice(0, 50);
  res.json({ ok: true, transactions: records });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const items = store.notifications.filter((n) => n.userId === req.user.id).slice(0, 20);
  res.json({ ok: true, notifications: items });
});

app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  const notification = store.notifications.find((item) => item.id === req.params.id && item.userId === req.user.id);
  if (!notification) return res.status(404).json({ ok: false, error: 'Notification not found' });

  notification.isRead = true;
  saveStore();
  res.json({ ok: true, notification });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const totalUsers = store.users.length;
  const totalBalance = store.wallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  const totalTransfers = store.transfers.length;
  const totalTransactions = store.transactions.length;

  res.json({
    ok: true,
    overview: {
      totalUsers,
      totalBalance,
      totalTransfers,
      totalTransactions,
      users: store.users.filter((user) => user.role !== 'admin').map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        wallets: store.wallets.filter((wallet) => wallet.userId === user.id && wallet.status === 'active').map((wallet) => ({
          id: wallet.id,
          currency: wallet.currency,
          balance: wallet.balance
        }))
      })),
      recentActivity: store.transactions.slice(0, 10)
    }
  });
});

app.post('/api/admin/wallets/:walletId/adjust', requireAuth, requireAdmin, (req, res) => {
  const amount = Number(req.body?.amount || 0);
  const wallet = store.wallets.find((item) => item.id === req.params.walletId && item.status === 'active');
  if (!wallet) return res.status(404).json({ ok: false, error: 'Wallet not found' });
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ ok: false, error: 'Non-zero amount required' });
  }
  if (Number(wallet.balance) + amount < 0) {
    return res.status(400).json({ ok: false, error: 'Balance cannot become negative' });
  }

  wallet.balance = Number(wallet.balance) + amount;
  const transaction = createTransaction({
    userId: wallet.userId,
    walletId: wallet.id,
    type: amount > 0 ? 'admin_credit' : 'admin_debit',
    direction: amount > 0 ? 'in' : 'out',
    amount: Math.abs(amount),
    currency: wallet.currency,
    status: 'completed',
    referenceId: `admin_adjust_${uid('txn')}`,
    metadata: { adminUserId: req.user.id }
  });
  createNotification(wallet.userId, 'admin', 'Баланс изменён', `Администратор изменил баланс на ${amount > 0 ? '+' : ''}${amount.toFixed(2)} ${wallet.currency}.`);
  store.auditLogs.unshift({ id: uid('audit'), adminUserId: req.user.id, action: 'wallet.adjust', entityType: 'wallet', entityId: wallet.id, metadata: { amount }, createdAt: now() });
  saveStore();
  res.json({ ok: true, wallet, transaction });
});

app.post('/api/payments/create-intent', requireAuth, (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Valid amount required' });
  }

  const payment = {
    id: uid('pay'),
    provider: 'demo_provider',
    eventType: 'payment.intent.created',
    userId: req.user.id,
    amount,
    currency: 'USD',
    status: 'pending',
    createdAt: now()
  };

  store.paymentEvents.unshift(payment);
  saveStore();

  res.json({ ok: true, payment });
});

app.post('/api/payments/webhook', (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const amount = Number(req.body?.amount || 0);

  if (!userId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid payment webhook payload' });
  }

  const wallet = getWalletForUser(userId);
  if (!wallet) return res.status(404).json({ ok: false, error: 'Wallet not found' });

  wallet.balance = Number(wallet.balance) + amount;
  createTransaction({
    userId,
    walletId: wallet.id,
    type: 'credit',
    direction: 'in',
    amount,
    currency: wallet.currency,
    status: 'completed',
    referenceId: `webhook_${uid('pay')}`,
    metadata: { source: 'payment_webhook' }
  });

  const event = {
    id: uid('pay'),
    provider: 'demo_provider',
    eventType: 'payment.success',
    userId,
    amount,
    currency: wallet.currency,
    status: 'completed',
    createdAt: now()
  };
  store.paymentEvents.unshift(event);
  createNotification(userId, 'payment', 'Payment received', `A payment of $${amount.toFixed(2)} was received.`);

  saveStore();
  res.json({ ok: true, wallet, event });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  try {
    await initializePersistence();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`PayPilot MVP server running on http://localhost:${PORT}`);
      console.log(dbPool ? 'Persistence: PostgreSQL' : 'Persistence: local JSON');
    });
  } catch (error) {
    console.error('Persistence initialization failed:', error.message);
    process.exit(1);
  }
}

startServer();
