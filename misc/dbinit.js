// Import required modules
const UniCache = require('../misc/unicache.js');
const { loadYaml } = require('../misc/util.js');

// Load configuration
const configFile = './config.yaml';
const config = loadYaml(configFile);

// Cache configuration
const cacheName = 'powersave';
const cacheOptions = {
  //cacheType: config.cacheType || 'file',
  cacheType: 'file',
  syncOnWrite: false,
  syncInterval: 5,
  savePath: config.savePath || './data'
};

// Initial energy savings data
const energySavings = {
  isVirgin: true,
  lastMeterConsumption: 0,
  lastMeterProduction: 0,
  lastMeterConsumptionReactive: 0,
  lastMeterProductionReactive: 0,
  prevHourMeterConsumption: 0,
  prevHourMeterProduction: 0,
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
  averagePower: 0,
  consumptionCurrentHour: 0,
  consumptionToday: 0,
  sortedHourlyConsumption: [],
  topConsumptionHours: [],
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
  if (await db.isEmpty(name)) {
    console.log('Database is empty')
    await db.init(data);
  }

  // Fetch the data from the cache and log it
  db.fetch().then(function (data) {
    console.log('Powersave data loaded', data);
  });
}

dbInit(cacheName, cacheOptions, energySavings);

// Export the cache database
module.exports = db;
