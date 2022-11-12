
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

const dayHoursStart = config.peakHoursStart;
const dayHoursEnd = config.peakHoursEnd;
const energyDayPrice = config.energyDayPrice;
const energyNightPrice = config.energyNightPrice;

let isVirgin = true;

function kwhCalc(obj, kWh) {
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
      obj.costLastHour = await kwhCalc(obj, obj.accumulatedConsumptionLastHour);
      obj.accumulatedCost = await kwhCalc(obj, obj.accumulatedConsumption);
      await db.set('accumulatedCost', obj.accumulatedCost);
      await db.set('accumulatedCostLastHour', obj.accumulatedCostLastHour);
      await db.sync();
      return obj;
    }
  },

  init: function () {
    if (isVirgin) {
      isVirgin = false;
    }
  }
};

module.exports = {calculateCost};