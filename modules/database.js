var stripe, bot, oauth2;
const mysql = require('mysql2');
const moment = require('moment');
const config = require("../config/config.json");
const database = {
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
  }).promise(),
//------------------------------------------------------------------------------
//  RUN QUERY FUNCTION
//------------------------------------------------------------------------------
  runQuery: async function(query, data, success) {
    result = database.db.query(query, data);
    if (!result[0]) {
      return false
    } else if (success) {
      console.info(success);
      return true;
    } else {
      return true;
    }
  },
//------------------------------------------------------------------------------
//  USER TABLE FETCH
//------------------------------------------------------------------------------
  fetchUser: async function(user_id) {
    let query = `SELECT * FROM stripe_users WHERE user_id = ?`;
    let data = [user_id];
    result = await database.db.query(query, data)
    if(result[0][0]) {
      return result[0][0];
    } else {
      return false;
    }
  },
//------------------------------------------------------------------------------
//  STRIPE USER TABLE FETCH
//------------------------------------------------------------------------------
  fetchStripeUser: async function(user_id, stripe_id) {
    let query = `SELECT * FROM stripe_users WHERE user_id = ? AND stripe_id = ?`;
    let data = [user_id, stripe_id];
    result = await database.db.query(query, data);
    if(result[0][0]) {
        return result[0][0];
    }
    else{
      return false;
    }
  },
//------------------------------------------------------------------------------
//  STRIPE USER TERMS REVIEWED
//------------------------------------------------------------------------------
  termsReviewed: async function(user_id) {
    let query = `UPDATE stripe_users SET terms_reviewed = 'true' WHERE user_id = ?`;
    let data = [user_id];
    await database.db.query(query, data)
  },
//------------------------------------------------------------------------------
//  STRIPE USER UPDATE ZONES
//------------------------------------------------------------------------------
  updateZoneSelection: async function(user_id, selection, format) {
    let query = `UPDATE stripe_users SET zone_votes = ? , zones_reviewed = ?, format = ? WHERE user_id = ?`;
    let data = [selection, 'true', format, user_id];
    await database.db.query(query, data);
  },
  updateZoneUsers: async function(zone, parent, addOrSub = 1) {
    let query = '';
    if(addOrSub == 1){
      query = `UPDATE service_zones SET total_users = total_users + 1 WHERE zone_name = ?`;
    }
    else
    {
      query = `UPDATE service_zones SET total_users = total_users - 1 WHERE zone_name = ?`;
    }

    let data = [zone];
    await database.db.query(query, data);
    data = [parent];
    await database.db.query(query, data);
  },
  updateTotalVotes: async function(zonediff) {
    let query = `UPDATE service_zones SET total_votes = total_votes + ? WHERE zone_name = ?`;
    zonediff = JSON.parse(zonediff)
    let data = [zonediff.difference, zonediff.zone_name];
    result = await database.db.query(query, data);
    if(result[0][0]) {
      return result[0][0];
    }
    else{
      return false;
    }
  },
  updateActiveVotes: async function(userid, status, lifetimeToggle = false){
    let query = "SELECT zone_votes FROM stripe_users WHERE user_id = ?";
    let data = [userid];
    let lifetime = ''
    result = await database.db.query(query, data);
    if (result[0][0]) {
    var votes = result[0][0].zone_votes;
    for(var i = 0 ; i < votes.length ; i++) {
      if(status == 0) {
        lifetime = 'lifetime-inactive'
        query = `UPDATE service_zones SET total_votes = total_votes - ?, total_users = total_users - 1 WHERE zone_name = ?`;
        } else{
        lifetime = 'lifetime-active'
        query = `UPDATE service_zones SET total_votes = total_votes + ? , total_users = total_users + 1 WHERE zone_name = ?`;
        }
        data = [votes[i].votes, votes[i].zone_name];

        database.runQuery(query, data);
        data = [votes[i].votes, votes[i].parent_name];
        database.runQuery(query, data);
      }
      if(lifetimeToggle != false) //only for lifetime users.
      {
        query = `UPDATE stripe_users SET customer_type = ? WHERE user_id = ?`;
        data = [lifetime, userid];
        database.runQuery(query, data);
      }
      database.updateWorkerCalc(config.service_zones.workers);
    }
  },
  updateParentVotes: async function(zonediff) {
    let query = `UPDATE service_zones SET total_votes = total_votes + ? WHERE zone_name = ?`;
    zonediff = JSON.parse(zonediff)
    let data = [zonediff.difference, zonediff.parent_zone];
    result = await database.db.query(query, data);
    if(result[0][0]) {
      return result[0][0];
    }
    else{
      return false;
    }
  },
  updateZoneOverride: async function(value,zone) {
    if(value == ''){
      value = 0;
    }
    var query = 'SELECT admin_worker_override, parent_zone FROM service_zones WHERE zone_name = ?';
    var data = [zone];
    result = await database.db.query(query, data);
    originalValue = result[0][0].admin_worker_override;
    if(result[0][0].parent_zone != null)
    {
      query = 'UPDATE service_zones SET admin_worker_override = admin_worker_override +  ? WHERE zone_name = ?';
      data = [value - originalValue, result[0][0].parent_zone];
      await database.db.query(query, data);
    }
    query = 'UPDATE service_zones SET admin_worker_override = ? WHERE zone_name = ?';
    data = [value, zone]
    await database.db.query(query, data);
   
  },
  updateWorkerCalc: async function(workers){
    var query = 'SELECT zone_name,total_votes,parent_zone,admin_worker_override FROM service_zones';
    var data = [];
    result = await database.db.query(query, data);
    if (result[0]) {
      result=result[0];
      var totalVotes = 0;
      var voteCalc = 0;
      var assigned = 0;
      for(var i = 0 ; i < result.length ; i++) { //grab vote total first from parents
        if(result[i].parent_zone == null){
          totalVotes += result[i].total_votes; 
        }
      }
      for(var i = 0 ; i < result.length ; i++) { //loop again to update values
        voteCalc =  Math.round(result[i].total_votes * 100.0 / totalVotes) / 100;
        voteCalc = Math.round(voteCalc * workers);
        assigned = voteCalc + result[i].admin_worker_override;
        query = 'UPDATE service_zones SET calc_workers = ? , assigned_workers = ? WHERE zone_name = ?';
        data = [voteCalc, assigned, result[i].zone_name]
        await database.db.query(query, data);
      }
    }
  },
//------------------------------------------------------------------------------
//  ZONE FETCH TABLE FETCH
//------------------------------------------------------------------------------
  fetchZones: async function() {
    let query = `SELECT sz.*,sz2.zone_name as parent_name FROM service_zones sz LEFT JOIN service_zones sz2 ON sz.parent_zone = sz2.zone_name`;
    let data = [];
    result = await database.db.query(query, data);
    if(result[0]) {
      return result[0];
    }
    else{
      return false;
    }
  },
//------------------------------------------------------------------------------
//  MAINTENANCE ROUTINES (DATABASE)
//------------------------------------------------------------------------------
  checkDetails: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Starting Discord Info Sync.");
    let unix = moment().unix();
    let query = `SELECT * FROM stripe_users WHERE user_id != ?`;
    let data = ['NULL'];
    records = await database.db.query(query, data);
    if(!records[0]){
        console.info("["+bot.getTime("stamp")+"] [database.js] Database Empty, nothing to sync.");
        return database.doneDetails();
      }
    else {
      records = records[0];
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
                let cx_type = 'inactive';
                if (user.customer_type == 'administrator') { cx_type = 'administrator' }
                if (user.customer_type == 'lifetime-active') { cx_type = 'lifetime-inactive' }
                let query = `UPDATE stripe_users SET customer_type = ?, stripe_id = NULL, price_id = NULL, expiration = NULL, charge_id = NULL WHERE user_id = ?`;
                let data = [cx_type, user.user_id];
                database.runQuery(query, data);
                if (user.customer_type != 'inactive' && user.customer_type != 'lifetime-inactive' && user.customer_type != 'administrator' && user.zone_votes) { await database.updateActiveVotes(user.user_id, 0); }
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
                await database.runQuery(query, data);
                await database.updateActiveVotes(user.user_id, 0);
                db_updated = true;
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Member Left Guild. Cancelled Subscriptions/Access.");
                bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Cancelled Subscriptions/Access.', config.discord.log_channel);
                if (indexcounter === records.length) { return database.doneDetails(); }
              } else if (user.customer_type == "lifetime-active" || user.customer_type == "lifetime-inactive" && user.access_token != 'Left Guild') {
                let query = `UPDATE stripe_users SET access_token = 'Left Guild', refresh_token = NULL, token_expiration = NULL, customer_type = 'lifetime-inactive', expiration = ? WHERE user_id = ?`;
                let data = [user.user_id, 9999999998];
                await database.runQuery(query, data);
                await database.updateActiveVotes(user.user_id, 0);
                db_updated = true;
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Lifetime Member Left Guild. Set inactive.");
                bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'Found Database Discrepency ⚠', 'Lifetime Member Left Guild. Set inactive.', config.discord.log_channel);
                if (indexcounter === records.length) { return database.doneDetails(); }
              } else {
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Not a Guild member, User admin or already inactive.");
                if (indexcounter === records.length) { return database.doneDetails(); }
              }
            } else {
              if (user.customer_type != 'inactive' && user.customer_type != 'lifetime-inactive') {
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
                        await database.runQuery(query, data);
                        db_updated = true;
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to refresh Discord token, cleared Tokens.");
                        if (indexcounter === records.length) { return database.doneDetails(); }
                      } else {
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to refresh Discord token.", e);
                        if (indexcounter === records.length) { return database.doneDetails(); }
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
                      await database.runQuery(query, data);
                      db_updated = true;
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Discord information, cleared Tokens.");
                      if (indexcounter === records.length) { return database.doneDetails(); }
                    } else {
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Unable to fetch Discord information.", e);
                      if (indexcounter === records.length) { return database.doneDetails(); }
                    }
                  }
                  if (discord.id != user.user_id) { // check if token pulled right ID result, log and alert if not
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User Fetch resulted in ID mismatch, Administration should investigate (Discord Check).");
                    bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User Fetch resulted in ID mismatch ⚠', 'Administration should investigate (Discord Check)', config.discord.log_channel);
                    if (indexcounter === records.length) { return database.doneDetails(); }
                  } else { // end ID/Token result mismatch
                    if (discord.username != user.user_name || discord.email != user.email) {
                      let query = `UPDATE stripe_users SET user_name = ?, email = ? WHERE user_id = ?`;
                      let data = [discord.username, discord.email, user.user_id]
                      database.runQuery(query, data);
                      db_updated = true;
                    } // end detail mismatch
                  } // end ID/Token result match
                } else { // end access and refresh token found
                  if (member.user.username != user.user_name) { // check username on member object only
                    let query = `UPDATE stripe_users SET user_name = ?, WHERE user_id = ?`;
                    let data = [member.user.username, user.user_id]
                    database.runQuery(query, data);
                    db_updated = true;
                  } // end detail mismatch
                } // end access and refresh token not found
                if (db_updated) {
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Updated Database details.");
                  if (indexcounter === records.length) { return database.doneDetails(); }
                } else {
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Verified Database details.");
                  if (indexcounter === records.length) { return database.doneDetails(); }
                }
              } else {// end type not inactive
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User is Inactive, Skip.");
                if (indexcounter === records.length) { return database.doneDetails(); }
              }
            } // end is guild member
          }, 1000 * index);
        }); //end for each user record
      }
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
    records = await database.db.query(query, data);
      if (!records[0]) {
        console.info('Empty database for role check');
      }
      else {
        records = records[0];
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
                        if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
                      } else {
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") is Verified in Discord Role.");
                        if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
                      }
                    } else if (user.stripe_id && user.price_id) { // end if member role matches config role (no role but they have a stripe & price ID)
                      if (config.stripe.price_ids[i].mode != 'payment' && user.price_id == config.stripe.price_ids[i].id) { // stripe-checked db subscription or legacy price matches price being checked
                        bot.assignRole(member.user.id, config.stripe.price_ids[i].role_id);
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User found without Role, Assigned.");
                        bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                        if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
                      } else if (config.stripe.price_ids[i].mode == 'payment' && user.price_id == config.stripe.price_ids[i].id) { // check for Pay-As-You-Go purch roles
                        if (user.expiration > unix) { //check if expired
                          bot.assignRole(member.user.id, config.stripe.price_ids[i].role_id); // add & log
                          console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  Pay-As-You-Go User found without Role, Assigned.");
                          bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                          if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
                        } else { // give role if clear, remove price and expiry if not
                          let query = `UPDATE stripe_users SET customer_type = 'inactive', price_id = NULL, expiration = NULL WHERE user_id = ?`;
                          let data = [member.user.id];
                          await database.runQuery(query, data);
                          await database.updateTotalVote(user.user_id, 0);
                          console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  Pay-As-You-Go User expired, cleared price and expiry.");
                          bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                          if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
                        } // end expiry check
                      } // end check Pay-As-You-Go purch record
                    } // end if user has stripe & price id
                  } // end for each price in config
                  console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") doesn't need and has no Discord Role.");
                  if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
                } // end guild member
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  User left guild mid-maintenance, will be corrected next run.");
                if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
                break;
              default:
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  User is Inactive, Manually Administered, Lifetime or Admin and handled in Discord Role Check.");
                if (indexcounter === records.length) { return database.doneDatabaseRoles(); }
            }
          }, 1000 * index);
        }); //end for each user record
      } //end if records returned
  },
  doneDatabaseRoles: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Database checks complete, proceeding to role checks.");
    return database.getRoleMembers();
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
        if (i === config.stripe.price_ids.length - 1) { return database.checkDiscordRoles(roleArray, delayArray); }
      }, 500 * i);
    }
  },
  checkDiscordRoles: async function(roleArray, delayArray) {
    let unix = moment().unix();
    roleArray.forEach((members, i) => {
      setTimeout(function() {
        if (members.length == 0) {
          console.info("["+bot.getTime("stamp")+"] [database.js] "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
          if (i === config.stripe.price_ids.length - 1) { return database.checkLifetime(); }
        } else {
          console.info("["+bot.getTime("stamp")+"] [database.js] Checking "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
        }
        members.forEach((member, index) => { //for each member in role
          let indexcounter = index + 1;
          setTimeout(function() {
            let query = `SELECT * FROM stripe_users WHERE user_id = ?`;
            let data = [member.user.id];
            record = database.db.query(query, data);
              if (!record[0][0]) {
                bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                bot.sendEmbed(member, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.discord.log_channel);
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) Not in Database, removed Role.");
                if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
              }
              else { //record found
                record = record[0][0];
                switch(true) {
                  case (record.customer_type == 'manual'): // check manual
                    if (record.expiration < unix) {
                      bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                      let query = `UPDATE stripe_users SET customer_type = 'inactive', expiration = NULL WHERE user_id = ?`;
                      let data = [record.user_id];
                      database.runQuery(query, data);
                      database.updateActiveVotes(record[0].user_id, 0);
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_id+") Manually Tracked User Expired, Removing Role & Flags.");
                      bot.sendDM(member, 'Subscription Ended', 'Your subscription has expired. Please sign up again to continue.', 'FFFF00');
                      bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'Manually Tracked User Expired ⚠', 'Removed Role & Flags. (Role Check)', config.discord.log_channel);
                      if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
                    }
                    break;
                  case (record.customer_type == 'pay-as-you-go' || record.customer_type == 'subscriber'):
                    if (!record.stripe_id) { // no stripe id remove (should no longer be possible)
                      bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                      record[0].stripe_id = "Not Found";
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_id+") User found without a Stripe ID, Removed Role.");
                      bot.sendEmbed(member, 'FF0000', 'User found without a Stripe ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                      if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
                    } else if (!record.price_id || config.stripe.price_ids[i].mode == 'payment' && record.expiration < unix || record.price_id && record.price_id != config.stripe.price_ids[i].id) { //no price or temp plan expired or price doesn't belong to role remove
                      bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_id+") User found expired or without/wrong Price ID, Removed Role.");
                      bot.sendEmbed(member, 'FF0000', 'User found expired or without a Price ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                      if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
                    }
                    break;
                  case (record.customer_type == 'administrator'):
                    break;
                  default:
                    bot.removeRole(member.user.id, config.stripe.price_ids[i].role_id);
                    bot.sendEmbed(member, 'FF0000', 'Lifetime or Inactive User found with a Price Role ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) is Lifetime or Inactive, removed Role.");
                    if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
                }
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_id+") User is verified in Role "+config.stripe.price_ids[i].role_id+".");
                if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
              }      
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
      records = await database.db.query(query, data)
        if (!records[0]) {
          console.info('No stripe lifetime users');
        }
        else
          records[0].forEach((user, index) => {
            if (user.expiration == 9999999999) {
              activeUsers.push(user);
            } else if (user.expiration == 9999999998 && user.access_token != 'Left Guild') {
              inactiveUsers.push(user);
            }
          });
         return database.syncLifetime(active, inactive, activeUsers, inactiveUsers);
      }
     else { return database.doneDiscordRoles(); }
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
          database.runQuery(query, data);
          if (indexcounter === activeNoDB.length && activeNoRole.length === 0 && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (activeNoRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+activeNoRole.length+" Active Lifetime Users in Database without their role, assigning.");
      activeNoRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.assignRole(user.user_id, config.discord.lifetime_role);
          if (indexcounter === activeNoRole.length && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
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
          database.runQuery(query, data);
          if (indexcounter === inactiveNoDB.length && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (inactiveNoRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+inactiveNoRole.length+" Inactive Lifetime Users in Database without their role, assigning.");
      inactiveNoRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.assignRole(user.user_id, config.discord.inactive_lifetime_role);
          if (indexcounter === inactiveNoRole.length && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (removeActiveRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+removeActiveRole.length+" Inactive Lifetime Users in Database still have active role, removing.");
      removeActiveRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.removeRole(user.user.id, config.discord.lifetime_role);
          if (indexcounter === removeActiveRole.length) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (activeNoDB.length === 0 && activeNoRole.length === 0 && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] All known Lifetime Users are in Roles and Database.");
      return database.doneDiscordRoles();
    }
  },
  doneDiscordRoles: async function() {
    console.info("["+bot.getTime("stamp")+"] [database.js] Role checks complete. Starting to sync users and votes for zones");
    return database.syncZones();
  },
  syncZones: async function() {
    let query = "SELECT zone_votes FROM stripe_users WHERE customer_type <> 'inactive' AND customer_type <> 'lifetime-inactive'";
    let data = [];
    result = await database.db.query(query, data);
    if (result[0]) {
      totals = result[0];
      var userTotal = [];
      var voteTotal = [];
      for(var i = 0 ; i < totals.length ; i++) {  //loop through users
          if(!!totals[i].zone_votes) {
            
            votes = totals[i].zone_votes;
            for(var j = 0 ; j < votes.length ; j++)  {//loop through zones users currently use
              if(typeof voteTotal[votes[j].zone_name] === 'undefined')
              {
                userTotal[votes[j].zone_name] = 0;
                voteTotal[votes[j].zone_name] = 0;
              }
              if(typeof voteTotal[votes[j].parent_name] === 'undefined')
              {
                userTotal[votes[j].parent_name] = 0;
                voteTotal[votes[j].parent_name] = 0;
              }
              voteTotal[votes[j].zone_name] += Number(votes[j].votes);
              voteTotal[votes[j].parent_name] += Number(votes[j].votes);
              userTotal[votes[j].zone_name] += 1;
              userTotal[votes[j].parent_name] += 1;
            }
          }
        }
        query = "SELECT zone_name, total_users, total_votes FROM service_zones";
        result = await database.db.query(query, data);
        if (result[0]) {
          zones = result[0];
          for(var i = 0 ; i < zones.length ; i++) {  //loop through zones to compare them with data from above
            if(userTotal[zones[i].zone_name] && zones[i].total_users != userTotal[zones[i].zone_name]){
              console.log("["+bot.getTime("stamp")+"] [database.js] Mismatched user totals for zone: " + zones[i].zone_name + ". "+ zones[i].total_users + " vs " + userTotal[zones[i].zone_name] + ". Updating value");
              query = 'UPDATE service_zones SET total_users = ? WHERE zone_name = ?';
              data = [userTotal[zones[i].zone_name], zones[i].zone_name];
              await database.db.query(query, data);
            }
            if(voteTotal[zones[i].zone_name] && zones[i].total_votes != voteTotal[zones[i].zone_name]){
              console.log("["+bot.getTime("stamp")+"] [database.js] Mismatched user totals for zone: " + zones[i].zone_name + ". "+ zones[i].total_votes + " vs " + voteTotal[zones[i].zone_name] + ". Updating value");
              query = 'UPDATE service_zones SET total_votes = ? WHERE zone_name = ?';
              data = [voteTotal[zones[i].zone_name], zones[i].zone_name];
              await database.db.query(query, data);
            }
          }
        }
        else
        {
            console.info("["+bot.getTime("stamp")+"] [database.js] No users found.");
        }
    }
     console.info("["+bot.getTime("stamp")+"] [database.js] Zone sync complete.");
    return console.info("["+bot.getTime("stamp")+"] [database.js] Maintenance routines complete.");
  }  
}

// EXPORT database
module.exports = database;

// SCRIPT REQUIREMENTS
stripe = require(__dirname+'/stripe.js');
bot = require(__dirname+'/bot.js');
oauth2 = require(__dirname+'/oauth2.js');