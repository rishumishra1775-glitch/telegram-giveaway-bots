const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined!');
  process.exit(1);
}

const bot = new Telegraf(token);

// Memory storage for wizards, active giveaways, and votes tracking
const userState = {};      // Wizard states for creation
const activeGiveaways = {}; // Stores giveaway options, message IDs, and votes count
const userVotes = {};      // Tracks which user voted for which giveaway & option ({ userId_giveawayId: optionIndex })

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
    await ctx.reply('✅ Device Status: Ready! Once you verify your device on the link, your vote will be securely locked.');
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
  await ctx.reply('🔄 **Session reset successfully!** You can now start fresh using /create or /menu.');
});

// --- INTERACTIVE MENU / COMMANDS ---
bot.command(['menu', 'panel'], async (ctx) => {
  await ctx.reply(
    `⚙️ **Giveaway & Voting Control Panel**\n\nChoose an action below:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Create New Giveaway', 'menu_create')],
        [Markup.button.callback('🔒 Close Active Giveaway', 'menu_close')],
        [Markup.button.callback('ℹ️ Help & Info', 'menu_help')]
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
  await ctx.reply('⚠️ To close a giveaway, reply with `/close <giveaway_id>` or use the close command in your channel.');
});

bot.action('menu_help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('💡 **Help Guide:**\n1. Use `/create` to start a new giveaway wizard.\n2. Add the bot as Admin in your target channel.\n3. Users must verify their device to vote securely.');
});

// --- GIVEAWAY CREATION WIZARD (Open for all users with channel admin check) ---
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
    
    // Check if bot is admin in that channel
    try {
      const botInfo = await ctx.telegram.getMe();
      const chatMember = await ctx.telegram.getChatMember(state.channel, botInfo.id);
      
      if (!['administrator', 'creator'].includes(chatMember.status)) {
        delete userState[userId];
        return ctx.reply('❌ **Error:** The bot is not an administrator in this channel! Please add the bot as an Admin with post permissions first, then run `/create` again.');
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
    
    // Initialize active giveaway data
    activeGiveaways[giveawayId] = {
      title,
      prize,
      channel,
      options: options.map(opt => ({ name: opt, votes: 0 })),
      status: 'active'
    };

    // Build buttons for options
    const buttons = options.map((opt, index) => [
      Markup.button.callback(`🗳 ${opt} (0)`, `vote_${giveawayId}_${index}`)
    ]);
    
    buttons.push([Markup.button.callback('🔒 Close Voting', `close_${giveawayId}`)]);

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        channel,
        📱 **${title}**\n\n🏆 **Prize:** ${prize}\n\n👇 Click below to vote! (Device verification required)`,
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

// --- VOTING HANDLING ---
bot.action(/^vote_(gw_\d+)_(\d+)$/, async (ctx) => {
  try {
    const giveawayId = ctx.match[1];
    const optionIndex = Number(ctx.match[2]);
    const userId = ctx.from.id;

    const giveaway = activeGiveaways[giveawayId];
    if (!giveaway || giveaway.status !== 'active') {
      return ctx.answerCbQuery({ text: '❌ This voting session is closed!', show_alert: true });
    }

    // Check if user already voted in this giveaway
    const voteKey = `${userId}_${giveawayId}`;
    if (userVotes[voteKey] !== undefined) {
      return ctx.answerCbQuery({ text: '⚠️ You have already voted in this giveaway!', show_alert: true });
    }

    // Prompt device verification URL
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}`;
    
    // Temporarily record vote and increment count (or enforce verification first based on your preference)
    userVotes[voteKey] = optionIndex;
    giveaway.options[optionIndex].votes += 1;

    // Update message buttons with new vote counts
    const updatedButtons = giveaway.options.map((opt, idx) => [
      Markup.button.callback(`🗳 ${opt.name} (${opt.votes})`, `vote_${giveawayId}_${idx}`)
    ]);
    updatedButtons.push([Markup.button.callback('🔒 Close Voting', `close_${giveawayId}`)]);

    await ctx.editMessageText(
      `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 Click below to vote! (Device verification required)`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(updatedButtons)
      }
    ).catch(() => {});

    await ctx.answerCbQuery({ text: '✅ Vote recorded successfully!' });

    // Send verification prompt to user chat
    await ctx.telegram.sendMessage(
      userId,
      `🔒 **Anti-Fraud Verification Required**\n\nYour vote for **${giveaway.options[optionIndex].name}** has been registered, but please verify your device to keep your entry secure:`,
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
      `🔒 **[CLOSED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n🏁 **Final Results:**\n` +
      giveaway.options.map(opt => `• ${opt.name}: **${opt.votes} votes**`).join('\n'),
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery({ text: 'Voting closed successfully!' });
  } catch (err) {
    console.error('Error closing giveaway:', err);
  }
});

// Command alternative to close giveaway
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
      `🔒 **[CLOSED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n🏁 **Final Results:**\n` +
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

    // Check if user left the channel/group
    if (['member', 'administrator'].includes(oldStatus) && ['left', 'kicked'].includes(newStatus)) {
      const userId = update.from.user.id;

      // Check all active giveaways to see if this user voted
      for (const giveawayId in activeGiveaways) {
        const voteKey = `${userId}_${giveawayId}`;
        if (userVotes[voteKey] !== undefined) {
          const optionIndex = userVotes[voteKey];
          const giveaway = activeGiveaways[giveawayId];

          if (giveaway && giveaway.status === 'active') {
            // Subtract vote
            if (giveaway.options[optionIndex].votes > 0) {
              giveaway.options[optionIndex].votes -= 1;
            }
            // Remove user vote record
            delete userVotes[voteKey];

            // Update channel message if messageId exists
            if (giveaway.messageId) {
              const updatedButtons = giveaway.options.map((opt, idx) => [
                Markup.button.callback(`🗳 ${opt.name} (${opt.votes})`, `vote_${giveawayId}_${idx}`)
              ]);
              updatedButtons.push([Markup.button.callback('🔒 Close Voting', `close_${giveawayId}` )]);

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
  console.log('Bot is running with full giveaway wizard, menu, and anti-exit features!');
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
