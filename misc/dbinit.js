const fs = require("fs");
const JSONdb = require('simple-json-db');
const cache = require('../misc/cache.js');
const yaml = require("yamljs");
const configFile = "./config.yaml";
const config = yaml.load(configFile);

// TODO: make a better storage spec
const savePath = config.savePath; //'./data/'
const cacheName = 'powersave';
const cacheFile = savePath + cacheName + '.json'

let useRedis = (config.cache === 'redis');

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

async function dbInit(name, data) { 
  if (useRedis) {
    db = new cache(name, {syncOnWrite: true})
    if (db.JSON() === null) {
      db.JSON(JSON.parse(data));
      db.sync();
    }
  } else {
    const cacheFile = savePath + name + '.json'
    db = new JSONdb(cacheFile, { jsonSpaces: 2, syncOnWrite: true });
    if (fs.existsSync(cacheFile)) {
      let savings = fs.readFileSync(cacheFile);
      db.JSON(JSON.parse(savings));
    } else {
      if (!fs.existsSync(savePath))
        fs.mkdirSync(savePath, { recursive: true });
      //fs.writeFileSync(cacheFile, JSON.stringify(data, false, 2))
      db.JSON(data);
      db.sync();
    }
  }
}
dbInit(cacheName, energySavings);
console.log(db.JSON())

module.exports = db;
