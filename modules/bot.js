const moment = require('moment');
const Discord = require('discord.js');
const eventsToDisable = ["PRESENCE_UPDATE", "VOICE_STATE_UPDATE", "TYPING_START", "VOICE_SERVER_UPDATE"];
const bot = new Discord.Client({
  disabledEvents: eventsToDisable,
  messageCacheMaxSize: 1,
  messageCacheLifetime: 1,
  messageSweepInterval: 1
});
const config = require("../config/config.json");
//------------------------------------------------------------------------------
//  TIME FUNCTION
//------------------------------------------------------------------------------
bot.getTime = (type) => {
  switch(type){
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
bot.sendEmbed = (username, user_id, color, title, body, channel_id) => {
  let embed = new Discord.MessageEmbed()
    .setColor(color)
    .setAuthor(username+' ('+user_id+')')
    .setTitle(title)
    .setDescription(body)
    .setFooter(config.server.site_name+' | '+bot.getTime('full'));
  return bot.channels.cache.get(channel_id).send(embed).catch(err => {
    console.info('['+bot.getTime('stamp')+'] [bot.js] Unable to Send Channel Message.', err);
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
    .setFooter(config.server.site_name+' | '+bot.getTime('full'));
  bot.guilds.cache.get(config.discord.guild_id).members.fetch(member.user.id).then(TARGET => {
    return TARGET.send(embed).catch(err => {
      if (err) {
        console.info('['+bot.getTime('stamp')+'] [bot.js] Unable to Send Direct Message.', err);
      }
    });
  });
}
//------------------------------------------------------------------------------
//  ASSIGN ROLE TO A MEMBER
//------------------------------------------------------------------------------
bot.assignRole = (server_id, user_id, role_id) => {
  let member = bot.guilds.cache.get(server_id).members.cache.get(user_id);
  console.info('['+bot.getTime('stamp')+'] [bot.js] '+member.user.tag+' Requires Role: '+role_id);
  if (!member) {
    console.info('['+bot.getTime('stamp')+'] [bot.js] Unable to Assign the User a role.');
    return false;
  } else if (!member.roles.cache.has(role_id)) {
    member.roles.add(role_id);
    console.info('['+bot.getTime('stamp')+'] [bot.js] Assigned the User a role.');
    return true;
  } else {
    console.info('['+bot.getTime('stamp')+'] [bot.js] User already has role.');
    return false;
  }
}
//------------------------------------------------------------------------------
//  REMOVE ROLE FROM A MEMBER
//------------------------------------------------------------------------------
bot.removeRole = (server_id, user_id, role_id) => {
  let member = bot.guilds.cache.get(server_id).members.cache.get(user_id);
  console.info('['+bot.getTime('stamp')+'] [bot.js] '+member.user.tag+' Requires Role Removal: '+role_id);
  if (!member) {
    console.info('['+bot.getTime('stamp')+'] [bot.js] Unable to remove the role from the User.');
    return false;
  } else if (member.roles.cache.has(role_id)) {
    member.roles.remove(role_id);
    console.info('['+bot.getTime('stamp')+'] [bot.js] Removed the role from the User.');
    return true;
  } else {
    console.info('['+bot.getTime('stamp')+'] [bot.js] User does not have role.');
    return false;
  }
}
//------------------------------------------------------------------------------
//  CONFIRM BOT IS ONLINE AND SET STATUS
//------------------------------------------------------------------------------
bot.blacklisted = [];
bot.on('ready', () => {
  console.info('['+bot.getTime('stamp')+'] [bot.js] The bot ('+bot.user.tag+') has initialized.');
  bot.blacklisted = config.discord.blacklist;
  if (bot.blacklisted.length > 0) {
    console.info('['+bot.getTime('stamp')+'] [bot.js] Loaded '+bot.blacklisted.length+' blacklisted user(s) from the config.');
  }
  if (config.discord.fetch_bans == true) {
    bot.guilds.cache.get(config.discord.guild_id).fetchBans().then(bans => {
      console.info('['+bot.getTime('stamp')+'] [bot.js] Fetched '+bans.size+' ban(s) for the blacklist.');
      bans.map(u => u.user.id).forEach(id => {
        bot.blacklisted.push(id);
      });
    }).catch(console.info);
  }
  if (config.sync.on_startup) {
    console.info("["+bot.getTime("stamp")+"] [bot.js] Starting Maintenance Routines.");
    database.checkDetails();
  }
  return bot.user.setActivity(config.discord.status_text, {
    type: config.discord.status_type
  });
});
//------------------------------------------------------------------------------
//  LOGIN THE BOT
//------------------------------------------------------------------------------
console.info('['+bot.getTime('stamp')+'] [bot.js] Starting up the bot...');
bot.login(config.discord.bot_token);
//------------------------------------------------------------------------------
//  EXPORT BOT
//------------------------------------------------------------------------------
module.exports = bot;