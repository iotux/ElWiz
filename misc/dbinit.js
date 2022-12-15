const fs = require("fs");
const JSONdb = require('simple-json-db');

const energyFile = './powersave.json'

const energySavings = {
  "prevDayMeterConsumption": 0,
  "prevDayMeterProduction": 0,
  "lastMeterConsumption": 0,
  "lastMeterProduction": 0,
  "lastMeterConsumptionReactive": 0,
  "lastMeterProductionReactive": 0,
  "accumulatedConsumption": 0,
  "accumulatedConsumptionLastHour": 0,
  "accumulatedProductionLastHour": 0,
  "accumulatedProduction": 0,
  "accumulatedCost": 0,
  "accumulatedCostLastHour": 0,
  "accumulatedReward": 0,
  "accumulatedRewardLastHour": 0,
  "minPower": 9999999,
  "maxPower": 0,
  "averagePower": 0
};

const db = new JSONdb(energyFile, {}, { jsonSpaces: 2, syncOnWrite: true });
let isVirgin = true;
function dbInit(file, data) { 
  if (isVirgin) {
    if (fs.existsSync(energyFile)) {
      let savings = fs.readFileSync(file);
      db.JSON(JSON.parse(savings));
    } else {
      db.JSON(data);
    }
  }
}
dbInit(energyFile, energySavings);
console.log(db.JSON())

module.exports = db;
