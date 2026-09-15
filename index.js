const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined!');
  process.exit(1);
}

const bot = new Telegraf(token);
const ADMIN_USER_ID = 7449469384;

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
const deviceVotesRecord = {}; 

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
    ctx.reply('❌ **Access Denied:** You are not authorized.', { parse_mode: 'Markdown' });
    return false;
  }
  return true;
};

bot.start(async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const userName = ctx.from.first_name || 'User';
  await ctx.reply(`Welcome, ${userName}! 🎉\n\nChoose an option from the panel below:`, { parse_mode: 'Markdown', ...getControlPanelKeyboard() });
});

bot.command('restart', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  delete userState[ctx.from.id];
  await ctx.reply('🔄 **Session reset successfully!**', { parse_mode: 'Markdown' });
});

bot.command(['menu', 'panel'], async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.reply(`⚙️ **Control Panel**`, { parse_mode: 'Markdown', ...getControlPanelKeyboard() });
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
  await ctx.reply('📞 **Support:** Each device is restricted to a single vote per poll securely.', { parse_mode: 'Markdown' });
});

const startCreationWizard = async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_channel' };
  const defaultChannel = '@BHAICHARAGROUPP';
  
  await ctx.reply(`📢 **Giveaway Creator**\n\nTarget Channel: \`${defaultChannel}\``, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('✅ Confirm Channel', `set_chan_${defaultChannel}`)]])
  });
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

  userState[userId] = { step: 'waiting_title', channel };
  await ctx.editMessageText(`✅ Channel set!\n\nNow enter the **Giveaway Title**:`, { parse_mode: 'Markdown' });
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
    return ctx.reply('🏆 Now enter the **Prize Details**:', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_prize') {
    state.prize = text;
    state.step = 'waiting_all_nominees';
    return ctx.reply('👥 **Enter All Nominee Names** (line by line):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_all_nominees') {
    const options = text.split(/\r?\n|,/).map(opt => opt.trim()).filter(opt => opt.length > 0);
    if (options.length === 0) return ctx.reply('⚠️ Please provide at least one valid nominee.');

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
    deviceVotesRecord[giveawayId] = {};
    const giveaway = activeGiveaways[giveawayId];

    const buttons = giveaway.options.map((opt, index) => {
      const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?gw=${giveawayId}&opt=${index}`;
      return [Markup.button.url(`🗳 ${opt.name} (0)`, verifyUrl)];
    });
    buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        giveaway.channel,
        `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click below to verify device & vote:**`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
      giveaway.messageId = sentMsg.message_id;
      return ctx.reply(`🎉 **Giveaway posted!** ID: \`${giveawayId}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      delete activeGiveaways[giveawayId];
      return ctx.reply(`❌ Failed to post: ${err.message}`, { parse_mode: 'Markdown' });
    }
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
    `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click below to verify device & vote:**`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  ).catch(() => {});
};

const listUserPollsForEdit = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);
  if (userPolls.length === 0) return ctx.reply('⚠️ No active polls found.', { parse_mode: 'Markdown' });
  const buttons = userPolls.map(id => [Markup.button.callback(`✏️ Edit: ${activeGiveaways[id].title}`, `edit_menu_${id}`)]);
  await ctx.reply('✏️ Select poll to edit:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
};

bot.action(/^edit_menu_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  const giveawayId = ctx.match[1];
  await ctx.reply(`⚙️ Options:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]]) });
});

const listActivePollsForRepost = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);
  if (userPolls.length === 0) return ctx.reply('⚠️ No active polls found.', { parse_mode: 'Markdown' });
  const buttons = userPolls.map(id => [Markup.button.callback(`📢 Repost: ${activeGiveaways[id].title}`, `repost_${id}`)]);
  await ctx.reply('🔄 Select poll to repost:', { parse_Mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^repost_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || giveaway.status !== 'active') return ctx.answerCbQuery({ text: 'Not active!', show_alert: true });

  const buttons = giveaway.options.map((opt, index) => {
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?gw=${giveawayId}&opt=${index}`;
    return [Markup.button.url(`🗳 ${opt.name} (${opt.votes})`, verifyUrl)];
  });
  buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

  const sentMsg = await ctx.telegram.sendMessage(
    giveaway.channel,
    `🎁 **[REPOSTED] ${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click below to verify device & vote:**`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
  giveaway.messageId = sentMsg.message_id;
  await ctx.answerCbQuery({ text: '✅ Reposted!' });
});

const listUserPollsForClose = async (ctx) => {
  const userId = ctx.from.id;
  const userPolls = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active' && activeGiveaways[id].creatorId === userId);
  if (userPolls.length === 0) return ctx.reply('⚠️ No active polls to close.', { parse_mode: 'Markdown' });
  const buttons = userPolls.map(id => [Markup.button.callback(`🔒 Close: ${activeGiveaways[id].title}`, `close_${id}`)]);
  await ctx.reply('🔒 Select poll to close:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^close_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || giveaway.status !== 'active') {
    return ctx.answerCbQuery({ text: 'Already closed!', show_alert: true });
  }

  giveaway.status = 'closed';

  try {
    await ctx.telegram.editMessageText(
      giveaway.channel,
      giveaway.messageId,
      undefined,
      `🔒 **[CLOSED] ${giveaway.title}**`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {}

  await ctx.answerCbQuery({ text: 'Closed!' });
  await ctx.reply('🔒 Poll closed successfully!', { parse_mode: 'Markdown' });
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

  if (req.method === 'POST' && urlParams.pathname === '/vote') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { gw, opt, userId, deviceToken } = data;

        if (!deviceToken) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Device verification failed.' }));
          return;
        }

        if (activeGiveaways[gw] && activeGiveaways[gw].options && activeGiveaways[gw].options[opt] !== undefined) {
          if (!deviceVotesRecord[gw]) deviceVotesRecord[gw] = {};
          if (!userVotesRecord[gw]) userVotesRecord[gw] = {};

          if (deviceVotesRecord[gw][deviceToken]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'This device has already been used to vote! Multiple votes from the same device are not allowed.' }));
            return;
          }

          const voterId = String(userId);
          if (userVotesRecord[gw][voterId]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'You have already voted using this account!' }));
            return;
          }

          deviceVotesRecord[gw][deviceToken] = true;
          userVotesRecord[gw][voterId] = true;
          
          activeGiveaways[gw].options[opt].votes += 1;
          updateChannelPollMessage(gw);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, votes: activeGiveaways[gw].options[opt].votes }));
          return;
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Poll not found.' }));
          return;
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error processing vote.' }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Device-Locked Bot server is active 24/7!\n');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
