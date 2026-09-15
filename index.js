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
const userVotesRecord = {}; 
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
  userState[ctx.from.id] = { step: 'waiting_title' };
  await ctx.reply('📢 Enter the Giveaway Title:');
});

bot.action('menu_close', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  await ctx.reply('Send /close to close active polls.');
});

bot.action('menu_support', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  await ctx.reply('📞 Each device is restricted to a single vote per giveaway.');
});

bot.command('close', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  let activeIds = Object.keys(activeGiveaways).filter(id => activeGiveaways[id].status === 'active');
  if (activeIds.length === 0) {
    return ctx.reply('⚠️ No active giveaways found to close.');
  }
  
  const buttons = activeIds.map(id => [Markup.button.callback(`🔒 Close: ${activeGiveaways[id].title}`, `close_${id}`)]);
  await ctx.reply('Select the giveaway you want to close:', Markup.inlineKeyboard(buttons));
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

    delete userState[userId];
    const giveawayId = 'gw_' + Date.now();
    const defaultChannel = '@BHAICHARAGROUPP';

    activeGiveaways[giveawayId] = {
      creatorId: userId,
      title: state.title,
      prize: state.prize,
      channel: defaultChannel,
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

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        giveaway.channel,
        `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click below to vote:**`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
      giveaway.messageId = sentMsg.message_id;
      return ctx.reply('🎉 Giveaway posted successfully!', getControlPanelKeyboard());
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
  if (!giveaway) return ctx.answerCbQuery({ text: 'Poll not found!' });

  giveaway.status = 'closed';
  await ctx.answerCbQuery({ text: 'Poll Closed Successfully!' });
  await ctx.reply(`🔒 Giveaway "${giveaway.title}" has been closed.`);
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

        if (activeGiveaways[gw] && activeGiveaways[gw].status === 'active' && activeGiveaways[gw].options && activeGiveaways[gw].options[opt] !== undefined) {
          if (!deviceVotesRecord[gw]) deviceVotesRecord[gw] = {};
          
          if (deviceVotesRecord[gw][deviceToken]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'This device has already been used to vote!' }));
            return;
          }

          deviceVotesRecord[gw][deviceToken] = true;
          activeGiveaways[gw].options[opt].votes += 1;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, votes: activeGiveaways[gw].options[opt].votes }));
          return;
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Poll is closed or not found.' }));
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
  res.end('Server active and listening!\n');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
