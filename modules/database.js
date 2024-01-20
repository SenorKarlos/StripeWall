var bot, oauth, qbo, stripe;
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
//  ZONE VOTE/WORKER FUNCTIONS
//------------------------------------------------------------------------------
  updateZoneSelection: async function(user_id, selection, allocations, format) {
    let query = '';
    let data = [];
    if(selection != '') //this happens when on $ mode. This will be set later.
    {
      query = `UPDATE stripe_users SET zone_votes = ?, allocations = ? , zones_reviewed = ?, format = ? WHERE user_id = ?`;
      data = [selection, allocations, 'true', format, user_id];
    } else {
      query = `UPDATE stripe_users SET allocations = ? , zones_reviewed = ?, format = ? WHERE user_id = ?`;
      data = [allocations, 'true', format, user_id];
    }
      await database.db.query(query, data);
  },
  updateZoneRoles: async function(user_id, selection, target = 'all', action = 'add', roleLevel = 0) {
    query = "SELECT user_name, access_token, zone_votes FROM stripe_users WHERE user_id = ?";
    data = [user_id];
    result = await database.db.query(query, data);
    username = result[0][0].user_name;
    access_token = result[0][0].access_token;
    if (selection == '') {
      if (result[0][0].zone_votes == null) { return 0; }
      zones = result[0][0].zone_votes;
    } else {
      zones = JSON.parse(selection);
    }
    highestVote = 0;
    highestZone = '';
    lastHighestZone = '';
    if (target == 'all') { //cycle through all zones
      for (let i = 0 ; i < zones.length ; i++) { //find highest vote before assigning roles
        if (zones[i].votes > highestVote) {
          highestVote = zones[i].votes;
          highestZone = zones[i].zone_name;
        }
        if (zones[i].role_level == 3) {
          lastHighestZone = zones[i].zone_name;
        }
      }
      update = false;  //flag. If any changes happen with upcoming loop, update zone_votes.
      for (let i = 0 ; i < zones.length ; i++) {
        query = "SELECT zone_roles FROM service_zones WHERE zone_name = ?";
        data = [zones[i].zone_name];
        result = await database.db.query(query, data);
        if (result[0][0].zone_roles != null) {
          roles = result[0][0].zone_roles;
          originalLevel = zones[i].role_level;
          temp_level = 0;
          for (let j = 0 ; j < roles.length ; j++) {
            if (roles[j].assign_on == 'any_area') {
              if (action == 'remove') {
                if (zones[i].role_level > 0) { //this triggers when user is going inactive
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed any_area role:", zones[i].zone_name, roles[j].roleID, username);
                  bot.removeRole(roles[j].serverID,user_id,roles[j].roleID, username);
                  temp_level = 0;
                }
              } else {
                if (zones[i].role_level < 1) {
                  console.info("["+bot.getTime("stamp")+"] [database.js] Added any_area role:", zones[i].zone_name, roles[j].roleID, username);
                  temp_level = 1;
                  bot.assignRole(roles[j].serverID,user_id,roles[j].roleID, username, access_token);
                }
              }
            } else if (roles[j].assign_on == 'any_votes') {
              if(action == 'remove') {
                if(zones[i].role_level > 1) { //this triggers when user is going inactive
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed any_votes role:", zones[i].zone_name, roles[j].roleID, username);
                  bot.removeRole(roles[j].serverID,user_id,roles[j].roleID, username);
                  temp_level = 0;
                  
                }
              } else {
                if(zones[i].votes > 0 && zones[i].role_level < 2) {
                  console.info("["+bot.getTime("stamp")+"] [database.js] Added any_votes role:", zones[i].zone_name, roles[j].roleID, username);
                  bot.assignRole(roles[j].serverID,user_id,roles[j].roleID, username, access_token)
                  if(temp_level < 2) { temp_level = 2; }
                } else if(zones[i].votes == 0 && zones[i].role_level > 1) { //votes went from non-zero to zero. Remove role.
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed any_votes role:", zones[i].zone_name, roles[j].roleID, username);
                  bot.removeRole(roles[j].serverID,user_id,roles[j].roleID, username);
                  if(temp_level == 0) { temp_level = 1; }
                }
              }
            } else if (roles[j].assign_on == 'most_votes') {
              if(action == 'remove') {
                if(zones[i].role_level > 2) { //this triggers when user is going inactive
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed most_votes role:", zones[i].zone_name, roles[j].roleID, username);
                  bot.removeRole(roles[j].serverID,user_id,roles[j].roleID, username);
                  temp_level = 0;
                }
              }
              else {
                if (lastHighestZone == zones[i].zone_name && lastHighestZone != highestZone) //previous highest vote has been outvoted. Remove role
                {
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed most_votes role:", zones[i].zone_name, roles[j].roleID, username);
                  bot.removeRole(roles[j].serverID,user_id,roles[j].roleID, username);
                  if(zones[i].votes == 0) {
                    temp_level = 1;
                  } else {
                    temp_level = 2;
                  }
                }
                else if (highestZone == zones[i].zone_name && lastHighestZone != zones[i].zone_name) { //if zone is new highest, assign.
                  console.info("["+bot.getTime("stamp")+"] [database.js] Added most_votes role:", zones[i].zone_name, roles[j].roleID, username);
                  bot.assignRole(roles[j].serverID,user_id,roles[j].roleID, username, access_token);
                  temp_level = 3;
                }
              }
            }
          }
          if((originalLevel != temp_level && temp_level != 0) || action == 'remove') {
            zones[i].role_level = temp_level;
            update = true;
          }
        }
      }
      if(update) {
        query = 'UPDATE stripe_users SET zone_votes = ? WHERE user_id = ?';
        data = [JSON.stringify(zones),user_id];
        await database.db.query(query, data);
      }
    } else { //one zone specified. This means we're removing roles
      query = "SELECT zone_roles FROM service_zones WHERE zone_name = ?";
      data = [target];
      result = await database.db.query(query, data);
      if (result[0][0].zone_roles != null) {
        roles = result[0][0].zone_roles;
        for (let j = 0; j < roles.length; j++) {
          if(roles[j].assign_on == 'any_vote' && roleLevel > 1) {
            console.info("["+bot.getTime("stamp")+"] [database.js] removeRole from", target, username, roles[j]);
            bot.removeRole(roles[j].serverID, user_id,roles[j].roleID, username)
          } else if (roles[j].assign_on == 'most_votes' && roleLevel == 3) {
            console.info("["+bot.getTime("stamp")+"] [database.js] removeRole from", target, username, roles[j]);
            bot.removeRole(roles[j].serverID, user_id,roles[j].roleID, username)
          } else {
            console.info("["+bot.getTime("stamp")+"] [database.js] removeRole from", target, username, roles[j]);
            bot.removeRole(roles[j].serverID, user_id,roles[j].roleID, username)
          }
        }
        if(roleLevel == 3) { //this zone had the most votes. Find the next zone with most votes.
          highest = 0;
          selection = -1;
          for (let i = 0 ; i < zones.length ; i++) { //find highest vote before assigning roles
            if (zones[i].votes > highest) {
              highest = zones[i].votes;
              selection = i;
            }
          }
          if(selection != -1) {  //next highest vote count found. Search zone role and update
            zones[selection].role_level = 3;
            query = "SELECT zone_roles FROM service_zones WHERE zone_name = ?";
            data = [zones[selection].zone_name];
            result = await database.db.query(query, data);
            roles = result[0][0].zone_roles;
            for (let i = 0 ; i < roles.length ; i++) {
              if (roles[i].assign_on == 'most_votes') {
                console.info("["+bot.getTime("stamp")+"] [database.js] added most_votes role:", zones[selection].zone_name, roles[i].roleID, username);
                bot.assignRole(roles[i].serverID,user_id,roles[i].roleID, username, access_token);
              }
            }
            query = 'UPDATE stripe_users SET zone_votes = ? WHERE user_id = ?';
            data = [JSON.stringify(zones),user_id];
            await database.db.query(query, data);
          }
        }
      }
    }
  },
  allocateVotes: async function(userid, allocations, percentage) {
    var query = "SELECT customer_type, total_votes, zone_votes FROM stripe_users WHERE user_id = ?";
    var data = [userid];
    result = await database.db.query(query, data);
    if(result[0][0].zone_votes != null)
    {
        allocations = JSON.parse(allocations)
        zones = result[0][0].zone_votes;
        total = result[0][0].total_votes;
        type = result[0][0].customer_type;
        sum = 0;
        amortized = 0;
        real = 0;
        natural = 0;
        var query2 = '';
        var data2 = []
        if(percentage == 100)
        {
          length = zones.length - 1;
        }
        else
        {
          length = zones.length;
        }
        for (i = 0; i < length; i++)
        {
          real = (allocations[i].percent/100) * total + amortized;
          natural = Math.floor(real);
          amortized = real - natural;
          if(type != 'inactive' && type != 'lifetime-inactive')  //update zone counts if active
          {
            query2 = "UPDATE service_zones SET total_votes = total_votes - ? WHERE zone_name = ?";
            data2 = [zones[i].votes - natural, zones[i].zone_name];
            await database.db.query(query2, data2);
            data2 = [zones[i].votes - natural,zones[i].parent_name];
            await database.db.query(query2, data2);
          }
          zones[i].votes = natural;
          sum += natural;
        }
        if(percentage == 100) {
          if(type != 'inactive' && type != 'lifetime-inactive')  //update zone counts if active
          {
            query2 = "UPDATE service_zones SET total_votes = total_votes - ? WHERE zone_name = ?";
            data2 = [zones[i].votes - (total-sum), zones[i].zone_name];
            await database.db.query(query2, data2);
            data2 = [zones[i].votes -zones[i].parent_name];
            await database.db.query(query2, data2);
          }
          zones[i].votes = total - sum;
        }
        zone_votes = JSON.stringify(zones);
        let query = "UPDATE stripe_users SET zone_votes = ? WHERE user_id = ?";
        let data = [zone_votes,userid];
        await database.db.query(query, data);
      }
  },
  updateZoneOverride: async function(value,zone) {
    if (value == '') {
      value = 0;
    }
    var query = 'SELECT admin_worker_override, parent_zone FROM service_zones WHERE zone_name = ?';
    var data = [zone];
    result = await database.db.query(query, data);
    originalValue = result[0][0].admin_worker_override;
    if(result[0][0].parent_zone != null) {
      query = 'UPDATE service_zones SET admin_worker_override = admin_worker_override +  ? WHERE zone_name = ?';
      data = [value - originalValue, result[0][0].parent_zone];
      await database.db.query(query, data);
    }
    query = 'UPDATE service_zones SET admin_worker_override = ? WHERE zone_name = ?';
    data = [value, zone]
    await database.db.query(query, data);
  },
  calcZones: async function() {
    let query = `SELECT user_id, customer_type, zone_votes FROM stripe_users WHERE zone_votes IS NOT NULL AND customer_type <> ? AND customer_type <> ?`;
    let data = ['inactive', 'lifetime-inactive'];
    let user_counts = [];
    user_counts[0] = { zone_name: "all_zones", count: 0, votes: 0 };
    let parent_counts = [];
    result = await database.db.query(query, data);
    if (result[0][0]) {
      result = result[0];
      for (let i = 0; i < result.length; i++) {
        user_counts[0].count++
        for (let x = 0; x < result[i].zone_votes.length; x++) {
          user_counts[0].votes = user_counts[0].votes + result[i].zone_votes[x].votes;
          let existingZone = user_counts.find(item => item.zone_name === result[i].zone_votes[x].zone_name);
          if (existingZone) {
            existingZone.count++;
            existingZone.votes = existingZone.votes + result[i].zone_votes[x].votes;
          } else {
            user_counts.push({ zone_name: result[i].zone_votes[x].zone_name, count: 1, votes:result[i].zone_votes[x].votes  });
          }
          result[i].zone_votes[x].user_id = result[i].user_id;
          parent_counts.push(result[i].zone_votes[x]);
        }
      }
      let uniqueUsersMap = new Map();
      parent_counts.forEach(parent => {
        let key = `${parent.parent_name}_${parent.user_id}`;
        if (!uniqueUsersMap.has(key)) {
          uniqueUsersMap.set(key, true);
          let existingParent = user_counts.find(item => item.zone_name === parent.parent_name);
          if (existingParent) {
            existingParent.count++;
          } else {
            user_counts.push({ zone_name: parent.parent_name, count: 1, votes: 0 });
          }
        }
        user_counts.forEach(zone => {
          if (parent.parent_name == zone.zone_name) {
            zone.votes = zone.votes + parent.votes;
          }
        });
      });
    }
    query = `SELECT zone_name FROM service_zones`;
    zones = await database.db.query(query, []);
    if (zones[0][0]) {
      zones = zones[0];
      for (let z = 0; z < zones.length; z++) {
        let existingCount = user_counts.find(item => item.zone_name === zones[z].zone_name);
        if (!existingCount) {
          user_counts.push({ zone_name: zones[z].zone_name, count: 0, votes: 0 });
        }
      }
    }
    for (let u = 1; u < user_counts.length; u++) {
      query = 'UPDATE service_zones SET total_users = ?, total_votes = ? WHERE zone_name = ?';
      data = [user_counts[u].count, user_counts[u].votes, user_counts[u].zone_name];
      await database.db.query(query, data);
    }
    return user_counts;
  },
  updateWorkerCalc: async function(workers = config.service_zones.workers) {
    var query = 'SELECT * FROM service_zones';
    var data = [];
    result = await database.db.query(query, data);
    if (result[0]) {
      result=result[0];
      result.sort(function(a, b){return a.total_votes - b.total_votes}); // sort results in ascending vote order
      var totalVotes = 0, voteCalc = 0, assigned = 0, remaining = workers, parents = [], children = [];
      for (let i = 0; i < result.length; i++) { //grab all zones vote total first from parents and sort into arrays, adding counters to parents
        if (result[i].parent_zone == null) {
          totalVotes += result[i].total_votes;
          result[i].calcWorkerCounter = 0;
          result[i].assignWorkerCounter = 0;
          parents.push(result[i]);
        } else {
          children.push(result[i]);
        }
      }
      for (let i = 0; i < children.length; i++) { //loop children to update workers, respecting max
        if (totalVotes === 0) { // if everything is empty, clear out variables so no workers are calced
          voteCalc = 0;
          remaining = 0;
        } else if (children[i].total_votes === 0) { // zero out empty voted zones
          voteCalc = 0;
        } else { // we have votes, do work
          voteCalc = Math.round(children[i].total_votes * 100.0 / totalVotes) / 100;
          voteCalc = Math.round(voteCalc * workers);
          if (voteCalc < 1) { voteCalc = 1; } // protect low votes from 0 workers
          remaining = remaining - voteCalc; // reduce remaining workers by calced amount
        }
        if (i == children.length-1) { // on last child
          voteCalc = voteCalc + remaining; // clear any +/- workers from rounding and low zone protection - will always be on highest vote due to sort earlier
        }
        assigned = voteCalc + children[i].admin_worker_override;
        query = 'UPDATE service_zones SET calc_workers = ? , assigned_workers = ? WHERE zone_name = ?';
        data = [voteCalc, assigned, children[i].zone_name];
        await database.db.query(query, data);
        for (let p = 0; p < parents.length; p++) {
          if (children[i].parent_zone == parents[p].zone_name) { // push worker totals to parent counters
            parents[p].calcWorkerCounter = parents[p].calcWorkerCounter + voteCalc;
            parents[p].assignWorkerCounter = parents[p].assignWorkerCounter + assigned;
          }
        }
      }
      for (let t = 0; t < parents.length; t++) { //loop through parents to update counts in DB
        query = 'UPDATE service_zones SET calc_workers = ? , assigned_workers = ? WHERE zone_name = ?';
        data = [parents[t].calcWorkerCounter, parents[t].assignWorkerCounter, parents[t].zone_name];
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
    } else {
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
    } else {
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
              let query = `UPDATE stripe_users SET customer_type = ?, stripe_id = NULL, price_id = NULL, expiration = NULL WHERE user_id = ?`;
              let data = [cx_type, user.user_id];
              database.runQuery(query, data);
              if (config.service_zones.roles_enabled && user.customer_type != 'inactive' && user.customer_type != 'lifetime-inactive' && user.customer_type != 'administrator' && user.zone_votes) {
                await database.updateZoneRoles(user.user_id, '', 'all','remove');
              }
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
              await database.runQuery(`UPDATE stripe_users SET access_token = 'Left Guild', refresh_token = NULL, token_expiration = NULL, customer_type = 'inactive', price_id = NULL, expiration = NULL WHERE user_id = ?`, [user.user_id]);
              await database.updateZoneRoles(user.user_id, '', 'all','remove');
              db_updated = true;
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") Member Left Guild. Cancelled Subscriptions/Access.");
              bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Cancelled Subscriptions/Access.', config.discord.log_channel);
              if (indexcounter === records.length) { return database.doneDetails(); }
            } else if (user.customer_type == "lifetime-active" || user.customer_type == "lifetime-inactive" && user.access_token != 'Left Guild') {
              await database.runQuery(`UPDATE stripe_users SET access_token = 'Left Guild', refresh_token = NULL, token_expiration = NULL, customer_type = 'lifetime-inactive' WHERE user_id = ?`, [user.user_id]);
              await database.updateZoneRoles(user.user_id, '', 'all','remove');
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
    let query = `SELECT * FROM stripe_users`;
    let data = [];
    records = await database.db.query(query, data);
    if (!records[0]) {
      console.info('Empty database for role check');
    } else {
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
                      bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") found without a Subscription. Removed Role."); // remove and log
                      bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without a Subscription ⚠', 'Removed Role. (Internal Check)', config.discord.log_channel);
                      if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
                    } else {
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") is Verified in Discord Role.");
                      if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
                    }
                  } else if (user.stripe_id && user.price_id) { // end if member role matches config role (no role but they have a stripe & price ID)
                    if (config.stripe.price_ids[i].mode != 'payment' && user.price_id == config.stripe.price_ids[i].id) { // stripe-checked db subscription or legacy price matches price being checked
                      bot.assignRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username, user.access_token);
                      console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") User found without Role, Assigned.");
                      bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                      if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
                    } else if (config.stripe.price_ids[i].mode == 'payment' && user.price_id == config.stripe.price_ids[i].id) { // check for Pay-As-You-Go purch roles
                      if (user.expiration > unix) { //check if expired
                        bot.assignRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username, user.access_token); // add & log
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  Pay-As-You-Go User found without Role, Assigned.");
                        bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                        if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
                      } else { // give role if clear, remove price and expiry if not
                        let query = `UPDATE stripe_users SET customer_type = 'inactive', price_id = NULL, expiration = NULL WHERE user_id = ?`;
                        let data = [member.user.id];
                        await database.runQuery(query, data);
                        await database.updateTotalVote(user.user_id, 0);
                        console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  Pay-As-You-Go User expired, cleared price and expiry.");
                        bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'User found without Role ⚠', 'Assigned Role. (Stripe Check)', config.discord.log_channel);
                        if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
                      } // end expiry check
                    } // end check Pay-As-You-Go purch record
                  } // end if user has stripe & price id
                } // end for each price in config
                console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+") doesn't need and has no Discord Role.");
                if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
              } // end guild member
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  User left guild mid-maintenance, will be corrected next run.");
              if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
            default:
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+records.length+") "+user.user_name+" ("+user.user_id+" | "+user.stripe_id+")  User is Inactive, Manually Administered, Lifetime or Admin and handled in Discord Role Check.");
              if (indexcounter === records.length) { return database.doneDatabaseRoles(); } else { return;}
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
          setTimeout(async function() {
            let query = `SELECT * FROM stripe_users WHERE user_id = ?`;
            let data = [member.user.id];
            record = await database.db.query(query, data);
            if (!record[0][0]) {
              bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
              bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.discord.log_channel);
              console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) Not in Database, removed Role.");
              if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
            } else { //record found
              record = record[0][0];
              switch(true) {
                case (record.customer_type == 'manual'): // check manual
                  if (record.expiration < unix) {
                    bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                    let query = `UPDATE stripe_users SET customer_type = 'inactive', expiration = NULL WHERE user_id = ?`;
                    let data = [record.user_id];
                    database.runQuery(query, data);
                    await database.calcZones();
                    await database.updateZoneRoles(record[0].user_id, '', 'all','remove');
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_id+") Manually Tracked User Expired, Removing Role & Flags.");
                    bot.sendDM(member, 'Subscription Ended', 'Your subscription has expired. Please sign up again to continue.', 'FFFF00');
                    bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'Manually Tracked User Expired ⚠', 'Removed Role & Flags. (Role Check)', config.discord.log_channel);
                    if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
                  }
                  break;
                case (record.customer_type == 'pay-as-you-go' || record.customer_type == 'subscriber'):
                  if (!record.stripe_id) { // no stripe id remove (should no longer be possible)
                    bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                    record[0].stripe_id = "Not Found";
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_id+") User found without a Stripe ID, Removed Role.");
                    bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'User found without a Stripe ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                    if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
                  } else if (!record.price_id || config.stripe.price_ids[i].mode == 'payment' && record.expiration < unix || record.price_id && record.price_id != config.stripe.price_ids[i].id) { //no price or temp plan expired or price doesn't belong to role remove
                    bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                    console.info("["+bot.getTime("stamp")+"] [database.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_id+") User found expired or without/wrong Price ID, Removed Role.");
                    bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'User found expired or without a Price ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                    if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { return database.checkLifetime(); }
                  }
                  break;
                case (record.customer_type == 'administrator'):
                  break;
                default:
                  bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                  bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'Lifetime or Inactive User found with a Price Role ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
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
      let query = `SELECT * FROM stripe_users WHERE customer_type = 'lifetime-active' OR customer_type = 'lifetime-inactive'`;
      let data = [];
      records = await database.db.query(query, data);
      if (!records[0]) {
        console.info('No stripe lifetime users');
        return database.doneDiscordRoles();
      } else {
        records[0].forEach((user, index) => {
          if (user.customer_type == 'lifetime-active') {
            activeUsers.push(user);
          } else if (user.customer_type == 'lifetime-inactive' && user.access_token != 'Left Guild') {
            inactiveUsers.push(user);
          }
        });
        return database.syncLifetime(active, inactive, activeUsers, inactiveUsers);
      }
    }
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
          let query = `INSERT INTO stripe_users (user_id, user_name, customer_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), customer_type=VALUES(customer_type), price_id = NULL`;
          let data = [member.user.id, member.user.username, 'lifetime-active'];
          database.runQuery(query, data);
          if (config.service_zones.roles_enabled) { database.updateZoneRoles(member.user.id,''); }
          if (indexcounter === activeNoDB.length && activeNoRole.length === 0 && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (activeNoRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+activeNoRole.length+" Active Lifetime Users in Database without their role, assigning.");
      activeNoRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.assignRole(config.discord.guild_id, user.user_id, config.discord.lifetime_role, user.user_name, user.access_token);
          if (config.service_zones.roles_enabled) { database.updateZoneRoles(user.user_id, ''); }
          if (indexcounter === activeNoRole.length && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (inactiveNoDB.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+inactiveNoDB.length+" Inactive Lifetime Users without proper Database Information, updating.");
      inactiveNoDB.forEach((member, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          let query = `INSERT INTO stripe_users (user_id, user_name, customer_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), customer_type=VALUES(customer_type), price_id = NULL`;
          let data = [member.user.id, member.user.username, 'lifetime-inactive'];
          database.runQuery(query, data);
          if (config.service_zones.roles_enabled) { database.updateZoneRoles(member.user.id, '', 'all', 'remove'); }
          if (indexcounter === inactiveNoDB.length && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (inactiveNoRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+inactiveNoRole.length+" Inactive Lifetime Users in Database without their role, assigning.");
      inactiveNoRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.assignRole(config.discord.guild_id, user.user_id, config.discord.inactive_lifetime_role, user.user_name, user.access_token);
          if (config.service_zones.roles_enabled) { database.updateZoneRoles(user.user_id, '', 'all', 'remove'); }
          if (indexcounter === inactiveNoRole.length && removeActiveRole.length === 0) { return database.doneDiscordRoles(); }
        }, 500 * index);
      });
    }
    if (removeActiveRole.length > 0) {
      console.info("["+bot.getTime("stamp")+"] [database.js] Found "+removeActiveRole.length+" Inactive Lifetime Users in Database still have active role, removing.");
      removeActiveRole.forEach((user, index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          bot.removeRole(config.discord.guild_id, user.user.id, config.discord.lifetime_role, user.user_name);
          if (config.service_zones.roles_enabled) { database.updateZoneRoles(user.user_id, '', 'all', 'remove'); }
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
    await database.calcZones();
    await database.updateWorkerCalc();
    console.info("["+bot.getTime("stamp")+"] [database.js] Zone sync complete.");
    return console.info("["+bot.getTime("stamp")+"] [database.js] Maintenance routines complete.");
  }  
}

// EXPORT database
module.exports = database;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
stripe = require(__dirname+'/stripe.js');