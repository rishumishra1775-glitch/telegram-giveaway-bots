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
  { command: 'create', description: 'Create New Giveaway' },
  { command: 'close', description: 'Close Active Poll' },
  { command: 'restart', description: 'Reset Session' }
]);

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
    ctx.reply('❌ Access Denied: You are not authorized.');
    return false;
  }
  return true;
};

bot.start(async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.reply('Welcome! Choose an option:', getControlPanelKeyboard());
});

bot.command('restart', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  delete userState[ctx.from.id];
  await ctx.reply('🔄 Session reset successfully!');
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
  await ctx.reply('Send /close to manage active polls.');
});

bot.action('menu_support', async (ctx) => {
  if (!checkAdmin(ctx)) return;
  await ctx.answerCbQuery();
  await ctx.reply('📞 Each device is restricted to a single vote.');
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
    return ctx.reply('👥 Enter Nominee Names (line by line):');
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
    buttons.push([Markup.button.callback('🔒 Close Poll', `close_${giveawayId}`)]);

    try {
      const sentMsg = await ctx.telegram.sendMessage(
        giveaway.channel,
        `🎁 **${giveaway.title}**\n\n🏆 **Prize:** ${giveaway.prize}\n\n👇 **Click below to vote:**`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
      giveaway.messageId = sentMsg.message_id;
      return ctx.reply(`🎉 Giveaway posted successfully!`);
    } catch (err) {
      delete activeGiveaways[giveawayId];
      return ctx.reply(`❌ Failed to post: ${err.message}`);
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
  await ctx.answerCbQuery({ text: 'Closed!' });
  await ctx.reply('🔒 Poll closed.');
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

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Server active!\n');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
