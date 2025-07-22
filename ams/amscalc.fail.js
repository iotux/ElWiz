const db = require('../misc/dbinit.js');
const { loadYaml } = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
let config;
try {
  config = loadYaml(configFile);
} catch (error) {
  console.error(`[AmsCalc] Error loading config file ${configFile}: ${error.message}`);
  throw error; // Re-throw the error to be handled by the caller
}

const topHoursCount = config.topHoursCount || 3;
const topHoursSize = config.topHoursSize || 10;

const debug = config.amscalc.debug || false;
const decimals = 4;

let virgin = true;
/**
 * Set and get the minimum power value.
 *
 * @param {number} power - The power value.
 * @returns {number} - The minimum power value.
 */
async function getMinPower(pow) {
  if ((await db.get('minPower')) === undefined || (await db.get('minPower')) > pow) {
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
  if ((await db.get('maxPower')) === undefined || (await db.get('maxPower')) < pow) {
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
    this.kWh = 0; // Holds kWh for the current period
    this.accumulatedKWh = 0; // Accumulated kWh counter
    this.power = 0; // Power in kW
    this.lastUpdateTime = null; // Last time power was updated
  }

  // Set the power (in kW) and update the kWh
  async setPower(power) {
    const now = Date.now();
    if (this.lastUpdateTime !== null) {
      const timeDifference = (now - this.lastUpdateTime) / 1000; // Time difference in seconds
      const kWh = this.power * (timeDifference / 3600); // Calculate kWh from power and time
      this.kWh += kWh;
      this.accumulatedKWh += kWh; // Accumulate kWh over the hour
    }
    this.power = power;
    this.lastUpdateTime = now;
  }

  // Get the kWh for the current period and reset the counter
  async setKWh(kWh) {
    this.kWh = kWh;
  }

  // Get the kWh for the current period and apply the correction factor if provided
  async getKWh() {
    // Return the current period's kWh and reset the counter
    const kWh = this.kWh;
    //await this.resetCounter(); // Reset the current period counter
    return kWh;
  }

  // Return accumulated kWh

  async setAccumulatedKWh(kWh) {
    this.accumulatedKWh = kWh;
  }

  // Return accumulated kWh, reset if requested
  async getAccumulatedKWh() {
    return this.accumulatedKWh;
    //return parseFloat(this.accumulatedKWh.toFixed(decimals)); // Return this.accumulatedKWh;
  }

  // Reset the current kWh counter
  async resetCounter() {
    this.kWh = 0;
  }
}

const consumptionCounter = new EnergyCounter();
const productionCounter = new EnergyCounter();

// Update the kW value when available
// consumptionCounter.setPower(newKWValue);

// To get the consumption and reset the counter
// const consumption = consumptionCounter.getEnergy();

let consumptionCurrentHour = 0;
let productionCurrentHour = 0;

async function sortHourlyConsumption(currentDate, consumption) {
  // 2024-01-01T00:00:00.000Z
  const sortedHours = await db.get('sortedHourlyConsumption');
  if (!Array.isArray(sortedHours)) {
    console.error('sortedHours is not an array:', sortedHours);
    return sortedHours;
  }
  // TODO: Check if the timeskew is correct with the current logic
  return sortedHours
    .concat({
      startTime: currentDate.substring(0, 13) + ':00:00',
      consumption: consumption,
    })
    .sort((a, b) => b.consumption - a.consumption);
}

async function getTopHoursAverage(topHours, count) {
  if (topHours !== undefined && topHours.length > 0) {
    const { length } = topHours;
    const slicedHours = topHours.slice(0, length < count ? length : count);
    //console.log(count, 'top hours', slicedHours);
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
    startTime: currentDate.substring(0, 13) + ':00:00',
    consumption: consumption,
  };
  // Extract the date part of the lastConsumption time
  const lastDate = lastConsumption.startTime.substring(0, 10);
  // Find the index of the element in topHours with the same date part
  const indexToUpdate = topHours.findIndex(({ startTime }) => startTime.substring(0, 10) === lastDate);
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
  // Reactive data not used for now
  //await db.set('prevDayMeterConsumptionReactive', obj.lastMeterConsumptionReactive);
  //await db.set('prevDayMeterProductionReactive', obj.lastMeterProductionReactive);

  // Set initial values = current to prevent huge false values on first run
  await db.set('lastMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevHourMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevDayMeterConsumption', obj.lastMeterConsumption);
  await db.set('prevMonthMeterConsumption', obj.lastMeterConsumption);
  await db.set('lastMeterProduction', obj.lastMeterProduction);
  await db.set('prevHourMeterProduction', obj.lastMeterProduction);
  await db.set('prevDayMeterProduction', obj.lastMeterProduction);
  await db.set('prevMonthMeterProduction', obj.lastMeterProduction);
}

async function performRolloverCalculations(obj) {
  // Hourly rollover
  await db.set('prevHourMeterConsumption', await db.get('lastMeterConsumption'));
  await db.set('prevHourMeterProduction', await db.get('lastMeterProduction'));
  await db.set('consumptionCurrentHour', 0);
  await db.set('productionCurrentHour', 0);

  // Daily rollover
  if (obj.isNewDay) {
    await db.set('prevDayMeterConsumption', await db.get('lastMeterConsumption'));
    await db.set('prevDayMeterProduction', await db.get('lastMeterProduction'));
    await db.set('consumptionToday', 0);
    await db.set('productionToday', 0);
    await db.set('minPower', 9999999);
    await db.set('maxPower', 0);
    await db.set('averagePower', 0);
    await db.set('sortedHourlyConsumption', []);
    obj.consumptionToday = 0;
    obj.productionToday = 0;
  }

  // Monthly rollover
  if (obj.isNewMonth) {
    await db.set('prevMonthMeterConsumption', await db.get('lastMeterConsumption'));
    await db.set('prevMonthMeterProduction', await db.get('lastMeterProduction'));
    await db.set('topConsumptionHours', []);
  }

  await db.sync();
}

async function init() {
  if (virgin) {
    await consumptionCounter.setKWh(await db.get('consumptionCurrentHour'));
    await consumptionCounter.setAccumulatedKWh(await db.get('consumptionToday'));
    await productionCounter.setKWh(await db.get('productionCurrentHour'));
    await productionCounter.setAccumulatedKWh(await db.get('productionToday'));
  }
  virgin = false;
}

/**
 * Calculate min, max, average, and accumulated power values.
 *
 * @param {string} list - The list type.
 * @param {Object} obj - The object containing power values.
 * @returns {Object} - The updated object with calculated values.
 */
async function amsCalc(list, obj) {
  //if (virgin) await init();
  // "Out of band" calculation of consumption & production
  // For Kaifa and possibly Aidon AMS meters this happens during List1 and List2
  // For Kamstrup AMS meters this happens during List2
  // Real consumption and production iternal counters are realigned with AMS in List3
  //if (obj.power !== undefined && obj.power !== null) {
  if (obj.power !== undefined && obj.power !== null) {
    obj.minPower = await getMinPower(obj.power);
    obj.maxPower = await getMaxPower(obj.power);
    await averageCalc.addPower(obj.power);
    obj.averagePower = parseFloat((await averageCalc.getAveragePower()).toFixed(decimals));

    // Set power for both instances (with and without correction factor)
    await consumptionCounter.setPower(obj.power);
    await productionCounter.setPower(obj.powerProduction);
    // Fetch the current kWh values for both instances
    const currConsKWh = await consumptionCounter.getKWh();
    const currProdKWh = await productionCounter.getKWh();

    // Only fetch correction factor and handle hourly data in 'list3'
    if (list === 'list3') {
      if (await db.get('isVirgin')) {
        await setInitialValues(obj);
      }
    }

    ///*
    //if (obj.lastMeterConsumption !== undefined) {
    if (list === 'list3') {
      // Fetch accumulated kWh for both instances
      const accumulatedKWh = await consumptionCounter.getAccumulatedKWh();
      console.log('accumulatedKWh:', accumulatedKWh);
    } else {
      //*/
      //if (obj.lastMeterConsumption === undefined) {
      // Calculate energy values based on power use
      obj.lastMeterConsumption = parseFloat(((await db.get('lastMeterConsumption')) + currConsKWh).toFixed(decimals)) || 0;
      obj.lastMeterProduction = parseFloat(((await db.get('lastMeterProduction')) + currProdKWh).toFixed(decimals)) || 0;
    }

    obj.consumptionToday = parseFloat((obj.lastMeterConsumption - (await db.get('prevDayMeterConsumption'))).toFixed(decimals)) || 0;
    obj.productionToday = parseFloat((obj.lastMeterProduction - (await db.get('prevDayMeterProduction'))).toFixed(decimals)) || 0;
    obj.consumptionCurrentHour = parseFloat((obj.lastMeterConsumption - (await db.get('prevHourMeterConsumption'))).toFixed(decimals)) || 0;
    obj.productionCurrentHour = parseFloat((obj.lastMeterProduction - (await db.get('prevHourMeterProduction'))).toFixed(decimals)) || 0;

    // Save values to the cache
    // Align actual consumption and production with meter reading
    await db.set('lastMeterConsumption', obj.lastMeterConsumption);
    await db.set('lastMeterProduction', obj.lastMeterProduction);
    await db.set('consumptionCurrentHour', obj.consumptionCurrentHour);
    await db.set('productionCurrentHour', obj.productionCurrentHour);
    await db.set('consumptionToday', obj.consumptionToday);
    await db.set('productionToday', obj.productionToday);
    await db.sync();
  }

  if (obj.isHourEnd !== undefined) {
    //const consumptionCurrentHour = await db.get('consumptionCurrentHour');
    //const productionCurrentHour = await db.get('productionCurrentHour');

    // Only update HA-related values before the next hour
    obj.sortedHourlyConsumption = await sortHourlyConsumption(obj.timestamp, obj.consumptionCurrentHour);
    obj.topConsumptionHours = await updateTopHours(obj.timestamp, obj.consumptionCurrentHour);
    obj.topHoursAverage = await getTopHoursAverage(obj.topConsumptionHours, topHoursCount);

    // These updates should not interfere with the correction factor calculation
    await db.set('sortedHourlyConsumption', obj.sortedHourlyConsumption);
    await db.set('topConsumptionHours', obj.topConsumptionHours);
    await db.set('topHoursAverage', obj.topHoursAverage);

    if (debug) {
      console.log('sortedHourlyConsumption:');
      console.table(obj.sortedHourlyConsumption);
      console.log('topConsumptionHours:');
      console.table(obj.topConsumptionHours);
    }
  }

  if (obj.isNewHour) {
    // Reset counters for the next hour
    await consumptionCounter.setKWh(0);
    await productionCounter.setKWh(0);
    await performRolloverCalculations(obj);
  }

  // Once every hour
  if (list === 'list3') {
    //if (await db.get('isVirgin')) {
    //  await setInitialValues(obj);
    //}
    // Align actual consumption and production with meter reading
    //await db.set('lastMeterConsumption', obj.lastMeterConsumption);
    //await db.set('lastMeterProduction', obj.lastMeterProduction);
    //await db.sync();
  }

  if (obj.meterVersion !== undefined) {
    delete obj.meterVersion;
    delete obj.meterID;
    delete obj.meterModel;
  }

  //if (debug && (list !== 'list1' || obj.isHourStart !== undefined || obj.isHourEnd !== undefined))
  //console.log('amsCalc:', JSON.stringify(obj, null, 2));

  return obj;
}

module.exports = amsCalc;
