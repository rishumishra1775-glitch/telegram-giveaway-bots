const { Telegraf } = require('telegraf');
const http = require('http');

// Token ko automatically detect karega
const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined in environment variables!');
  process.exit(1);
}

const bot = new Telegraf(token);

bot.start((ctx) => {
  ctx.reply('Welcome to the Secure Giveaway Bot! 🚀\nYour device verification system is active.');
});

bot.help((ctx) => {
  ctx.reply('Use /start to begin participating in the secure giveaway.');
});

// Bot launch
bot.launch().then(() => {
  console.log('Bot is successfully running and connected to Telegram!');
}).catch((err) => {
  console.error('Failed to launch bot:', err);
});

// Render ke liye dummy HTTP server taaki port open rahe aur timeout na aaye
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running successfully!\n');
}).listen(PORT, () => {
  console.log(`HTTP server is listening on port ${PORT}`);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
