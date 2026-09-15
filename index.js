const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined!');
  process.exit(1);
}

const bot = new Telegraf(token);

const ADMIN_USER_ID = 7449469384;

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

const userState = {};      
const activeGiveaways = {}; 
const userVotesRecord = {}; 

const getControlPanelKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Create Giveaway', 'menu_create')],
    [Markup.button.callback('✏️ Edit Names', 'menu_edit')],
    [Markup.button.callback('🔄 Repost Live Polls', 'menu_repost')],
    [Markup.button.callback('🔒 Close Poll', 'menu_close')],
    [Markup.button.callback('📞 Support', 'menu_support')]
  ]);
};

const checkAdmin = (ctx) => {
  const userId = ctx.from?.id;
  if (userId !== ADMIN_USER_ID) {
    ctx.reply('❌ **Access Denied:** You are not authorized to use this bot control panel.', { parse_mode: 'Markdown' });
    return false;
  }
  return true;
};

bot.start(async (ctx) => {
  if (!checkAdmin(ctx)) return;
  try {
    const userName = ctx.from.first_name || 'User';
    await ctx.reply(
      `Welcome, ${userName}! 🎉\n\nChoose an option from the panel below to manage or create your giveaways:`,
      { parse_mode: 'Markdown', ...getControlPanelKeyboard() }
    );
  } catch (err) {
    console.error('Error in /start:', err);
  }
});

bot.command('restart', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const userId = ctx.from.id;
  if (userState[userId]) delete userState[userId];
  await ctx.reply('🔄 **Session reset successfully!** You can start fresh using `/create` or `/menu`.', { parse_mode: 'Markdown' });
});

bot.command(['menu', 'panel'], async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.reply(`⚙️ **Giveaway & Poll Control Panel**\n\nSelect an action below:`, { parse_mode: 'Markdown', ...getControlPanelKeyboard() });
});

bot.action('menu_create', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  startCreationWizard(ctx);
});

bot.action('menu_edit', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  listUserPollsForEdit(ctx);
});

bot.action('menu_repost', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  listActivePollsForRepost(ctx);
});

bot.action('menu_close', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  listUserPollsForClose(ctx);
});

bot.action('menu_support', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  await ctx.reply('📞 **Support Desk:**\n\n1. Admins can create multiple polls simultaneously.\n2. Each voter can only vote **once** per poll.\n3. Send nominee names line by line.', { parse_mode: 'Markdown' });
});

const startCreationWizard = async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_channel' };
  const defaultChannel = '@BHAICHARAGROUPP';
  
  await ctx.reply(
    `📢 **Giveaway Creator Wizard Started**\n\nTarget Channel detected: \`${defaultChannel}\`\n\nClick below to confirm and proceed:`, 
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Channel', `set_chan_${defaultChannel}`)]
      ])
    }
  );
};

bot.command('create', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  startCreationWizard(ctx);
});

bot.action(/^set_chan_(.+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const channel = ctx.match[1];

  try {
    const botInfo = await ctx.telegram.getMe();
    const chatMember = await ctx.telegram.getChatMember(channel, botInfo.id);
    if (!['administrator', 'creator'].includes(chatMember.status)) {
      delete userState[userId];
      return ctx.editMessageText('❌ **Error:** The bot is not an administrator in this channel!', { parse_mode: 'Markdown' });
    }
  } catch (err) {
    delete userState[userId];
    return ctx.editMessageText('❌ **Error validating channel.** Make sure the bot is an admin.', { parse_mode: 'Markdown' });
  }

  userState[userId] = { step: 'waiting_title', channel };
  await ctx.editMessageText(`✅ Channel **${channel}** validated successfully!\n\nNow enter the **Giveaway / Voting Title**:`, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) return next();
  
  const text = ctx.message.text.trim();
  if (!userState[userId]) return next();
  const state = userState[userId];

  if (state.step === 'waiting_title') {
    state.title = text;
    state.step = 'waiting_prize';
    return ctx.reply('🏆 Now enter the **Prize Details** (e.g., $100 USDT):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_prize') {
    state.prize = text;
    state.step = 'waiting_all_nominees';
    return ctx.reply('👥 **Enter All Nominee Names:** (separated by comma or new line):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_all_nominees') {
    const options = text.split(/\r?\n|,/).map(opt => opt.trim()).filter(opt => opt.length > 0);
    if (options.length === 0) return ctx.reply('⚠️ Please provide at least one valid nominee name.');

    const { channel, title, prize } = state;
    delete userState[userId];

    const giveawayId = 'gw_' + Date.now();
    activeGiveaways[giveawayId] = {
      creatorId: userId,
      title,
      prize,
      channel,
      options: options.map(name => ({ name, votes: 0 })),
      status: 'active'
    };

    userVotesRecord[giveawayId] = {};
    const giveaway = activeGiveaways[giveawayId];

    const buttons = giveaway.options.map((opt, index) => {
      const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?gw=${giveawayId}&opt=${index}`;
      return [Markup.button.url(`🗳 ${opt.name} (0)`, verifyUrl)];
    });
    buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        giveaway.channel,
        `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click an option below to securely verify your device and vote:**`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
      giveaway.messageId = sentMsg.message_id;
      return ctx.reply(`🎉 **Giveaway successfully posted to channel (${channel})!**\n🆔 ID: \`${giveawayId}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      delete activeGiveaways[giveawayId];
      return ctx.reply(`❌ Failed to post giveaway: ${err.message}`, { parse_mode: 'Markdown' });
    }
  }

  if (state.step === 'adding_nominee') {
    const { giveawayId } = state;
    delete userState[userId];
    const giveaway = activeGiveaways[giveawayId];
    if (!giveaway || giveaway.status !== 'active') return ctx.reply('❌ Poll is no longer active.');

    giveaway.options.push({ name: text, votes: 0 });
    await updateChannelPollMessage(giveawayId);
    return ctx.reply(`✅ Nominee **"${text}"** added successfully!`, { parse_mode: 'Markdown' });
  }

  return next();
});

const updateChannelPollMessage = async (giveawayId) => {
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || !giveaway.messageId) return;

  const buttons = giveaway.options.map((opt, index) => {
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?gw=${giveawayId}&opt=${index}`;
    return [Markup.button.url(`🗳 ${opt.name} (${opt.votes})`, verifyUrl)];
  });
  buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

  await bot.telegram.editMessageText(
    giveaway.channel,
    giveaway.messageId,
    undefined,
    `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click an option below to securely verify your device and vote:**`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  ).catch(() => {});
};

const listUserPollsForEdit = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);
  if (userPolls.length === 0) return ctx.reply('⚠️ **No active polls found to edit.**', { parse_mode: 'Markdown' });

  const buttons = userPolls.map(id => [Markup.button.callback(`✏️ Edit: ${activeGiveaways[id].title}`, `edit_menu_${id}`)]);
  await ctx.reply('✏️ **Select a poll to edit:**', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
};

bot.action(/^edit_menu_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  const giveawayId = ctx.match[1];
  const buttons = [
    [Markup.button.callback('➕ Add New Nominee', `add_nom_${giveawayId}`)],
    [Markup.button.callback('❌ Remove Nominee', `rem_nom_list_${giveawayId}`)]
  ];
  await ctx.reply(`⚙️ **Editing Poll:**`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^add_nom_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'adding_nominee', giveawayId: ctx.match[1] };
  await ctx.reply('➕ Send the name of the **New Nominee**:', { parse_mode: 'Markdown' });
});

bot.action(/^rem_nom_list_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || giveaway.options.length <= 1) return ctx.reply('⚠️ Must keep at least one nominee.');

  const buttons = giveaway.options.map((opt, idx) => [Markup.button.callback(`🗑 Remove: ${opt.name}`, `remove_opt_${giveawayId}_${idx}`)]);
  await ctx.reply('🗑 Select nominee to remove:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^remove_opt_(gw_\d+)_(\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const giveawayId = ctx.match[1];
  const optIdx = Number(ctx.match[2]);
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || giveaway.options.length <= 1) return ctx.answerCbQuery({ text: 'Cannot remove!', show_alert: true });

  const removed = giveaway.options.splice(optIdx, 1);
  await updateChannelPollMessage(giveawayId);
  await ctx.answerCbQuery({ text: `Removed "${removed[0].name}"!` });
  await ctx.editMessageText(`✅ Nominee **"${removed[0].name}"** removed.`, { parse_mode: 'Markdown' });
});

const listActivePollsForRepost = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);
  if (userPolls.length === 0) return ctx.reply('⚠️ **No active polls found.**', { parse_mode: 'Markdown' });

  const buttons = userPolls.map(id => [Markup.button.callback(`📢 Repost: ${activeGiveaways[id].title}`, `repost_${id}`)]);
  await ctx.reply('🔄 **Select poll to repost:**', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
};

bot.command('repost', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  listActivePollsForRepost(ctx);
});

bot.action(/^repost_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || giveaway.status !== 'active') return ctx.answerCbQuery({ text: 'Poll not active!', show_alert: true });

  const buttons = giveaway.options.map((opt, index) => {
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?gw=${giveawayId}&opt=${index}`;
    return [Markup.button.url(`🗳 ${opt.name} (${opt.votes})`, verifyUrl)];
  });
  buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

  const sentMsg = await ctx.telegram.sendMessage(
    giveaway.channel,
    `🎁 **[REPOSTED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click an option below to securely verify your device and vote:**`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
  giveaway.messageId = sentMsg.message_id;
  await ctx.answerCbQuery({ text: '✅ Reposted!' });
  await ctx.editMessageText(`✅ Poll reposted!`, { parse_mode: 'Markdown' });
});

const listUserPollsForClose = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);
  if (userPolls.length === 0) return ctx.reply('⚠️ **No active polls to close.**', { parse_mode: 'Markdown' });

  const buttons = userPolls.map(id => [Markup.button.callback(`🔒 Close: ${activeGiveaways[id].title}`, `close_${id}`)]);
  await ctx.reply('🔒 **Select poll to close:**', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
};

bot.action(/^close_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || giveaway.status !== 'active') return ctx.answerCbQuery({ text: 'Already closed!', show_audit: true });

  giveaway.status = 'closed';
  await ctx.telegram.editMessageText(
    giveaway.channel,
    giveaway.messageId,
    undefined,
    `🔒 **[CLOSED / POLL ENDED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n🏁 **Final Results:**\n` +
    giveaway.options.map(opt => `• ${opt.name}: **${opt.votes} votes**`).join('\n'),
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  await ctx.answerCbQuery({ text: 'Closed!' });
  await ctx.reply(`🔒 Poll closed successfully!`, { parse_mode: 'Markdown' });
});

bot.command('close', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const giveawayId = ctx.message.text.split(' ')[1];
  if (!giveawayId || !activeGiveaways[giveawayId]) return ctx.reply('⚠️ Provide valid ID.');

  const giveaway = activeGiveaways[giveawayId];
  giveaway.status = 'closed';
  await ctx.telegram.editMessageText(
    giveaway.channel,
    giveaway.messageId,
    undefined,
    `🔒 **[CLOSED] ${giveaway.title}**\n\n🏁 **Results:**\n` +
    giveaway.options.map(opt => `• ${opt.name}: **${opt.votes} votes**`).join('\n'),
    { parse_mode: 'Markdown' }
  );
  await ctx.reply(`✅ Closed successfully!`);
});

bot.launch();

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlParams = new URL(req.url, `http://${req.headers.host}`);
  if (urlParams.pathname === '/vote') {
    const gw = urlParams.searchParams.get('gw');
    const opt = parseInt(urlParams.searchParams.get('opt'), 10);
    let voterId = urlParams.searchParams.get('user');

    if (!voterId || voterId.startsWith('anon')) {
      voterId = 'voter_' + Math.random(); // Unique fallback ID agar telegram id na mile
    }

    if (activeGiveaways[gw] && activeGiveaways[gw].options && activeGiveaways[gw].options[opt] !== undefined) {
      if (!userVotesRecord[gw]) userVotesRecord[gw] = {};

      if (userVotesRecord[gw][voterId]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'You have already voted in this poll!' }));
        return;
      }

      userVotesRecord[gw][voterId] = true;
      activeGiveaways[gw].options[opt].votes += 1;

      updateChannelPollMessage(gw);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, votes: activeGiveaways[gw].options[opt].votes }));
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Poll or option not found.' }));
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot server is active 24/7!\n');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

setInterval(() => {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) http.get(renderUrl, () => {}).on('error', () => {});
}, 4 * 60 * 1000);
