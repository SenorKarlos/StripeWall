var bot, database, maintenance, migration, oauth2, qbo, stripe, utils, zones;
const request = require('request')
const moment = require('moment');
const config = require('../config/config.json');

const qboData = {
  getData: async function() {
    return new Promise(async function(resolve) {
      let unix = moment().unix();
      let result = await database.db.query('SELECT * FROM qbo_metadata WHERE id = ?', [1]);
      if (result[0].length > 0) {
        result = result[0][0];
      }
      else {
        console.info('['+utils.getTime('stamp')+'] [qboData.js] Inital QBO Data not entered in the database. Please ensure setup has been completed.');
        return resolve(false);
      }
      if (!result.basic_auth_token || !result.refresh_token || !result.refresh_token_expiry || !result.customer_type_id || !result.service_product_id || !result.donation_product_id || !result.stripe_fee_expense_id || config.stripe.taxes.active && !result.tax_ids || !result.stripe_account_id || !result.bank_account_id || !result.invoice_sequence) {
        console.info('['+utils.getTime('stamp')+'] [qboData.js] Required QBO information is missing from the database. Review log and setup instructions, and update as required.');
        console.info('Current Result: ' + result);
        return resolve(false);
      }
      if (result.oauth_token && result.oauth_token_expiry > unix) {
        return resolve(result);
      }
      else {
        let json = await request({
          url: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Authorization': 'Basic ' + result.basic_auth_token,
            'Content-Type' : 'application/x-www-form-urlencoded'
          },
          form: {
            refresh_token: result.refresh_token,
            grant_type: 'refresh_token'
          }
        }, async function(err, response) {
          if (err) {
            console.info('['+utils.getTime('stamp')+'] [qboData.js] Error during QBO oAuth request: ', err);
            return resolve(false);
          }
          else {
            json = JSON.parse(response.body);
            if (json.error) {
              console.info('['+utils.getTime('stamp')+'] [qboData.js] Error during QBO oAuth request: ', json);
              return resolve(false);
            }
            result.oauth_token = json.access_token;
            result.oauth_token_expiry = unix + json.expires_in;
            result.refresh_token = json.refresh_token;
            result.refresh_token_expiry = unix + json.x_refresh_token_expires_in;
            let saved = await database.db.query('UPDATE qbo_metadata SET refresh_token = ?, refresh_token_expiry = ?, oauth_token = ?, oauth_token_expiry = ? WHERE id = ?', [result.refresh_token, result.refresh_token_expiry, result.oauth_token, result.oauth_token_expiry, 1]);
            if (!saved) { 
              console.info('['+utils.getTime('stamp')+'] [qboData.js] Database update failure, logging Data for manual update and admin investigation.');
              console.info('Data: ', result);
            }
            return resolve(result);
          }
        });
      }
    });
  }
};

module.exports = qboData;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
database = require(__dirname+'/database.js');
maintenance = require(__dirname+'/maintenance.js');
migration = require(__dirname+'/migration.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
stripe = require(__dirname+'/stripe.js');
utils = require(__dirname+'/utils.js');
zones = require(__dirname+'/zones.js');