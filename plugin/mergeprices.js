
const MQTTClient = require("../mqtt/mqtt");
const { format, formatISO, nextDay } = require("date-fns");
const configFile = "./config.yaml";
const { skewDays, loadYaml, isNewDay } = require("../misc/util.js");

const config = loadYaml(configFile);
const debug = config.mergeprices.debug || false;

const priceTopic = config.priceTopic || "elwiz/prices";

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'mergePrices');
mqttClient.waitForConnect();

let prevDayPrices = {};
let dayPrices = {};
let nextDayPrices = {};

let twoDaysData = [];
let timerInit = true;

let nextDayAvailable = false;

mqttClient.subscribe(priceTopic + "/#", (err) => {
  if (err) {
    console.log("mergePrices: Subscription error");
  }
});

mqttClient.on("message", (topic, message) => {
  const yesterday = skewDays(-1);
  const today = skewDays(0);
  const tomorrow = skewDays(1);
  const [topic1, topic2, topic3] = topic.split("/");
  if (`${topic1}/${topic2}` === priceTopic) {
    const result = parseJsonSafely(message)
    if (!result.error) {
      // Fetch 2 days of price data
      if (twoDaysData.length < 2) {
        twoDaysData.push(result.data);
      } else if (result.data.priceDate > twoDaysData[1].priceDate) {
        twoDaysData.push(result.data);
      } else {
        if (debug)
          console.log('Pricedata skipped ', result.data.priceDate);
      }

      // MQTT price data handling
      // Give time for receiving 2 - 3 MQTT messages
      // before activating "handleMessages()"
      // Then reset "timerInit" after a delay
      if (timerInit) {
        timerInit = false;
        setTimeout(() => {
          if (twoDaysData.length === 2) {
            twoDaysData = twoDaysData.slice(-2);
          }
          if (twoDaysData.length > 1) {
            if (twoDaysData[1].priceDate === today) {
              prevDayPrices = twoDaysData[0];
              dayPrices = twoDaysData[1];
              nextDayAvailable = false;
            } else {
              dayPrices = twoDaysData[0];
              nextDayPrices = twoDaysData[1];
              nextDayAvailable = true;
            }
          } else {
            console.log('mergePrices: Price data is missing');
          }
          timerInit = true;
        }, 500);
      }
    } else {
      console.log('mergePrices:', result.error);
    }
  }
});

function parseJsonSafely(message) {
  let buffer;
  try {
    buffer = message.toString();
  } catch (err) {
    console.log('mergePrices: Error converting buffer to string:', err);
    return { error: true, message: 'Message cannot be parsed as atring', data: null };
  }
  // Trim the input to remove leading/trailing whitespace
  const trimmedString = buffer.trim();

  // Check if the input is empty
  if (trimmedString === '') {
    return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
  }

  // Attempt to parse the JSON string
  try {
    const data = JSON.parse(trimmedString);
    return { error: false, message: 'Successfully parsed JSON.', data: data };
  } catch (error) {
    return { error: true, message: `Error parsing JSON: ${error.message}`, data: null };
  }
}

async function findPricesBelowAverage(priceObject) {
  const prices = priceObject.hourly;
  const average = dayPrices.daily.avgPrice;
  const filteredPrices = prices
    .filter(({ spotPrice }) => spotPrice < average) // Filter prices below average
    .map(({ startTime, spotPrice }) => ({
      hour: format(new Date(startTime), "HH"),
      spotPrice,
    }));

  return {
    date: priceObject.priceDate,
    avgPrice: average,
    hours: filteredPrices,
  };
  //return filteredPrices;
}

/**
 * Merge price information from today and next day prices into an object
 * @param {string} list - The list identifier
 * @param {Object} obj - The object to which price information will be added
 * @returns {Promise<Object>} - The merged object with price information
 */
async function mergePrices(list, obj) {
  const idx = obj.hourIndex;

  // isHourStart and isHourEnd can possibly be in list1 or list2
  // it depends on the AMS meter timing
  if (obj.isHourStart !== undefined && obj.isHourStart === true) {
    //const kWh = obj.consumptionCurrentHour;
    if (obj.isDayStart !== undefined && obj.isDayStart === true) {
      dayPrices = nextDayPrices;
      nextDayAvailable = false;
    }
    obj.startTime = dayPrices.hourly[idx].startTime;
    obj.endTime = dayPrices.hourly[idx].endTime;
    obj.spotPrice = dayPrices.hourly[idx].spotPrice;
    obj.floatingPrice = dayPrices.hourly[idx].floatingPrice;
    obj.fixedPrice = dayPrices.hourly[idx].fixedPrice;
    obj.minPrice = dayPrices.daily.minPrice;
    obj.maxPrice = dayPrices.daily.maxPrice;
    obj.avgPrice = dayPrices.daily.avgPrice;
    obj.peakPrice = dayPrices.daily.peakPrice;
    obj.offPeakPrice1 = dayPrices.daily.offPeakPrice1;
    obj.offPeakPrice2 = dayPrices.daily.offPeakPrice2;
    obj.spotBelowAverage = dayPrices.hourly[idx].spotPrice < obj.avgPrice ? 1 : 0;
    obj.pricesBelowAverage = await findPricesBelowAverage(dayPrices);
    if (nextDayAvailable) {
      obj.startTimeDay2 = nextDayPrices.hourly[idx].startTime;
      obj.endTimeDay2 = nextDayPrices.hourly[idx].endTime;
      obj.spotPriceDay2 = nextDayPrices.hourly[idx].spotPrice;
      obj.floatingPriceDay2 = nextDayPrices.hourly[idx].floatingPrice;
      obj.fixedPriceDay2 = nextDayPrices.hourly[idx].fixedPrice;
      obj.minPriceDay2 = nextDayPrices.daily.minPrice;
      obj.maxPriceDay2 = nextDayPrices.daily.maxPrice;
      obj.avgPriceDay2 = nextDayPrices.daily.avgPrice;
      obj.peakPriceDay2 = nextDayPrices.daily.peakPrice;
      obj.offPeakPrice1Day2 = nextDayPrices.daily.offPeakPrice1;
      obj.offPeakPrice2Day2 = nextDayPrices.daily.offPeakPrice2;
      obj.pricesBelowAverageDay2 = await findPricesBelowAverage(nextDayPrices);
    }
  } // isHourStart

  // Needed for HA cost calculation
  if (obj.isHourEnd !== undefined && obj.isHourEnd === true) {
    obj.spotPrice = dayPrices.hourly[idx].spotPrice;
    obj.floatingPrice = dayPrices.hourly[idx].floatingPrice;
    obj.fixedPrice = dayPrices.hourly[idx].fixedPrice;
    obj.customerPrice = parseFloat((obj.spotPrice + obj.floatingPrice + obj.fixedPrice / obj.consumptionCurrentHour).toFixed(4));
  }

  if (debug && (list !== 'list1' || obj.isHourStart !== undefined || obj.isHourEnd !== undefined))
    console.log('mergePrices', JSON.stringify(obj, null, 2));

  return obj;
}

module.exports = { mergePrices };
