var bot, database, maintenance, migration, oauth2, qbo, qboData, stripe, utils;

let serviceZones = [];

async function initializeServiceZones() {
  serviceZones = await database.fetchZones();
}

async function getServiceZone(zone_name) {
  for (let z = 0; z < serviceZones.length; z++) {
    if (zone_name == serviceZones[z].zone_name) {
      let serviceZone = await utils.deepClone(serviceZones[z]);
      return serviceZone;
    }
  }
}

async function updateZone(zone_name, updatedZone) {
  for (let z = 0; z < serviceZones.length; z++) {
    if (zone_name == serviceZones[z].zone_name) {
      serviceZones[z] = await utils.deepClone(updatedZone);
    }
  }
}

async function getServiceZones() {
  let serviceZonesCopy = await utils.deepClone(serviceZones);
  return serviceZonesCopy;
}

module.exports = {
  initializeServiceZones,
  getServiceZone,
  updateZone,
  getServiceZones
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
utils = require(__dirname+'/utils.js');