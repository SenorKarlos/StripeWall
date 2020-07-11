var bot;
const fs = require('fs');
const ini = require('ini');
const axios = require('axios');
const config = ini.parse(fs.readFileSync('./files/config.ini', 'utf-8'));
//------------------------------------------------------------------------------
//  VARIABLES
//------------------------------------------------------------------------------
const oauth2 = {
  "client_id": config.OAUTH2.client_id,
  "client_secret": config.OAUTH2.client_secret,
  "base_url": `https://discord.com/api/`,
  "oauth_url": `https://discord.com/oauth2/authorize`,
  "scope": config.OAUTH2.scope.replace(/,/g, ('%20')),
  //------------------------------------------------------------------------------
  //  FETCH ACCESS TOKEN
  //------------------------------------------------------------------------------
  fetchAccessToken: function(code) {
    return new Promise(async function(resolve) {
      let data = `client_id=${oauth2.client_id}&client_secret=${oauth2.client_secret}&grant_type=authorization_code&code=${code}&redirect_uri=${config.redirect_url}&scope=${oauth2.scope}`;
      let headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
      axios.post("https://discord.com/api/oauth2/token", data, {
        headers: headers
      }).then(async function(response) {
        return resolve(response.data);
      }).catch(error => {
        console.error("[Oauth2+Stripe] [oauth2.js]", error.response);
        return resolve(error);
      });
    });
  },
/*   refreshAccessToken: function(refresh_token) {
    let data = `client_id=${oauth2.client_id}&client_secret=${oauth2.client_secret}&grant_type=refresh_token&refresh_token=${refresh_token}&redirect_uri=${config.redirect_url}&scope=${oauth2.scope}`;
    let headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    axios.post("https://discord.com/api/oauth2/token", data, {
      headers: headers
    }).then(async function(response) {
      console.log("SUCCESSFULLY REFRESHED A TOKEN", response.data);
      return resolve(response.data);
    }).catch(error => {
      console.error("[Oauth2+Stripe] [oauth2.js]", error.response);
      return resolve(error);
    });
  }, */
  //------------------------------------------------------------------------------
  //  FETCH DISCORD USER
  //------------------------------------------------------------------------------
  fetchUser: function(access_token) {
    return new Promise(async function(resolve) {
      axios.get(oauth2.base_url + `v6/users/@me`, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${access_token}`
        }
      }).then(function(response) {
        return resolve(response.data);
      }).catch(error => {
        console.error;
        return resolve(error);
      });
    });
  },
  //------------------------------------------------------------------------------
  //  FETCH DISCORD USER'S GUILDS
  //------------------------------------------------------------------------------
  fetchUserGuilds: function(access_token) {
    return new Promise(function(resolve) {
      console.log("[" + bot.getTime('stamp') + "] [oauth2.js] ACCESS_TOKEN", access_token);
      axios.get(oauth2.base_url + `users/@me/guilds`, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${access_token}`
        }
      }).then(async function(response) {
        let guilds = [];
        await response.data.forEach((server, index) => {
          guilds.push(server.name + '|' + server.id);
        });
        return resolve(guilds);
      }).catch(error => {
        console.error('[' + bot.getTime('stamp') + '] [oauth2.js] Error fetching user guilds. Reason: `' + error.response.data.message + '`');
        return resolve('ERROR');
      });
    });
  },
  //------------------------------------------------------------------------------
  //  JOIN THE USER TO YOUR GUILD
  //------------------------------------------------------------------------------
  joinGuild: function(access_token, guild_id, user_id) {
    bot.users.fetch(user_id).then(async (user) => {
      let options = {
        'accessToken': access_token
      }
      bot.guilds.cache.get(config.guild_id).addMember(user, options);
      return 'success';
    });
  }
}

//------------------------------------------------------------------------------
//  EXPORT OAUTH2
//------------------------------------------------------------------------------
module.exports = oauth2;

// SCRIPT REQUIREMENTS
bot = require(__dirname + '/bot.js');