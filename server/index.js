/**
 * AFXX Rewards — Backend server
 * ------------------------------------------------
 * This is what makes the login "real": Telegram itself signs a payload
 * (initData) whenever your Mini App is opened, using a secret only your
 * bot token can reproduce. The frontend CANNOT be trusted to say "I am
 * user X" on its own — anyone could edit that in devtools. So every
 * request here re-checks the Telegram signature server-side before
 * touching that user's balance.
 *
 * Coins live in a SQLite file (afxx.db) keyed by telegram_id. Logging
 * out of the mini app doesn't delete this row, so balance survives
 * closing Telegram, reopening days later, switching phones, etc.
 * (It's tied to the SQLite file though — if you redeploy to a host
 * that wipes disk on restart, e.g. some free tiers, switch to a
 * managed Postgres/MySQL before going live.)
 *
 * Install & run:
 *   npm install express better-sqlite3 cors
 *   BOT_TOKEN=your_botfather_token node index.js
 *
 * Anti-cheat included here is BASIC (per-request cooldown + server-decided
 * reward amount, client never sends "how much to add"). For a real launch
 * you'll want more: device/session anomaly checks, daily caps, replay
 * protection, etc.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN environment variable.');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const MAX_ENERGY = 1000;
const ENERGY_COST_PER_TAP = 8;
const MIN_TAP_INTERVAL_MS = 120; // basic anti-autoclick throttle

// ---------- DB setup ----------
const db = new Database('afxx.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    coins INTEGER NOT NULL DEFAULT 0,
    energy INTEGER NOT NULL DEFAULT ${MAX_ENERGY},
    last_tap_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const getUserStmt = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
const insertUserStmt = db.prepare(`
  INSERT INTO users (telegram_id, username, coins, energy, last_tap_at, created_at, updated_at)
  VALUES (?, ?, 0, ${MAX_ENERGY}, 0, ?, ?)
`);
const updateUserStmt = db.prepare(`
  UPDATE users SET coins = ?, energy = ?, last_tap_at = ?, updated_at = ? WHERE telegram_id = ?
`);

function findOrCreateUser(telegramId, username) {
  let user = getUserStmt.get(telegramId);
  if (!user) {
    const now = Date.now();
    insertUserStmt.run(telegramId, username || null, now, now);
    user = getUserStmt.get(telegramId);
  }
  return user;
}

// ---------- Telegram initData verification ----------
// Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const key of [...params.keys()].sort()) {
    pairs.push(`${key}=${params.get(key)}`);
  }
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  // Optional: reject stale initData (older than 24h)
  const authDate = Number(params.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > 60 * 60 * 24) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  return JSON.parse(userRaw); // { id, first_name, username, ... }
}

// ---------- App ----------
const app = express();
app.use(cors());
app.use(express.json());

// Every protected route expects { initData } in the body — the raw string
// Telegram.WebApp.initData gives you on the client, unmodified.
function requireTelegramUser(req, res, next) {
  const { initData } = req.body || {};
  if (!initData) return res.status(401).json({ error: 'Missing initData' });
  const tgUser = verifyInitData(initData, BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: 'Invalid or expired Telegram signature' });
  req.tgUser = tgUser;
  next();
}

// Log in / resume session: returns the user's persisted balance
app.post('/api/session', requireTelegramUser, (req, res) => {
  const telegramId = String(req.tgUser.id);
  const username = req.tgUser.username || req.tgUser.first_name || 'Player';
  const user = findOrCreateUser(telegramId, username);
  res.json({ coins: user.coins, energy: user.energy, username });
});

// Tap: server decides the reward, updates the DB, returns the new totals
app.post('/api/tap', requireTelegramUser, (req, res) => {
  const telegramId = String(req.tgUser.id);
  const user = findOrCreateUser(telegramId, req.tgUser.username || req.tgUser.first_name);

  const now = Date.now();
  if (now - user.last_tap_at < MIN_TAP_INTERVAL_MS) {
    return res.status(429).json({ error: 'Too fast', coins: user.coins, energy: user.energy });
  }
  if (user.energy < ENERGY_COST_PER_TAP) {
    return res.status(400).json({ error: 'Out of energy', coins: user.coins, energy: user.energy });
  }

  const gain = Math.round(4 + Math.random() * 4); // server-side reward, client can't fake this
  const newCoins = user.coins + gain;
  const newEnergy = Math.max(0, user.energy - ENERGY_COST_PER_TAP);

  updateUserStmt.run(newCoins, newEnergy, now, now, telegramId);
  res.json({ gain, coins: newCoins, energy: newEnergy });
});

// Slow passive energy regen — call this periodically (e.g. a cron every minute)
// or lazily recompute on session fetch. Kept simple/explicit here as a manual endpoint.
app.post('/api/regen', requireTelegramUser, (req, res) => {
  const telegramId = String(req.tgUser.id);
  const user = findOrCreateUser(telegramId);
  const newEnergy = Math.min(MAX_ENERGY, user.energy + 2);
  updateUserStmt.run(user.coins, newEnergy, user.last_tap_at, Date.now(), telegramId);
  res.json({ coins: user.coins, energy: newEnergy });
});

app.listen(PORT, () => console.log(`AFXX backend listening on port ${PORT}`));
