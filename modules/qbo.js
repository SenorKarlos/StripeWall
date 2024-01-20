var bot, database, oauth, stripe;
const moment = require('moment');
const axios = require('axios');
const QuickBooks = require('node-quickbooks');
const config = require("../config/config.json");

const qbo_js = new QuickBooks(
  config.qbo.consumerKey,
  config.qbo.consumerSecret,
  config.qbo.oauthToken,
  false, // no token secret for oAuth 2.0
  config.qbo.realmId,
  false, // use the sandbox?
  true, // enable debugging?
  null, // set minorversion, or null for the latest version
  '2.0', //oAuth version
  config.qbo.refreshToken
);

const qbo = {
//------------------------------------------------------------------------------
//  
//------------------------------------------------------------------------------
  findCustomers: function () {
    return new Promise(function(resolve) {
      qbo_js.findCustomers({
        fetchAll: true
      }, function(e, customers) {
        return resolve(console.log(customers));
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
oauth2 = require(__dirname+'/oauth2.js');
stripe = require(__dirname+'/stripe.js');