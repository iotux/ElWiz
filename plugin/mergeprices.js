const fs = require("fs");
const yaml = require("yamljs");
const Mqtt = require("../mqtt/mqtt.js");
const configFile = "./config.yaml";
//const { event } = require('../misc/misc.js')
const { skewDays } = require('../misc/util.js');

const config = yaml.load(configFile);
const priceTopic = config.priceTopic;

const mqttClient = Mqtt.mqttClient();

let dayPrices = {}
let nextDayPrices = {}

mqttClient.on("connect", () => {
  mqttClient.subscribe(priceTopic + '/#', (err) => {
    if (err) {
      console.log("Subscription error");
    }
  });
});

mqttClient.on("message", (topic, message) => {
  const today = skewDays(0);
  const tomorrow = skewDays(1);
  let [topic1, topic2, date] = topic.split('/')
  if (topic1 + '/' + topic2 === 'elwiz/prices') {
    let msg;
    try {
      msg = JSON.parse(message.toString());
    } catch (error) {
      console.log('mergeprices MQTT', error)
    }

    if (date == today) {
      dayPrices = msg;
      // If today's price date is present, nextDayPrices
      // are not available yet, so set them equal to dayPrices
      nextDayPrices = dayPrices;
    } else if (date == tomorrow) {
      nextDayPrices = msg;
    }
  }
});

/**
 * Merge price information from day and next day prices into an object
 * @param {string} list - The list identifier
 * @param {Object} obj - The object to which price information will be added
 * @returns {Promise<Object>} - The merged object with price information
 */
async function mergePrices(list, obj) {
  if (list === 'list1' || list === 'list2') return obj;
  if (list === "list3") {
    const hourlyProperties = ['startTime', 'endTime', 'spotPrice', 'gridFixedPrice', 'supplierFixedPrice', 'customerPrice'];
    const dailyProperties = ['minPrice', 'maxPrice', 'avgPrice', 'peakPrice', 'offPeakPrice1', 'offPeakPrice2'];

    // Date format: 2022-10-30T17:31:50
    const idx = obj.meterDate.substr(11, 2) * 1;

    if (obj.meterDate.substr(11, 8) === "00:00:10") {
      // Update the day prices to the next day prices if the time has passed midnight.
      dayPrices = nextDayPrices;
    }

    // Refactored code merges the price information
    // from both days into one object using Object.assign()
    // Add today's prices to the object
    //Object.assign(obj, { ...dayPrices["hourly"][idx], ...dayPrices["daily"] });
    // Add tomorrow's prices to the object
    //Object.assign(obj, { ...nextDayPrices["hourly"][idx], ...nextDayPrices["daily"] });

    //obj[`${prop}Day2`] = nextDayPrices['daily'][prop];
    //obj[`${prop}Day2`] = nextDayPrices['hourly'][idx][prop];
    hourlyProperties.forEach(prop => { obj[prop] = dayPrices['hourly'][idx][prop]; });
    dailyProperties.forEach(prop => { obj[prop] = dayPrices['daily'][prop]; });
    hourlyProperties.forEach(prop => { obj[`${prop}Day2`] = nextDayPrices['hourly'][idx][prop]; });
    dailyProperties.forEach(prop => { obj[`${prop}Day2`] = nextDayPrices['daily'][prop]; });
  }
  /**
   * Removed this code as it is not related to
   * merging prices and can be moved elsewhere
   * if (list === 'list1') event.emit('plug1', obj)
   * if (list === 'list2') event.emit('plug2', obj)
   * if (list === 'list3') event.emit('plug3', obj)
   */
  console.log('mergeprices ===>', list, obj)
  return obj;
}

module.exports = { mergePrices };
