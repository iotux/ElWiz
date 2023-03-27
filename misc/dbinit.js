const yaml = require("yamljs");
const configFile = "./config.yaml";
const config = yaml.load(configFile);

const savePath = config.savePath; //'./data/'
const cacheModule = config.cacheModule
const cache = require('../misc/' + cacheModule + '.js');
const cacheName = 'powersave';

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

async function dbInit(name, data) { 
  // savePath is mandatory when using file-cache
  const db = new cache(name, {syncOnWrite: false, savepath: savePath})
  if (await db.isEmpty()) {
    // Call to db.init() with 'data' argument is automatically synced
    await db.init(data);
  }
}

dbInit(cacheName, energySavings);
console.log(db.JSON())

module.exports = db;
