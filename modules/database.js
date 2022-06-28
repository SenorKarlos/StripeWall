var stripe, bot, oauth2;
const mysql = require('mysql');
const moment = require('moment');
const config = require("../files/config.json");
const object = {
  // DATABASE CONNECTION
  db: mysql.createPool({
    connectionLimit: 100,
    host: config.db_host,
    user: config.db_username,
    password: config.db_password,
    port: config.db_port,
    database: config.db_name
  }),

  //------------------------------------------------------------------------------
  //  RUN QUERY FUNCTION
  //------------------------------------------------------------------------------
  runQuery: function(query, data, success) {
    return new Promise(function(resolve) {
      object.db.query(query, data, function(err, user, fields) {
        if (err) {
          console.error(err);
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
          return console.error(err);
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
          return console.error(err);
        } else if (record[0]) {
          return resolve(record[0]);
        } else {
          return resolve(null);
        }
      });
    });
  },
  //------------------------------------------------------------------------------
  //  DONOR CHECK
  //------------------------------------------------------------------------------
  checkDonors: async function() {
    console.info("[database.js] Starting user check.")
    let query = `SELECT * FROM stripe_users WHERE stripe_id != ?`;
    let data = ['Lifetime'];
    await object.db.query(query, data, async function(err, records, fields) {
      if (err) {
        console.error(err);
      }
      if (records) {
        records.forEach((user, index) => {
          setTimeout(async function() {
            let member = bot.guilds.cache.get(config.guild_id).members.cache.get(user.user_id);
            let customer = '';
            if (member) {
              if (member.roles.cache.has(config.donor_role_id)) {
                if (!user.stripe_id || user.plan_id != config.stripe.plan_id) {
                  bot.removeDonor(member.id);
                  return bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role. (Internal Check)', config.log_channel);
                } else {
                  customer = await stripe.customer.fetch(user.stripe_id);
                  if (!customer || customer.deleted == true || !customer.subscriptions || !customer.subscriptions.data[0]) {
                    bot.removeDonor(member.id);
                    bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role. (Stripe Check)', config.log_channel);
                    query = `UPDATE stripe_users SET stripe_id = NULL, plan_id = NULL WHERE user_id = ?`;
                    data = [member.id];
                    return object.runQuery(query, data);
                  } else if (customer.subscriptions.data[0].status != 'active') {
                    bot.removeDonor(member.id);
                    return bot.sendEmbed(member, 'FF0000', 'User found without an Active Subscription ⚠', 'Removed Donor Role. (Stripe Check)', config.log_channel);
                  }
                }
              } else if (user.stripe_id && user.stripe_id.startsWith('cus')) {
                customer = await stripe.customer.fetch(user.stripe_id);
                if (!customer || customer.deleted == true) {
                  query = `UPDATE stripe_users SET stripe_id = NULL, plan_id = NULL WHERE user_id = ?`;
                  data = [member.id];
                  await object.runQuery(query, data);
                  return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Updated ' + user.user_name + ' Record to Reflect no Stripe information.', config.log_channel);
                } else if (!customer.subscriptions.data[0] && user.plan_id) {
                  query = `UPDATE stripe_users SET plan_id = NULL WHERE user_id = ?`;
                  data = [member.id];
                  await object.runQuery(query, data);
                  return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Deleted Subscription Plan record for ' + user.user_name + ' (' + member.id + ').', config.log_channel);
                } else if (customer.subscriptions.data[0] && customer.subscriptions.data[0].status == 'active' && user.plan_id == config.stripe.plan_id) {
                  bot.assignDonor(member.id);
                  return bot.sendEmbed(member, 'FF0000', 'User found without Donor Role ⚠', 'Assigned Donor Role. (Stripe Check)', config.log_channel);
                } else {
                  return;
                }
              }
            } else {
              member = user;
              member.nickname = user.user_name;
              member.user = [];
              member['user']['id'] = user.user_id;
              customer = await stripe.customer.fetch(user.stripe_id);
              query = `DELETE FROM stripe_users WHERE user_id = ?`;
              data = [member.user_id];
              await object.runQuery(query, data);
              await stripe.subscription.cancelNow(member, customer.subscriptions.data[0].id);
              return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Deleted Tokens and Guild Association for ' + user.user_name + ' (' + member.user_id + ').', config.log_channel);
            }
          }, 5000 * index);
        });
        return;
      }
    });
    let guild = bot.guilds.cache.get(config.guild_id);
    let members = guild.roles.cache.find(role => role.id === config.donor_role_id).members.map(m => m);
    members.forEach((member, index) => {
      setTimeout(function() {
        let query = `SELECT * FROM stripe_users WHERE user_id = ?`;
        let data = [member.id],
          removed = '';
        object.db.query(query, data, async function(err, record, fields) {
          if (err) {
            return console.error(err);
          }
          switch (true) {
            case !record[0]:
              return;
            case record[0].stripe_id == "Lifetime":
              return;
            case record[0].stripe_id != "Lifetime":
              if (!record[0].stripe_id && member.roles.cache.has(config.donor_role_id)) {
                bot.removeDonor(member.id);
                return bot.sendEmbed(member, 'FF0000', 'User found without a Stripe ID ⚠', 'Removed Donor Role. (Member Check)', config.log_channel);
              } else {
                customer = await stripe.customer.fetch(record[0].stripe_id);
                if (!customer || customer.deleted == true || !customer.subscriptions || !customer.subscriptions.data[0]) {
                  if (member.roles.cache.has(config.donor_role_id)) {
                    bot.removeDonor(member.id);
                  }
                  bot.sendEmbed(member, 'FF0000', 'No Customer found for this User ⚠', 'Removed Donor Role. (Member Check)', config.log_channel);
                  query = `UPDATE stripe_users SET stripe_id = NULL, plan_id = NULL WHERE user_id = ?`;
                  data = [member.id];
                  return object.runQuery(query, data);
                } else if (customer.subscriptions.data[0].status != 'active' && member.roles.cache.has(config.donor_role_id)) {
                  bot.removeDonor(member.id);
                  return bot.sendEmbed(member, 'FF0000', 'User found without an Active Subscription ⚠', 'Removed Donor Role. (Member Check)', config.log_channel);
                }
              }
              return;
            case member.roles.cache.has(config.donor_role_id):
              bot.removeDonor(member.id);
              return bot.sendEmbed(member, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.log_channel);
          }
        });
      }, 5000 * index);
    });
    return;
  }
}

// EXPORT OBJECT
module.exports = object;

// SCRIPT REQUIREMENTS
stripe = require(__dirname + '/stripe.js');
bot = require(__dirname + '/bot.js');
oauth2 = require(__dirname + '/oauth2.js');