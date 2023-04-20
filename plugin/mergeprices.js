const fs = require("fs");
const yaml = require("yamljs");
const Mqtt = require("../mqtt/mqtt.js");
const configFile = "./config.yaml";
//const { event } = require('../misc/misc.js')
const { skewDays } = require('../misc/util.js');

const config = yaml.load(configFile);
const priceTopic = config.priceTopic || 'elwiz/prices';

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
    if (date == today) {
      dayPrices = JSON.parse(message.toString());
      // If today's price date is present, nextDayPrices
      // are not available yet, so set them equal to dayPrices
      nextDayPrices = JSON.parse(JSON.stringify(dayPrices));
    } else if (date == tomorrow) {
      nextDayPrices = JSON.parse(message.toString());
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
  //console.log('dayPrices', dayPrices['priceDate']);
  //console.log('nextDayPrices', nextDayPrices['priceDate'])
  if (list === 'list1' || list === 'list2') return obj;
  if (list === "list3") {
    const hourlyProperties = ['startTime', 'endTime', 'spotPrice', 'gridFixedPrice', 'supplierFixedPrice']; //, 'customerPrice'];
    const dailyProperties = ['minPrice', 'maxPrice', 'avgPrice', 'peakPrice', 'offPeakPrice1', 'offPeakPrice2'];

    // Date format: 2022-10-30T17:31:50
    const idx = obj.meterDate.substring(11, 13) * 1;
    if (obj.meterDate.substring(11, 19) === "00:00:10") {
      // Update the day prices to the next day prices if the time has passed midnight.
      dayPrices = await JSON.parse(JSON.stringify(nextDayPrices))
    }

    hourlyProperties.forEach(prop => { obj[prop] = dayPrices['hourly'][idx][prop] || 0; });
    dailyProperties.forEach(prop => { obj[prop] = dayPrices['daily'][prop] || 0; });
    hourlyProperties.forEach(prop => { obj[`${prop}Day2`] = nextDayPrices['hourly'][idx][prop] || 0; });
    dailyProperties.forEach(prop => { obj[`${prop}Day2`] = nextDayPrices['daily'][prop] || 0; });
  }

  return obj;
}

module.exports = { mergePrices };
