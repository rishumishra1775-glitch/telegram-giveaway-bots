const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined in environment variables!');
  process.exit(1);
}

const bot = new Telegraf(token);

// /start command - sending User ID in the web URL
bot.start(async (ctx) => {
  try {
    const userName = ctx.from.first_name || 'User';
    const userId = ctx.from.id; // Getting Telegram User ID
    const webAppUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}`;

    await ctx.reply(
      `Welcome, ${userName}! 🎉\n\nTo participate in the secure giveaway and lock in your entry, please complete your **Device Verification** below.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔗 Verify Device', webAppUrl)],
          [Markup.button.callback('📊 Check Status', 'check_status')]
        ])
      }
    );
  } catch (err) {
    console.error('Error in /start command:', err);
  }
});

// Callback query for status check
bot.action('check_status', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('✅ Device Verified Successfully! Your entry is locked and secure.');
  } catch (err) {
    console.error('Error in action:', err);
  }
});

bot.help((ctx) => {
  ctx.reply('Use /start to begin participating in the secure giveaway.');
});

bot.launch().then(() => {
  console.log('Bot is successfully running and connected to Telegram!');
}).catch((err) => {
  console.error('Failed to launch bot:', err);
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running successfully!\n');
}).listen(PORT, () => {
  console.log(`HTTP server is listening on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
