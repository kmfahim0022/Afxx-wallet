/**
 * AFXX Rewards — Telegram Bot (minimal starter)
 * ------------------------------------------------
 * What this does:
 *   - Responds to /start with a button that opens your Mini App inside Telegram
 *   - That's the standard way Telegram bots launch a web-based mini app
 *
 * What you need before running this:
 *   1. A bot token from @BotFather (Telegram > search "BotFather" > /newbot)
 *   2. Your Mini App hosted at a real HTTPS url (Telegram requires https,
 *      not localhost) — e.g. deploy afxx-rewards.html to Vercel/Netlify/GitHub Pages,
 *      or your own domain.
 *   3. In BotFather: /mybots -> your bot -> Bot Settings -> Menu Button ->
 *      set it to your hosted URL (this makes the app open from the chat menu too).
 *
 * Install & run:
 *   npm init -y
 *   npm install node-telegram-bot-api
 *   BOT_TOKEN=your_token_here MINI_APP_URL=https://your-domain.com/afxx-rewards.html node telegram-bot-server.js
 *
 * This is intentionally minimal — no database, no reward logic, no withdrawal
 * handling. Wiring real coin balances/withdrawals to Telegram users requires
 * your own backend + database (this bot alone doesn't do that).
 */

const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;

if (!BOT_TOKEN || !MINI_APP_URL) {
  console.error('Missing BOT_TOKEN or MINI_APP_URL environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to AFXX Rewards! Tap below to open the app.', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 Open AFXX Rewards', web_app: { url: MINI_APP_URL } }
      ]]
    }
  });
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Use /start to open the AFXX Rewards mini app.');
});

console.log('Bot is running (polling mode). Press Ctrl+C to stop.');
