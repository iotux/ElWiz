// Import required modules
const yaml = require("yamljs");
const UniCache = require('../misc/unicache.js');

// Load configuration
const configFile = "./config.yaml";
const config = yaml.load(configFile);

// Cache configuration
const cacheName = 'powersave';
const cacheOptions = {
  cacheType: config.cacheType || 'file',
  syncOnWrite: false,
  syncInterval: 5,
  savePath: config.savePath
};

// Initial energy savings data
const energySavings = {
  isVirgin: true,
  lastMeterConsumption: 0,
  lastMeterProduction: 0,
  lastMeterConsumptionReactive: 0,
  lastMeterProductionReactive: 0,
  prevDayMeterConsumption: 0,
  prevDayMeterProduction: 0,
  prevDayMeterConsumptionReactive: 0,
  prevDayMeterProductionReactive: 0,
  prevMonthMeterConsumption: 0,
  prevMonthMeterProduction: 0,
  accumulatedCost: 0,
  accumulatedReward: 0,
  minPower: 9999999,
  maxPower: 0,
  averagePower: 0
};

let db;

/**
 * Initialize the cache database.
 * @param {string} name - The name of the cache.
 * @param {object} options - Cache options.
 * @param {object} data - Initial data to be stored in the cache.
 */
async function dbInit(name, options, data) {
  // Initialize the cache with the given name and options
  db = new UniCache(name, options);

  // Check if the cache is empty and initialize it with the provided data
  if (await db.isEmpty()) {
    await db.init(data);
  }

  // Fetch the data from the cache and log it
  db.fetch().then(function (data) {
    console.log('Data loaded', data);
  });
}

// Initialize the cache database with the given configuration and data
dbInit(cacheName, cacheOptions, energySavings);

// Export the cache database
module.exports = db;
