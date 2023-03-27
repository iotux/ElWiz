const yaml = require("yamljs");
const UniCache = require('../misc/unicache.js');
const configFile = "./config.yaml";
const config = yaml.load(configFile);

const cacheName = 'powersave';
const cacheOptions = {
  cacheType: config.cacheType, // ('redis' || 'file')
  syncOnWrite: false,
  syncInterval: 5,
  savePath: config.savePath    // Mandatory for cacheType: 'file'
}

const energySavings = {
  "isVirgin": true,
  "lastMeterConsumption": 0,
  "lastMeterProduction": 0,
  "lastMeterConsumptionReactive": 0,
  "lastMeterProductionReactive": 0,
  "prevDayMeterConsumption": 0,
  "prevDayMeterProduction": 0,
  "prevDayMeterConsumptionReactive": 0,
  "prevDayMeterProductionReactive": 0,
  "accumulatedCost": 0,
  "accumulatedReward": 0,
  "minPower": 9999999,
  "maxPower": 0,
  "averagePower": 0
};

let db;

async function dbInit(name, options, data) { 
  // savePath is mandatory when using file-cache
  db = new UniCache(name, options);

  if (await db.isEmpty()) {
    // Call to db.init() with 'data' argument is automatically synced
    await db.init(data);
  }
  
  db.fetch().then(function(data) {
    console.log('Data loaded', data)
  })
}

dbInit(cacheName, cacheOptions, energySavings);


module.exports = db;
