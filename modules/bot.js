const moment = require('moment');
const Discord = require('discord.js');
const eventsToDisable = ["PRESENCE_UPDATE", "VOICE_STATE_UPDATE", "TYPING_START", "VOICE_SERVER_UPDATE"];
const bot = new Discord.Client({
  disabledEvents: eventsToDisable,
  messageCacheMaxSize: 1,
  messageCacheLifetime: 1,
  messageSweepInterval: 1
});
const config = require("../files/config.json");
//------------------------------------------------------------------------------
//  TIME FUNCTION
//------------------------------------------------------------------------------
bot.getTime = (type) => {
  switch (type) {
    case 'full':
      return moment().format('dddd, MMMM Do, h:mm A');
    case 'stamp':
      return moment().format('HH:mmA');
    case 'short':
      return moment().format('DD-MMM-YYYY h:mm A');
  }
}
//------------------------------------------------------------------------------
//  SEND EMBED FUNCTION
//------------------------------------------------------------------------------
bot.sendEmbed = (member, color, title, body, channel_id, title2, body2) => {
  if (!member.nickname) {
    nickname = member.user.username;
  } else {
    nickname = member.nickname;
  }

  let embed = new Discord.MessageEmbed()
    .setColor(color)
    .setAuthor(nickname + ' (' + member.user.id + ')', member.user.displayAvatarURL)
    .setTitle(title)
    .setDescription(body)
    .setFooter(config.map_name + ' | ' + bot.getTime('full'));
  console.log(body2);
  if (body2 && body2.partial && body2.full) {
    embed.addField("IP & Fingerprint Matches", body2.full, false);
    embed.addField("Fingerprint Matches", body2.partial, false);
  } else if (body2 && body2.partial) {
    embed.addField("Fingerprint Matches", body2.partial, false);
  } else if (title2) {
    embed.addField(title2, body2, false);
  }

  return bot.channels.cache.get(channel_id).send(embed).catch(err => {
    console.error('[' + bot.getTime('stamp') + '] [bot.js] Unable to Send Channel Message.', err);
  });
}
//------------------------------------------------------------------------------
//  SEND DM TO A USER
//------------------------------------------------------------------------------
bot.sendDM = (member, title, body, color) => {
  let embed = new Discord.MessageEmbed()
    .setColor(color)
    .setTitle(title)
    .setDescription(body)
    .setFooter(config.map_name + ' | ' + bot.getTime('full'));
  bot.guilds.cache.get(config.guild_id).members.fetch(member.id).then(TARGET => {
    return TARGET.send(embed).catch(error => {
      if (error) {
        console.error('[Send_DM]', error);
      }
    });
  });
}
//------------------------------------------------------------------------------
//  ASSIGN DONOR ROLE TO A MEMBER
//------------------------------------------------------------------------------
bot.assignDonor = (user_id) => {
  let member = bot.guilds.cache.get(config.guild_id).members.cache.get(user_id);
  console.log('[' + bot.getTime('stamp') + '] [bot.js] ' + member.user.tag + ' has Donor Role: ' + member.roles.cache.has(config.donor_role_id));
  if (!member) {
    console.error('[' + bot.getTime('stamp') + '] [bot.js] Unable to Assign the User a donor role.');
    return false;
  } else if (!member.roles.cache.has(config.donor_role_id)) {
    member.roles.add(config.donor_role_id);
    console.error('[' + bot.getTime('stamp') + '] [bot.js] Assigned the User a donor role.');
    return true;
  } else {
    return false;
  }
}
//------------------------------------------------------------------------------
//  REMOVE DONOR ROLE FROM A MEMBER
//------------------------------------------------------------------------------
bot.removeDonor = (user_id) => {
  let member = bot.guilds.cache.get(config.guild_id).members.cache.get(user_id);
  console.log('[bot.js] [removeDonor] ' + member.user.tag + ' has Donor Role: ' + member.roles.cache.has(config.donor_role_id));
  if (!member) {
    console.error('[' + bot.getTime('stamp') + '] [bot.js] Unable to Remove the donor role from the User.');
    return false;
  } else if (member.roles.cache.has(config.donor_role_id)) {
    member.roles.remove(config.donor_role_id);
    console.error('[' + bot.getTime('stamp') + '] [bot.js] Removed the donor role from the User.');
    return true;
  } else {
    return false;
  }
}
//------------------------------------------------------------------------------
//  CONFIRM BOT IS ONLINE AND SET STATUS
//------------------------------------------------------------------------------
bot.on('ready', () => {
  console.info('[' + bot.getTime('stamp') + '] [bot.js] The bot (' + bot.user.tag + ') has initialized.');
  if (config.blacklist) {
    bot.blacklisted = config.blacklist.split(',');
  } else {
    bot.blacklisted = [];
  }
  if (bot.blacklisted.length > 0) {
    console.log('[' + bot.getTime('stamp') + '] [bot.js] Loaded ' + bot.blacklisted.length + ' blacklisted users from the config.');
  }
  if (config.fetch_bans == true) {
    bot.guilds.cache.get(config.guild_id).fetchBans()
      .then(bans => {
        console.log('[' + bot.getTime('stamp') + '] [bot.js] Fetched ' + bans.size + ' bans for the blacklist.');
        bans.map(u => u.id).forEach(id => {
          bot.blacklisted.push(id);
        });
      }).catch(console.error);
  }
  return bot.user.setActivity(config.map_url.slice(8, 50), {
    type: 'WATCHING'
  });
});
//------------------------------------------------------------------------------
//  LOGIN THE BOT
//------------------------------------------------------------------------------
console.info('[' + bot.getTime('stamp') + '] [bot.js] Starting up the bot...');
bot.login(config.OAUTH2.bot_token);
//------------------------------------------------------------------------------
//  EXPORT BOT
//------------------------------------------------------------------------------
module.exports = bot;