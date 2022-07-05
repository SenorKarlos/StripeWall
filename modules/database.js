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
    console.info("["+bot.getTime("stamp")+"] [database.js] Starting Discord Role Maintenance.");
    let query = `SELECT * FROM stripe_users WHERE stripe_id != ?`;
    let data = ['Manual'];
    await object.db.query(query, data, async function(err, records, fields) {
      if (err) {
        console.error(err);
      }
      if (records) {
        records.forEach((user, index) => {
          setTimeout(async function() {
            let member = bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.user_id);
            let customer = '';
            if (member) {
              for (let i = 0; i < config.stripe.price_ids.length; i++) {
                if (member.roles.cache.has(config.stripe.price_ids[i]role_id)) {
                  if (!user.stripe_id || user.price_id != config.stripe.price_ids[i].id) {
                    bot.removeDonor(member.id);
                    console.info("["+bot.getTime("stamp")+"] [database.js] ");
                    return bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role. (Internal Check)', config.discord.log_channel);
                  } else { // end if no stripe ID or plan not matched to role
                    customer = await stripe.customer.fetch(user.stripe_id);
                    if (!customer || customer.deleted == true) {
                      bot.removeDonor(member.id);
                      bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role. (Stripe Check)', config.discord.log_channel);
                      query = `UPDATE stripe_users SET stripe_id = NULL, price_id = NULL WHERE user_id = ?`;
                      data = [member.id];
                      return object.runQuery(query, data);
                    } //end if customer doesn't exist or is deleted (if they exist, they are in stripe sync and id & plan are verified)
                  } // end if they have an id and the plan matched role
                } else if (user.stripe_id) { // end if member role matches config role
                  customer = await stripe.customer.fetch(user.stripe_id);
                  if (!customer || customer.deleted == true) {
                    query = `UPDATE stripe_users SET stripe_id = NULL, price_id = NULL WHERE user_id = ?`;
                    data = [member.id];
                    await object.runQuery(query, data);
                    return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Updated '+user.user_name+' Record to Reflect no Stripe information.', config.discord.log_channel);
                  } else if (customer.subscriptions.data[0] && customer.subscriptions.data[0].status == 'active' && user.price_id == config.stripe.price_id) {
                    bot.assignDonor(member.id);
                    return bot.sendEmbed(member, 'FF0000', 'User found without Donor Role ⚠', 'Assigned Donor Role. (Stripe Check)', config.discord.log_channel);
                  } else {
                    return;
                  }
                } // end if user has stripe id
              } // end for each plan in config
            } else { //end if guild member
              member = user;
              member.nickname = user.user_name;
              member.user = [];
              member['user']['id'] = user.user_id;
              customer = await stripe.customer.fetch(user.stripe_id);
              await stripe.subscription.cancelNow(member, customer.subscriptions.data[0].id);
              return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Deleted Tokens and Guild Association for '+user.user_name+' ('+member.user_id+').', config.discord.log_channel);
            } // end not guild member
          }, 5000 * index);
        }); //end for each user record
        return;
      } //end if records returned
    }); //end query all db users except Manual
    // Removed member block
  }
}

// EXPORT OBJECT
module.exports = object;

// SCRIPT REQUIREMENTS
stripe = require(__dirname+'/stripe.js');
bot = require(__dirname+'/bot.js');
oauth2 = require(__dirname+'/oauth2.js');