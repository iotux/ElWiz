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
      if (db.get("isVirgin") || db.get("isVirgin") === undefined) {
        db.set("isVirgin", false);
        // Set initial values = current
        db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
        db.set("prevDayMeterProduction", obj.lastMeterProduction);
        db.set("prevDayMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
        db.set("prevDayMeterProductionReactive", obj.lastMeterProductionReactive);
        db.set("lastMeterConsumption", obj.lastMeterConsumption);
        db.set("lastMeterProduction", obj.lastMeterProduction);
        db.sync();
      }
      // Energy calculations
      obj.accumulatedConsumptionLastHour = (obj.lastMeterConsumption - db.get("lastMeterConsumption")).toFixed(3) * 1;
      obj.accumulatedProductionLastHour = (obj.lastMeterProduction - db.get("lastMeterProduction")).toFixed(3) * 1;

      // TODO: Add Reactive?

      // Save current values for next round
      db.set("lastMeterConsumption", obj.lastMeterConsumption);
      db.set("lastMeterProduction", obj.lastMeterProduction);
      db.set("lastMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
      db.set("lastMeterProductionReactive", obj.lastMeterProductionReactive);

      // Helper (temporary)
      obj.curHour = obj.meterDate.substr(11, 5)
    }

    if (obj.meterDate.substr(11, 8) === "00:00:10") {
      // Once every day after midnight
      // https://youtu.be/j81Vx-0uM0k
      db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
      db.set("prevDayMeterProduction", obj.lastMeterProduction);
      db.set("prevDayMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
      db.set("prevDayMeterProductionReactive", obj.lastMeterProductionReactive);

      obj.accumulatedConsumption = 0;
      obj.accumulatedProduction = 0;

      db.set("minPower", 9999999);
      db.set("averagePower", 0);
      db.set("maxPower", 0);
      obj.curDay = skewDays(0);
      obj.nextDay = skewDays(1);
    } else {
      obj.accumulatedConsumption = (obj.lastMeterConsumption - db.get("prevDayMeterConsumption")).toFixed(3) * 1;
      obj.accumulatedProduction = (obj.lastMeterProduction - db.get("prevDayMeterProduction")).toFixed(3) * 1;
    }

    if (obj.meterDate.substr(8, 2) === "01") {
      // TODO: Monthly summary to Mongo
    }
    db.sync();

    return obj;
  }
}

module.exports = amsCalc;
