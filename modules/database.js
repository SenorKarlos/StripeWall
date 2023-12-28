var stripe, bot, oauth2;
const mysql = require('mysql2');
const moment = require('moment');
const config = require("../config/config.json");
const object = {
//------------------------------------------------------------------------------
//  DATABASE CONNECTION
//------------------------------------------------------------------------------
  db: mysql.createPool({
    connectionLimit: 100,
    host: config.database.host,
    user: config.database.username,
    password: config.database.password,
    port: config.database.port,
    database: config.database.name,
    charset : 'utf8mb4'
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
//  STRIPE USER TERMS REVIEWED
//------------------------------------------------------------------------------
termsReviewed: function(user_id) {
  return new Promise(function(resolve) {
    let query = `UPDATE stripe_users SET terms_reviewed = 'true' WHERE user_id = ?`;
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
checkTermsReviewed: function(user_id) {
  return new Promise(function(resolve) {
    let query = `SELECT terms_reviewed FROM stripe_users WHERE user_id = ?`;
    let data = [user_id];
    object.db.query(query, data, async function(err, record, fields) {
      if (err) {
        return console.info(err);
      } else if (record[0]) {
        return resolve(record[0].terms_reviewed);
      } else {
        return resolve(null);
      }
    });
  });
},
  //------------------------------------------------------------------------------
//  STRIPE USER UPDATE ZONES
//------------------------------------------------------------------------------
updateZoneSelection: function(user_id, selection, zonediff) {
  return new Promise(function(resolve) {
    let query = `UPDATE stripe_users SET zone_votes = ? , zones_reviewed = ? WHERE user_id = ?`;
    let data = [selection, 'true', user_id];
    object.db.query(query, data, async function(err, record, fields) {
      if (err) {
        console.info(err);
      } else if (record[0]) {
        resolve(record[0]);
      } else {
        resolve(null);
      }
    });
  });
},
updateTotalVotes: function(zonediff) {
  return new Promise(function(resolve) {
    let query = `UPDATE service_zones SET total_votes = total_votes + ? WHERE zone_name = ?`;
    zonediff = JSON.parse(zonediff)
    let data = [zonediff.difference, zonediff.zone_name];
    object.db.query(query, data, async function(err, record, fields) {
      if (err) {
        console.info(err);
      } else if (record[0]) {
        resolve(record[0]);
      } else {
        resolve(null);
      }
      });
  })
},
updateActiveVotes: function(userid, status){
  let query = "SELECT zone_votes FROM stripe_users WHERE user_id = ?";
  let data = [userid];
  object.db.query(query, data, async function(err, records, fields) {
    if (err) {
      console.info(err);
    }
    if (records) {
      var votes = records[0].zone_votes;
      for(var i = 0 ; i < votes.length ; i++) {
        if(status == 0){
          query = `UPDATE service_zones SET total_votes = total_votes - ? WHERE zone_name = ?`;
          } else{
          query = `UPDATE service_zones SET total_votes = total_votes + ? WHERE zone_name = ?`;
          }
          console.log(votes[i].votes)
          console.log(votes[i].zone_name)
          data = [votes[i].votes, votes[i].zone_name];
          console.log(query+ ' + ')
          console.log(data)
          object.runQuery(query, data);
          data = [votes[i].votes, votes[i].parent_name];
          object.runQuery(query, data);
        }
      }
  })
},
updateParentVotes: function(zonediff) {
  return new Promise(function(resolve) {
    let query = `UPDATE service_zones SET total_votes = total_votes + ? WHERE zone_name = ?`;
    zonediff = JSON.parse(zonediff)
    let data = [zonediff.difference, zonediff.parent_zone];
    object.db.query(query, data, async function(err, record, fields) {
      if (err) {
        console.info(err);
      } else if (record[0]) {
        resolve(record[0]);
      } else {
        resolve(null);
      }
      });
  })
},
  //------------------------------------------------------------------------------
//  ZONE FETCH TABLE FETCH
//------------------------------------------------------------------------------
fetchZones: function() {
  return new Promise(function(resolve) {
    let query = `SELECT sz.*,sz2.zone_name as parent_name FROM service_zones sz LEFT JOIN service_zones sz2 ON sz.parent_zone = sz2.zone_name`;
    let data = [];
    object.db.query(query, data, async function(err, record, fields) {
      if (err) {
        return console.info(err);
      } else if (record) {
        return resolve(record);
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
    console.info("["+bot.getTime("stamp")+"] [database.js] Starting Discord Info Sync.");
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
            let member;
            let customer;
            let db_updated = false;
            if (user.stripe_id) {
              try {
                customer = await stripe.customer.fetch(user.stripe_id); // fetch customer because stripe list only returns active users
              } catch (e) {
                return console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Stripe record.", e);
              }
              if (!customer || customer.deleted == true) {
                let query = `UPDATE stripe_users SET customer_type = 'inactive', stripe_id = NULL, price_id = NULL, expiration = NULL WHERE user_id = ?`;
                let data = [user.user_id];
                object.runQuery(query, data);
                await object.updateActiveVotes(user.user_id, 0);
                db_updated = true;
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Stripe Customer ID Invalid/Deleted, removed from Database Record.");
              } else {
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Stripe Customer ID Validated.");
              }
            } else {
              user.stripe_id = "Not Found";
              try {
                customer = await stripe.customer.create(user.user_name, user.user_id, user.email); // create customer in stripe
              } catch (e) {
                return console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to create Stripe record.", e);
              }
              if (customer) { user.stripe_id = customer.id; }
            }
            try {
              member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.user_id);
            } catch (e) {
              return console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to verify Guild Membership.", e);
            }            
            if (!member) {
              if (user.customer_type == "manual" || user.customer_type == "pay-as-you-go" || user.customer_type == "subscriber") {
                if (customer && customer.subscriptions.data[0]) { // they have some sub data
                  for (let x = 0; x < customer.subscriptions.data.length; x++) { //for each sub
                    await stripe.subscription.cancel(user.user_name, user.user_id, customer.subscriptions.data[x].id); //cancel each sub
                  }
                }
                let query = `UPDATE stripe_users SET customer_type = 'inactive', price_id = NULL, expiration = NULL, charge_id = NULL WHERE user_id = ?`;
                let data = [user.user_id];
                await object.runQuery(query, data);
                await object.updateActiveVotes(user.user_id, 0);
                db_updated = true;
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Member Left Guild. Cancelled Subscriptions/Access.");
                bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Cancelled Subscriptions/Access.', config.discord.log_channel);
                if (indexcounter === records.length) { return object.doneDetails(); }
              } else if (user.customer_type == "lifetime-active") {
                let query = `UPDATE stripe_users SET access_token = 'Left Guild', refresh_token = NULL, token_expiration = NULL, customer_type = 'lifetime-inactive', expiration = ? WHERE user_id = ?`;
                let data = [user.user_id, 9999999998];
                await object.runQuery(query, data);
                await object.updateActiveVotes(user.user_id, 0);
                db_updated = true;
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Lifetime Member Left Guild. Set inactive.");
                bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'Found Database Discrepency ⚠', 'Lifetime Member Left Guild. Set inactive.', config.discord.log_channel);
                if (indexcounter === records.length) { return object.doneDetails(); }
              } else {
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Not a Guild member, User admin or already inactive.");
                if (indexcounter === records.length) { return object.doneDetails(); }
              }
            } else {
              if (user.customer_type != 'inactive') {
                let data = {};
                if (user.access_token && user.refresh_token) {
                  if (!user.token_expiration) { user.token_expiration = 1 }
                  if (unix-86400 > user.token_expiration) {
                    try {
                      data = await oauth2.refreshAccessToken(user.refresh_token, user);
                      if (data.response) {
                        throw data.response;
                      }
                    } catch (e) {
                      if (e.status === 400) {
                        let query = `UPDATE stripe_users SET access_token = NULL, refresh_token = NULL, token_expiration = NULL WHERE user_id = ?`;
                        let data = [user.user_id];
                        await object.runQuery(query, data);
                        db_updated = true;
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to refresh Discord token, cleared Tokens.");
                        if (indexcounter === records.length) { return object.doneDetails(); }
                      } else {
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to refresh Discord token.", e);
                        if (indexcounter === records.length) { return object.doneDetails(); }
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
                      let data = [user.user_id];
                      await object.runQuery(query, data);
                      db_updated = true;
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Discord information, cleared Tokens.");
                      if (indexcounter === records.length) { return object.doneDetails(); }
                    } else {
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Discord information.", e);
                      if (indexcounter === records.length) { return object.doneDetails(); }
                    }
                  }
                  if (discord.id != user.user_id) { // check if token pulled right ID result, log and alert if not
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User Fetch resulted in ID mismatch, Administration should investigate (Discord Check).");
                    bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User Fetch resulted in ID mismatch ⚠', 'Administration should investigate (Discord Check)', config.discord.log_channel);
                    if (indexcounter === records.length) { return object.doneDetails(); }
                  } else { // end ID/Token result mismatch
                    if (discord.username != user.user_name || discord.email != user.email) {
                      let query = `UPDATE stripe_users SET user_name = ?, email = ? WHERE user_id = ?`;
                      let data = [discord.username, discord.email, user.user_id]
                      object.runQuery(query, data);
                      db_updated = true;
                    } // end detail mismatch
                  } // end ID/Token result match
                } else { // end access and refresh token found
                  if (member.user.username != user.user_name) { // check username on member object only
                    let query = `UPDATE stripe_users SET user_name = ?, WHERE user_id = ?`;
                    let data = [member.user.username, user.user_id]
                    object.runQuery(query, data);
                    db_updated = true;
                  } // end detail mismatch
                } // end access and refresh token not found
                if (db_updated) {
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Updated Database details.");
                  if (indexcounter === records.length) { return object.doneDetails(); }
                } else {
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Verified Database details.");
                  if (indexcounter === records.length) { return object.doneDetails(); }
                }
              } // end type not inactive
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User is Inactive, Skip.");
              if (indexcounter === records.length) { return object.doneDetails(); }
            } // end is guild member
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
  checkDatabaseRoles: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Starting Role Database Checks.");
    let unix = moment().unix();
    let query = `SELECT * FROM stripe_users WHERE user_id != ?`;
    let data = ['NULL'];
    await object.db.query(query, data, async function(err, records, fields) {
      if (err) {
        console.info(err);
      }
      if (records) {
        console.info("["+bot.getTime("stamp")+"] [database.js] Checking "+records.length+" Database Users.");
        records.forEach((user, index) => {
          let indexcounter = index + 1;
          setTimeout(async function() {
            switch(true) {
              case (user.customer_type == 'pay-as-you-go' || user.customer_type == 'subscriber'):
                let member = bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.user_id);
                if (member) { // pull discord member record
                  for (let i = 0; i < config.stripe.price_ids.length; i++) { // check each config price id
                    if (member.roles.cache.has(config.stripe.price_ids[i].role_id)) { // they have a role matching the price being checked
                      if (!user.stripe_id || !user.price_id || user.price_id && user.price_id != config.stripe.price_ids[i].id || user.expiration && user.expiration < unix) { // they don't have a stripe id or price, or the registered price isn't correct or expired
                        bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") found without a Subscription. Removed Role."); // remove and log
                        bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without a Subscription ⚠', 'Removed Role. (Internal Check)', config.discord.log_channel);
                        if (indexcounter === records.length) { return object.doneDatabaseRoles(); }
                      } else {
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") is Verified in Discord Role.");
                        if (indexcounter === records.length) { return object.doneDatabaseRoles(); }
                      }
                    } else if (user.stripe_id && user.price_id) { // end if member role matches config role (no role but they have a stripe & price ID)
                      if (config.stripe.price_ids[i].mode != 'payment' && user.price_id == config.stripe.price_ids[i].id) { // stripe-checked db subscription or legacy price matches price being checked
                        bot.assignRole(member.user.id, config.stripe.price_ids[i].role_id);
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User found without Role, Assigned.");
                        bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                        if (indexcounter === records.length) { return object.doneDatabaseRoles(); }
                      } else if (config.stripe.price_ids[i].mode == 'payment' && user.price_id == config.stripe.price_ids[i].id) { // check for Pay-As-You-Go purch roles
                        if (user.expiration > unix) { //check if expired
                          bot.assignRole(member.user.id, config.stripe.price_ids[i].role_id); // add & log
                          console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  Pay-As-You-Go User found without Role, Assigned.");
                          bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                          if (indexcounter === records.length) { return object.doneDatabaseRoles(); }
                        } else { // give role if clear, remove price and expiry if not
                          let query = `UPDATE stripe_users SET customer_type = 'inactive', price_id = NULL, expiration = NULL WHERE user_id = ?`;
                          let data = [member.user.id];
                          await object.runQuery(query, data);
                          await object.updateTotalVote(user.user_id, 0);
                          console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  Pay-As-You-Go User expired, cleared price and expiry.");
                          bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                          if (indexcounter === records.length) { return object.doneDatabaseRoles(); }
                        } // end expiry check
                      } // end check Pay-As-You-Go purch record
                    } // end if user has stripe & price id
                  } // end for each price in config
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") doesn't need and has no Discord Role.");
                  if (indexcounter === records.length) { return object.doneDatabaseRoles(); }
                } // end guild member
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  User left guild mid-maintenance, will be corrected next run.");
                break;
              default:
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  User is Inactive, Manually Administered, Lifetime or Admin and handled in Discord Role Check.");
            }
          }, 1000 * index);
        }); //end for each user record
      } //end if records returned
    }); //end query all db users except Manual
  },
  doneDatabaseRoles: async function() {
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
        if (i === config.stripe.price_ids.length - 1) { return object.checkDiscordRoles(roleArray, delayArray); }
      }, 500 * i);
    }
  },
  checkDiscordRoles: async function(roleArray, delayArray) {
    let unix = moment().unix();
    roleArray.forEach((members, i) => {
      setTimeout(function() {
        if (members.length == 0) {
          console.info("["+bot.getTime("stamp")+"] [database.js] "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
          if (i === config.stripe.price_ids.length - 1) { return object.checkLifetime(); }
        } else {
          console.info("["+bot.getTime("stamp")+"] [database.js] Checking "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
        }
        members.forEach((member, index) => { //for each member in role
          let indexcounter = index + 1;
          setTimeout(function() {
            let query = `SELECT * FROM stripe_users WHERE user_id = ?`;
            let data = [member.user.id];
            object.db.query(query, data, async function(err, record, fields) { // pull DB record
              if (err) {
                return console.info(err);
              }
              if (record[0]) { //record found
                switch(true) {
                  case (record[0].customer_type == 'manual'): // check manual
                    if (record[0].expiration < unix) {
                      bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                      let query = `UPDATE stripe_users SET customer_type = 'inactive', expiration = NULL WHERE user_id = ?`;
                      let data = [record[0].user_id];
                      await object.runQuery(query, data);
                      await object.updateActiveVotes(record[0].user_id, 0);
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") Manually Tracked User Expired, Removing Role & Flags.");
                      bot.sendDM(member, 'Subscription Ended', 'Your subscription has expired. Please sign up again to continue.', 'FFFF00');
                      bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'Manually Tracked User Expired ⚠', 'Removed Role & Flags. (Role Check)', config.discord.log_channel);
                      if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.checkLifetime(); }
                    }
                    break;
                  case (record[0].customer_type == 'pay-as-you-go' || record[0].customer_type == 'subscriber'):
                    if (!record[0].stripe_id) { // no stripe id remove (should no longer be possible)
                      bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                      record[0].stripe_id = "Not Found";
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") User found without a Stripe ID, Removed Role.");
                      bot.sendEmbed(member, 'FF0000', 'User found without a Stripe ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                      if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.checkLifetime(); }
                    } else if (!record[0].price_id || config.stripe.price_ids[i].mode == 'payment' && record[0].expiration < unix || record[0].price_id && record[0].price_id != config.stripe.price_ids[i].id) { //no price or temp plan expired or price doesn't belong to role remove
                      bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") User found expired or without/wrong Price ID, Removed Role.");
                      bot.sendEmbed(member, 'FF0000', 'User found expired or without a Price ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                      if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.checkLifetime(); }
                    }
                    break;
                  case (record[0].customer_type == 'administrator'):
                    break;
                  default:
                    bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                    bot.sendEmbed(member, 'FF0000', 'Lifetime or Inactive User found with a Price Role ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) is Lifetime or Inactive, removed Role.");
                    if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.checkLifetime(); }
                }
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record[0].stripe_id+") User is verified in Role "+config.stripe.price_ids[i].role_id+".");
                if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.checkLifetime(); }
              } else { // not in db
                bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                bot.sendEmbed(member, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.discord.log_channel);
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) Not in Database, removed Role.");
                if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return object.checkLifetime(); }
              }
            });
          }, 1000 * index);
        });
      }, delayArray[i]);
    });
  },
  checkLifetime: async function() {
    if (config.discord.lifetime_role) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Syncing Lifetime Users.");
      let guild = bot.guilds.cache.get(config.discord.guild_id); // pull guild info
      let active = guild.roles.cache.find(role => role.id === config.discord.lifetime_role).members.map(m => m);
      let inactive;
      if (config.discord.inactive_lifetime_role) {
        inactive = guild.roles.cache.find(role => role.id === config.discord.inactive_lifetime_role).members.map(m => m);
      } else {
        inactive = [];
      }
      let activeUsers = [];
      let inactiveUsers = [];
      let query = `SELECT * FROM stripe_users WHERE expiration > ?`;
      let data = [9999999997];
      await object.db.query(query, data, function(err, records, fields) {
        if (err) {
          console.info(err);
        }
        if (records) {
          records.forEach((user, index) => {
            if (user.expiration == 9999999999) {
              activeUsers.push(user);
            } else if (user.expiration == 9999999998 && user.access_token != 'Left Guild') {
              inactiveUsers.push(user);
            }
          });
        } return object.syncLifetime(active, inactive, activeUsers, inactiveUsers);
      });
    } else { return object.doneDiscordRoles(); }
  },
  syncLifetime: async function(active, inactive, activeUsers, inactiveUsers) { 
    let activeNoDB = active.filter(o1 => !activeUsers.some(o2 => o1.user.id === o2.user_id));
    activeNoDB = activeNoDB.filter(o1 => !inactiveUsers.some(o2 => o1.user.id === o2.user_id));
    activeNoDB = activeNoDB.filter(o1 => !inactive.some(o2 => o1.user.id === o2.user.id));
    let activeNoRole = activeUsers.filter(o1 => !active.some(o2 => o1.user_id === o2.user.id));
    activeNoRole = activeNoRole.filter(o1 => !inactive.some(o2 => o1.user_id === o2.user.id));
    activeNoRole = activeNoRole.filter(o1 => !inactiveUsers.some(o2 => o1.user_id === o2.user_id));
    let inactiveNoDB = inactive.filter(o1 => !inactiveUsers.some(o2 => o1.user.id === o2.user_id));
    let inactiveNoRole = inactiveUsers.filter(o1 => !inactive.some(o2 => o1.user_id === o2.user.id));
    let removeActiveRole = inactive.filter(o1 => active.some(o2 => o1.user.id === o2.user.id));
    if (activeNoDB.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+activeNoDB.length+" Active Lifetime Users without proper Database Information, updating.");
      activeNoDB.forEach((member, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          let query = `INSERT INTO stripe_users (user_id, user_name, customer_type, expiration) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), customer_type=VALUES(customer_type), price_id = NULL, expiration=VALUES(expiration), charge_id = NULL`;
          let data = [member.user.id, member.user.username, 'lifetime-active', 9999999999];
          object.runQuery(query, data);
          if (indexcounter === activeNoDB.length && activeNoRole.length === 0 && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return object.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (activeNoRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+activeNoRole.length+" Active Lifetime Users in Database without their role, assigning.");
      activeNoRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.assignRole(user.user_id, config.discord.lifetime_role);
          if (indexcounter === activeNoRole.length && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return object.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (inactiveNoDB.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+inactiveNoDB.length+" Inactive Lifetime Users without proper Database Information, updating.");
      inactiveNoDB.forEach((member, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          let query = `INSERT INTO stripe_users (user_id, user_name, customer_type, expiration) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), customer_type=VALUES(customer_type), price_id = NULL, expiration=VALUES(expiration), charge_id = NULL`;
          let data = [member.user.id, member.user.username, 'lifetime-inactive', 9999999998];
          object.runQuery(query, data);
          if (indexcounter === inactiveNoDB.length && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return object.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (inactiveNoRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+inactiveNoRole.length+" Inactive Lifetime Users in Database without their role, assigning.");
      inactiveNoRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.assignRole(user.user_id, config.discord.inactive_lifetime_role);
          if (indexcounter === inactiveNoRole.length && removeActiveRole.length === 0) { return object.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (removeActiveRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+removeActiveRole.length+" Inactive Lifetime Users in Database still have active role, removing.");
      removeActiveRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.removeRole(user.user.id, config.discord.lifetime_role);
          if (indexcounter === removeActiveRole.length) { return object.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (activeNoDB.length === 0 && activeNoRole.length === 0 && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] All known Lifetime Users are in Roles and Database.");
      return object.doneDiscordRoles();
    }
  },
  doneDiscordRoles: async function() {
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