var stripe, bot, oauth2;
const fs = require('fs');
const ini = require('ini');
const mysql = require('mysql');
const moment = require('moment');
const config = ini.parse(fs.readFileSync('./files/config.ini', 'utf-8'));
const object = {
  // RDM DATABASE CONNECTION
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
      let query = `SELECT * FROM oauth_users WHERE user_id = ? AND map_guild = ?`;
      let data = [user_id, config.guild_id];
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
      let query = `SELECT * FROM oauth_users WHERE user_id = ? AND stripe_id = ? AND map_guild = ?`;
      let data = [user_id, stripe_id, config.guild_id];
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
  //  USER RECORD UPDATE
  //------------------------------------------------------------------------------
  recordUpdate: async function() {
    let queue_query = `SELECT * FROM oauth_queue WHERE guild_id = ? AND inserted = (SELECT MIN(inserted) FROM oauth_queue)`;
    let queue_data = [config.guild_id];
    object.db.query(queue_query, queue_data, async function(err, record, fields) {
      if (record[0]) {
        let embed_title = '',
          embed_body = '',
          user_id = '',
          user_name = '';
        let guild = bot.guilds.cache.get(config.guild_id);
        let member = guild.members.cache.get(record[0].user_id);
        if (member == undefined) {
          bot.users.fetch(record[0].user_id).then(user => {
            user_id = user.id;
            user_name = user.username + '#' + user.discriminator;
          });
        } else {
          user_id = member.user.id;
          user_name = member.user.tag;
        }
        let guilds = await oauth2.fetchUserGuilds(record[0].token);
        guilds = guilds.toString().replace(/[\W]+/g, '');
        if (guilds == "ERROR") {
          console.info('[' + bot.getTime('stamp') + '] [database.js] Token deleted for ' + user_name + ' (' + user_id + ').');
          object.runQuery(`DELETE FROM oauth_queue WHERE user_id = ?`, [record[0].user_id]);
          return object.runQuery(`UPDATE oauth_users SET access_token = NULL WHERE user_id = ?`, [record[0].user_id]);
        } else {

          let user_query = `SELECT * FROM oauth_users WHERE user_id = ? AND map_guild = ?`;
          let user_data = [user_id, config.guild_id];
          object.db.query(user_query, user_data, async function(err, user, fields) {

            if (err) {
              return console.error(err);
            }
            object.runQuery(`DELETE FROM oauth_queue WHERE user_id = ?`, [record[0].user_id]);
            if (user[0]) {
              object.runQuery('UPDATE oauth_users SET guilds = ?, last_updated = ? WHERE user_id = ? AND map_guild = ?', [guilds, moment().unix(), user_id, config.guild_id]);
              console.info('[' + bot.getTime('stamp') + '] [database.js] Database Record updated for ' + user_name + ' (' + user_id + ').');
              if (config.guild_log == true && [0].guilds && [0].guilds.length < guilds.length) {
                let old_guilds = [];
                await [0].guilds.split(',').forEach((guild) => {
                  old_guilds.push(guild.split('|')[1]);
                });
                let new_guilds = guilds.split(',');
                let changed_guilds = '',
                  added = 0;
                await new_guilds.forEach((guild) => {
                  if (old_guilds.indexOf(guild.split('|')[1]) < 0) {
                    changed_guilds += guild.split('|')[0] + ',';
                    added++;
                  }
                });
                changed_guilds = changed_guilds.slice(0, -1).replace(/,/g, '\n');
                if (added > 1) {
                  embed_title = 'Joined New Guilds';
                } else {
                  embed_title = 'Joined A New Guild';
                }
                if (config.guild_log) {
                  bot.sendEmbed(member, '0000FF', embed_title, '```' + changed_guilds + '```', config.guild_log_channel);
                }
                console.info('[' + bot.getTime('stamp') + '] [database.js] ' + user_name + ' Joined new Guild(s).');
              }
            } else {
              let insert_query = `INSERT IGNORE INTO oauth_users (user_id, user_name, last_login, map_name, map_guild, stripe_id, guilds, email, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
              let insert_data = [user_id, user_name.replace(/[\W]+/g, ''), record[0].last_login, config.map_name, config.guild_id, null, guilds.toString().replace(/[\W]+/g, ''), user.email, record[0].token];
              object.db.query(insert_query, insert_data, async function(err, user, fields) {
                if (err) {
                  return console.error(err);
                } else {
                  console.info('[' + bot.getTime('stamp') + '] [database.js] ' + user_name + ' (' + user_id + ') Added to the User Database.');
                  if (config.map_log == true) {
                    let user_guilds = '';
                    await guilds.split(',').forEach((guild) => {
                      user_guilds += guild.split('|')[0] + ',';
                    });
                    user_guilds = user_guilds.slice(0, -1).replace(/,/g, '\n');
                    if (user_guilds.length > 2000) {
                      user_guilds = user_guilds.slice(0, (user_guilds.length - 1990)) + '\n[More...]';
                    }
                    if (!user_guilds) {
                      user_guilds = '*Not a Member of any Guilds*';
                    } else {
                      user_guilds = '```' + user_guilds + '```';
                    }
                    if (config.guild_log) {
                      bot.sendEmbed(member, '0000FF', 'New User', user_guilds, config.guild_log_channel);
                    }
                  }
                }
              });
            }
          });
        }
      }
    });
  },
  //------------------------------------------------------------------------------
  //  USER FINGERPRINT STORAGE AND ANALYSIS
  //------------------------------------------------------------------------------
  userTrack: function(session) {
    return new Promise(async function(resolve) {
      if (session.discord_id) {
        let matches = {},
          user_name = "",
          user_id = "";
        bot.users.fetch(session.discord_id).then(async target => {
          let insert_query = `INSERT IGNORE INTO oauth_fingerprints (user_id, user_name, ip_address, map_name, map_guild) VALUES (?,?,?,?,?)`;
          let insert_data = [session.discord_id, target.username, session.ip, config.map_name, config.guild_id];
          await object.db.query(insert_query, insert_data, function(err, inserted, fields) {
            if (err) {
              console.error(err);
            }
            let fp_query = `SELECT * FROM oauth_fingerprints WHERE ip_address = ? AND user_id <> ?`;
            let fp_data = [session.ip, session.discord_id];
            object.db.query(fp_query, fp_data, async function(err, users, fields) {
              if (err) {
                console.error(err);
              } else if (users && users.length >= 1) {
                await users.forEach((user, index) => {
                  if (!matches.full) {
                    matches.full = user.user_name + " (" + user.user_id + "),";
                  } else if (matches.full.indexOf(user.user_id) < 0) {
                    matches.full += user.user_name + " (" + user.user_id + "),";
                  }
                });
                matches.full = matches.full.slice(0, -1).replace(/,/g, '\n')
              }
              let match_query = `SELECT * FROM oauth_fingerprints WHERE map_guild = ? AND user_id <> ?`;
              let match_data = [config.guild_id, session.discord_id];
              object.db.query(match_query, match_data, async function(err, users, fields) {
                if (err) {
                  console.error(err);
                  return resolve(matches);
                } else if (users && users.length >= 1) {
                  await users.forEach((user, index) => {
                    if (!matches.partial) {
                      matches.partial = user.user_name + " (" + user.user_id + "),";
                    } else if (matches.partial.indexOf(user.user_id) < 0) {
                      matches.partial += user.user_name + " (" + user.user_id + "),";
                    }
                  });
                  matches.partial = matches.partial.slice(0, -1).replace(/,/g, '\n');
                  return resolve(matches);
                } else {
                  return resolve(matches);
                }
              });
            });
          });
        });
      }
    });
  },
  //------------------------------------------------------------------------------
  //  DONOR CHECK
  //------------------------------------------------------------------------------
  checkDonors: async function() {
    console.info("[database.js] Starting user check.")
    let query = `SELECT * FROM oauth_users WHERE map_guild = ? AND stripe_id != 'Lifetime'`;
    let data = [config.guild_id];
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
                if (!user.stripe_id) {
                  bot.removeDonor(member.id);
                  return bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role. (Internal Check)', config.stripe_log_channel);
                } else {
                  customer = await stripe.customer.fetch(user.stripe_id);
                  if (!customer || customer.deleted == true || !customer.subscriptions || !customer.subscriptions.data[0]) {
                    bot.removeDonor(member.id);
                    bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role. (Stripe Check)', config.stripe_log_channel);
                    query = `UPDATE oauth_users SET stripe_id = NULL, plan_id = NULL WHERE user_id = ? AND map_guild = ?`;
                    data = [member.id, config.guild_id];
                    return object.runQuery(query, data);
                  } else if (customer.subscriptions.data[0].status != 'active') {
                    bot.removeDonor(member.id);
                    return bot.sendEmbed(member, 'FF0000', 'User found without an Active Subscription ⚠', 'Removed Donor Role. (Stripe Check)', config.stripe_log_channel);
                  }
                }
              } else if (user.stripe_id && user.stripe_id.startsWith('cus')) {
                customer = await stripe.customer.fetch(user.stripe_id);
                if (!customer || customer.deleted == true) {
                  query = `UPDATE oauth_users SET stripe_id = NULL, plan_id = NULL WHERE user_id = ? AND map_guild = ?`;
                  data = [member.id, config.guild_id];
                  await object.runQuery(query, data);
                  return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Updated ' + user.user_name + ' Record to Reflect no Stripe information.', config.stripe_log_channel);
                } else if (!customer.subscriptions.data[0] && user.plan_id) {
                  query = `UPDATE oauth_users SET plan_id = NULL WHERE user_id = ? AND map_guild = ?`;
                  data = [member.id, config.guild_id];
                  await object.runQuery(query, data);
                  return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Deleted Subscription Plan record for ' + user.user_name + ' (' + member.id + ').', config.stripe_log_channel);
                } else if (customer.subscriptions.data[0] && customer.subscriptions.data[0].status == 'active') {
                  bot.assignDonor(member.id);
                  return bot.sendEmbed(member, 'FF0000', 'User found without Donor Role ⚠', 'Assigned Donor Role. (Stripe Check)', config.stripe_log_channel);
                } else {
                  return;
                }
              }
            } else {
              member = user.user_id;
              query = `UPDATE oauth_users SET map_guild = NULL, access_token = NULL, refresh_token = NULL, token_expiration = NULL WHERE user_id = ?`;
              data = [member.id];
              await object.runQuery(query, data);
              return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Deleted Tokens and Guild Association for ' + user.user_name + ' (' + member.id + ').', config.stripe_log_channel);
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
        let query = `SELECT * FROM oauth_users WHERE user_id = ? AND map_guild = ?`;
        let data = [member.id, config.guild_id],
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
                return bot.sendEmbed(member, 'FF0000', 'User found without a Stripe ID ⚠', 'Removed Donor Role. (Member Check)', config.stripe_log_channel);
              } else {
                customer = await stripe.customer.fetch(record[0].stripe_id);
                if (!customer || customer.deleted == true || !customer.subscriptions || !customer.subscriptions.data[0]) {
                  if (member.roles.cache.has(config.donor_role_id)) {
                    bot.removeDonor(member.id);
                  }
                  bot.sendEmbed(member, 'FF0000', 'No Customer found for this User ⚠', 'Removed Donor Role. (Member Check)', config.stripe_log_channel);
                  query = `UPDATE oauth_users SET stripe_id = NULL, plan_id = NULL WHERE user_id = ? AND map_guild = ?`;
                  data = [member.id, config.guild_id];
                  return object.runQuery(query, data);
                } else if (customer.subscriptions.data[0].status != 'active' && member.roles.cache.has(config.donor_role_id)) {
                  bot.removeDonor(member.id);
                  return bot.sendEmbed(member, 'FF0000', 'User found without an Active Subscription ⚠', 'Removed Donor Role. (Member Check)', config.stripe_log_channel);
                }
              }
              return;
            case member.roles.cache.has(config.donor_role_id):
              bot.removeDonor(member.id);
              return bot.sendEmbed(member, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.stripe_log_channel);
          }
        });
      }, 5000 * index);
    });
    return;
  },
  tokenRefresh: function() {
/*     let query = `SELECT * FROM oauth_users WHERE token_expiration < UNIX_TIMESTAMP() AND refresh_token is NOT NULL`;
    let data = [config.guild_id];
    object.db.query(query, data, async function(err, records, fields) {
      if (err) {
        console.error(err);
      } else {
        records.forEach((record, i) => {
          setTimeout(function() {
            console.log('[database.js] ['+bot.getTime('stamp')+'] Refreshing Token for '+record.user_name+' ('+record.user_id+').');
            let new_data = oauth2.refreshAccessToken(record.refresh_token);
            object.runQuery(`UPDATE IGNORE oauth_users SET access_token = ?, refresh_token = ?, token_expiration = ?, last_updated = ? WHERE user_id = ?`, [new_data.access_token, new_data.refresh_token, (moment().unix() + new_data.expires_in - 21600), moment().unix(), record.user_id]);
          }, 60000 * i);
        });
      }
    });
    return; */
  },
  //------------------------------------------------------------------------------
  //  USER GUILDS CHECK
  //------------------------------------------------------------------------------
  guildsCheck: function() {
    // let query = `SELECT * FROM oauth_users WHERE map_guild = ? AND last_updated < UNIX_TIMESTAMP()-21600`;
    // let data = [config.guild_id];
    // object.db.query(query, data, async function (err, records, fields) {
    //   if(err){ return console.error(err); }
    //   if(records[0]){
    //     records.forEach( async (record,index) => {
    //       if(!record.token){ return; }
    //       let randomInt = Math.floor(Math.random()*30000+1) - 10000;
    //       setTimeout(async function() {
    //         let guilds = await oauth2.fetchUserGuilds(record.token);
    //         if(guilds == 'ERROR'){
    //           console.log('[database.js] ['+bot.getTime('stamp')+'] Expired Token for '+record.user_name+' ('+record.user_id+') removed from the database.');
    //           object.runQuery('UPDATE oauth_users SET token = NULL WHERE user_id = ? AND map_guild = ?', [record.user_id, record.map_guild]);
    //         } else{
    //           let member = await bot.guilds.cache.get(config.guild_id).members.cache.get(record.user_id);
    //           object.recordUpdate(member, record, bot.getTime('short'), guilds.toString().replace(/[\W]+/g,''), record.token);
    //         }
    //       }, (45000+randomInt) * index);
    //     });
    //   } return;
    // });
  }
}

//------------------------------------------------------------------------------
//  FIRE OFF OAUTH CHECK
//------------------------------------------------------------------------------
setInterval(function() {
  object.recordUpdate();
  object.tokenRefresh();
}, 60000 * 1); // 1 Minute

//------------------------------------------------------------------------------
//  MYSQL CONNECTION EVENTS
//------------------------------------------------------------------------------
// object.db.on('acquire', function (connection) {
//   console.log('Connection %d acquired', connection.threadId);
// });
// object.db.on('connection', function (connection) {
//   connection.query('SET SESSION auto_increment_increment=1');
// });
// object.db.on('enqueue', function () {
//   console.log('Waiting for available connection slot');
// });
// object.db.on('release', function (connection) {
//   console.log('Connection %d released', connection.threadId);
// });
// EXPORT OBJECT
module.exports = object;

// let query = `SELECT * FROM pokebot.map_users`;
// object.db.query(query, async function (err, records, fields) {
//   records.forEach( async (record,index) => {
//     if(!record.fingerprints){ return; }
//     if(!record.user_id){ return; }
//     // object.db.query('INSERT IGNORE INTO oauth_users (user_id, user_name, last_login, map_name, map_guild, stripe_id, plan_id, guilds, email, token, last_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [record.user_id, record.user_name, record.last_login, record.map_name, record.map_guild, record.stripe_id, record.plan_id, record.guilds, record.email, record.token, record.last_updated]);
//     let fingerprints = record.fingerprints.split(',');
//     await fingerprints.forEach((value,index) => {
//       let array = value.split(':'), ip = "";
//       let fp = array[array.length - 1];
//       let ipArr = array.slice(0,-1);
//       ip = ipArr.join(":")
//       let insertQuery = `INSERT IGNORE INTO oauth_fingerprints (user_id, user_name, ip_address, fingerprint, map_name, map_guild) VALUES (?,?,?,?,?,?)`;
//       let insertData = [record.user_id, record.user_name, ip, fp, record.map_name, record.map_guild];
//       object.runQuery(insertQuery, insertData);
//     });
//   });
// });

// let query = `SELECT * FROM oauth_fingerprints`;
// object.db.query(query, async function (err, records, fields) {
//   records.forEach( async (record,index) => {
//     if(record.fingerprint.indexOf(';') >= 0){
//       let ip = record.fingerprint.split(';')[0];
//       let fp = record.fingerprint.split(';')[1];
//       let updateQuery = `UPDATE oauth_fingerprints SET ip_address = ?, fingerprint = ? WHERE user_id = ? AND fingerprint = ?`;
//       let updateData = [ip, fp, record.user_id, record.fingerprint];
//       object.runQuery(updateQuery, updateData);
//       let dQuery = `DELET FROM oauth_fingerprints WHERE ip_address = ? AND fingerprint = ? AND user_id = ?`;
//       let dData = [record.ip_address, record.fingerprint, record.user_id];
//       object.runQuery(dQuery, dData);
//     }
//   });
// });

// SCRIPT REQUIREMENTS
stripe = require(__dirname + '/stripe.js');
bot = require(__dirname + '/bot.js');
oauth2 = require(__dirname + '/oauth2.js');
