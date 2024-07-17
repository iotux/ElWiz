const db = require('../misc/dbinit.js');
const { getPreviousHour, skewDays, loadYaml } = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);

const topHoursCount = config.topHoursCount || 3;
const topHoursSize = config.topHoursSize || 10;

const debug = config.amscalc.debug || false;
const decimals = 4

/**
 * Set and get the minimum power value.
 *
 * @param {number} power - The power value.
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

class EnergyCounter {
  constructor() {
    this.consumption = 0;
    this.effect = 0;
    this.lastUpdateTime = null;
    this.correctionFactor = 1; // Initially assume no correction is needed
  }

  async setEffect(effect) {
    const now = Date.now();
    if (this.lastUpdateTime !== null) {
      const timeDifference = (now - this.lastUpdateTime) / 1000;
      this.consumption += this.effect * (timeDifference / 3600) * this.correctionFactor;
    }
    this.effect = effect;
    this.lastUpdateTime = now;
  }

  async getEnergy(actualConsumption) {
    // If actualConsumption is provided and this.consumption is not zero, update the correction factor
    if (actualConsumption !== undefined && this.consumption !== 0) {
      this.correctionFactor = actualConsumption / this.consumption;
    }
    const consumption = this.consumption;
    await this.resetCounter();
    return consumption;
  }

  async resetCounter() {
    this.consumption = 0;
  }
}

const consumptionCounter = new EnergyCounter();
const productionCounter = new EnergyCounter();

// Update the kW value when available
// consumptionCounter.setEffect(newKWValue);

// To get the consumption and reset the counter
// const consumption = consumptionCounter.getEnergy();

let consumptionCurrentHour = 0;
let productionCurrentHour = 0;

async function sortHourlyConsumption(currentDate, consumption) {
  const sortedHours = await db.get('sortedHourlyConsumption');
  if (!Array.isArray(sortedHours)) {
    console.error('sortedHours is not an array:', sortedHours);
    return sortedHours;
  }
  // TODO: Check if the timeskew is correct with the current logic
  return sortedHours.concat({
    time: getPreviousHour(currentDate).substring(0, 19),
    //date: currentDate.substring(0, 19),
    consumption: consumption
  }).sort((a, b) => b.consumption - a.consumption);
}

async function getTopHoursAverage(topHours, count) {
  if (topHours !== undefined && topHours.length > 0) {
    const { length } = topHours;
    //console.log('topHours length', length, topHours);
    const slicedHours = topHours.slice(0, length < count ? length : count);
    console.log('slicedHours', slicedHours);
    const totalConsumption = slicedHours.reduce((total, { consumption }) => total + consumption, 0);
    //console.log('totalConsumption', totalConsumption);
    const average = totalConsumption / slicedHours.length;
    //console.log('average before toFixed', average);
    return parseFloat(average.toFixed(decimals));
  }
  return 0;
}


async function updateTopHours(currentDate, consumption) {
  const topHours = await db.get('topConsumptionHours');
  if (!Array.isArray(topHours)) {
    console.error('topHours is not an array:', topHours);
    return topHours;
  }
  const lastConsumption = {
    time: getPreviousHour(currentDate).substring(0, 19),
    consumption: consumption
  }
  // Extract the date part of the lastConsumption time
  const lastDate = lastConsumption.time.substring(0, 10);
  // Find the index of the element in topHours with the same date part
  const indexToUpdate = topHours.findIndex(({ time }) => time.substring(0, 10) === lastDate);
  // If an element is found and its consumption is smaller than lastConsumption
  if (indexToUpdate >= 0 && topHours[indexToUpdate].consumption < lastConsumption.consumption) {
    // Remove the element at indexToUpdate
    topHours.splice(indexToUpdate, 1);
    // Append lastConsumption to topHours
    topHours.push(lastConsumption);
  } else if (indexToUpdate === -1) {
    // If no corresponding element is found, append lastConsumption to topHours
    topHours.push(lastConsumption);
  }
  // Sort the array by consumption in descending order
  topHours.sort((a, b) => b.consumption - a.consumption);
  // If the array length is greater than topHoursSize, truncate it
  if (topHours.length > topHoursSize) {
    topHours.length = topHoursSize;
  }

  return topHours;
}

async function setInitialValues(obj) {
  await db.set('isVirgin', false);
  // Set initial values = current to prevent huge false values on first run
  await db.set('prevHourMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevDayMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevDayMeterProduction', obj.lastMeterProduction);
  await db.set('prevDayMeterConsumptionReactive', obj.lastMeterConsumptionReactive);
  await db.set('prevDayMeterProductionReactive', obj.lastMeterProductionReactive);
  await db.set('prevMonthMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevMonthMeterProduction', obj.lastMeterProduction);
  await db.set('lastMeterConsumption', obj.lastMeterConsumption);
  await db.set('lastMeterProduction', obj.lastMeterProduction);
}

async function handleMonthlyCalculations(obj) {
  if (obj.isNewMonth) {
    await db.set('prevMonthMeterConsumption', obj.lastMeterConsumption);
    await db.set('prevMonthMeterProduction', obj.lastMeterProduction);
    await db.set('topConsumptionHours', []);
  }
}

async function setPreviousDayValues(obj) {
  await db.set('prevDayMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevDayMeterProduction', obj.lastMeterProduction);
  await db.set('prevDayMeterConsumptionReactive', obj.lastMeterConsumptionReactive);
  await db.set('prevDayMeterProductionReactive', obj.lastMeterProductionReactive);
  await db.set('minPower', 9999999);
  await db.set('maxPower', 0);
  await db.set('averagePower', 0);
  await db.set('consumptionToday', 0);
  await db.set('sortedHourlyConsumption', []);
}

async function handleDailyCalculations(obj) {
  if (obj.isNewDay) {
    // Wait for List2 to set preious values
    await setPreviousDayValues(obj);

    obj.accumulatedConsumption = 0;
    obj.accumulatedProduction = 0;
    obj.accumulatedConsumptionReactive = 0;
    obj.accumulatedProductionReactive = 0;
    obj.consumptionToday = 0;

    obj.curDay = skewDays(0);
    obj.nextDay = skewDays(1);
  }
}

async function handleHourlyCalculations(obj) {

  // Save current values for next hour
  await db.set('prevHourMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevHourMeterProduction', obj.lastMeterProduction);
  await db.set('lastMeterConsumption', obj.lastMeterConsumption);
  await db.set('lastMeterProduction', obj.lastMeterProduction);
  await db.set('lastMeterConsumptionReactive', obj.lastMeterConsumptionReactive);
  await db.set('lastMeterProductionReactive', obj.lastMeterProductionReactive);

  // sortedHourlyConsumption not exposed by obj, but used by sortHourlyConsumption()
  //await db.set('sortedHourlyConsumption', await sortHourlyConsumption(obj.meterDate, obj.consumptionLastHour));
  //await db.set('topConsumptionHours', await updateTopHours(obj.meterDate, obj.consumptionLastHour));
  //obj.topConsumptionHours = await db.get('topConsumptionHours');

  obj.topHoursAverage = await getTopHoursAverage(obj.topConsumptionHours, topHoursCount);
  obj.consumptionToday = obj.accumulatedConsumption;
  obj.consumptionCurrentHour = 0;
  obj.productionCurrentHour = 0;

  //await db.set('topHoursAverage', obj.topHoursAverage);

  await db.set('consumptionCurrentHour', 0);
  await db.set('productionCurrentHour', 0);
}

/**
 * Calculate min, max, average, and accumulated power values.
 *
 * @param {string} list - The list type.
 * @param {Object} obj - The object containing power values.
 * @returns {Object} - The updated object with calculated values.
 */
async function amsCalc(list, obj) {
  obj.minPower = await getMinPower(obj.power);
  obj.maxPower = await getMaxPower(obj.power);
  await averageCalc.addPower(obj.power);
  obj.averagePower = parseFloat((await averageCalc.getAveragePower()).toFixed(decimals));

  // "Out of band" calculation of consumption & production
  // For Kaifa and possibly Aidon AMS meters this happens during List1 and List2
  // For Kamstrup AMS meters this happens during List2
  // Real consumption and production iternal counters are realigned with AMS in List3
  if (obj.power !== undefined) {
    await consumptionCounter.setEffect(obj.power);
    const consumptionCurrent = parseFloat((await consumptionCounter.getEnergy()).toFixed(decimals));
    // Fetch old values && add new consumption
    obj.lastMeterConsumption = parseFloat((await db.get('lastMeterConsumption') + consumptionCurrent).toFixed(decimals)) || 0;
    obj.consumptionCurrentHour = parseFloat((await db.get('consumptionCurrentHour') + consumptionCurrent).toFixed(decimals)) || 0;
    obj.consumptionToday = parseFloat((await db.get('consumptionToday') + consumptionCurrent).toFixed(decimals)) || 0;
    // Save new values
    await db.set('lastMeterConsumption', obj.lastMeterConsumption);
    await db.set('consumptionCurrentHour', obj.consumptionCurrentHour);
    await db.set('consumptionToday', obj.consumptionToday);
  }

  if (obj.powerProduction !== undefined) {
    await productionCounter.setEffect(obj.powerProduction);
    const productionCurrent = parseFloat((await productionCounter.getEnergy()).toFixed(decimals));
    obj.lastMeterProduction = parseFloat((await db.get('lastMeterProduction') + productionCurrent).toFixed(decimals)) || 0;
    obj.productionCurrentHour = parseFloat((await db.get('productionCurrentHour') + productionCurrent).toFixed(decimals)) || 0;
    obj.productionToday = parseFloat((await db.get('productionToday') + productionCurrent).toFixed(decimals)) || 0;
    await db.set('lastMeterProduction', obj.lastMeterProduction);
    await db.set('productionCurrentHour', obj.productionCurrentHour);
    await db.set('productionToday', obj.productionToday);
    await db.sync();
  }

  if (obj.isHourEnd) {
    obj.consumptionLastHour = obj.consumptionCurrentHour;
    obj.productionLastHour = obj.productionCurrentHour;
    // sortedHourlyConsumption not exposed by obj, but used by sortHourlyConsumption()
    await db.set('sortedHourlyConsumption', await sortHourlyConsumption(obj.timestamp, obj.consumptionLastHour));
    await db.set('topConsumptionHours', await updateTopHours(obj.timestamp, obj.consumptionLastHour));
    obj.topConsumptionHours = await db.get('topConsumptionHours');
  }

  if (list === 'list1') {
  }

  if (list === 'list2') {
    delete obj.meterVersion;
    delete obj.meterID;
    delete obj.meterModel;

    if (await db.get('isVirgin') === false) {
      await db.sync();
      //if (debug) {
      //  await db.fetch().then(function (data) {
      //    console.log('amsCalc:saved data', data);
      //  });
      //}
    }
  }

  // Once every hour
  if (list === 'list3') {
    delete obj.meterVersion;
    delete obj.meterID;
    delete obj.meterModel;

    if (await db.get('isVirgin')) {
      await setInitialValues(obj);
    }
    const consumptionCurrent = parseFloat((await consumptionCounter.getEnergy()).toFixed(decimals));
    console.log('List3: dummy consumptionCurrent', consumptionCurrent);
    await handleMonthlyCalculations(obj);
    await handleDailyCalculations(obj);
    await handleHourlyCalculations(obj);
    if (debug) {
      await db.fetch().then(function (data) {
        console.log('amsCalc: Unicache:db', data);
      });
    }
    await db.sync();
  }

  return obj;
};

module.exports = amsCalc;
