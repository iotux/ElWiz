const fs = require("fs");
const JSONdb = require('simple-json-db');
const yaml = require("yamljs");
const configFile = "./config.yaml";
const config = yaml.load(configFile);

const { createClient } = require('redis');
const client = createClient();

// TODO: make a better storage spec
const savePath ='./data'
const energyFile = savePath + '/powersave.json'

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
  "costLastHour": 0,
  "rewardLastHour": 0,
  "minPower": 9999999,
  "maxPower": 0,
  "averagePower": 0
};

const db = new JSONdb(energyFile, {}, { jsonSpaces: 2, syncOnWrite: true });
async function dbInit(file, data) { 
  if (fs.existsSync(file)) {
    let savings = fs.readFileSync(file);
    db.JSON(JSON.parse(savings));
  } else {
    if (!fs.existsSync(savePath))
      fs.mkdirSync(savePath, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, false, 2))
    db.JSON(data);
    db.sync();
  }
}
dbInit(energyFile, energySavings);
console.log(db.JSON())

module.exports = db;
