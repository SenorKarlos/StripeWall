var bot, database, maintenance, oauth2, qbo, qboData, stripe;

let serviceZones = [];

async function initializeServiceZones() {
  serviceZones = await database.fetchZones();
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

async function getServiceZone(zone_name) {
  for (let z = 0; z < serviceZones.length; z++) {
    if (zone_name == serviceZones[z].zone_name) {
      let serviceZone = await deepClone(serviceZones[z]);
      return serviceZone;
    }
  }
}

async function updateZone(zone_name, updatedZone) {
  for (let z = 0; z < serviceZones.length; z++) {
    if (zone_name == serviceZones[z].zone_name) {
      serviceZones[z] = await deepClone(updatedZone);
    }
  }
}

async function getServiceZones() {
  let serviceZonesCopy = await deepClone(serviceZones);
  return serviceZonesCopy;
}

module.exports = {
  initializeServiceZones,
  deepClone,
  getServiceZone,
  updateZone,
  getServiceZones
};

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
database = require(__dirname+'/database.js');
maintenance = require(__dirname+'/maintenance.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
qboData = require(__dirname+'/qboData.js');