var bot, database, migration, oauth2, qbo, qboData, stripe, utils, zones;
const moment = require('moment');
const config = require("../config/config.json");
const maintenance = {
//------------------------------------------------------------------------------
//  MAINTENANCE ROUTINES
//------------------------------------------------------------------------------
  checkDetails: async function() {
    console.info("["+utils.getTime("stamp")+"] [maintenance.js] Starting Customer Record Maintenance.");
    let unix = moment().unix();

    let records = await database.db.query(`SELECT * FROM customers`, []);
    if(!records[0]){
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Database Empty, Building.");
      records = [];
    }
    else {
      records = records[0];
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] "+records.length+" Database Customers found.");
    }

    let stripe_customers = await stripe.customer.list();
    if (!stripe_customers || stripe_customers.length == 0) {
      stripe_customers = [];
    }
    else {
      let duplicates = stripe_customers.reduce((acc, customer) => {
        let description = customer.description;
        if (!acc[description]) {
          acc[description] = [customer.id];
        }
        else {
          acc[description].push(customer.id);
        }
        return acc;
      }, {});
      let duplicateDescriptions = Object.keys(duplicates).filter(
        (description) => duplicates[description].length > 1
      );
      if (duplicateDescriptions.length > 0) {
        console.info("["+utils.getTime("stamp")+"] [maintenance.js] Terminating Maintenance: Duplicate Discord IDs found in Stripe:");
        for (const description of duplicateDescriptions) {
          console.info(`Discord ID: ${description}, Stripe IDs: ${duplicates[description].join(", ")}`);
        };
        return;
      }
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] "+stripe_customers.length+" Stripe Customers found.");
    }

    let timeout = config.maintenance.timeout;

    let stripeDB = stripe_customers.filter(o1 => records.some(o2 => o1.description === o2.user_id));
    if (stripeDB.length > 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Updating "+stripeDB.length+" DB records with current Stripe Data, est "+((timeout * stripeDB.length) / 1000)+" seconds.");
      for (const [index, customer] of stripeDB.entries()) {
        await new Promise(resolve => {
          setTimeout(async () => {
            for (const record of records) {
              if (customer.description == record.user_id) {
                let saved;
                try {
                  saved = await database.runQuery(`UPDATE customers SET stripe_data = ? WHERE user_id = ?`, [JSON.stringify(customer), record.user_id]);
                } catch (e) {
                  throw e;
                }
                if (!saved) { 
                  console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database update failure, logging Data for admin investigation.');
                  console.info('Data: ', record);
                  console.info('Stripe Info: ', customer);
                  return;
                }
                else {
                  record.stripe_data = customer;
                }
              }
            };
            resolve();
          }, timeout);
        });
      };
    }

    let stripeNoDB = stripe_customers.filter(o1 => !records.some(o2 => o1.description === o2.user_id));
    if (stripeNoDB.length > 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Inserting "+stripeNoDB.length+" users into the Database, est "+((timeout * stripeNoDB.length) / 1000)+" seconds.");
      for (const [index, customer] of stripeNoDB.entries()) {
        await new Promise(resolve => {
          setTimeout(async () => {
            let data = [];
            data[0] = customer.description;
            data[1] = customer.name;
            data[2] = customer.email;
            data[3] = JSON.stringify(customer);
            let saved = await database.runQuery(`INSERT INTO customers (user_id, user_name, email, stripe_data) VALUES (?, ?, ?, ?)`, data);
            if (!saved) { 
              console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database insert failure, logging Data for admin investigation.');
              console.info('Data: ', data);
              console.info('Stripe Info: ', customer);
              return;
            }
            else {
              let record = await database.fetchUser(customer.description);
              if (!record) {
                console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database fetch failure (after Stripe create), logging Data for admin investigation.');
                console.info('Data: ', data);
                console.info('Stripe Info: ', customer);
                return;
              }
              else {
                records.push(record);
              }
            }
            resolve();
          }, timeout);
        });
      };
    }

    let dbNoStripe = records.filter(o1 => !stripe_customers.some(o2 => o1.user_id === o2.description));
    if (dbNoStripe.length > 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Creating "+dbNoStripe.length+" users in Stripe, est "+((timeout * dbNoStripe.length) / 1000)+" seconds.");
      for (const [index, record] of dbNoStripe.entries()) {
        await new Promise(resolve => {
          setTimeout(async () => {
            let body = {
              name: record.user_name,
              description: record.user_id,
              email: record.email
            }
            let created = await stripe.customer.create(body);
            if (!created) {
              console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Stripe customer create failure, logging Data for admin investigation.');
              console.info('Data: ', record);
              return;
            }
            else {
              let saved = await database.runQuery(`UPDATE customers SET stripe_data = ? WHERE user_id = ?`, [JSON.stringify(created), record.user_id]);
              if (!saved) { 
                console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database update failure, logging Data for admin investigation.');
                console.info('Data: ', record);
                console.info('Stripe Info: ', created);
                return;
              }
              else {
                stripe_customers.push(created);
                record.stripe_data = created;
              }
            }
            resolve();
          }, timeout);
        });
      };
    }

    let qbo_customers = [];
    if (config.qbo.enabled) {
      qbo_customers = await qbo.findAllCustomers();
      if (qbo_customers.length > 0) {
        let duplicates = qbo_customers.reduce((acc, customer) => {
          let description = customer.CompanyName;
          if (!acc[description]) {
            acc[description] = [customer.DisplayName];
          }
          else {
            acc[description].push(customer.DisplayName);
          }
          return acc;
        }, {});
        let duplicateDescriptions = Object.keys(duplicates).filter(
          (description) => duplicates[description].length > 1
        );
        if (duplicateDescriptions.length > 0) {
          console.info("["+utils.getTime("stamp")+"] [maintenance.js] Terminating Maintenance: Duplicate Discord IDs found in QBO:");
          for (const description of duplicateDescriptions) {
            console.info(`Discord ID: ${description}, QBO Names: ${duplicates[description].join(", ")}`);
          };
          return;
        }
        console.info("["+utils.getTime("stamp")+"] [maintenance.js] "+qbo_customers.length+" QBO Customers found.");
      }
/*       //remove this after testing
      if (qbo_customers.length > 0) {
        let replace_qbo = [];
        for (const customer of qbo_customers) {
          if (customer.CompanyName == "140324435654606848" || customer.CompanyName == "236987709913038849" || customer.CompanyName == "310183376805953538" || customer.CompanyName == "319091180883410946" || customer.CompanyName == "334665120439599125" || customer.CompanyName == "339084896394018816" || customer.CompanyName == "347253566739578882" || customer.CompanyName == "347727261547495424" || customer.CompanyName == "348071080231043073" || customer.CompanyName == "472430722557280256" || customer.CompanyName == "500845294997471234" || customer.CompanyName == "595266544515284999" || customer.CompanyName == "715224647779614771" || customer.CompanyName == "719581038900281435" || customer.CompanyName == "993050981724078170" || customer.CompanyName == "1012935499528294480" || customer.CompanyName == "1117529808621023334" || customer.CompanyName == "342400795586592770" || customer.CompanyName == "839212770271952897") {
            replace_qbo.push(customer);
          }
        };
        qbo_customers = replace_qbo;
        console.info("["+utils.getTime("stamp")+"] [maintenance.js] "+qbo_customers.length+" QBO Customers used for test.");
      }
      // end remove */

      let qboDB = qbo_customers.filter(o1 => records.some(o2 => o1.CompanyName == o2.user_id));
      if (qboDB.length > 0) {
        console.info("["+utils.getTime("stamp")+"] [maintenance.js] Updating "+qboDB.length+" DB records with current QBO Data, est "+((timeout * qboDB.length) / 1000)+" seconds.");
        for (const [index, customer] of qboDB.entries()) {
          await new Promise(resolve => {
            setTimeout(async () => {
              for (const record of records) {
                if (customer.CompanyName == record.user_id) {
                  let saved;
                  try {
                    saved = database.runQuery(`UPDATE customers SET qbo_data = ? WHERE user_id = ?`, [JSON.stringify(customer), record.user_id]);
                  } catch (e) {
                    throw e;
                  }
                  if (!saved) { 
                    console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database update failure, logging Data for admin investigation.');
                    console.info('Data: ', record);
                    console.info('Stripe Info: ', customer);
                    return;
                  }
                  else {
                    record.qbo_data = customer;
                  }
                }
              };
              resolve();
            }, timeout);
          });
        };
      }

      let qboNoDB = qbo_customers.filter(o1 => !records.some(o2 => o1.CompanyName == o2.user_id));
      if (qboNoDB.length > 0) {
        console.info("["+utils.getTime("stamp")+"] [maintenance.js] Inserting "+qboNoDB.length+" users into the Database and Creating in Stripe, est "+(((timeout * qboNoDB.length) + timeout) / 1000)+" seconds.");
        for (const [index, customer] of qboNoDB.entries()) {
          await new Promise(resolve => {
            setTimeout(async () => {
              let data = [];
              data[0] = customer.CompanyName;
              data[1] = customer.DisplayName;
              if (customer.PrimaryEmailAddr) {
                data[2] = customer.PrimaryEmailAddr.Address;
              }
              else {
                data[2] = null;
              }
              data[4] = JSON.stringify(customer);
              let body = {
                name: data[1],
                description: data[0],
                email: data[2]
              }
              let created = await stripe.customer.create(body);
              if (!created) {
                console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Stripe customer create failure, logging Data for admin investigation.');
                console.info('Data: ', data);
                console.info('QBO Record: ', customer);
                return;
              }
              else {
                data[3] = JSON.stringify(created);
                stripe_customers.push(created);
              }
              let saved = await database.runQuery(`INSERT INTO customers (user_id, user_name, email, stripe_data, qbo_data) VALUES (?, ?, ?, ?, ?)`, data);
              if (!saved) {
                console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database insert failure, logging Data for admin investigation.');
                console.info('Data: ', data);
                console.info('QBO Record: ', customer);
                console.info('Stripe Record: ', created);
                return;
              }
              else {
                let record = await database.fetchUser(customer.CompanyName);
                if (!record) {
                  console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database fetch failure (after QBO/Stripe create), logging Data for admin investigation.');
                  console.info('Data: ', data);
                  console.info('QBO Record: ', customer);
                  console.info('Stripe Record: ', created);
                  return;
                }
                else {
                  records.push(record);
                }
              }
              resolve();
            }, timeout);
          });
        };
      }

      let dbNoQBO = records.filter(o1 => !qbo_customers.some(o2 => o1.user_id == o2.CompanyName));
      if (dbNoQBO.length > 0) {
        console.info("["+utils.getTime("stamp")+"] [maintenance.js] Creating "+dbNoQBO.length+" users in QBO, est "+((((timeout * 3) * dbNoQBO.length)) / 1000)+" seconds.");
        for (const [index, record] of dbNoQBO.entries()) {
          await new Promise(resolve => {
            setTimeout(async () => {
              let created = await qbo.createCustomer(record.user_name, record.user_id, record.email);
              if (!created) {
                console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: QBO customer create failure, logging Data for admin investigation.');
                console.info('Data: ', record);
                return;
              }
              else {
                qbo_customers.push(created);
                let saved = await database.runQuery(`UPDATE customers SET qbo_data = ? WHERE user_id = ?`, [JSON.stringify(created), record.user_id]);
                if (!saved) {
                  console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Database insert failure, logging Data for admin investigation.');
                  console.info('Data: ', record);
                  console.info('QBO Record: ', created);
                  return;
                }
                else {
                  record.qbo_data = created;
                }
              }
              resolve();
            }, timeout * 3);
          });
        };
      }
    }

    if (config.qbo.enabled) {
      if (records.length === stripe_customers.length && records.length === qbo_customers.length) {
        console.info('['+utils.getTime('stamp')+'] [maintenance.js] Records prepared for checking and updating.');
        console.info('DB: '+records.length+', Stripe: '+stripe_customers.length+', QBO: '+qbo_customers.length+'.');
      }
      else {
        console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Record arrays not aligned.');
        console.info('DB: '+records.length+', Stripe: '+stripe_customers.length+', QBO: '+qbo_customers.length+'.');
        return;
      }
    }
    else {
      if (records.length === stripe_customers.length) {
        console.info('['+utils.getTime('stamp')+'] [maintenance.js] Records prepared for checking and updating.');
        console.info('DB: '+records.length+', Stripe: '+stripe_customers.length+'.');
      }
      else {
        console.info('['+utils.getTime('stamp')+'] [maintenance.js] Terminating Maintenance: Record arrays not aligned.');
        console.info('DB: '+records.length+', Stripe: '+stripe_customers.length+'.');
        return;
      }
    }

    console.info("["+utils.getTime("stamp")+"] [maintenance.js] Checking for Discord profile updates and record validity on "+records.length+" Database Users.");
    for (const [index, dbuser] of records.entries()) {
      let indexcounter = index + 1;
      await new Promise(resolve => {
        setTimeout(async () => {
          let member;
          let db_updated = false;
// create charge list array if not present
          if (!dbuser.charge_list) {
            let charge_list = await stripe.customer.getCharges(dbuser.stripe_data.id);
            database.runQuery('UPDATE customers SET charge_list = ? WHERE user_id = ?', [JSON.stringify(charge_list), dbuser.user_id]);
            db_updated = true;
          }
// Determine guild membership status
          try {
            member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(dbuser.user_id);
          } catch (e) {
            return console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Unable to check Guild Membership.", e);
          }
// Cancel any active statuses or subscriptions if they have left, preserve lifetime status as inactive
          if (!member) {
            if (dbuser.customer_type == "pay-as-you-go" || dbuser.customer_type == "subscriber") {
              if (dbuser.stripe_data && dbuser.stripe_data.subscriptions.data[0]) {
                for (let x = 0; x < dbuser.stripe_data.subscriptions.data.length; x++) {
                  await stripe.subscription.cancel(dbuser.user_name, dbuser.user_id, dbuser.stripe_data.subscriptions.data[x].id);
                }
              }
              await database.runQuery(`UPDATE customers SET access_token = NULL, refresh_token = NULL, token_expiration = NULL, customer_type = 'inactive', paygo_data = NULL WHERE user_id = ?`, [dbuser.user_id]);
              if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
              db_updated = true;
              console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Member Left Guild. Cancelled Subscriptions/Access.");
              await bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', 'Found Database Discrepency ⚠', 'Member Left Guild. Cancelled Subscriptions/Access.', config.discord.log_channel);
              if (indexcounter === records.length) { await maintenance.doneDetails(); }
            }
            else if (dbuser.customer_type == "lifetime-active" || dbuser.customer_type == "lifetime-inactive" && dbuser.access_token != 'Left Guild') {
              await database.runQuery(`UPDATE customers SET access_token = 'Left Guild', refresh_token = NULL, token_expiration = NULL, customer_type = 'lifetime-inactive' WHERE user_id = ?`, [dbuser.user_id]);
              if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
              db_updated = true;
              console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Lifetime Member Left Guild. Set inactive.");
              await bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', 'Found Database Discrepency ⚠', 'Lifetime Member Left Guild. Set inactive.', config.discord.log_channel);
              if (indexcounter === records.length) { await maintenance.doneDetails(); }
            }
            else {
              console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Not a Guild member, User admin or already inactive.");
              if (indexcounter === records.length) { await maintenance.doneDetails(); }
            }
          }
          else {
// Verify customer_type, roles & record accuracy
            let verified = false;      
            if (dbuser.customer_type == 'administrator' || dbuser.customer_type == 'lifetime-active' || dbuser.customer_type == 'lifetime-inactive') {
              verified = true;
              dbuser.paygo_data = null;
              if (dbuser.customer_type == 'lifetime-inactive') {
                await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.discord.inactive_lifetime_role, dbuser.user_name);
                await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.discord.lifetime_role, dbuser.user_name);
                if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
              }
              else if (dbuser.customer_type == 'lifetime-active') {
                await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.discord.lifetime_role, dbuser.user_name);
                await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.discord.inactive_lifetime_role, dbuser.user_name);
                if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
              }
            }
            else if (dbuser.customer_type == 'subscriber') {
              if (dbuser.stripe_data.subscriptions && dbuser.stripe_data.subscriptions.total_count > 0) {
                for (let x = 0; x < dbuser.stripe_data.subscriptions.data.length; x++) {
                  for (let i = 0; i < config.stripe.price_ids.length; i++) {
                    if (dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id && dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
                      if (dbuser.stripe_data.subscriptions.data[x].status == 'active') {
                        await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                        if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
                        verified = true;
                        dbuser.paygo_data = null;
                      }
                    }
                  }
                }
              }
              if (!verified) {
                for (let i = 0; i < config.stripe.price_ids.length; i++) {
                  await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                }
                if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
                dbuser.customer_type = 'inactive';
              }
            }
            else if (dbuser.customer_type == 'pay-as-you-go') {
              if (dbuser.paygo_data && dbuser.paygo_data.expiration && dbuser.paygo_data.expiration > unix && dbuser.paygo_data.price_id) {
                for (let i = 0; i < config.stripe.price_ids.length; i++) {
                  if (dbuser.paygo_data.price_id == config.stripe.price_ids[i].id) {
                    await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                    if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
                    verified = true;
                  }
                }
              }
              if (!verified) {
                for (let i = 0; i < config.stripe.price_ids.length; i++) {
                  await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                }
                if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
                dbuser.customer_type = 'inactive';
                dbuser.paygo_data = null;
              }
            }
            if (dbuser.customer_type == 'inactive') {
              if (dbuser.stripe_data.subscriptions && dbuser.stripe_data.subscriptions.total_count > 0) {
                for (let x = 0; x < dbuser.stripe_data.subscriptions.data.length; x++) {          
                  for (let i = 0; i < config.stripe.price_ids.length; i++) {
                    if (dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id && dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
                      if (dbuser.stripe_data.subscriptions.data[x].status != 'active') {
                        await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                        if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
                        dbuser.customer_type = 'subscriber';
                        dbuser.paygo_data = null;
                      }
                    }
                  }
                }
              }
              if (dbuser.paygo_data) {
                if (dbuser.paygo_data.expiration && dbuser.paygo_data.expiration > unix && dbuser.paygo_data.price_id) {
                  for (let i = 0; i < config.stripe.price_ids.length; i++) {
                    if (dbuser.paygo_data.price_id == config.stripe.price_ids[i].id) {
                      await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                      if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
                      dbuser.customer_type = 'pay-as-you-go';
                    }
                  }
                }
                else {
                  dbuser.paygo_data = null;
                }
              }
            }
            if (dbuser.donation_data) {
              if (dbuser.donation_data.role_ids[0] != "") {
                await bot.assignRole(config.discord.guild_id, dbuser.user_id, dbuser.donation_data.role_ids[0], dbuser.user_name);
              }
              if (dbuser.donation_data.role_ids[1] != "") {
                await bot.assignRole(config.discord.guild_id, dbuser.user_id, dbuser.donation_data.role_ids[1], dbuser.user_name);
              }
            }
            if (dbuser.paygo_data) {
              dbuser.paygo_data = JSON.stringify(dbuser.paygo_data);
            }
            await database.runQuery(`UPDATE customers SET customer_type = ?, stripe_data = ?, paygo_data = ?, qbo_data = ? WHERE user_id = ?`, [dbuser.customer_type, JSON.stringify(dbuser.stripe_data), dbuser.paygo_data, JSON.stringify(dbuser.qbo_data), dbuser.user_id]);
// Verify discord account details with oauth or member data if active
            if (dbuser.customer_type != 'inactive' && dbuser.customer_type != 'lifetime-inactive') {
              let data = {};
              if (dbuser.access_token && dbuser.refresh_token) {
                if (!dbuser.token_expiration) { dbuser.token_expiration = 1 }
                if (unix - 86400 > dbuser.token_expiration) {
                  try {
                    data = await oauth2.refreshAccessToken(dbuser.refresh_token, dbuser.user_id, dbuser.user_name);
                    if (data.response) {
                      throw data.response;
                    }
                  } catch (e) {
                    if (e.status === 400) {
                      await database.runQuery(`UPDATE customers SET access_token = NULL, refresh_token = NULL, token_expiration = NULL WHERE user_id = ?`, [dbuser.user_id]);
                      db_updated = true;
                      console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Unable to refresh Discord token, cleared Tokens.");
                      if (indexcounter === records.length) { await maintenance.doneDetails(); }
                    }
                    else {
                      console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Unable to refresh Discord token.", e);
                      if (indexcounter === records.length) { await maintenance.doneDetails(); }
                    }
                  }
                }
                else { data.access_token = dbuser.access_token; }
                let user;
                try {
                  user = await oauth2.fetchUser(data.access_token);
                  if (user.response) {
                    throw user.response;
                  }
                } catch (e) {
                  if (e.status === 401) {
                    await database.runQuery(`UPDATE customers SET access_token = NULL, refresh_token = NULL, token_expiration = NULL WHERE user_id = ?`, [dbuser.user_id]);
                    db_updated = true;
                    console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Unable to fetch Discord information, cleared Tokens.");
                    if (indexcounter === records.length) { await maintenance.doneDetails(); }
                  }
                  else {
                    console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Unable to fetch Discord information.", e);
                    if (indexcounter === records.length) { await maintenance.doneDetails(); }
                  }
                }
                if (user.id != dbuser.user_id) { // check if token pulled right ID result, log and alert if not
                  console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") User Fetch resulted in ID mismatch, Administration should investigate (Discord Check).");
                  await bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', 'User Fetch resulted in ID mismatch ⚠', 'Administration should investigate (Discord Check)', config.discord.log_channel);
                  if (indexcounter === records.length) { await maintenance.doneDetails(); }
                }
                else { // end ID/Token result mismatch
                  if (user.username != dbuser.user_name || user.email != dbuser.email) {
                    let body = {
                      name: user.username,
                      email: user.email
                    };
                    await stripe.customer.update(dbuser.stripe_data.id, body);
                    let stripe_data = await stripe.customer.fetch(dbuser.stripe_data.id);
                    let qbo_data = dbuser.qbo_data;
                    if (config.qbo.enabled) {
                      qbo_data.GivenName = qbo_data.DisplayName = qbo_data.PrintOnCheckName = user.username;
                      qbo_data.PrimaryEmailAddr.Address = user.email;
                      qbo_data = await qbo.updateCustomer(qbo_data);
                    }
                    database.runQuery(`UPDATE customers SET user_name = ?, email = ?, stripe_data = ?, qbo_data = ? WHERE user_id = ?`, [user.username, user.email, JSON.stringify(stripe_data), JSON.stringify(qbo_data), dbuser.user_id]);
                    db_updated = true;
                  } // end detail mismatch
                } // end ID/Token result match
              }
              else { // end access and refresh token found
                if (member.user.username != dbuser.user_name) { // check username on member object only
                  let body = { name: member.user.username };
                  await stripe.customer.update(dbuser.stripe_data.id, body);
                  let stripe_data = await stripe.customer.fetch(dbuser.stripe_data.id);
                  let qbo_data = dbuser.qbo_data;
                  if (config.qbo.enabled) {
                    qbo_data.GivenName = qbo_data.DisplayName = qbo_data.PrintOnCheckName = member.user.username;
                    qbo_data = await qbo.updateCustomer(qbo_data);
                  }
                  database.runQuery(`UPDATE customers SET user_name = ?, stripe_data = ?, qbo_data = ? WHERE user_id = ?`, [member.user.username, JSON.stringify(stripe_data), JSON.stringify(qbo_data), dbuser.user_id]);
                  db_updated = true;
                } // end detail mismatch
              } // end access and refresh token not found
              if (db_updated) {
                console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Updated Database details.");
                if (indexcounter === records.length) { await maintenance.doneDetails(); }
              }
              else {
                console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") Verified Database details.");
                if (indexcounter === records.length) { await maintenance.doneDetails(); }
              }
            }
            else { // end type not inactive
              console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+records.length+") "+dbuser.user_name+" ("+dbuser.user_id+" | "+dbuser.stripe_data.id+") User is Inactive, Skip.");
              if (indexcounter === records.length) { await maintenance.doneDetails(); }
            }
          } // end is guild member
          resolve();
        }, 500);
      });
    }; //end for each user record
  },
  doneDetails: async function() {
    console.info("["+utils.getTime("stamp")+"] [maintenance.js] Discord Info Sync complete.");
    await maintenance.getRoleMembers();
  },
  getRoleMembers: async function() {
    console.info("["+utils.getTime("stamp")+"] [maintenance.js] Starting Discord Role Maintenance.");
    console.info("["+utils.getTime("stamp")+"] [maintenance.js] Checking "+config.stripe.price_ids.length+" Roles.");
    let roleArray = [];
    for (let i = 0; i < config.stripe.price_ids.length; i++) { //for each price
      await new Promise(resolve => {
        setTimeout(async () => {
          let guild = await bot.guilds.cache.get(config.discord.guild_id); // pull guild info
          let members = await guild.roles.cache.find(role => role.id === config.stripe.price_ids[i].role_id).members.map(m => m); // map role members from price
          roleArray.push(members);
          if (i === config.stripe.price_ids.length - 1) { await maintenance.checkDiscordRoles(roleArray); }
          resolve();
        }, 500);
      });
    }
  },
  checkDiscordRoles: async function(roleArray) {
    let unix = moment().unix();
    for (const [i, members] of roleArray.entries()) {
      await new Promise(resolve => {
        setTimeout(async () => {
          if (members.length === 0) {
            console.info("["+utils.getTime("stamp")+"] [maintenance.js] "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
            if (i === config.stripe.price_ids.length - 1) { await maintenance.checkLifetime(); }
          }
          else {
            console.info("["+utils.getTime("stamp")+"] [maintenance.js] Checking "+members.length+" Users in Role "+config.stripe.price_ids[i].role_id+".");
          }
          for (const [index, member] of members.entries()) { //for each member in role
            let indexcounter = index + 1;
            await new Promise(resolve => {
              setTimeout(async () => {
              let record = await database.db.query(`SELECT * FROM customers WHERE user_id = ?`, [member.user.id]);
                if (!record[0][0]) {
                  await bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                  await bot.sendEmbed(member.user.username, member.user.user_id, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.discord.log_channel);
                  console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) Not in Database, removed Role.");
                  if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { await maintenance.checkLifetime(); }
                }
                else { //record found
                  record = record[0][0];
                  let verified = true;
                  switch(true) {
                    case (record.customer_type == 'pay-as-you-go'):
                      if (!record.paygo_data || !record.paygo_data.expiration || record.paygo_data.expiration < unix || !record.paygo_data.price_id || record.paygo_data.price_id != config.stripe.price_ids[i].id) {
                        await bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                        await database.runQuery(`UPDATE customers SET customer_type = 'inactive', paygo_data = NULL WHERE user_id = ?`, [record.user_id]);
                        console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_data.id+") Pay-As-You-Go User in role without valid information, Removed Role.");
                        await bot.sendEmbed(member.user.username, member.user.id, 'FF0000', 'Pay-As-You-Go User in role without valid information ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                        verified = false;
                        if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { await maintenance.checkLifetime(); }
                      }
                      break;
                    case (record.customer_type == 'subscriber'):
                      if (!record.stripe_data || !record.stripe_data.subscriptions || record.stripe_data.subscriptions.total_count === 0) {
                        await bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                        console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_data.id+") Subscriber found in role without valid information, Removed Role.");
                        await bot.sendEmbed(member.user.username, member.user.id, 'FF0000', 'Subscriber found in role with missing stripe/subscription info ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                        verified = false;
                        if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { await maintenance.checkLifetime(); }
                      }
                      else {
                        let id_found = false;
                        for (let x = 0; x < record.stripe_data.subscriptions.data.length; x++) {
                          if (record.stripe_data.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
                            id_found = true;
                          }
                        }
                        if (!id_found) {
                          await bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                          console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_data.id+") Subscriber found in role without matching Price ID, Removed Role.");
                          await bot.sendEmbed(member.user.username, member.user.id, 'FF0000', 'Subscriber found in role without matching Price ID ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                          verified = false;
                          if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { await maintenance.checkLifetime(); }
                        }
                      }
                      break;
                    case (record.customer_type == 'inactive' || record.customer_type == 'lifetime-active' || record.customer_type == 'lifetime-inactive'):
                      await bot.removeRole(config.discord.guild_id, member.user.id, config.stripe.price_ids[i].role_id, member.user.username);
                      await bot.sendEmbed(member.user.username, member.user.id, 'FF0000', 'Lifetime or Inactive User found with a Price Role ⚠', 'Removed Role. (Role Check)', config.discord.log_channel);
                      console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | Not Found) is Lifetime or Inactive, removed Role.");
                      verified = false;
                      if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { await maintenance.checkLifetime(); }
                      break;
                    case (record.customer_type == 'administrator'):
                      break;
                  }
                  if (verified) {
                    console.info("["+utils.getTime("stamp")+"] [maintenance.js] ("+indexcounter+" of "+members.length+") "+member.user.username+" ("+member.user.id+" | "+record.stripe_data.id+") User is verified in Role "+config.stripe.price_ids[i].role_id+".");
                    if (i === config.stripe.price_ids.length - 1 && indexcounter === members.length) { await maintenance.checkLifetime(); }
                  }
                }
                resolve();
              }, 500);
            });
          };
          resolve();
        }, 500);
      });
    };
  },
  checkLifetime: async function() {
    if (config.discord.lifetime_role) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Syncing Lifetime Users.");
      let guild = await bot.guilds.cache.get(config.discord.guild_id); // pull guild info
      let active = await guild.roles.cache.find(role => role.id === config.discord.lifetime_role).members.map(m => m);
      let inactive;
      if (config.discord.inactive_lifetime_role) {
        inactive = await guild.roles.cache.find(role => role.id === config.discord.inactive_lifetime_role).members.map(m => m);
      }
      else {
        inactive = [];
      }
      let activeUsers = [];
      let inactiveUsers = [];
      records = await database.db.query(`SELECT * FROM customers WHERE customer_type = 'lifetime-active' OR customer_type = 'lifetime-inactive'`, []);
      if (!records[0]) {
        await maintenance.syncLifetime(active, inactive, activeUsers, inactiveUsers);
      }
      else {
        for (const [index, user] of records[0].entries()) {
          if (user.customer_type == 'lifetime-active') {
            activeUsers.push(user);
          }
          else if (user.customer_type == 'lifetime-inactive' && user.access_token != 'Left Guild') {
            inactiveUsers.push(user);
          }
        };
        await maintenance.syncLifetime(active, inactive, activeUsers, inactiveUsers);
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
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Found "+activeNoDB.length+" Active Lifetime Users without proper Database Information, updating.");
      for (const [index, member] of activeNoDB.entries()) {
        let indexcounter = index + 1;
        await new Promise(resolve => {
          setTimeout(async () => {
            database.runQuery(`INSERT INTO customers (user_id, user_name, customer_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), customer_type=VALUES(customer_type)`, [member.user.id, member.user.username, 'lifetime-active']);
            if (config.service_zones.roles_enabled) { database.updateZoneRoles(member.user.id,''); }
            if (indexcounter === activeNoDB.length && activeNoRole.length === 0 && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { await maintenance.doneDiscordRoles(); }
            resolve();
          }, 500);
        });
      };
    }
    if (activeNoRole.length > 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Found "+activeNoRole.length+" Active Lifetime Users in Database without their role, assigning.");
      for (const [index, user] of activeNoRole.entries()) {
        let indexcounter = index + 1;
        await new Promise(resolve => {
          setTimeout(async () => {
            await bot.assignRole(config.discord.guild_id, user.user_id, config.discord.lifetime_role, user.user_name, user.access_token);
            if (config.service_zones.roles_enabled) { database.updateZoneRoles(user.user_id, ''); }
            if (indexcounter === activeNoRole.length && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { await maintenance.doneDiscordRoles(); }
            resolve();
          }, 500);
        });
      };
    }
    if (inactiveNoDB.length > 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Found "+inactiveNoDB.length+" Inactive Lifetime Users without proper Database Information, updating.");
      for (const [index, member] of inactiveNoDB.entries()) {
        let indexcounter = index + 1;
        await new Promise(resolve => {
          setTimeout(async () => {
            database.runQuery(`INSERT INTO customers (user_id, user_name, customer_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), customer_type=VALUES(customer_type)`, [member.user.id, member.user.username, 'lifetime-inactive']);
            if (config.service_zones.roles_enabled) { database.updateZoneRoles(member.user.id, '', 'all', 'remove'); }
            if (indexcounter === inactiveNoDB.length && inactiveNoRole.length === 0 && removeActiveRole.length === 0) { await maintenance.doneDiscordRoles(); }
            resolve();
          }, 500);
        });
      };
    }
    if (inactiveNoRole.length > 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Found "+inactiveNoRole.length+" Inactive Lifetime Users in Database without their role, assigning.");
      for (const [index, user] of inactiveNoRole.entries()) {
        let indexcounter = index + 1;
        await new Promise(resolve => {
          setTimeout(async () => {
            await bot.assignRole(config.discord.guild_id, user.user_id, config.discord.inactive_lifetime_role, user.user_name, user.access_token);
            if (config.service_zones.roles_enabled) { database.updateZoneRoles(user.user_id, '', 'all', 'remove'); }
            if (indexcounter === inactiveNoRole.length && removeActiveRole.length === 0) { await maintenance.doneDiscordRoles(); }
            resolve();
          }, 500);
        });
      };
    }
    if (removeActiveRole.length > 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Found "+removeActiveRole.length+" Inactive Lifetime Users in Database still have active role, removing.");
      for (const [index, user] of removeActiveRole.entries()) {
        let indexcounter = index + 1;
        await new Promise(resolve => {
          setTimeout(async () => {
            await bot.removeRole(config.discord.guild_id, user.user.id, config.discord.lifetime_role, user.user_name);
            if (config.service_zones.roles_enabled) { database.updateZoneRoles(user.user_id, '', 'all', 'remove'); }
            if (indexcounter === removeActiveRole.length) { await maintenance.doneDiscordRoles(); }
            resolve();
          }, 500);
        });
      };
    }
    if (activeNoDB.length === 0 && activeNoRole.length === 0 && inactiveNoDB.length === 0 && inactiveNoRole.length === 0 && removeActiveRole.length === 0) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] "+((activeUsers.length)+(inactiveUsers.length))+" known Lifetime Users are in the Database and Guild Members have roles.");
      await maintenance.doneDiscordRoles();
    }
  },
  doneDiscordRoles: async function() {
    if (config.service_zones.zones_enabled) {
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Role checks complete. Starting to sync users and votes for zones");
      await database.calcZones();
      await database.updateWorkerCalc();
      console.info("["+utils.getTime("stamp")+"] [maintenance.js] Zone sync complete.");
    }
    return console.info("["+utils.getTime("stamp")+"] [maintenance.js] Maintenance routines complete.");
  }
}

// EXPORT maintenance
module.exports = maintenance;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
database = require(__dirname+'/database.js');
migration = require(__dirname+'/migration.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
qboData = require(__dirname+'/qboData.js');
stripe = require(__dirname+'/stripe.js');
utils = require(__dirname+'/utils.js');
zones = require(__dirname+'/zones.js');