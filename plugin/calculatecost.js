
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

function calcReward(obj, kWh) {
  // TODO: complete this
  return kWh * gridKwhReward;
}

function calcCost(obj, kWh) {
  // TODO: use fixed 30 days per month
  //let gridPrice = obj.gridPrice + (gridKwhPrice + gridKwhPrice * gridVatPercent / 100);
  let gridPrice = obj.gridFixedPrice + gridKwhPrice * kWh;
  let supplierPrice = obj.supplierFixedPrice + supplierKwhPrice * kWh;
  let tax = energyTax * kWh;  
  let kwhPrice = gridPrice + supplierPrice + tax;
  let spotPrice = (obj.spotPrice + obj.spotPrice * spotVatPercent / 100) * kWh;

  return (kwhPrice + spotPrice).toFixed(4) * 1;
}

const calculateCost = {

  calc: async function (list, obj) {
    // List3 is run once every hour
    if (list === 'list3') {
      obj.customerPrice = await calcCost(obj, 1)
      obj.costLastHour = await calcCost(obj, obj.accumulatedConsumptionLastHour);
      obj.accumulatedCost = (db.get("accumulatedCost") + obj.costLastHour).toFixed(4) * 1;
      db.set("accumulatedCost", obj.accumulatedCost);

      obj.rewardLastHour = await calcReward(obj, obj.accumulatedProductionLastHour);
      obj.accumulatedReward = (db.get("accumulatedReward") + obj.rewardLastHour).toFixed(4) * 1;
      db.set("accumulatedReward", obj.accumulatedReward);
      db.sync();
      return obj;
    }
  },
};

module.exports = {calculateCost};