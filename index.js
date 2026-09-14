const { Telegraf } = require('telegraf');

// Token ko automatically detect karega chahe BOT_TOKEN ho ya TOKEN
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

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
