
const yaml = require("yamljs");
const db = require('../misc/dbinit.js');
const configFile = "./config.yaml";

const config = yaml.load(configFile);

const spotVatPercent = config.spotVatPercent;
const gridVatPercent = config.gridVatPercent;
const gridKwhPrice = config.gridKwhPrice;

const supplierVatPercent = config.supplierVatPercent;
const supplierKwhPrice = config.supplierKwhPrice;

const energyTax = config.energyTax;

const gridKwhReward = config.gridKwhReward;

// TODO: priceObject

async function calcReward(obj, kWh) {
  // TODO: complete this
  return kWh * gridKwhReward;
}

async function calcPrice(obj, kWh) {
  // Actual price per kWh this hour (experimental)
  let price = (obj.gridPrice + obj.supplierPrice) / kWh;
  price += (gridKwhPrice + supplierKwhPrice + energyTax);
  price += obj.spotPrice;
  return price.toFixed(4) * 1;
}

async function calcCost(obj, kWh) {
  // Cost this hour
  let cost = (obj.gridPrice + obj.supplierPrice);
  cost += (gridKwhPrice + supplierKwhPrice + energyTax) * kWh;
  cost += obj.spotPrice * kWh
  return cost.toFixed(4) * 1;
}

const calculateCost = {

  calc: async function (list, obj) {
    // List3 is run once every hour
    if (list === 'list3') {
      obj.customerPrice = await calcPrice(obj, obj.accumulatedConsumptionLastHour);
      obj.costLastHour = await calcCost(obj, obj.accumulatedConsumptionLastHour);
      obj.rewardLastHour = await calcReward(obj, obj.accumulatedProductionLastHour);
      // Once every midnight
      if (obj.meterDate.substr(11, 8) === "00:00:10") {
        obj.accumulatedCost = 0;
        obj.accumulatedReward = 0;
      } else {
        obj.accumulatedCost = (await db.get("accumulatedCost") + obj.costLastHour).toFixed(4) * 1;
        obj.accumulatedReward = (await db.get("accumulatedReward") + obj.rewardLastHour).toFixed(4) * 1;
      }
      await db.set("accumulatedCost", obj.accumulatedCost);
      await db.set("accumulatedReward", obj.accumulatedReward);
      await db.sync();
      console.log('calculatecost', await db.JSON())
      return obj;
    }
  },
};

module.exports = {calculateCost};
