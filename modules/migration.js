var bot, database, maintenance, oauth2, qbo, qboData, stripe, utils, zones;
const fs = require('fs');
const path = require('path');
const config = require("../config/config.json");
const currentVersion = '01';
const migration = {
  start: async function() {
    console.info("["+utils.getTime("stamp")+"] [migration.js] Checking Database Migration Status.");
    let metadata;
    try {
      metadata = await database.db.query(`SELECT * FROM metadata`, []);
    } catch (e) {
      if (e.code && e.code == 'ER_NO_SUCH_TABLE') {
        console.info("["+utils.getTime("stamp")+"] [migration.js] Database Empty, create structure.");
        await this.initializeDatabase();
        await database.db.query("INSERT INTO metadata (`key`, `value`) VALUES (?, ?)", ['DB_VERSION', '01']);
        metadata = await database.db.query(`SELECT * FROM metadata`, []);
        console.info("["+utils.getTime("stamp")+"] [migration.js] Checking Database for Pre-Migrations User Table.");
        let old_table;
        try {
          old_table = await database.db.query(`SELECT * FROM stripe_users`, []);
        } catch {
          console.info("["+utils.getTime("stamp")+"] [migration.js] Pre-Migrations User Table does not exist.");
        }
        if (old_table && old_table[0].length > 0) {
          console.info("["+utils.getTime("stamp")+"] [migration.js] Pre-Migrations User Table exists, migrating users.");
          for (const record of old_table[0]) {
            await new Promise(resolve => {
              setTimeout(async () => {
                let data = [];
                data[0] = record.user_id;
                data[1] = record.user_name;
                data[2] = record.email;
                if (record.manual == 'true') {
                  if (record.temp_plan_expiration) {
                    if (record.temp_plan_expiration == '9999999998') {
                      data[3] = 'lifetime-inactive';
                      data[4] = null;
                    }
                    else if (record.temp_plan_expiration == '9999999999') {
                      data[3] = 'lifetime-active';
                      data[4] = null;
                    }
                    else {
                      data[3] = 'pay-as-you-go';
                      let price_id, source, found = false;
                      if (record.price_id) {
                        price_id = record.price_id;
                        source = 'manual';
                      }
                      else {
                        for (let i = 0; i < config.stripe.price_ids.length; i++) {
                          if (!found && config.stripe.price_ids[i].mode == 'payment') {
                            price_id = config.stripe.price_ids[i].id;
                            source = 'manual'
                            found = true;
                          }
                        }
                      }
                      let paygo_data = {
                        source: source,
                        price_id: price_id,
                        expiration: Number(record.temp_plan_expiration)
                      }
                      data[4] = JSON.stringify(paygo_data);
                    }
                  }
                  else {
                    data[3] = 'inactive';
                    data[4] = null;
                  }
                }
                else {
                  if (record.price_id && !record.temp_plan_expiration) {
                    data[3] = 'subscriber';
                    data[4] = null;
                  }
                  else if (record.price_id && record.temp_plan_expiration) {
                    data[3] = 'pay-as-you-go';
                    let paygo_data = {
                      source: 'stripe',
                      price_id: record.price_id,
                      expiration: Number(record.temp_plan_expiration)
                    }
                    data[4] = JSON.stringify(paygo_data);
                  }
                  else {
                    data[3] = 'inactive';
                    data[4] = null;
                  }
                }
                data[5] = record.tax_rate;
                await database.db.query(`INSERT INTO customers (user_id, user_name, email, customer_type, paygo_data, tax_rate) VALUES (?, ?, ?, ?, ?, ?)`, data);
                console.info("["+utils.getTime("stamp")+"] [migration.js] Inserted User "+data[1]+": "+data[0]+", "+data[2]+", "+data[3]+".");
                resolve();
              }, config.maintenance.timeout);
            });
          };
        }
        if (config.qbo.enabled) {
          console.info("["+utils.getTime("stamp")+"] [migration.js] QBO Enabled, set Metadata");
          try {
            const qbo_metadata = require("../config/qbo_metadata.json");
            let data = [];
            data[0] = qbo_metadata.id;
            data[1] = qbo_metadata.basic_auth_token;
            data[2] = qbo_metadata.refresh_token;
            data[3] = qbo_metadata.refresh_token_expiry;
            data[4] = qbo_metadata.oauth_token;
            data[5] = qbo_metadata.oauth_token_expiry;
            data[6] = qbo_metadata.customer_type_id;
            data[7] = qbo_metadata.service_product_id;
            data[8] = qbo_metadata.donation_product_id;
            data[9] = qbo_metadata.stripe_fee_expense_id;
            data[10] = JSON.stringify(qbo_metadata.tax_ids);
            data[11] = qbo_metadata.stripe_account_id;
            data[12] = qbo_metadata.bank_account_id;
            data[13] = qbo_metadata.invoice_prefix;
            data[14] = qbo_metadata.invoice_sequence;
            await database.db.query(`INSERT INTO qbo_metadata (id, basic_auth_token, refresh_token, refresh_token_expiry, oauth_token, oauth_token_expiry, customer_type_id, service_product_id, donation_product_id, stripe_fee_expense_id, tax_ids, stripe_account_id, bank_account_id, invoice_prefix, invoice_sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, data);
          } catch (e) {
            console.info("["+utils.getTime("stamp")+"] [migration.js] Unable to set QBO Metadata, review error and instructions", e);
            process.exit(4);
          }
        }
      }
      else {
        console.info("["+utils.getTime("stamp")+"] [migration.js] Database Error, Aborting."+ e);
        throw e;
      }
    }
    if (metadata && metadata[0][0].key && metadata[0][0].key == 'DB_VERSION' && metadata[0][0].value) {
      if (Number(currentVersion) > Number(metadata[0][0].value)) {
        console.info("["+utils.getTime("stamp")+"] [migration.js] Database requires updating, current: "+metadata[0][0].value+", target: "+currentVersion+".");
        const startVersion = parseInt(metadata[0][0].value) + 1;
        const endVersion = parseInt(currentVersion);
        for (let i = startVersion; i <= endVersion; i++) {
          const migrationDir = path.join(__dirname, '..', 'sql');
          const migrationFile = `${i.toString().padStart(2, '0')}.sql`;
          const filePath = path.join(migrationDir, migrationFile);
          try {
            console.info("["+utils.getTime("stamp")+"] [migration.js] Running migration: "+migrationFile);
            const sqlContent = fs.readFileSync(filePath, 'utf8');
            const sqlStatements = sqlContent.split(';');
            for (const sqlStatement of sqlStatements) {
              if (sqlStatement.trim() !== '') {
                await database.db.query(sqlStatement.trim(), []);
              }
            }
            console.info("["+utils.getTime("stamp")+"] [migration.js] Migration "+migrationFile+" completed successfully.");
            await database.db.query("UPDATE metadata SET `value` = ? WHERE `key` = ?", [i.toString().padStart(2, '0'), 'DB_VERSION']);
            console.info("["+utils.getTime("stamp")+"] [migration.js] Updated DB_VERSION to "+i+".");
          } catch (e) {
            console.error("["+utils.getTime("stamp")+"] [migration.js] Error running migration "+migrationFile+": "+e);
            throw e;
          }
        }
      }
      else {
        console.info("["+utils.getTime("stamp")+"] [migration.js] Database Up To Date.");
      }
    }
  },
  initializeDatabase: async function() {
    const migrationDir = path.join(__dirname, '..', 'sql');
    const migrationFile = '01.sql';
    const filePath = path.join(migrationDir, migrationFile);
    try {
      console.info("["+utils.getTime("stamp")+"] [migration.js] Running migration: "+migrationFile);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      const sqlStatements = sqlContent.split(';');
      for (const sqlStatement of sqlStatements) {
        if (sqlStatement.trim() !== '') {
          await database.db.query(sqlStatement.trim(), []);
        }
      }
      console.info("["+utils.getTime("stamp")+"] [migration.js] Migration "+migrationFile+" completed successfully.");
    } catch (e) {
      console.error("["+utils.getTime("stamp")+"] [migration.js] Error running migration "+migrationFile+": "+e);
      throw e;
    }
  }
}

// EXPORT maintenance
module.exports = migration;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
database = require(__dirname+'/database.js');
maintenance = require(__dirname+'/maintenance.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
qboData = require(__dirname+'/qboData.js');
stripe = require(__dirname+'/stripe.js');
utils = require(__dirname+'/utils.js');
zones = require(__dirname+'/zones.js');