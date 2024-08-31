
const db = require('../misc/dbinit.js');
const { loadYaml } = require('../misc/util.js')

const configFile = './config.yaml';
const config = loadYaml(configFile);

const debug = config.calculatecost.debug || false;
const {
  gridKwhPrice,
  supplierKwhPrice,
  energyTax,
  gridKwhReward
} = config;

/**
 * Calculate the reward for the given kWh.
 * @param {Object} obj - The object containing necessary information.
 * @param {number} kWh - The kilowatt-hours to calculate the reward for.
 * @returns {number} - The calculated reward.
 */
async function calcReward(obj, kWh) {
  // TODO: complete this
  return kWh * gridKwhReward;
}

async function getCustomerPrice(obj, kWh) {
  const price = parseFloat((obj.spotPrice + obj.floatingPrice + obj.fixedPrice * kWh).toFixed(4));
  return price;
}

async function calcCost(obj, kWh) {
  const cost = parseFloat((obj.fixedPrice + obj.floatingPrice * kWh).toFixed(4));
  return cost;
}

/**
 * Calculate cost, price, and reward for the given list and object.
 * @param {string} list - The list identifier, currently supporting 'list3' only.
 * @param {Object} obj - The object containing necessary information.
 * @returns {Object} - The updated object with calculated cost, price, and reward.
*/
//calc: async function (list, obj) {
async function calculateCost(list, obj) {
  if (obj.isHourEnd !== undefined && obj.isHourEnd === true) {
    const consumptionCurrentHour = await db.get('consumptionCurrentHour');
    const productionCurrentHour = await db.get('productionCurrentHour');
    //obj.customerPrice = await getCustomerPrice(obj, consumptionCurrentHour);
    obj.costLastHour = await calcCost(obj, consumptionCurrentHour);
    obj.rewardLastHour = parseFloat((gridKwhReward * productionCurrentHour).toFixed(4));
    delete (obj.gridFixedPrice);
    delete (obj.supplierFixedPrice);

    obj.accumulatedCost = await db.get('accumulatedCost') + obj.costLastHour;
    obj.accumulatedReward = await db.get('accumulatedReward') + obj.rewardLastHour;
    await db.set('accumulatedCost', obj.accumulatedCost);
    await db.set('accumulatedReward', obj.accumulatedReward);
    //await db.sync();
  }

  if (obj.isNewDay !== undefined && obj.isNewDay === true) {
    obj.accumulatedCost = 0;
    obj.accumulatedReward = 0;
    await db.set('accumulatedCost', 0);
    await db.set('accumulatedReward', 0);
  }

  if (debug && (list !== 'list1' || obj.isHourStart !== undefined || obj.isHourEnd !== undefined))
    console.log('calculateCost', JSON.stringify(obj, null, 2));

  return obj;
};

module.exports = { calculateCost };
