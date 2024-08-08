// Import required modules
const UniCache = require('../misc/unicache.js');
const { loadYaml } = require('../misc/util.js');

// Load configuration
const configFile = './config.yaml';
const config = loadYaml(configFile);

// Cache configuration
const cacheDebug = config.unicache.debug || false;
const cacheName = 'powersave';
const cacheOptions = {
  //cacheType: config.cacheType || 'file',
  cacheType: 'file',
  syncOnWrite: false,
  syncInterval: 10, // seconds
  savePath: config.savePath || './data',
  debug: cacheDebug
};

// Initial energy savings data
const energySavings = {
  isVirgin: true,
  // Reactive data not used for now
  //lastMeterConsumptionReactive: 0,
  //lastMeterProductionReactive: 0,
  //prevDayMeterConsumptionReactive: 0,
  //prevDayMeterProductionReactive: 0,
  // Consumption cache
  consumptionCurrentHour: 0,
  consumptionToday: 0,
  lastMeterConsumption: 0,
  prevHourMeterConsumption: 0,
  prevDayMeterConsumption: 0,
  prevMonthMeterConsumption: 0,
  // Production cache
  productionCurrentHour: 0,
  productionToday: 0,
  lastMeterProduction: 0,
  prevHourMeterProduction: 0,
  prevDayMeterProduction: 0,
  prevMonthMeterProduction: 0,
  // Hourly consumption cache 
  topHoursAverage: 0,
  sortedHourlyConsumption: [],
  topConsumptionHours: [],
  // Cost and reward cache
  accumulatedCost: 0,
  accumulatedReward: 0,
  // Calculated power cache
  minPower: 9999999,
  maxPower: 0,
  averagePower: 0,
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
    if (cacheDebug) console.log('Database is empty')
    await db.init(data);
  }

  // Fetch the data from the cache and log it
  db.fetch().then(function (data) {
    if (cacheDebug) console.log('Powersave data loaded', data);
  });
}

dbInit(cacheName, cacheOptions, energySavings);

// Export the cache database
module.exports = db;
