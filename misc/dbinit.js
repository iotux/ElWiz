const fs = require("fs");
const JSONdb = require('simple-json-db');

const energyFile = './data/powersave.json'

const energySavings = {
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
function dbInit(file, data) { 
  if (fs.existsSync(file)) {
    let savings = fs.readFileSync(file);
    db.JSON(JSON.parse(savings));
  } else {
    fs.writeFileSync(file, JSON.stringify(data, false, 2))
    db.JSON(data);
    db.sync();
  }
}
dbInit(energyFile, energySavings);
console.log(db.JSON())

module.exports = db;
