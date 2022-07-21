var stripe, bot, oauth2;
const mysql = require('mysql');
const moment = require('moment');
const config = require("../files/config.json");
const object = {
  // DATABASE CONNECTION
  db: mysql.createPool({
    connectionLimit: 100,
    host: config.database.host,
    user: config.database.username,
    password: config.database.password,
    port: config.database.port,
    database: config.database.name
  }),
  //------------------------------------------------------------------------------
  //  RUN QUERY FUNCTION
  //------------------------------------------------------------------------------
  runQuery: function(query, data, success) {
    return new Promise(function(resolve) {
      object.db.query(query, data, function(err, user, fields) {
        if (err) {
          console.info(err);
          return resolve(false);
        } else if (success) {
          console.info(success);
          return resolve(true);
        } else {
          return resolve(true);
        }
      });
    });
  },
  //------------------------------------------------------------------------------
  //  USER TABLE FETCH
  //------------------------------------------------------------------------------
  fetchUser: function(user_id) {
    return new Promise(function(resolve) {
      let query = `SELECT * FROM stripe_users WHERE user_id = ?`;
      let data = [user_id];
      object.db.query(query, data, async function(err, record, fields) {
        if (err) {
          return console.info(err);
        } else if (record[0]) {
          return resolve(record[0]);
        } else {
          return resolve(null);
        }
      });
    });
  },
  //------------------------------------------------------------------------------
  //  STRIPE USER TABLE FETCH
  //------------------------------------------------------------------------------
  fetchStripeUser: function(user_id, stripe_id) {
    return new Promise(function(resolve) {
      let query = `SELECT * FROM stripe_users WHERE user_id = ? AND stripe_id = ?`;
      let data = [user_id, stripe_id];
      object.db.query(query, data, async function(err, record, fields) {
        if (err) {
          return console.info(err);
        } else if (record[0]) {
          return resolve(record[0]);
        } else {
          return resolve(null);
        }
      });
    });
  },
  //------------------------------------------------------------------------------
  //  MAINTENANCE ROUTINES (DATABASE)
  //------------------------------------------------------------------------------
  checkDetails: async function() {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Starting Discord Info Sync.");
    let unix = moment().unix();
    let query = `SELECT * FROM stripe_users WHERE user_id != ?`;
    let data = ['NULL'];
    await object.db.query(query, data, async function(err, records, fields) {
      if (err) {
        console.info(err);
      }
      if (records) {
        console.info("["+bot.getTime("stamp")+"] [database.js] Checking for Discord profile updates and Stripe ID validity on "+records.length+" Database Users.");
        records.forEach((user, index) => {
          let indexcounter = index + 1;
          setTimeout(async function() {
            let member = bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.user_id);
            let customer;
            let db_updated = false;
            if (user.stripe_id) {
              try {
                customer = await stripe.customer.fetch(user.stripe_id); // fetch customer because stripe list only returns active users
              } catch (e) {
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Stripe record.", e);
              }
              if (!customer || customer.deleted == true) {
                let query = `UPDATE stripe_users SET stripe_id = NULL, price_id = NULL, temp_plan_expiration = NULL WHERE user_id = ?`;
                let data = [user.user_id];
                object.runQuery(query, data);
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Stripe Customer ID Invalid/Deleted, removed from Database Record.");
              }
            }
            if (!member) {
              if (user.access_token != "Left Guild") {
                member = user;
                member.nickname = user.user_name;
                member.user = [];
                member['user']['id'] = user.user_id;
                if (user.stripe_id) { customer = await stripe.customer.fetch(user.stripe_id); }
                if (customer && customer.subscriptions.data[0]) { // they have some sub data
                  for (let x = 0; x < customer.subscriptions.data.length; x++) { //for each sub
                    await stripe.subscription.cancel(member, customer.subscriptions.data[x].id); //cancel each sub
                  }
                }
                let query = `UPDATE stripe_users SET price_id = NULL, temp_plan_expiration = NULL, access_token = 'Left Guild', refresh_token = NULL WHERE user_id = ?`;
                let data = [user.user_id];
                await object.runQuery(query, data);
                if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Member Left Guild. Deleted Tokens.");
                bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Deleted Tokens.', config.discord.log_channel);
                if (indexcounter === records.length) { return object.doneDetails(); } else { return; }
              } else {
                if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Not a Guild member.");
                if (indexcounter === records.length) { return object.doneDetails(); } else { return; }
              }
            }
            let data = {};
            if (user.access_token && user.access_token != 'Left Guild' || user.refresh_token) {
              if (!user.token_expiration) { user.token_expiration = unix -1 }
              if (!user.access_token || unix > user.token_expiration) {
                try {
                  data = await oauth2.refreshAccessToken(user.refresh_token, user);
                  if (data.response) {
                    throw data.response;
                  }
                } catch (e) {
                  if (e.status === 400) {
                    let query = `UPDATE stripe_users SET access_token = NULL, refresh_token = NULL, token_expiration = NULL WHERE user_id = ?`;
                    let data = [member.id];
                    await object.runQuery(query, data);
                    if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to refresh Discord token, cleared Tokens.");
                    if (indexcounter === records.length) { return object.doneDetails(); } else { return; }
                  } else {
                    if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to refresh Discord token.", e);
                    if (indexcounter === records.length) { return object.doneDetails(); } else { return; }
                  }
                }
              } else { data.access_token = user.access_token; }
              let discord;
              try {
                discord = await oauth2.fetchUser(data.access_token);
                if (discord.response) {
                  throw discord.response;
                }
              } catch (e) {
                if (e.status === 401) {
                  let query = `UPDATE stripe_users SET access_token = NULL, refresh_token = NULL, token_expiration = NULL WHERE user_id = ?`;
                  let data = [member.id];
                  await object.runQuery(query, data);
                  if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Discord information, cleared Tokens.");
                  if (indexcounter === records.length) { return object.doneDetails(); } else { return; }
                } else {
                  if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Discord information.", e);
                  if (indexcounter === records.length) { return object.doneDetails(); } else { return; }
                }
              }
              if (discord.id != user.user_id) { // check if token pulled right ID result, log and alert if not
                if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User Fetch resulted in ID mismatch, Administration should investigate (Discord Check).");
                let member;
                try {
                  member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.user_id);
                } catch (e) {
                  console.info(e);
                  member = user;
                  member.nickname = user.user_name;
                  member.user = [];
                  member['user']['id'] = user.user_id;
                }
                bot.sendEmbed(member, 'FF0000', 'User Fetch resulted in ID mismatch ⚠', 'Administration should investigate (Discord Check)', config.discord.log_channel);
                if (indexcounter === records.length) { return object.doneDetails(); }
              } else { // end ID/Token result mismatch
                if (discord.username != user.user_name || discord.email != user.email) {
                  let query = `UPDATE stripe_users SET user_name = ?, email = ? WHERE user_id = ?`;
                  let data = [discord.username, discord.email, user.user_id]
                  object.runQuery(query, data);
                  db_updated = true;
                } // end detail mismatch
                if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                if (db_updated) {
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Updated Database details.");
                  if (indexcounter === records.length) { return object.doneDetails(); }
                } else {
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Verified Database details.");
                  if (indexcounter === records.length) { return object.doneDetails(); }
                }
              } // end ID/Token result match
            } else { // end access and refresh token found
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User has no Tokens, unable to fetch updates from Discord.");
              if (indexcounter === records.length) { return object.doneDetails(); }
            }
          }, 1000 * index);
        }); //end for each user record
      } else { //end if records returned
        console.info("["+bot.getTime("stamp")+"] [database.js] Database Empty, nothing to sync.");
        return object.doneDetails();
      } // move to next stage if no records
    }); //end query all db users
  },
  doneDetails: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Discord Info Sync complete.");
    return stripe.customer.list();
  },
  checkDatabase: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Starting Database Checks.");
    let unix = moment().unix();
    let query = `SELECT * FROM stripe_users WHERE manual != ?`;
    let data = ['true'];
    await object.db.query(query, data, async function(err, records, fields) {
      if (err) {
        console.info(err);
      }
      if (records) {
        console.info("["+bot.getTime("stamp")+"] [database.js] Checking "+records.length+" Database Users.");
        records.forEach((user, index) => {
          let indexcounter = index + 1;
          setTimeout(async function() {
            let member = bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.user_id);
            let customer = '';
            if (member) {                                                // if in the guild
              for (let i = 0; i < config.stripe.price_ids.length; i++) { // check each config price id
                if (member.roles.cache.has(config.stripe.price_ids[i].role_id)) { // they have a role matching the price being checked
                  if (!user.stripe_id || user.price_id != config.stripe.price_ids[i].id || user.temp_plan_expiration && user.temp_plan_expiration < unix) { // they don't have a stripe id or the registered price isn't correct or expired
                    bot.removeRole(member.id, config.stripe.price_ids[i].role_id);
                    if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") found without a Subscription. Removed Role."); // remove and log
                    bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Role. (Internal Check)', config.discord.log_channel);
                    if (indexcounter === records.length) { return object.doneDatabase(); } else { return; }
                  } else {
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") is Verified in Discord Role.");
                    if (indexcounter === records.length) { return object.doneDatabase(); } else { return; }
                  }
                } else if (user.stripe_id && user.price_id) { // end if member role matches config role (no role but they have a stripe & price ID)
                  if (config.stripe.price_ids[i].mode != 'payment' && user.price_id == config.stripe.price_ids[i].id) { // stripe-checked db subscription or legacy price matches price being checked
                    bot.assignRole(member.id, config.stripe.price_ids[i].role_id);
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User found without Role, Assigned.");
                    bot.sendEmbed(member, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                    if (indexcounter === records.length) { return object.doneDatabase(); } else { return; }
                  } else if (config.stripe.price_ids[i].mode == 'payment' && user.price_id == config.stripe.price_ids[i].id) { // check for one-time purch roles
                    if (user.temp_plan_expiration > unix) { //check if expired
                      bot.assignRole(member.id, config.stripe.price_ids[i].role_id); // add & log
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  One-Time User found without Role, Assigned.");
                      bot.sendEmbed(member, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                      if (indexcounter === records.length) { return object.doneDatabase(); } else { return; }
                    } else { // give role if clear, remove price and expiry if not
                      let query = `UPDATE stripe_users SET price_id = NULL, temp_plan_expiration = NULL WHERE user_id = ?`;
                      let data = [member.id];
                      await object.runQuery(query, data);
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  One-Time User expired, cleared price and expiry.");
                      bot.sendEmbed(member, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                      if (indexcounter === records.length) { return object.doneDatabase(); } else { return; }
                    } // end expiry check
                  } // end check one-time purch record
                } // end if user has stripe & price id
              } // end for each price in config
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") doesn't need and has no Discord Role.");
              if (indexcounter === records.length) { return object.doneDatabase(); }
            } else { //end if guild member
              if (user.access_token != "Left Guild") {
                member = user;
                member.nickname = user.user_name;
                member.user = [];
                member['user']['id'] = user.user_id;
                if (user.stripe_id) { customer = await stripe.customer.fetch(user.stripe_id); }
                if (customer && customer.subscriptions.data[0]) { // they have some sub data
                  for (let x = 0; x < customer.subscriptions.data.length; x++) { //for each sub
                    await stripe.subscription.cancel(member, customer.subscriptions.data[x].id); //cancel each sub
                  }
                }
                let query = `UPDATE stripe_users SET price_id = NULL, temp_plan_expiration = NULL, access_token = 'Left Guild', refresh_token = NULL WHERE user_id = ?`;
                let data = [user.user_id];
                await object.runQuery(query, data);
                if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Member Left Guild. Deleted Tokens and Guild Association.");
                bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Deleted Tokens and Guild Association.', config.discord.log_channel);
                if (indexcounter === records.length) { return object.doneDatabase(); }
              } else {
                if (!user.stripe_id) { user.stripe_id = "Not Found"; }
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Not a Guild member.");
                if (indexcounter === records.length) { return object.doneDatabase(); }
              }
            } // end not guild member
          }, 1000 * index);
        }); //end for each user record
      } //end if records returned
    }); //end query all db users except Manual
  },
  doneDatabase: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Database checks complete, proceeding to role checks.");
    return object.getRoleMembers();
  },
  getRoleMembers: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Starting Discord Role Maintenance.");
    console.info("["+bot.getTime("stamp")+"] [database.js] Checking "+config.stripe.price_ids.length+" Roles.");
    let roleArray = [];
    let delayArray = [0];
    for (let i = 0; i < config.stripe.price_ids.length; i++) { //for each price
      setTimeout(function() {
        let guild = bot.guilds.cache.get(config.discord.guild_id); // pull guild info
        let members = guild.roles.cache.find(role => role.id === config.stripe.price_ids[i].role_id).members.map(m => m); // map role members from price
        roleArray.push(members);
        let timer = members.length * 1000;
        if (timer == 0) { timer = 1000; }
        timer = timer + delayArray[i];
        delayArray.push(timer);
        console.info("["+bot.getTime("stamp")+"] [database.js] "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
        if (i === config.stripe.price_ids.length - 1) { return object.checkRoles(roleArray, delayArray); }
      }, 500 * i);
    }
  },
  checkRoles: async function(roleArray, delayArray) {
    let unix = moment().unix();
    roleArray.forEach((members, i) => {
      setTimeout(function() {
        if (members.length == 0) {
          console.info("["+bot.getTime("stamp")+"] [database.js] "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
          if (i === config.stripe.price_ids.length - 1) { return object.doneRoles(); }
        } else {
          console.info("["+bot.getTime("stamp")+"] [database.js] Checking "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
        }
        members.forEach((member, index) => { //for each member in role
          let indexcounter = index + 1;
          setTimeout(function() {
            let query = `SELECT * FROM stripe_users WHERE user_id = ?`;
            let data = [member.id];
            object.db.query(query, data, async function(err, record, fields) { // pull DB record
              if (err) {
                return console.info(err);
              }
              if (record) { //record found
                if (record[0].manual == 'true') { // skip life/manual
                  if (!record[0].stripe_id) { record[0].stripe_id = "Not Found"; }
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") Manually tracked or Lifetime User, Skipping.");
                  if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.doneRoles(); }
                } else if (!record[0].stripe_id) { // no stripe id remove
                  bot.removeRole(member.id, config.stripe.price_ids[i].role_id);
                  record[0].stripe_id = "Not Found";
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") User found without a Stripe ID, Removed Role.");
                  bot.sendEmbed(member, 'FF0000', 'User found without a Stripe ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                  if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.doneRoles(); }
                } else if (!record[0].price_id || config.stripe.price_ids[i].mode == 'payment' && record[0].temp_plan_expiration < unix) { //no price or temp plan expired remove
                  bot.removeRole(member.id, config.stripe.price_ids[i].role_id);
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") User found expired or without a Price ID, Removed Role.");
                  bot.sendEmbed(member, 'FF0000', 'User found expired or without a Price ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                  if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.doneRoles(); }
                }
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") User is verified in Role "+config.stripe.price_ids[i].role_id+".");
              if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.doneRoles(); }
              } else { // not in db
                bot.removeRole(member.id, config.stripe.price_ids[i].role_id);
                bot.sendEmbed(member, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.discord.log_channel);
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) Not in Database, removed Role.");
                if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.doneRoles(); }
              }
            });
          }, 1000 * index);
        });
      }, delayArray[i]);
    });
  },
  doneRoles: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Role checks complete");
    return console.info("["+bot.getTime("stamp")+"] [database.js] Maintenance routines complete.");
  }
}

// EXPORT OBJECT
module.exports = object;

// SCRIPT REQUIREMENTS
stripe = require(__dirname+'/stripe.js');
bot = require(__dirname+'/bot.js');
oauth2 = require(__dirname+'/oauth2.js');