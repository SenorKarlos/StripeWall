var bot;
const axios = require('axios');
const config = require("../files/config.json");
//------------------------------------------------------------------------------
//  VARIABLES
//------------------------------------------------------------------------------
const oauth2 = {
  "client_id": config.oauth2.client_id,
  "client_secret": config.oauth2.client_secret,
  "base_url": `https://discord.com/api/`,
  "oauth_url": `https://discord.com/oauth2/authorize`,
  "scope": config.oauth2.scope.replace(/,/g, ('%20')),
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
        console.error("["+bot.getTime('stamp')+"] [oauth2.js]", error.response);
        return resolve(error);
      });
    });
  },
  //------------------------------------------------------------------------------
  //  FETCH ACCESS TOKEN
  //------------------------------------------------------------------------------
  refreshAccessToken: function(refresh_token, user) {
    let data = `client_id=${oauth2.client_id}&client_secret=${oauth2.client_secret}&grant_type=refresh_token&refresh_token=${refresh_token}&redirect_uri=${config.redirect_url}&scope=${oauth2.scope}`;
    let headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    axios.post("https://discord.com/api/oauth2/token", data, {
      headers: headers
    }).then(async function(response) {
      console.log("[oauth2.js] Successfully Refreshed a Token", response.data);
      let token_expiration = (unix_now + response.data.expires_in);
      database.runQuery(`UPDATE IGNORE stripe_users SET access_token = ?, refresh_token = ?, token_expiration = ?, last_updated = ? WHERE user_id = ?`, [response.data.access_token, response.data.refresh_token, token_expiration, unix_now, user.user_id]);
      console.info('['+bot.getTime('stamp')+'] [oauth2.js] '+user.user_name+' ('+user.user_id+') Updated Discord OAuth2 info in Database.');
      return resolve(response.data);
    }).catch(error => {
      console.error("["+bot.getTime('stamp')+"] [oauth2.js]", error.response);
      return resolve(error);
    });
  },
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
        console.error("[oauth2.js]", error.response);
        return resolve(error);
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
database = require(__dirname + '/database.js');
bot = require(__dirname + '/bot.js');