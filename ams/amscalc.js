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
    this.kWh = 0;
    this.power = 0;
    this.lastUpdateTime = null;
  }

  async setPower(power) {
    const validPower = typeof power === 'number' && isFinite(power) ? power : 0;
    const now = Date.now();
    if (this.lastUpdateTime !== null) {
      const timeDifference = (now - this.lastUpdateTime) / 1000;
      this.kWh += this.power * (timeDifference / 3600);
    }
    this.power = validPower;
    this.lastUpdateTime = now;
  }

  async getKWh() {
    const kWh = this.kWh;
    this.kWh = 0;
    return kWh;
  }
}

const consumptionCounter = new EnergyCounter();
const productionCounter = new EnergyCounter();

async function sortHourlyConsumption(currentDate, consumption) {
  const sortedHours = await db.get('sortedHourlyConsumption');
  if (!Array.isArray(sortedHours)) {
    console.error('sortedHours is not an array:', sortedHours);
    return sortedHours;
  }
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
    const totalConsumption = slicedHours.reduce((total, { consumption }) => total + consumption, 0);
    const average = totalConsumption / slicedHours.length;
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
  const lastDate = lastConsumption.startTime.substring(0, 10);
  const indexToUpdate = topHours.findIndex(({ startTime }) => startTime.substring(0, 10) === lastDate);
  if (indexToUpdate >= 0 && topHours[indexToUpdate].consumption < lastConsumption.consumption) {
    topHours.splice(indexToUpdate, 1);
    topHours.push(lastConsumption);
  } else if (indexToUpdate === -1) {
    topHours.push(lastConsumption);
  }
  topHours.sort((a, b) => b.consumption - a.consumption);
  if (topHours.length > topHoursSize) {
    topHours.length = topHoursSize;
  }

  return topHours;
}

async function setInitialValues(obj) {
  await db.set('isVirgin', false);
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
  const lastMeterConsumption = obj.lastMeterConsumption || await db.get('lastMeterConsumption');
  const lastMeterProduction = obj.lastMeterProduction || await db.get('lastMeterProduction');

  // Hourly rollover
  await db.set('prevHourMeterConsumption', lastMeterConsumption);
  await db.set('prevHourMeterProduction', lastMeterProduction);
  await db.set('consumptionCurrentHour', 0);
  await db.set('productionCurrentHour', 0);
  obj.consumptionCurrentHour = 0;
  obj.productionCurrentHour = 0;

  // Daily rollover
  if (obj.isNewDay) {
    await db.set('prevDayMeterConsumption', lastMeterConsumption);
    await db.set('prevDayMeterProduction', lastMeterProduction);
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
    await db.set('prevMonthMeterConsumption', lastMeterConsumption);
    await db.set('prevMonthMeterProduction', lastMeterProduction);
    await db.set('topConsumptionHours', []);
  }

  await db.sync();
}

/**
 * Calculate min, max, average, and accumulated power values.
 *
 * @param {string} list - The list type.
 * @param {Object} obj - The object containing power values.
 * @returns {Object} - The updated object with calculated values.
 */
async function amsCalc(list, obj) {
  // Internal Rollover Detection
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDate();
  const lastHour = await db.get('lastHour');
  const lastDay = await db.get('lastDay');

  // Detect rollover if hour changed and we're not at the very first run (-1)
  if (lastHour !== undefined && lastHour !== -1 && currentHour !== lastHour) {
    obj.isNewHour = true;
    if (currentDay !== lastDay) {
      obj.isNewDay = true;
      if (currentDay === 1) obj.isNewMonth = true;
    }
  }

  // Update tracking state
  if (lastHour === -1 || currentHour !== lastHour) {
    await db.set('lastHour', currentHour);
    await db.set('lastDay', currentDay);
  }

  // Perform rollover BEFORE processing the current frame
  if (obj.isNewHour) {
    await performRolloverCalculations(obj);
  }

  if (obj.power !== undefined && obj.power !== null) {
    obj.minPower = await getMinPower(obj.power);
    obj.maxPower = await getMaxPower(obj.power);
    await averageCalc.addPower(obj.power);
    obj.averagePower = parseFloat((await averageCalc.getAveragePower()).toFixed(decimals));

    await consumptionCounter.setPower(obj.power);
    await productionCounter.setPower(obj.powerProduction);

    if (list === 'list3') {
      // If this is the first list3 we've ever seen, or we just cleared the cache
      const isVirgin = await db.get('isVirgin');
      const dbLmc = await db.get('lastMeterConsumption');
      
      if (obj.lastMeterConsumption !== undefined && (isVirgin || dbLmc === 0)) {
        await setInitialValues(obj);
      }
      // If sanitized or missing, fall back to last known DB value
      if (obj.lastMeterConsumption === undefined) {
        obj.lastMeterConsumption = await db.get('lastMeterConsumption');
      }
    } else {
      const currConsKWh = await consumptionCounter.getKWh();
      const currProdKWh = await productionCounter.getKWh();
      obj.lastMeterConsumption = parseFloat(((await db.get('lastMeterConsumption')) + currConsKWh).toFixed(decimals)) || 0;
      obj.lastMeterProduction = parseFloat(((await db.get('lastMeterProduction')) + currProdKWh).toFixed(decimals)) || 0;
    }

    // Ensure we have a valid baseline if it was 0 (e.g. after a cache clear or initial start)
    const prevHourCons = await db.get('prevHourMeterConsumption');
    if (obj.lastMeterConsumption > 0 && prevHourCons === 0) {
      await db.set('prevHourMeterConsumption', obj.lastMeterConsumption);
      await db.set('prevDayMeterConsumption', obj.lastMeterConsumption);
      await db.set('prevMonthMeterConsumption', obj.lastMeterConsumption);
    }

    obj.consumptionToday = parseFloat((obj.lastMeterConsumption - (await db.get('prevDayMeterConsumption'))).toFixed(decimals)) || 0;
    obj.productionToday = parseFloat((obj.lastMeterProduction - (await db.get('prevDayMeterProduction'))).toFixed(decimals)) || 0;

    const prevHourProd = await db.get('prevHourMeterProduction');

    // If baseline is 0, we don't know the consumption yet. Skip reporting to avoid spikes.
    if (prevHourCons > 0) {
      obj.consumptionCurrentHour = parseFloat((obj.lastMeterConsumption - prevHourCons).toFixed(decimals)) || 0;
    } else {
      obj.consumptionCurrentHour = 0;
    }

    if (prevHourProd > 0) {
      obj.productionCurrentHour = parseFloat((obj.lastMeterProduction - prevHourProd).toFixed(decimals)) || 0;
    } else {
      obj.productionCurrentHour = 0;
    }

    await db.set('lastMeterConsumption', obj.lastMeterConsumption);
    await db.set('lastMeterProduction', obj.lastMeterProduction);
    await db.set('consumptionCurrentHour', obj.consumptionCurrentHour);
    await db.set('productionCurrentHour', obj.productionCurrentHour);
    await db.set('consumptionToday', obj.consumptionToday);
    await db.set('productionToday', obj.productionToday);
    await db.sync();
  }

  if (obj.isHourEnd !== undefined) {
    obj.sortedHourlyConsumption = await sortHourlyConsumption(obj.timestamp, obj.consumptionCurrentHour);
    obj.topConsumptionHours = await updateTopHours(obj.timestamp, obj.consumptionCurrentHour);
    obj.topHoursAverage = await getTopHoursAverage(obj.topConsumptionHours, topHoursCount);

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

  if (obj.meterVersion !== undefined) {
    delete obj.meterVersion;
    delete obj.meterID;
    delete obj.meterModel;
  }

  //if (debug && obj.isHourEnd !== undefined && obj.isHourEnd === true) console.log('amsCalc:', JSON.stringify(obj, null, 2));
  if (debug) console.log('amsCalc:', JSON.stringify(obj, null, 2));

  return obj;
}

module.exports = amsCalc;
