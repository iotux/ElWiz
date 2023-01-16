
const yaml = require("yamljs");
const db = require('../misc/dbinit.js');
const configFile = "./config.yaml";

const config = yaml.load(configFile);

const daysInMonth = [undefined, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const spotVatPercent = config.spotVatPercent;
const gridVatPercent = config.gridVatPercent;
const gridMonthPrice = config.gridMonthPrice;
const gridDayPrice = config.gridDayPrice;
const gridKwhPrice = config.gridKwhPrice;

const supplierVatPercent = config.supplierVatPercent;
const supplierMonthPrice = config.supplierMonthPrice;
const supplierDayPrice = config.supplierDayPrice;
const supplierKwhPrice = config.supplierKwhPrice;

const energyTax = config.energyTax;

gridKwhReward = config.gridKwhReward;

const dayHoursStart = config.peakHoursStart;
const dayHoursEnd = config.peakHoursEnd;
const energyDayPrice = config.energyDayPrice;
const energyNightPrice = config.energyNightPrice;

let isVirgin = true;

function calcReward(obj, kWh) {
  let month = obj.startTime.split("-")[1] * 1;
  let curHour = obj.startTime.split('T')[0].substr(0, 5);
  // TODO: complete this
  return kWh * gridKwhReward;
}

function calcCost(obj, kWh) {
  let month = obj.startTime.split("-")[1] * 1;
  let curHour = obj.startTime.split('T')[0].substr(0, 5);
  let gridPrice;
  if (curHour >= dayHoursStart && curHour < dayHoursEnd)
    gridPrice = energyDayPrice;
  else
    gridPrice = energyNightPrice;
  gridPrice += gridKwhPrice;
  gridPrice += gridMonthPrice / daysInMonth[month] / 24;
  gridPrice += gridDayPrice / 24;
  gridPrice += gridPrice * gridVatPercent / 100;
  let spotPrice = obj.spotPrice + obj.spotPrice * spotVatPercent / 100
  let supplierPrice = supplierKwhPrice + supplierMonthPrice / daysInMonth[month] / 24;
  supplierPrice += supplierDayPrice / 24;
  supplierPrice += supplierPrice * supplierVatPercent / 100;
  return (kWh * (spotPrice + supplierPrice + gridPrice + energyTax)).toFixed(4) * 1;
}

const calculateCost = {
  isVirgin: true,

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