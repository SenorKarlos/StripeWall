var bot, database, maintenance, migration, oauth2, qboData, stripe, utils, zones;
const moment = require('moment');
const QuickBooks = require('node-quickbooks');
const config = require("../config/config.json");

const qbo_js = new QuickBooks(
  config.qbo.consumerKey,
  config.qbo.consumerSecret,
  null, // Place holder for oauthToken
  false, // no token secret for oAuth 2.0
  config.qbo.realmId,
  config.qbo.sandbox, // use the sandbox?
  config.qbo.debug, // enable debugging?
  null, // set minorversion, or null for the latest version
  '2.0', //oAuth version
  null // Place holder for refreshToken
);

const qbo = {
//------------------------------------------------------------------------------
//  
//------------------------------------------------------------------------------
  findAllCustomers: async function () {
    return new Promise(async function(resolve) {
      let data = await qboData.getData();
      if (!data) { return resolve(console.info('['+utils.getTime('stamp')+'] [qbo.js] Data Fetch Failure, Need logic')) }
      qbo_js.token = data.oauth_token;
      qbo_js.refreshToken = data.refresh_token;
      qbo_js.findCustomers({
        fetchAll: true
      }, function(e, customers) {
        if (e) {
          console.info('['+utils.getTime('stamp')+'] [qbo.js] QuickBooks function error: ', e);
          return resolve(false);
        }
        else {
          if (customers.QueryResponse.Customer && customers.QueryResponse.Customer.length > 0) {
            customers = customers.QueryResponse.Customer;
          }
          customers = customers.filter((customers) => customers.CustomerTypeRef);
          customers = customers.filter((customers) => customers.CustomerTypeRef.value == data.customer_type_id);
          return resolve(customers);
        }
      })
    });
  },
  createCustomer: async function (DisplayName, CompanyName, Email) {
    return new Promise(async function(resolve) {
      let data = await qboData.getData();
      if (!data) { return resolve(console.info('['+utils.getTime('stamp')+'] [qbo.js] Data Fetch Failure, Need logic')) }
      qbo_js.token = data.oauth_token;
      qbo_js.refreshToken = data.refresh_token;
      let body = {};
      body.DisplayName = DisplayName;
      body.GivenName = DisplayName;
      body.PrintOnCheckName = DisplayName;
      body.CompanyName = CompanyName;
      body.PrimaryEmailAddr = { Address: Email };
      body.CustomerTypeRef = { value: data.customer_type_id };
      qbo_js.createCustomer(body, function(e, customer) {
        if (e) {
          console.info('['+utils.getTime('stamp')+'] [qbo.js] QuickBooks function error: ', e);
          return resolve(false);
        }
        else {
          return resolve(customer);
        }
      })
    });
  },
  updateCustomer: async function (customer) {
    return new Promise(async function(resolve) {
      let data = await qboData.getData();
      if (!data) { return resolve(console.info('['+utils.getTime('stamp')+'] [qbo.js] Token Fetch Failure, Need logic')) }
      qbo_js.token = data.oauth_token;
      qbo_js.refreshToken = data.refresh_token;
      qbo_js.updateCustomer(customer, function(e, newCustomer) {
        if (e) {
          console.info('['+utils.getTime('stamp')+'] [qbo.js] QuickBooks function error: ', e);
          return resolve(false);
        }
        else {
          return resolve(newCustomer);
        }
      })
    });
  }
};
//------------------------------------------------------------------------------
//  EXPORT QBO
//------------------------------------------------------------------------------
module.exports = qbo;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
database = require(__dirname+'/database.js');
maintenance = require(__dirname+'/maintenance.js');
migration = require(__dirname+'/migration.js');
oauth2 = require(__dirname+'/oauth2.js');
qboData = require(__dirname+'/qboData.js');
stripe = require(__dirname+'/stripe.js');
utils = require(__dirname+'/utils.js');
zones = require(__dirname+'/zones.js');