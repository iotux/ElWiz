const yaml = require('yamljs');
const configFile = "./config.yaml";
const db = require('../misc/dbinit.js');
const { skewDays } = require('../misc/util.js');

// Load broker and topics preferences from config file
const config = yaml.load(configFile);

const debug = config.DEBUG;

const amsCalc = {

  calc: function (obj) {
    // TODO: Calculate min/max/average here
    //db.set('minPower', obj.minPower);
    //db.set('maxPower', obj.maxPower);
    //db.set('averagePower', obj.averagePower);

    // Once every hour
    if (obj.meterDate.substr(14, 5) === "00:10") {
      // Set initial values === current
      if (db.get("prevDayMeterConsumption") === 0)
        db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
      if (db.get("prevDayMeterProduction") === 0)
        db.set("prevDayMeterProduction", obj.lastMeterProduction);
      if (db.get("prevDayMeterConsumptionReactive") === 0)
        db.set("prevDayMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
      if (db.get("prevDayMeterProductionReactive") === 0)
        db.set("prevDayMeterProductionReactive", obj.lastMeterProductionReactive);

      // Energy calculations
      obj.accumulatedConsumptionLastHour = (obj.lastMeterConsumption - db.get("lastMeterConsumption")).toFixed(3) * 1;
      obj.accumulatedProductionLastHour = (obj.lastMeterProduction - db.get("lastMeterProduction")).toFixed(3) * 1;
      obj.accumulatedConsumption = (obj.lastMeterConsumption - db.get("prevDayMeterConsumption")).toFixed(3) * 1;
      obj.accumulatedProduction = (obj.lastMeterProduction - db.get("prevDayMeterProduction")).toFixed(3) * 1;
      // TODO: Add Reactive?

      // TODO: Save Redis document

      // Save current values for next round
      db.set("lastMeterConsumption", obj.lastMeterConsumption);
      db.set("lastMeterProduction", obj.lastMeterProduction);
      db.set("lastMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
      db.set("lastMeterProductionReactive", obj.lastMeterProductionReactive);

      // Helper (temprary)
      obj.curHour = obj.meterDate.substr(11, 5)
    }

    if (obj.meterDate.substr(11, 8) === "00:00:10") {
      // Once every day
      // https://youtu.be/j81Vx-0uM0k
      db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
      db.set("prevDayMeterProduction", obj.lastMeterProduction);
      db.set("prevDayMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
      db.set("prevDayMeterProductionReactive", obj.lastMeterProductionReactive);
      // Moved to calculatecost.js
      //db.set("accumulatedCost", 0);
      //db.set("accumulatedReward", 0);
      db.set("minPower", 9999999);
      db.set("averagePower", 0);
      db.set("maxPower", 0);
      obj.curDay = skewDays(0);
      obj.nextDay = skewDays(1);
      // TODO: Save Redis & Mongo document
    }

    if (obj.meterDate.substr(8, 2) === "01") {
      // TODO: Monthly summary to Mongo
    }
    db.sync();

    return obj;
  }
}

module.exports = amsCalc;