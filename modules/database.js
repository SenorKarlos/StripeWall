var bot, maintenance, oauth2, qbo, qboData, stripe, zones;
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
  runQuery: async function(query, data) {
    return new Promise(async function(resolve) {
      result = await database.db.query(query, data);
      if (!result[0]) {
        return resolve(false);
      }
      else {
        return resolve(true);
      }
    });
  },
//------------------------------------------------------------------------------
//  USER TABLE FETCH
//------------------------------------------------------------------------------
  fetchUser: async function(user_id) {
    result = await database.db.query(`SELECT * FROM customers WHERE user_id = ?`, [user_id]);
    if (result[0][0]) {
      return result[0][0];
    }
    else {
      return false;
    }
  },
//------------------------------------------------------------------------------
//  USER TERMS REVIEWED
//------------------------------------------------------------------------------
  termsReviewed: async function(user_id) {
    await database.db.query(`UPDATE customers SET terms_reviewed = 'true' WHERE user_id = ?`, [user_id]);
  },
//------------------------------------------------------------------------------
//  ZONE VOTE/WORKER FUNCTIONS
//------------------------------------------------------------------------------
  updateZoneSelection: async function(user_id, selection, allocations, format) {
    if (selection != '') {
      await database.db.query(`UPDATE customers SET zone_votes = ?, allocations = ?, zones_reviewed = ?, format = ? WHERE user_id = ?`, [selection, allocations, 'true', format, user_id]);
    }
    else {
      await database.db.query(`UPDATE customers SET allocations = ?, zones_reviewed = ?, format = ? WHERE user_id = ?`, [allocations, 'true', format, user_id]);
    }
  },
  updateZoneRoles: async function(user_id, selection, target = 'all', action = 'add', roleLevel = 0) {
    result = await database.db.query(`SELECT user_name, access_token, zone_votes FROM customers WHERE user_id = ?`, [user_id]);
    username = result[0][0].user_name;
    access_token = result[0][0].access_token;
    if (selection == '') { // this happens when on $ mode. This will be set later.
      if (result[0][0].zone_votes == null) { return 0; }
      user_zones = result[0][0].zone_votes;
    }
    else {
      user_zones = JSON.parse(selection);
    }
    let service_zones = await zones.getServiceZones();
    highestVote = 0;
    highestZone = '';
    lastHighestZone = '';
    if (target == 'all') { // cycle through all zones
      for (let i = 0; i < user_zones.length; i++) { // find highest vote before assigning roles
        if (user_zones[i].votes > highestVote) {
          highestVote = user_zones[i].votes;
          highestZone = user_zones[i].zone_name;
        }
        if (user_zones[i].role_level == 3) {
          lastHighestZone = user_zones[i].zone_name;
        }
      }
      update = false;  // flag. If any changes happen with upcoming loop, update zone_votes.
      for (let i = 0; i < user_zones.length; i++) {
        let service_zone = await zones.getServiceZone(user_zones[i].zone_name);
        if (service_zone.zone_roles != null) {
          roles = service_zone.zone_roles;
          originalLevel = user_zones[i].role_level;
          temp_level = 0;
          for (let j = 0 ; j < roles.length ; j++) {
            if (roles[j].assign_on == 'any_area') {
              if (action == 'remove') {
                if (user_zones[i].role_level > 0) { // this triggers when user is going inactive
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed any_area role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.removeRole(roles[j].serverID, user_id, roles[j].roleID, username);
                  if (changed) { temp_level = 0; }
                }
              }
              else {
                if (user_zones[i].role_level < 1) {
                  console.info("["+bot.getTime("stamp")+"] [database.js] Added any_area role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.assignRole(roles[j].serverID, user_id, roles[j].roleID, username, access_token);
                  if (changed) { temp_level = 1; }
                }
              }
            }
            else if (roles[j].assign_on == 'any_votes') {
              if (action == 'remove') {
                if (user_zones[i].role_level > 1) { // this triggers when user is going inactive
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed any_votes role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.removeRole(roles[j].serverID, user_id, roles[j].roleID, username);
                  if (changed) { temp_level = 0; }
                  
                }
              }
              else {
                if (user_zones[i].votes > 0 && user_zones[i].role_level < 2) {
                  console.info("["+bot.getTime("stamp")+"] [database.js] Added any_votes role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.assignRole(roles[j].serverID,user_id,roles[j].roleID, username, access_token)
                  if (changed && temp_level < 2) { temp_level = 2; }
                }
                else if (user_zones[i].votes == 0 && user_zones[i].role_level > 1) { // votes went from non-zero to zero. Remove role.
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed any_votes role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.removeRole(roles[j].serverID, user_id, roles[j].roleID, username);
                  if (changed && temp_level == 0) { temp_level = 1; }
                }
              }
            }
            else if (roles[j].assign_on == 'most_votes') {
              if (action == 'remove') {
                if (user_zones[i].role_level > 2) { // this triggers when user is going inactive
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed most_votes role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.removeRole(roles[j].serverID, user_id,roles[j].roleID, username);
                  if (changed) { temp_level = 0; }
                }
              }
              else {
                if (lastHighestZone == user_zones[i].zone_name && lastHighestZone != highestZone) { // previous highest vote has been outvoted. Remove role
                  console.info("["+bot.getTime("stamp")+"] [database.js] Removed most_votes role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.removeRole(roles[j].serverID, user_id, roles[j].roleID, username);
                  if (changed && user_zones[i].votes == 0) {
                    temp_level = 1;
                  }
                  else {
                    temp_level = 2;
                  }
                }
                else if (highestZone == user_zones[i].zone_name && lastHighestZone != user_zones[i].zone_name) { // if zone is new highest, assign.
                  console.info("["+bot.getTime("stamp")+"] [database.js] Added most_votes role:", user_zones[i].zone_name, roles[j].roleID, username);
                  let changed = await bot.assignRole(roles[j].serverID, user_id, roles[j].roleID, username, access_token);
                  if (changed) { temp_level = 3; }
                }
              }
            }
          }
          if ((originalLevel != temp_level && temp_level != 0) || action == 'remove') {
            user_zones[i].role_level = temp_level;
            update = true;
          }
        }
      }
      if (update) {
        await database.db.query(`UPDATE customers SET zone_votes = ? WHERE user_id = ?`, [JSON.stringify(user_zones), user_id]);
      }
    }
    else { // one zone specified. This means we're removing roles
      let service_zone = await zones.getServiceZone(target);
      if (service_zone.zone_roles != null) {
        roles = service_zone.zone_roles;
        for (let j = 0; j < roles.length; j++) {
          if (roles[j].assign_on == 'any_vote' && roleLevel > 1) {
            console.info("["+bot.getTime("stamp")+"] [database.js] removeRole from", target, username, roles[j]);
            bot.removeRole(roles[j].serverID, user_id,roles[j].roleID, username)
          }
          else if (roles[j].assign_on == 'most_votes' && roleLevel == 3) {
            console.info("["+bot.getTime("stamp")+"] [database.js] removeRole from", target, username, roles[j]);
            bot.removeRole(roles[j].serverID, user_id,roles[j].roleID, username)
          }
          else {
            console.info("["+bot.getTime("stamp")+"] [database.js] removeRole from", target, username, roles[j]);
            bot.removeRole(roles[j].serverID, user_id,roles[j].roleID, username)
          }
        }
        if (roleLevel == 3) { // this zone had the most votes. Find the next zone with most votes.
          highest = 0;
          selection = -1;
          for (let i = 0 ; i < user_zones.length ; i++) { // find highest vote before assigning roles
            if (user_zones[i].votes > highest) {
              highest = user_zones[i].votes;
              selection = i;
            }
          }
          if (selection != -1) { // next highest vote count found. Search zone role and update
            user_zones[selection].role_level = 3;
            let service_zone = await zones.getServiceZone(user_zones[selection].zone_name);
            roles = service_zone.zone_roles;
            for (let i = 0 ; i < roles.length ; i++) {
              if (roles[i].assign_on == 'most_votes') {
                console.info("["+bot.getTime("stamp")+"] [database.js] added most_votes role:", user_zones[selection].zone_name, roles[i].roleID, username);
                bot.assignRole(roles[i].serverID,user_id,roles[i].roleID, username, access_token);
              }
            }
            await database.db.query(`UPDATE customers SET zone_votes = ? WHERE user_id = ?`, [JSON.stringify(user_zones), user_id]);
          }
        }
      }
    }
  },
  allocateVotes: async function(userid, allocations, percentage) {
    result = await database.db.query(`SELECT customer_type, total_votes, zone_votes FROM customers WHERE user_id = ?`, [userid]);
    if(result[0][0].zone_votes != null) {
      if (typeof allocations == "string") {
        allocations = JSON.parse(allocations);
      }
      let user_zones = [];
      result[0][0].zone_votes.forEach(zone => {
        user_zones.push(zone);
      });
      let remaining = total = result[0][0].total_votes;
      let voteCalc = 0;
      // Sort the allocations array
      allocations.sort((a, b) => { // If percent is the same, maintain the original order
        if (a.percent === b.percent) {
          return 0;
        }
        return b.percent - a.percent; // Otherwise, sort by percent in descending order
      });
      // Sort the zones array based on allocations order
      user_zones = user_zones.sort((a, b) => { // Find the indexes of a.zone_name and b.zone_name in allocations array
        let index_a = allocations.findIndex(item => item.zone_name === a.zone_name);
        let index_b = allocations.findIndex(item => item.zone_name === b.zone_name);
        return index_a - index_b; // Compare the indexes
      });
      for (let i = 0; i < user_zones.length; i++) {
        if (remaining > 0) { // we have votes to allocate
          voteCalc = Math.floor(total * (allocations[i].percent / 100)); // see what the math says, starting with highest %
          if (voteCalc < 1) { voteCalc = 1; } // as we run into low %, protect partial votes
          remaining = remaining - voteCalc; // deduct our votes from the remaining
          if (remaining < 0) { // if this resulted in a negative remaining
            voteCalc = voteCalc + remaining; // put it back
            remaining = 0; // set remaining to zero
          }
        }
        else { // no votes left
          voteCalc = 0; // give the zone no votes
        }
        user_zones[i].votes = voteCalc;
      }
      if (remaining > 0) { // if we have leftovers, give to highest voted zone
        user_zones[0].votes = user_zones[0].votes + remaining
      }
      // Restore the zones array back to original order
      user_zones = user_zones.sort((a, b) => {
        let index_a = result[0][0].zone_votes.findIndex(item => item.zone_name === a.zone_name);
        let index_b = result[0][0].zone_votes.findIndex(item => item.zone_name === b.zone_name);
        return index_a - index_b;
      });
      database.runQuery(`UPDATE customers SET zone_votes = ? WHERE user_id = ?`, [JSON.stringify(user_zones), userid]);
    }
  },
  updateZoneOverride: async function(value, zone) {
    if (value == '') {
      value = 0;
    }
    let service_zone = await zones.getServiceZone(zone);
    let originalValue = service_zone.admin_worker_override;
    if (service_zone.parent_zone != null) {
      let parent_zone = await zones.getServiceZone(service_zone.parent_zone);
      parent_zone.admin_worker_override += (value - originalValue);
      await zones.updateZone(parent_zone.zone_name, parent_zone);
      database.db.query(`UPDATE service_zones SET admin_worker_override = admin_worker_override + ? WHERE zone_name = ?`, [value - originalValue, service_zone.parent_zone]);
    }
    service_zone.admin_worker_override = value;
    await zones.updateZone(zone, service_zone);
    database.db.query(`UPDATE service_zones SET admin_worker_override = ? WHERE zone_name = ?`, [value, zone]);
  },
  calcZones: async function() {
    let user_counts = [];
    user_counts[0] = { zone_name: "all_zones", count: 0, votes: 0 };
    let parent_counts = [];
    result = await database.db.query(`SELECT user_id, customer_type, zone_votes FROM customers WHERE zone_votes IS NOT NULL AND customer_type <> 'inactive' AND customer_type <> 'lifetime-inactive'`, []);
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
          }
          else {
            user_counts.push({ zone_name: result[i].zone_votes[x].zone_name, count: 1, votes:result[i].zone_votes[x].votes });
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
          }
          else {
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
    let service_zones = await zones.getServiceZones();
    for (let z = 0; z < service_zones.length; z++) {
      let existingCount = user_counts.find(item => item.zone_name === service_zones[z].zone_name);
      if (!existingCount) {
        user_counts.push({ zone_name: service_zones[z].zone_name, count: 0, votes: 0 });
        service_zones[z].total_users = 0;
        service_zones[z].total_votes = 0;
      }
      else {
        if (!existingCount.count) {
          service_zones[z].total_users = 0;
        }
        else {
          service_zones[z].total_users = existingCount.count;
        }
        if (!existingCount.votes) {
          service_zones[z].total_votes = 0;
        }
        else {
          service_zones[z].total_votes = existingCount.votes;
        }
      }
      await zones.updateZone(service_zones[z].zone_name, service_zones[z]);
      database.db.query(`UPDATE service_zones SET total_users = ?, total_votes = ? WHERE zone_name = ?`, [service_zones[z].total_users, service_zones[z].total_votes, service_zones[z].zone_name]);
    }
    return user_counts;
  },
  updateWorkerCalc: async function(workers = config.service_zones.workers) {
    let service_zones = await zones.getServiceZones();
    service_zones.sort(function(a, b){return a.total_votes - b.total_votes}); // sort service_zones in ascending vote order
    let totalVotes = 0, voteCalc = 0, assigned = 0, remaining = workers, parents = [], children = [];
    for (let z = 0; z < service_zones.length; z++) { // grab all zones vote total first from parents and sort into arrays
      if (service_zones[z].parent_zone == null) {
        totalVotes += service_zones[z].total_votes;
        let parentZone = { ...service_zones[z] }
        parentZone.index = z;
        parentZone.calc_workers = 0;
        parentZone.assigned_workers = 0;
        parents.push(parentZone);
      }
      else {
        let childZone = { ...service_zones[z] }
        childZone.index = z;
        children.push(childZone);
      }
    }
    for (let i = 0; i < children.length; i++) { // loop children to update workers, respecting max
      if (totalVotes === 0) { // if everything is empty, clear out remaining and skip calcs
        remaining = 0;
      }
      else if (children[i].total_votes === 0) { // zero out empty voted zones
        voteCalc = 0;
      }
      else { // we have votes, do work
        voteCalc = Math.round(children[i].total_votes * 100.0 / totalVotes) / 100;
        voteCalc = Math.round(voteCalc * workers);
        if (voteCalc < 1) { voteCalc = 1; } // protect low votes from 0 workers
        remaining = remaining - voteCalc; // reduce remaining workers by calced amount
      }
      if (i == children.length-1) { // on last child
        voteCalc = voteCalc + remaining; // clear any +/- workers from rounding and low zone protection - will always be on highest vote due to sort earlier
      }
      assigned = voteCalc + children[i].admin_worker_override;
      service_zones[children[i].index].calc_workers = voteCalc;
      service_zones[children[i].index].assigned_workers = assigned;
      await zones.updateZone(children[i].zone_name, service_zones[children[i].index]);
      database.db.query(`UPDATE service_zones SET calc_workers = ?, assigned_workers = ? WHERE zone_name = ?`, [voteCalc, assigned, children[i].zone_name]);
      for (let p = 0; p < parents.length; p++) {
        if (children[i].parent_zone == parents[p].zone_name) { // push worker totals to parent totals
          parents[p].calc_workers += voteCalc;
          parents[p].assigned_workers += assigned;
        }
      }
    }
    for (let p = 0; p < parents.length; p++) { // loop through parents to update counts in DB
      service_zones[parents[p].index].calc_workers = parents[p].calc_workers;
      service_zones[parents[p].index].assigned_workers = parents[p].assigned_workers;
      await zones.updateZone(parents[p].zone_name, service_zones[parents[p].index]);
      database.db.query(`UPDATE service_zones SET calc_workers = ?, assigned_workers = ? WHERE zone_name = ?`, [parents[p].calc_workers, parents[p].assigned_workers, parents[p].zone_name]);
    }
  },
//------------------------------------------------------------------------------
//  ZONE TABLE FETCH
//------------------------------------------------------------------------------
  fetchZones: async function() {
    result = await database.db.query(`SELECT * FROM service_zones`, []);
    if (result[0]) {
      return result[0];
    }
    else {
      return false;
    }
  }
}

// EXPORT database
module.exports = database;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
maintenance = require(__dirname+'/maintenance.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
qboData = require(__dirname+'/qboData.js');
stripe = require(__dirname+'/stripe.js');
zones = require(__dirname+'/zones.js');