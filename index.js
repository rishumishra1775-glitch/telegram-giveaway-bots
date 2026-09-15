// Server ke upar active giveaways ke sath device records track karne ke liye
const deviceVotesRecord = {}; // { giveawayId: { deviceToken: true, ... } }

// POST /vote endpoint ke andar:
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

          // Check agar is device se pehle hi vote pad chuka hai (chahe id koi bhi ho)
          if (deviceVotesRecord[gw][deviceToken]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'This device has already been used to vote in this poll! Multiple IDs from same device are not allowed.' }));
            return;
          }

          // Check agar yeh Telegram ID pehle use ho chuki hai
          const voterId = String(userId);
          if (userVotesRecord[gw][voterId]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'You have already voted using this Telegram account!' }));
            return;
          }

          // Dono record lock kar do
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
        res.end(JSON.stringify({ success: false, message: 'Server error.' }));
      }
    });
    return;
  }
