const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const token = process.env.BOT_TOKEN || process.env.TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not defined!');
  process.exit(1);
}

const bot = new Telegraf(token);
const ADMIN_USER_ID = 7449469384;

const userState = {};      
const activeGiveaways = {}; 
const deviceVotesRecord = {}; 

const getControlPanelKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Create Giveaway', 'menu_create')],
    [Markup.button.callback('🔒 Close Poll', 'menu_close')],
    [Markup.button.callback('📞 Support', 'menu_support')]
  ]);
};

const checkAdmin = (ctx) => {
  const userId = ctx.from?.id;
  if (userId !== ADMIN_USER_ID) {
    ctx.reply('❌ Access Denied.');
    return false;
  }
  return true;
};

bot.start(async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.reply('🤖 **Welcome to Giveaway Bot Control Panel**\n\nChoose an option below:', {
    parse_mode: 'Markdown',
    ...getControlPanelKeyboard()
  });
});

bot.action('menu_create', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'waiting_channel' };
  await ctx.reply('📢 **Enter the Target Channel Username** (e.g., @BHAICHARAGROUPP):', { parse_mode: 'Markdown' });
});

bot.action('menu_close', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  triggerCloseList(ctx);
});

bot.action('menu_support', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  await ctx.reply('📞 Users must join the official channel to vote, and strict 1 vote per device/user is enforced.');
});

const triggerCloseList = async (ctx) => {
  const activeIds = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active');
  if (activeIds.length === 0) {
    return ctx.reply('⚠️ No active giveaways found to close.', { parse_mode: 'Markdown' });
  }
  
  const buttons = activeIds.map(id => [Markup.button.callback(`🔒 Close: ${activeGiveaways[id].title}`, `close_${id}`)]);
  await ctx.reply('🔒 **Select active poll to close:**', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
};

bot.command('close', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  triggerCloseList(ctx);
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) return next();
  
  const text = ctx.message.text.trim();
  if (!userState[userId]) return next();
  const state = userState[userId];

  if (state.step === 'waiting_channel') {
    let targetChannel = text;
    if (!targetChannel.startsWith('@')) {
      targetChannel = '@' + targetChannel;
    }

    try {
      const chatMember = await ctx.telegram.getChatMember(targetChannel, ctx.botInfo.id);
      const isBotAdmin = ['administrator', 'creator'].includes(chatMember.status);
      
      if (!isBotAdmin) {
        return ctx.reply(`❌ Bot is not an Admin in *${targetChannel}*!\n\nPlease add this bot as an Admin in the channel first, then send the channel username again.`, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      return ctx.reply(`❌ Could not verify channel. Make sure the username is correct and the bot is added as an Admin.\n\nError: ${err.message}`);
    }

    state.channel = targetChannel;
    state.step = 'waiting_title';
    return ctx.reply(`✅ Channel verified: *${targetChannel}*\n\n📢 Now enter the Giveaway Title:`, { parse_mode: 'Markdown' });
  }

  if (state.step === 'waiting_title') {
    state.title = text;
    state.step = 'waiting_prize';
    return ctx.reply('🏆 Now enter the Prize Details:');
  }

  if (state.step === 'waiting_prize') {
    state.prize = text;
    state.step = 'waiting_nominees';
    return ctx.reply('👥 Enter Nominee Names line by line (e.g., Name 1\nName 2):');
  }

  if (state.step === 'waiting_nominees') {
    const options = text.split(/\r?\n/).map(opt => opt.trim()).filter(opt => opt.length > 0);
    if (options.length === 0) return ctx.reply('⚠️ Please provide valid nominees.');

    const channel = state.channel;
    const title = state.title;
    const prize = state.prize;

    delete userState[userId];
    const giveawayId = 'gw_' + Date.now();

    activeGiveaways[giveawayId] = {
      creatorId: userId,
      title: title,
      prize: prize,
      channel: channel,
      options: options.map(name => ({ name, votes: 0 })),
      status: 'active'
    };

    deviceVotesRecord[giveawayId] = {};
    const giveaway = activeGiveaways[giveawayId];

    const buttons = giveaway.options.map((opt, index) => {
      const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?gw=${giveawayId}&opt=${index}`;
      return [Markup.button.url(`🗳 ${opt.name} (0)`, verifyUrl)];
    });

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        giveaway.channel,
        `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click below to vote (Channel Join Required):**`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
      giveaway.messageId = sentMsg.message_id;
      return ctx.reply(`🎉 Giveaway posted successfully in *${giveaway.channel}*!`, { parse_mode: 'Markdown', ...getControlPanelKeyboard() });
    } catch (err) {
      delete activeGiveaways[giveawayId];
      return ctx.reply(`❌ Failed to post: ${err.message}`, getControlPanelKeyboard());
    }
  }
  return next();
});

bot.action(/^close_(gw_\d+)$/, async (ctx) => {
  if (!checkAdmin(ctx)) return;
  const giveawayId = ctx.match[1];
  const giveaway = activeGiveaways[giveawayId];
  if (!giveaway || giveaway.status !== 'active') {
    return ctx.answerCbQuery({ text: 'Poll already closed or not found!' });
  }

  giveaway.status = 'closed';

  const sortedOptions = [...giveaway.options].sort((a, b) => b.votes - a.votes);

  let resultText = `📊 **Poll Results: ${giveaway.title}**\n🏆 **Prize:** ${giveaway.prize}\n\n`;
  sortedOptions.forEach((opt, index) => {
    let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
    resultText += `${medal} **Rank ${index + 1}:** ${opt.name} — *${opt.votes} votes*\n`;
  });

  try {
    await bot.telegram.sendMessage(ADMIN_USER_ID, resultText, { parse_mode: 'Markdown' });
  } catch (err) {}

  try {
    await bot.telegram.editMessageText(
      giveaway.channel,
      giveaway.messageId,
      undefined,
      `🔒 **[CLOSED] ${giveaway.title}**\n\n❌ Voting has ended.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {}

  await ctx.answerCbQuery({ text: 'Poll Closed & Results Sent!' });
  await ctx.reply(`🔒 Giveaway "${giveaway.title}" closed successfully. Results sent to your chat.`);
});

const updateChannelPollMessage = async (gw) => {
  const giveaway = activeGiveaways[gw];
  if (!giveaway || !giveaway.messageId) return;

  const buttons = giveaway.options.map((opt, index) => {
    const verifyUrl = `https://rishumishra1775-glitch.github.io/telegram-giveaway-bots/?gw=${gw}&opt=${index}`;
    return [Markup.button.url(`🗳 ${opt.name} (${opt.votes})`, verifyUrl)];
  });

  try {
    await bot.telegram.editMessageText(
      giveaway.channel,
      giveaway.messageId,
      undefined,
      `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click below to vote (Channel Join Required):**`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
  } catch (e) {}
};

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
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { gw, opt, userId, deviceToken } = data;

        if (!deviceToken) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Device verification failed.' }));
          return;
        }

        const giveaway = activeGiveaways[gw];
        if (!giveaway || giveaway.status !== 'active' || giveaway.options[opt] === undefined) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Poll is closed or not found.' }));
          return;
        }

        // 1. Mandatory Channel Membership Check
        if (userId) {
          try {
            const chatMember = await bot.telegram.getChatMember(giveaway.channel, userId);
            const isMember = ['creator', 'administrator', 'member'].includes(chatMember.status);
            if (!isMember) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: `❌ You must join ${giveaway.channel} first to vote!` }));
              return;
            }
          } catch (e) {
            // If user ID cannot be verified, fallback or block securely
          }
        }

        if (!deviceVotesRecord[gw]) deviceVotesRecord[gw] = {};
        
        // 2. Strict Device + User Voting Check
        const uniqueKey = userId ? `${userId}_${deviceToken}` : deviceToken;
        if (deviceVotesRecord[gw][uniqueKey] || (userId && deviceVotesRecord[gw][String(userId)])) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'This device or account has already been used to vote!' }));
          return;
        }

        deviceVotesRecord[gw][uniqueKey] = true;
        if (userId) deviceVotesRecord[gw][String(userId)] = true;

        giveaway.options[opt].votes += 1;

        await updateChannelPollMessage(gw);

        const votedOption = giveaway.options[opt].name;
        try {
          await bot.telegram.sendMessage(
            ADMIN_USER_ID,
            `📥 **New Vote Recorded!**\n\n📋 **Poll:** ${giveaway.title}\n👤 **User ID:** \`${userId || 'Web User'}\`\n🗳 **Voted For:** *${votedOption}*\n📊 **Total Votes:** ${giveaway.options[opt].votes}`,
            { parse_mode: 'Markdown' }
          );
        } catch (err) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, votes: giveaway.options[opt].votes }));
        return;

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error processing vote.' }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Server active and listening!\n');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
