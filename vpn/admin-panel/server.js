const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 4173);
const API_URL = process.env.API_URL || 'http://vpn-admin:3000';
const ADMIN_DIR = __dirname;

app.use(express.json());
app.use(express.static(ADMIN_DIR));

app.get('/api/clients', async (req, res) => {
  try {
    const response = await fetch(`${API_URL}/clients`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Admin API unavailable' });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const response = await fetch(`${API_URL}/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Admin API unavailable' });
  }
});

app.get('/api/clients/:name/config', async (req, res) => {
  try {
    const response = await fetch(`${API_URL}/clients/${encodeURIComponent(req.params.name)}/config`);
    const text = await response.text();
    res.status(response.status).type('text/plain').send(text);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Admin API unavailable' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VPN admin panel listening on http://0.0.0.0:${PORT}`);
});
