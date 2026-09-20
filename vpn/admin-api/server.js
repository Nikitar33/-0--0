const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, '..', 'admin-data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

app.use(express.json());

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CLIENTS_FILE)) {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify([], null, 2));
  }
}

function readClients() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeClients(clients) {
  ensureStorage();
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

function generateWireGuardKeyPair() {
  try {
    const privateKey = execFileSync('wg', ['genkey'], { encoding: 'utf8' }).trim();
    const publicKey = execFileSync('wg', ['pubkey'], { input: privateKey, encoding: 'utf8' }).trim();
    return { privateKey, publicKey };
  } catch (error) {
    throw new Error('WireGuard tools are not available on this host. Install wireguard-tools to generate client keys.');
  }
}

function makeClientConfig(client) {
  const serverPublicKey = process.env.SERVER_PUBLIC_KEY || 'REPLACE_SERVER_PUBLIC_KEY';
  const serverHost = process.env.SERVER_HOST || 'your-public-domain-or-ip';
  const serverPort = Number(process.env.SERVER_PORT || 51820);

  return `[Interface]
PrivateKey = ${client.privateKey}
Address = ${client.ip}/24
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverHost}:${serverPort}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'vpn-admin-api' });
});

app.get('/clients', (req, res) => {
  const clients = readClients();
  res.json({ ok: true, clients });
});

app.post('/clients', (req, res) => {
  const { name, ip } = req.body || {};

  if (!name || !ip) {
    return res.status(400).json({ ok: false, error: 'name and ip are required' });
  }

  const clients = readClients();
  const exists = clients.some((client) => client.name === name || client.ip === ip);
  if (exists) {
    return res.status(409).json({ ok: false, error: 'client name or IP already exists' });
  }

  let keyPair;
  try {
    keyPair = generateWireGuardKeyPair();
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  const client = {
    id: Date.now().toString(),
    name,
    ip,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    createdAt: new Date().toISOString(),
  };
  clients.push(client);
  writeClients(clients);

  res.status(201).json({ ok: true, client, config: makeClientConfig(client) });
});

app.get('/clients/:name/config', (req, res) => {
  const clients = readClients();
  const client = clients.find((item) => item.name === req.params.name);

  if (!client) {
    return res.status(404).json({ ok: false, error: 'client not found' });
  }

  res.type('text/plain').send(makeClientConfig(client));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VPN admin API listening on http://0.0.0.0:${PORT}`);
});
