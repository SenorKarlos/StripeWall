var bot, database, maintenance, migration, oauth2, qbo, qboData, stripe, zones;
const moment = require('moment');

function getTime(type) {
  switch(type){
    case 'full':
      return moment().format('dddd, MMMM Do, h:mm A');
    case 'stamp':
      return moment().format('HH:mmA');
    case 'short':
      return moment().format('DD-MMM-YYYY h:mm A');
  }
}

function deepClone(data) {
  if (data === null || typeof data !== 'object') {
    return data; // Return primitive types or null as-is
  }
  if (Array.isArray(data)) {
    return data.map(item => deepClone(item)); // Recursively clone arrays
  }
  const clonedData = {};
  for (let key in data) { // Clone objects
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      clonedData[key] = deepClone(data[key]); // Recursively clone object properties
    }
  }
  return clonedData;
}

module.exports = {
  getTime,
  deepClone
};

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
database = require(__dirname+'/database.js');
maintenance = require(__dirname+'/maintenance.js');
migration = require(__dirname+'/migration.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
qboData = require(__dirname+'/qboData.js');
stripe = require(__dirname+'/stripe.js');
zones = require(__dirname+'/zones.js');