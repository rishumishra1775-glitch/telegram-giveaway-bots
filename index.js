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
  { command: 'edit', description: 'Edit Live Poll Names' },
  { command: 'repost', description: 'Repost Live Polls' },
  { command: 'close', description: 'Close Active Poll' },
  { command: 'restart', description: 'Reset Current Session' }
]);

// Memory storage
const userState = {};      
const activeGiveaways = {}; 
const pendingGiveaways = {}; 

// Main Control Panel Keyboard
const getControlPanelKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Create Giveaway', 'menu_create')],
    [Markup.button.callback('✏️ Edit Names', 'menu_edit')],
    [Markup.button.callback('🔄 Repost Live Polls', 'menu_repost')],
    [Markup.button.callback('🔒 Close Poll', 'menu_close')],
    [Markup.button.callback('📞 Support', 'menu_support')]
  ]);
};

// /start command
bot.start(async (ctx) => {
  try {
    const userName = ctx.from.first_name || 'User';
    await ctx.reply(
      `Welcome, ${userName}! 🎉\n\nChoose an option from the panel below to manage or create your giveaways:`,
      {
        parse_mode: 'Markdown',
        ...getControlPanelKeyboard()
      }
    );
  } catch (err) {
    console.error('Error in /start:', err);
  }
});

// /restart command
bot.command('restart', async (ctx) => {
  const userId = ctx.from.id;
  if (userState[userId]) delete userState[userId];
  if (pendingGiveaways[userId]) delete pendingGiveaways[userId];
  await ctx.reply('🔄 **Session reset successfully!** You can start fresh using `/create` or `/menu`.', { parse_mode: 'Markdown' });
});

// --- MAIN CONTROL PANEL / MENU ---
bot.command(['menu', 'panel'], async (ctx) => {
  await ctx.reply(
    `⚙️ **Giveaway & Poll Control Panel**\n\nSelect an action below:`,
    {
      parse_mode: 'Markdown',
      ...getControlPanelKeyboard()
    }
  );
});

bot.action('menu_create', async (ctx) => {
  await ctx.answerCbQuery();
  startCreationWizard(ctx);
});

bot.action('menu_edit', async (ctx) => {
  await ctx.answerCbQuery();
  listUserPollsForEdit(ctx);
});

bot.action('menu_repost', async (ctx) => {
  await ctx.answerCbQuery();
  listActivePollsForRepost(ctx);
});

bot.action('menu_close', async (ctx) => {
  await ctx.answerCbQuery();
  listUserPollsForClose(ctx);
});

bot.action('menu_support', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 **Support Desk:**\n\n1. Only the creator can close or edit a poll.\n2. Send all nominee names in a single message separated by commas or new lines.\n3. Preview screen lets you check before final posting.', { parse_mode: 'Markdown' });
});

// --- STEP-BY-STEP GIVEAWAY CREATION WIZARD ---
const startCreationWizard = async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_channel' };
  await ctx.reply('📢 **Giveaway Creator Wizard Started**\n\nPlease send your Target Channel username or link (e.g., `@mychannel`):', { parse_mode: 'Markdown' });
};

bot.command('create', startCreationWizard);

// Handle text inputs for wizard and editing options
bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  if (!userState[userId]) return next();

  const state = userState[userId];

  // Step 1: Channel
  if (state.step === 'waiting_channel') {
    try {
      const botInfo = await ctx.telegram.getMe();
      const chatMember = await ctx.telegram.getChatMember(text, botInfo.id);
      if (!['administrator', 'creator'].includes(chatMember.status)) {
        delete userState[userId];
        return ctx.reply('❌ **Error:** The bot is not an administrator in this channel! Please make the bot an admin first.', { parse_mode: 'Markdown' });
      }
    } catch (err) {
      delete userState[userId];
      return ctx.reply('❌ **Error validating channel.** Make sure the username is correct and bot is an administrator.', { parse_mode: 'Markdown' });
    }

    state.channel = text;
    state.step = 'waiting_title';
    return ctx.reply('✅ Channel validated successfully!\n\nNow enter the **Giveaway / Voting Title** (e.g., Best Creator Award):', { parse_mode: 'Markdown' });
  }

  // Step 2: Title
  if (state.step === 'waiting_title') {
    state.title = text;
    state.step = 'waiting_prize';
    return ctx.reply('🏆 Now enter the **Prize Details** (e.g., $100 USDT):', { parse_mode: 'Markdown' });
  }

  // Step 3: Prize
  if (state.step === 'waiting_prize') {
    state.prize = text;
    state.step = 'waiting_all_nominees';
    return ctx.reply(
      '👥 **Enter All Nominee Names:**\n\nSend all the nominee names in a single message (separate each name with a new line or comma):',
      { parse_mode: 'Markdown' }
    );
  }

  // Step 4: Parse all nominees at once and show PREVIEW
  if (state.step === 'waiting_all_nominees') {
    const options = text.split(/[\n,]+/).map(opt => opt.trim()).filter(opt => opt.length > 0);

    if (options.length === 0) {
      return ctx.reply('⚠️ Please provide at least one valid nominee name.');
    }

    delete userState[userId];

    pendingGiveaways[userId] = {
      creatorId: userId,
      channel: state.channel,
      title: state.title,
      prize: state.prize,
      options: options.map(opt => ({ name: opt, votes: 0 }))
    };

    const previewData = pendingGiveaways[userId];
    const previewButtons = previewData.options.map((opt, index) => {
      return [Markup.button.callback(`🗳 ${opt.name} (0)`, `dummy_${index}`)];
    });
    previewButtons.push([
      Markup.button.callback('📢 Post Your Giveaway', 'confirm_post_giveaway'),
      Markup.button.callback('❌ Cancel Anyway', 'cancel_post_giveaway')
    ]);

    return ctx.reply(
      `👀 **Giveaway Preview (How it will look in channel):**\n\n` +
      `🎁 **${previewData.title}**\n\n🏆 **Prize:** ${previewData.prize}\n\nTarget Channel: \`${previewData.channel}\`\n\nReview the voting layout below and click **Post Your Giveaway** to publish:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(previewButtons)
      }
    );
  }

  // Editing Live Poll: Adding a new nominee
  if (state.step === 'adding_nominee') {
    const giveawayId = state.giveawayId;
    const giveaway = activeGiveaways[giveawayId];
    delete userState[userId];

    if (!giveaway || giveaway.status !== 'active') {
      return ctx.reply('❌ Poll is no longer active.');
    }

    giveaway.options.push({ name: text, votes: 0 });
    await updateChannelPollMessage(giveawayId);
    return ctx.reply(`✅ Nominee **"${text}"** successfully added to *${giveaway.title}*!`, { parse_mode: 'Markdown' });
  }

  return next();
});

// --- CONFIRM OR CANCEL POSTING GIVEAWAY ---
bot.action('confirm_post_giveaway', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const previewData = pendingGiveaways[userId];

    if (!previewData) {
      return ctx.answerCbQuery({ text: '❌ No pending giveaway found! Start again with /create', show_alert: true });
    }

    delete pendingGiveaways[userId];
    const giveawayId = 'gw_' + Date.now();

    activeGiveaways[giveawayId] = {
      creatorId: userId,
      title: previewData.title,
      prize: previewData.prize,
      channel: previewData.channel,
      options: previewData.options,
      status: 'active'
    };

    const buttons = previewData.options.map((opt, index) => {
      const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}&gw=${giveawayId}&opt=${index}`;
      return [Markup.button.webApp(`🗳 ${opt.name} (0)`, verifyUrl)];
    });
    buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

    const sentMsg = await ctx.telegram.sendMessage(
      previewData.channel,
      `🎁 **${previewData.title}**\n\n🏆 **Prize:** ${previewData.prize}\n\n👇 **Click an option below to securely verify your device and vote:**`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      }
    );

    activeGiveaways[giveawayId].messageId = sentMsg.message_id;

    await ctx.answerCbQuery({ text: '🎉 Giveaway posted successfully!' });
    await ctx.editMessageText(`🎉 **Giveaway successfully posted to your channel!**\n🆔 Giveaway ID: \`${giveawayId}\``, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error posting giveaway:', err);
    await ctx.answerCbQuery({ text: `❌ Failed: ${err.message}`, show_alert: true });
  }
});

bot.action('cancel_post_giveaway', async (ctx) => {
  const userId = ctx.from.id;
  if (pendingGiveaways[userId]) {
    delete pendingGiveaways[userId];
  }
  await ctx.answerCbQuery({ text: 'Giveaway creation cancelled.' });
  await ctx.editMessageText('❌ **Giveaway creation cancelled.** Use `/create` whenever you want to try again.', { parse_mode: 'Markdown' });
});

// Helper to update channel message dynamically
const updateChannelPollMessage = async (giveawayId) => {
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || !giveaway.messageId) return;

  const buttons = giveaway.options.map((opt, index) => {
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=SYSTEM&gw=${giveawayId}&opt=${index}`;
    return [Markup.button.webApp(`🗳 ${opt.name} (${opt.votes})`, verifyUrl)];
  });
  buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

  await bot.telegram.editMessageText(
    giveaway.channel,
    giveaway.messageId,
    undefined,
    `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click an option below to securely verify your device and vote:**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    }
  ).catch(() => {});
};

// --- EDIT LIVE POLL NAMES FEATURE ---
const listUserPollsForEdit = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);

  if (userPolls.length === 0) {
    return ctx.reply('⚠️ **You have no active polls created by you to edit.**', { parse_mode: 'Markdown' });
  }

  const buttons = userPolls.map(id => [
    Markup.button.callback(`✏️ Edit: ${activeGiveaways[id].title}`, `edit_menu_${id}`)
  ]);

  await ctx.reply('✏️ **Select a poll you created to edit nominees:**', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
};

bot.action(/^edit_menu_(gw_\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];

  if (!giveaway) return ctx.reply('Poll not found.');

  const buttons = [
    [Markup.button.callback('➕ Add New Nominee', `add_nom_${giveawayId}`)],
    [Markup.button.callback('❌ Remove Nominee', `rem_nom_list_${giveawayId}`)]
  ];

  await ctx.reply(`⚙️ **Editing Poll:** *${giveaway.title}*\n\nChoose an action:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action(/^add_nom_(gw_\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const giveawayId = ctx.match[1];
  userState[ctx.from.id] = { step: 'adding_nominee', giveawayId };
  await ctx.reply('➕ Send the name of the **New Nominee** you want to add:', { parse_mode: 'Markdown' });
});

bot.action(/^rem_nom_list_(gw_\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];

  if (!giveaway || giveaway.options.length <= 1) {
    return ctx.reply('⚠️ You must keep at least one nominee.');
  }

  const buttons = giveaway.options.map((opt, idx) => [
    Markup.button.callback(`🗑 Remove: ${opt.name}`, `remove_opt_${giveawayId}_${idx}`)
  ]);

  await ctx.reply('🗑 Select the nominee you want to remove:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action(/^remove_opt_(gw_\d+)_(\d+)$/, async (ctx) => {
  try {
    const giveawayId = ctx.match[1];
    const optIdx = Number(ctx.match[2]);
    const giveaway = activeGiveaways[giveawayId];

    if (!giveaway || giveaway.status !== 'active') {
      return ctx.answerCbQuery({ text: 'Poll not active!', show_alert: true });
    }

    if (giveaway.options.length <= 1) {
      return ctx.answerCbQuery({ text: 'Cannot remove the last remaining option!', show_alert: true });
    }

    const removed = giveaway.options.splice(optIdx, 1);
    await updateChannelPollMessage(giveawayId);

    await ctx.answerCbQuery({ text: `Removed "${removed[0].name}" successfully!` });
    await ctx.editMessageText(`✅ Nominee **"${removed[0].name}"** removed successfully from *${giveaway.title}*.`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error removing nominee:', err);
  }
});

// --- REPOST LIVE POLLS FEATURE ---
const listActivePollsForRepost = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);

  if (userPolls.length === 0) {
    return ctx.reply('⚠️ **No active polls found created by you.**', { parse_mode: 'Markdown' });
  }

  const buttons = userPolls.map(id => [
    Markup.button.callback(`📢 Repost: ${activeGiveaways[id].title}`, `repost_${id}`)
  ]);

  await ctx.reply('🔄 **Select your active poll to repost:**', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
};

bot.command('repost', listActivePollsForRepost);

bot.action(/^repost_(gw_\d+)$/, async (ctx) => {
  try {
    const giveawayId = ctx.match[1];
    const giveaway = activeGiveaways[giveawayId];
    const userId = ctx.from.id;

    if (!giveaway || giveaway.status !== 'active' || giveaway.creatorId !== userId) {
      return ctx.answerCbQuery({ text: '❌ Unauthorized or poll closed!', show_alert: true });
    }

    const buttons = giveaway.options.map((opt, index) => {
      const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?user=${userId}&gw=${giveawayId}&opt=${index}`;
      return [Markup.button.webApp(`🗳 ${opt.name} (${opt.votes})`, verifyUrl)];
    });
    buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

    const sentMsg = await ctx.telegram.sendMessage(
      giveaway.channel,
      `🎁 **[REPOSTED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click an option below to securely verify your device and vote:**`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      }
    );

    giveaway.messageId = sentMsg.message_id;
    await ctx.answerCbQuery({ text: '✅ Poll successfully reposted!' });
    await ctx.editMessageText(`✅ Poll *${giveaway.title}* reposted successfully!`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error reposting:', err);
    await ctx.answerCbQuery({ text: '❌ Failed to repost.', show_alert: true });
  }
});

// --- SECURE CLOSE POLL (Creator Only) ---
const listUserPollsForClose = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);

  if (userPolls.length === 0) {
    return ctx.reply('⚠️ **You have no active polls created by you to close.**', { parse_mode: 'Markdown' });
  }

  const buttons = userPolls.map(id => [
    Markup.button.callback(`🔒 Close: ${activeGiveaways[id].title}`, `close_${id}`)
  ]);

  await ctx.reply('🔒 **Select a poll created by you to close:**', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
};

bot.action(/^close_(gw_\d+)$/, async (ctx) => {
  try {
    const giveawayId = ctx.match[1];
    const giveaway = activeGiveaways[giveawayId];
    const userId = ctx.from.id;

    if (!giveaway || giveaway.status !== 'active') {
      return ctx.answerCbQuery({ text: 'Poll already closed or not found!', show_alert: true });
    }

    if (giveaway.creatorId !== userId) {
      return ctx.answerCbQuery({ text: '❌ Unauthorized! Only the creator can close this poll.', show_alert: true });
    }

    giveaway.status = 'closed';

    await ctx.telegram.editMessageText(
      giveaway.channel,
      giveaway.messageId,
      undefined,
      `🔒 **[CLOSED / POLL ENDED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n🏁 **Final Results:**\n` +
      giveaway.options.map(opt => `• ${opt.name}: **${opt.votes} votes**`).join('\n'),
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    await ctx.answerCbQuery({ text: 'Poll closed successfully!' });
    await ctx.reply(`🔒 Giveaway *${giveaway.title}* closed successfully!`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error closing giveaway:', err);
  }
});

bot.command('close', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const giveawayId = args[1];

  if (!giveawayId || !activeGiveaways[giveawayId]) {
    return ctx.reply('⚠️ Provide a valid Giveaway ID (e.g., `/close gw_123456`).', { parse_mode: 'Markdown' });
  }

  const giveaway = activeGiveaways[giveawayId];
  if (giveaway.creatorId !== userId) {
    return ctx.reply('❌ Unauthorized! Only the creator of this poll can close it.');
  }

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
    await ctx.reply(`❌ Failed to close channel message: ${err.message}`);
  }
});

// Launch Bot
bot.launch().then(() => {
  console.log('Bot running smoothly with Instant Channel Validation & Preview Flow!');
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
