const { Telegraf, Markup } = require('telegraf');
const http = require('http');

// Token ko automatically detect karega
const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined in environment variables!');
  process.exit(1);
}

const bot = new Telegraf(token);

// /start command with Inline Buttons
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'User';
  
  ctx.reply(
    `Welcome, ${userName}! 🎉\n\nWelcome to the Secure Giveaway Bot. To participate and lock in your entry, please complete your device verification below.`,
    Markup.inlineKeyboard([
      [Markup.button.url('🔗 Verify Device', 'https://t.me')], // Yahan apna verification URL daal sakta hai
      [Markup.button.callback('📊 Check Status', 'check_status')]
    ])
  );
});

// Button click handler for 'Check Status'
bot.action('check_status', async (ctx) => {
  await ctx.answerCbQuery(); // Loading state hatane ke liye
  await ctx.reply('⚠️ Verification Pending! Please click on "Verify Device" to complete your entry.');
});

// Help command
bot.help((ctx) => {
  ctx.reply('Use /start to begin participating in the secure giveaway and verify your device.');
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
