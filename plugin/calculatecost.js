
const yaml = require("yamljs");
const db = require('../misc/dbinit.js');
const configFile = "./config.yaml";

const config = yaml.load(configFile);

const {
  gridKwhPrice,
  supplierKwhPrice,
  energyTax,
  gridKwhReward,
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

/**
 * Calculate the price for the given kWh.
 * @param {Object} obj - The object containing necessary information.
 * @param {number} kWh - The kilowatt-hours to calculate the price for.
 * @returns {number} - The calculated price.
 */
async function calcPrice(obj, kWh) {
  // Actual price per kWh this hour (experimental)
  let price = (obj.gridFixedPrice + obj.supplierFixedPrice) / kWh;
  price += (gridKwhPrice + supplierKwhPrice + energyTax);
  price += obj.spotPrice;
  return await price.toFixed(4) * 1;
  //return parseFloat(price.toFixed(4));
}

/**
 * Calculate the cost for the given kWh.
 * @param {Object} obj - The object containing necessary information.
 * @param {number} kWh - The kilowatt-hours to calculate the cost for.
 * @returns {number} - The calculated cost
 */
async function calcCost(obj, kWh) {
  // Cost this hour
  let cost = (obj.gridFixedPrice + obj.supplierFixedPrice);
  cost += (gridKwhPrice + supplierKwhPrice + energyTax) * kWh;
  cost += obj.spotPrice * kWh
  return await cost.toFixed(4) * 1;
  //return parseFloat(cost.toFixed(4));
}

const calculateCost = {
  /**
   * Calculate cost, price, and reward for the given list and object.
   * @param {string} list - The list identifier, currently supporting 'list3' only.
   * @param {Object} obj - The object containing necessary information.
   * @returns {Object} - The updated object with calculated cost, price, and reward.
  */
  calc: async function (list, obj) {
    if (list === 'list1' || list === 'list2') return obj;

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
        obj.accumulatedReward = await db.get("accumulatedReward") + parseFloat(obj.rewardLastHour.toFixed(4));
      }
      await db.set("accumulatedCost", obj.accumulatedCost);
      await db.set("accumulatedReward", obj.accumulatedReward);
      await db.sync();
    }
    return obj;
  },
};

module.exports = {calculateCost};
