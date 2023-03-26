const yaml = require('yamljs');
const configFile = "./config.yaml";
const db = require('../misc/dbinit.js');
const { skewDays } = require('../misc/util.js');

// Load broker and topics preferences from config file
const config = yaml.load(configFile);

const debug = config.DEBUG;

async function getMinPower(pow) {
  if (await db.get('minPower') === undefined || await db.get('minPower') > pow){
    await db.set('minPower', pow);
  }
  return await db.get('minPower');
};

async function getMaxPower(pow) {
  if (await db.get('maxPower') === undefined || await db.get('maxPower') < pow) {
    await db.set('maxPower', pow);
  }
  return await db.get('maxPower');
};

const amsCalc = {

  calc: async function (list, obj) {
    // TODO: Calculate min/max/average here
    obj.minPower = await getMinPower(obj.power);
    obj.maxPower = await getMaxPower(obj.power);
    // TODO: calculate average
    obj.averagePower = 0;
  
    await db.set('minPower', obj.minPower);
    await db.set('maxPower', obj.maxPower);
    await db.set('averagePower', obj.averagePower);

    // Once every hour
    if (list === 'list3') {
      if (obj.meterDate.substr(14, 5) === "00:10") {
        if (await db.get("isVirgin") || await db.get("isVirgin") === undefined) {
          await db.set("isVirgin", false);
          // Set initial values = current
          await db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
          await db.set("prevDayMeterProduction", obj.lastMeterProduction);
          await db.set("prevDayMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
          await db.set("prevDayMeterProductionReactive", obj.lastMeterProductionReactive);
          await db.set("lastMeterConsumption", obj.lastMeterConsumption);
          await db.set("lastMeterProduction", obj.lastMeterProduction);
          //await db.sync();
        }
        // Energy calculations
        obj.accumulatedConsumptionLastHour = (obj.lastMeterConsumption - await db.get("lastMeterConsumption")).toFixed(3) * 1;
        obj.accumulatedProductionLastHour = (obj.lastMeterProduction - await db.get("lastMeterProduction")).toFixed(3) * 1;
  
        // TODO: Add Reactive?
  
        // Save current values for next round
        await db.set("lastMeterConsumption", obj.lastMeterConsumption);
        await db.set("lastMeterProduction", obj.lastMeterProduction);
        await db.set("lastMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
        await db.set("lastMeterProductionReactive", obj.lastMeterProductionReactive);
  
        // Helper (temporary)
        obj.curHour = obj.meterDate.substr(11, 5)
      }
  
      if (obj.meterDate.substr(11, 8) === "00:00:10") {
        // Once every day after midnight
        // https://youtu.be/j81Vx-0uM0k
        await db.set("prevDayMeterConsumption", obj.lastMeterConsumption);
        await db.set("prevDayMeterProduction", obj.lastMeterProduction);
        await db.set("prevDayMeterConsumptionReactive", obj.lastMeterConsumptionReactive);
        await db.set("prevDayMeterProductionReactive", obj.lastMeterProductionReactive);
  
        obj.accumulatedConsumption = 0;
        obj.accumulatedProduction = 0;
  
        await db.set("minPower", 9999999);
        await db.set("averagePower", 0);
        await db.set("maxPower", 0);
        obj.curDay = skewDays(0);
        obj.nextDay = skewDays(1);
      } else {
        obj.accumulatedConsumption = (obj.lastMeterConsumption - await db.get("prevDayMeterConsumption")).toFixed(3) * 1;
        obj.accumulatedProduction = (obj.lastMeterProduction - await db.get("prevDayMeterProduction")).toFixed(3) * 1;
      }
  
      if (obj.meterDate.substr(8, 2) === "01") {
        // TODO: Monthly summary to Mongo
      }
    }

    if (list === 'list2') {
      // Syncing at every 10th seconds may be overkill
      // but may be useful for min/max/avg data
      await db.sync();
      //console.log('amscalc', await db.JSON())
    }

    return obj;
  }
}

module.exports = amsCalc;
