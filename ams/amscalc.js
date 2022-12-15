const yaml = require('yamljs');
const configFile = "./config.yaml";
const db = require('../misc/dbinit.js');
const { skewDays } = require('../misc/util.js');

// Load broker and topics preferences from config file
const config = yaml.load(configFile);

const debug = config.DEBUG;

const amsCalc = {
  // Not used
  lastMeterConsumptionReactive: 0,
  lastMeterProductionReactive: 0,

  calc: function (obj) {

    // Energy consumtion
    if (db.get("lastMeterConsumption") > 0) {
      obj.accumulatedConsumptionLastHour = (obj.lastMeterConsumption - db.get("lastMeterConsumption")).toFixed(3) * 1;
      db.set("accumulatedConsumptionLastHour", obj.accumulatedConsumptionLastHour);
      db.set("lastMeterConsumption", obj.lastMeterConsumption);
      obj.accumulatedConsumption = (obj.lastMeterConsumption - db.get("prevDayMeterConsumption")).toFixed(3) * 1;
      db.set("accumulatedConsumption", obj.accumulatedConsumption);
    } else {
      if (db.get("prevDayMeterConsumption") === 0)
        db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
    }
    // Energy production
    if (db.get("lastMeterProduction") > 0) {
      obj.accumulatedProductionLastHour = (obj.lastMeterProduction - db.get("lastMeterProduction")).toFixed(3) * 1;
      db.set("accumulatedProductionLastHour", obj.accumulatedProductionLastHour);
      db.set("lastMeterProduction", obj.lastMeterProduction);
      obj.accumulatedProduction = (obj.lastMeterProduction - db.get("prevDayMeterProduction")).toFixed(3) * 1;
      db.set("accumulatedProduction", obj.accumulatedProduction);
    } else {
      if (db.get("prevDayMeterProduction") === 0)
        db.set("prevDayMeterProduction", obj.lastMeterProduction);
    }
   
    db.set("lastMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
    db.set("lastMeterProductionReactive", obj.lastMeterProductionReactive);

    //db.set('minPower', obj.minPower);
    //db.set('maxPower', obj.maxPower);
    //db.set('averagePower', obj.averagePower);

    if (obj.meterDate.substr(11, 8) === "00:00:10") {
      // https://youtu.be/j81Vx-0uM0k
      db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
      db.set("prevDayMeterProduction", obj.lastMeterProduction);
      db.set("accumulatedConsumption", 0);
      db.set("accumulatedProduction", 0);
      db.set("accumulatedConsumptionLastHour", 0);
      db.set("accumulatedProductionLastHour", 0);
      db.set("minPower", 9999999);
      db.set("averagePower", 0);
      db.set("maxPower", 0);
      obj.curHour = "00:00:10";
      obj.curDay = skewDays(0);
      obj.nextDay = skewDays(1);
    }
    db.sync();
    
    if (obj.meterDate.substr(14, 5) === "00:10") {
      obj.curHour = obj.meterDate.substr(11, 2)
    };
    return obj;
  }
}

module.exports = amsCalc;
