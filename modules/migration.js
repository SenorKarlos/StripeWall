var bot, database, maintenance, oauth2, qbo, qboData, stripe, utils, zones;
const moment = require('moment');
const config = require("../config/config.json");
const migration = {
  start: async function() {
    console.info("["+utils.getTime("stamp")+"] [migration.js] Checking Database Migration Status.");
    let metadata = await database.db.query(`SELECT * FROM metadata`, []);
    console.log(metadata);
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