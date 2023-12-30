var bot;
const axios = require('axios');
const moment = require('moment');
const config = require("../config/config.json");
//------------------------------------------------------------------------------
//  VARIABLES
//------------------------------------------------------------------------------
const oauth2 = {
  "client_id": config.discord.client_id,
  "client_secret": config.discord.client_secret,
  "base_url": `https://discord.com/api/`,
  "oauth_url": `https://discord.com/oauth2/authorize`,
  "scope": "identify%20guilds%20guilds.join%20email",
//------------------------------------------------------------------------------
//  FETCH ACCESS TOKEN
//------------------------------------------------------------------------------
  fetchAccessToken: async function(code) {
      let data = `client_id=${oauth2.client_id}&client_secret=${oauth2.client_secret}&grant_type=authorization_code&code=${code}&redirect_uri=${config.discord.redirect_url}&scope=${oauth2.scope}`;
      let headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
      axios.post("https://discord.com/api/oauth2/token", data, {
        headers: headers
      }).then(async function(response) {
        return response.data;
      }).catch(error => {
        return error;
      });
  },
//------------------------------------------------------------------------------
//  REFRESH ACCESS TOKEN
//------------------------------------------------------------------------------
  refreshAccessToken: async function(refresh_token, user) {
      let unix = moment().unix();
      let data = `client_id=${oauth2.client_id}&client_secret=${oauth2.client_secret}&grant_type=refresh_token&refresh_token=${refresh_token}&redirect_uri=${config.discord.redirect_url}&scope=${oauth2.scope}`;
      let headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
      axios.post("https://discord.com/api/oauth2/token", data, {
        headers: headers
      }).then(async function(response) {
        console.info('['+bot.getTime('stamp')+'] [oauth2.js] Successfully Refreshed a Token', response.data);
        let token_expiration = (unix+response.data.expires_in);
        database.runQuery('UPDATE stripe_users SET access_token = ?, refresh_token = ?, token_expiration = ? WHERE user_id = ?', [response.data.access_token, response.data.refresh_token, token_expiration, user.user_id]);
        console.info('['+bot.getTime('stamp')+'] [oauth2.js] '+user.user_name+' ('+user.user_id+') Updated Discord OAuth2 info in Database.');
        return response.data;
      }).catch(error => {
        return error;
      });
  },
//------------------------------------------------------------------------------
//  FETCH DISCORD USER
//------------------------------------------------------------------------------
  fetchUser: async function(access_token) {
      axios.get(oauth2.base_url+`v6/users/@me`, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${access_token}`
        }
      }).then(function(response) {
        return response.data;
      }).catch(error => {
        return error;
      });
  },
//------------------------------------------------------------------------------
//  JOIN THE USER TO A GUILD
//------------------------------------------------------------------------------
  joinGuild: async function(access_token, guild_id, user_id) {
    bot.users.fetch(user_id).then(async (user) => {
      let options = {
        'accessToken': access_token
      }
      bot.guilds.cache.get(guild_id).addMember(user, options);
      return 'success';
    });
  }
}

//------------------------------------------------------------------------------
//  EXPORT OAUTH2
//------------------------------------------------------------------------------
module.exports = oauth2;

// SCRIPT REQUIREMENTS
database = require(__dirname+'/database.js');
bot = require(__dirname+'/bot.js');