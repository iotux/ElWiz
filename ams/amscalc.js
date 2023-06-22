// const yaml = require('yamljs');
// const configFile = './config.yaml';
const db = require('../misc/dbinit.js');
const { skewDays } = require('../misc/util.js');

// Load broker and topics preferences from config file
// const config = yaml.load(configFile);

// const debug = config.DEBUG;

/**
 * Set and get the minimum power value.
 *
 * @param {number} pow - The power value.
 * @returns {number} - The minimum power value.
 */
async function getMinPower(pow) {
  if (await db.get('minPower') === undefined || await db.get('minPower') > pow) {
    await db.set('minPower', pow);
  }
  return await db.get('minPower');
}

/**
 * Set and get the maximum power value.
 *
 * @param {number} pow - The power value.
 * @returns {number} - The maximum power value.
 */
async function getMaxPower(pow) {
  if (await db.get('maxPower') === undefined || await db.get('maxPower') < pow) {
    await db.set('maxPower', pow);
  }
  return await db.get('maxPower');
}

// Usage:
// 1. Add a new value to the power array.
// await averageCalc.addPower(value);

// 2. Get the average of the power array.
// const averagePower = await averageCalc.getAveragePower();
class AverageCalculator {
  constructor(windowSize = 60) {
    this.windowSize = windowSize;
    this.powerValues = [];
  }

  async addPower(pow) {
    this.powerValues.push(pow);
    if (this.powerValues.length > this.windowSize) {
      this.powerValues.shift();
    }
  }

  async getAveragePower() {
    const total = this.powerValues.reduce((tot, pow) => tot + pow, 0);
    return total / this.powerValues.length;
  }
}

const averageCalc = new AverageCalculator(120);

let consumptionCurrentHour = 0;

const calculatePowerUse = (power) => {
  const interval = 2 * 1000;
  // Calculate the power used during the interval and add it to the accumulator
  const powerUsed = (power * (interval / 1000)) / 3600; // kW * interval_in_hours
  consumptionCurrentHour += powerUsed;

  // Return the accumulated power use in kWh
  return consumptionCurrentHour;
};

async function setInitialValues(obj) {
  await db.set('isVirgin', false);
  // Set initial values = current
  await db.set('prevDayMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevDayMeterProduction', obj.lastMeterProduction);
  await db.set('prevDayMeterConsumptionReactive', obj.lastMeterConsumptionReactive);
  await db.set('prevDayMeterProductionReactive', obj.lastMeterProductionReactive);
  await db.set('lastMeterConsumption', obj.lastMeterConsumption);
  await db.set('lastMeterProduction', obj.lastMeterProduction);
  await db.set('prevMonthMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevMonthMeterProduction', obj.lastMeterProduction);
}

async function updateHourlyValues(obj) {
  // Energy calculations
  obj.accumulatedConsumptionLastHour = parseFloat((obj.lastMeterConsumption - await db.get('lastMeterConsumption')).toFixed(3));
  obj.accumulatedProductionLastHour = parseFloat((obj.lastMeterProduction - await db.get('lastMeterProduction')).toFixed(3));
  // TODO: Add Reactive?

  // Save current values for next hour
  await db.set('lastMeterConsumption', obj.lastMeterConsumption);
  await db.set('lastMeterProduction', obj.lastMeterProduction);
  await db.set('lastMeterConsumptionReactive', obj.lastMeterConsumptionReactive);
  await db.set('lastMeterProductionReactive', obj.lastMeterProductionReactive);
}

async function handleHourlyCalculations(obj) {
  if (obj.freshHour) {
    if (await db.get('isVirgin') || await db.get('isVirgin') === undefined) {
      await setInitialValues(obj);
    }
    await updateHourlyValues(obj);
    consumptionCurrentHour = 0;
  }
}

async function setPreviousDayValues(obj) {
  await db.set('prevDayMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevDayMeterProduction', obj.lastMeterProduction);
  await db.set('prevDayMeterConsumptionReactive', obj.lastMeterConsumptionReactive);
  await db.set('prevDayMeterProductionReactive', obj.lastMeterProductionReactive);
}

async function handleDailyCalculations(obj) {
  if (obj.freshDay) {
    await setPreviousDayValues(obj);

    obj.accumulatedConsumption = 0;
    obj.accumulatedProduction = 0;
    obj.accumulatedConsumptionReactive = 0;
    obj.accumulatedProductionReactive = 0;

    await db.set('minPower', 9999999);
    await db.set('maxPower', 0);
    await db.set('averagePower', 0);
    obj.curDay = skewDays(0);
    obj.nextDay = skewDays(1);
  } else {
    obj.accumulatedConsumption = parseFloat((obj.lastMeterConsumption - await db.get('prevDayMeterConsumption')).toFixed(3));
    obj.accumulatedProduction = parseFloat((obj.lastMeterProduction - await db.get('prevDayMeterProduction')).toFixed(3));
    obj.accumulatedConsumptionReactive = parseFloat((obj.lastMeterConsumptionReactive - await db.get('prevDayMeterConsumptionReactive')).toFixed(3));
    obj.accumulatedProductionReactive = parseFloat((obj.lastMeterProductionReactive - await db.get('prevDayMeterProductionReactive')).toFixed(3));
  }
}

async function handleMonthlyCalculations(obj) {
  if (obj.isFirstDayOfMonth) {
    await db.set('prevMonthMeterConsumption', obj.lastMeterConsumption);
    await db.set('prevMonthMeterProduction', obj.lastMeterProduction);
  }
}

const amsCalc = {

  /**
   * Calculate min, max, average, and accumulated power values.
   *
   * @param {string} list - The list type.
   * @param {Object} obj - The object containing power values.
   * @returns {Object} - The updated object with calculated values.
   */
  calc: async function (list, obj) {
    obj.minPower = await getMinPower(obj.power);
    obj.maxPower = await getMaxPower(obj.power);
    await averageCalc.addPower(obj.power);
    obj.averagePower = parseFloat((await averageCalc.getAveragePower()).toFixed(4));

    consumptionCurrentHour = await calculatePowerUse(obj.power);
    obj.consumptionCurrentHour = consumptionCurrentHour.toFixed(4) * 1;

    await db.set('minPower', obj.minPower);
    await db.set('maxPower', obj.maxPower);
    await db.set('averagePower', obj.averagePower);

    // Once every hour
    if (list === 'list3') {
      //const isHourlyCalculation = obj.meterDate.substr(14, 5) === '00:10';
      //const isDailyCalculation = obj.meterDate.substr(11, 8) === '00:00:10';
      //const isFirstDayOfMonth = (obj.meterDate.substr(8, 2) === '01' && obj.meterDate.substr(11, 8) === '00:00:10');

      await handleHourlyCalculations(obj);
      await handleDailyCalculations(obj);
      await handleMonthlyCalculations(obj);
      await db.sync();
    }

    if (list === 'list2') {
      // Syncing at every 10th seconds may be overkill
      // but is useful for min/max/avg data
      //await db.sync();
    }
    return obj;
  }
};

module.exports = amsCalc;
