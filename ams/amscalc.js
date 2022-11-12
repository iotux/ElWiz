const yaml = require('yamljs');
const configFile = "./config.yaml";
const db = require('../misc/dbinit.js');
const { skewDays } = require('../misc/util.js');

// Load broker and topics preferences from config file
const config = yaml.load(configFile);

const debug = config.DEBUG;

const amsCalc = {

  lastMeterConsumption: 0,
  lastMeterProduction: 0,
  accumulatedConsumption: 0,
  accumulatedProduction: 0,
  // Not used
  lastMeterConsumptionReactive: 0,
  lastMeterProductionReactive: 0,

  calc: function (obj) {

    // Energy consumed last hour
    if (this.lastMeterConsumption > 0) {
      obj.accumulatedConsumptionLastHour = (obj.lastMeterConsumption - this.lastMeterConsumption).toFixed(3) * 1;
      this.accumulatedConsumption += obj.accumulatedConsumptionLastHour;
    }
      else obj.accumulatedConsumptionLastHour = 0;
    this.lastMeterConsumption = obj.lastMeterConsumption;

    if (this.lastMeterProduction > 0) {
      obj.accumulatedProductionLastHour = (obj.lastMeterProduction - this.lastMeterProduction).toFixed(3) * 1;
      this.accumulatedProduction += obj.accumulatedConsumptionLastHour;
    }
      else obj.accumulatedProductionLastHour = 0;
    this.lastMeterProduction = obj.lastMeterProduction;

    obj.accumulatedConsumption = this.accumulatedConsumption.toFixed(3) * 1;
    obj.accumulatedProduction = this.accumulatedProduction.toFixed(3) * 1;
   
    db.set("lastMeterConsumption", obj.lastMeterConsumption);
    db.set("lastMeterProduction", obj.lastMeterProduction);
    db.set("lastMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
    db.set("lastMeterProductionReactive", obj.lastMeterProductionReactive);

    db.set("accumulatedConsumption", obj.accumulatedConsumption);
    db.set("accumulatedProduction", obj.accumulatedProduction);
    db.set("accumulatedConsumptionLastHour", obj.accumulatedConsumptionLastHour);
    db.set("accumulatedProductionLastHour", obj.accumulatedProductionLastHour);
    //db.set('minPower', obj.minPower);
    //db.set('maxPower', obj.maxPower);
    //db.set('averagePower', obj.averagePower);

    if (obj.meterDate.substr(11, 8) === "00:00:10") {
      // https://youtu.be/j81Vx-0uM0k
      this.accumulatedConsumption = 0;
      this.accumulatedProduction = 0;
      this.accumulatedConsumptionLastHour = 0;
      this.accumulatedProductionLastHour = 0;
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