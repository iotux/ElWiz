const db = require('../misc/dbinit.js');
const { loadYaml } = require('../misc/util.js');

const configFile = './config.yaml';
const config = loadYaml(configFile);

const debug = config.calculatecost.debug || false;
const { gridKwhPrice, supplierKwhPrice, energyTax, gridKwhReward } = config;

async function calcReward(reward, kWh) {
  return parseFloat((reward * kWh).toFixed(4));
}

async function calcCost(obj, kWh) {
  const perKwhPrice = obj.spotPrice + obj.floatingPrice;
  const cost = perKwhPrice * kWh + obj.fixedPrice;
  return parseFloat(cost.toFixed(4));
}

/**
 * Calculate cost, price, and reward for the given list and object.
 * @param {string} list - The list identifier, currently supporting 'list3' only.
 * @param {Object} obj - The object containing necessary information.
 * @returns {Object} - The updated object with calculated cost, price, and reward.
 */
async function calculateCost(list, obj) {
  if (obj.isHourEnd !== undefined && obj.isHourEnd === true) {
    const consumptionCurrentHour = await db.get('consumptionCurrentHour');
    const productionCurrentHour = await db.get('productionCurrentHour');
    obj.costLastHour = await calcCost(obj, consumptionCurrentHour);
    obj.rewardLastHour = await calcReward(gridKwhReward, productionCurrentHour);

    obj.accumulatedCost = parseFloat(((await db.get('accumulatedCost')) + obj.costLastHour).toFixed(4));
    obj.accumulatedReward = parseFloat(((await db.get('accumulatedReward')) + obj.rewardLastHour).toFixed(4));
    await db.set('accumulatedCost', obj.accumulatedCost);
    await db.set('accumulatedReward', obj.accumulatedReward);

    // The hour is finished. The current consumption value is the baseline for the next hour.
    await db.set('prevHourMeterConsumption', await db.get('lastMeterConsumption'));
    await db.set('prevHourMeterProduction', await db.get('lastMeterProduction'));
  }

  if (list === 'list2') {
    if (obj.isNewDay !== undefined && obj.isNewDay === true) {
      obj.accumulatedCost = 0;
      obj.accumulatedReward = 0;
      await db.set('accumulatedCost', 0);
      await db.set('accumulatedReward', 0);
    }
  }

  if (debug) {
    if (list === 'list1' || list !== 'list2' || obj.isHourEnd !== undefined) {
      console.log('calculateCost:', JSON.stringify(obj, null, 2));
    }
  }
  return obj;
}

module.exports = { calculateCost };
