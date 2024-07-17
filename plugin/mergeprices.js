
const MQTTClient = require("../mqtt/mqtt");
const { format, formatISO } = require("date-fns");
const configFile = "./config.yaml";
// const { event } = require('../misc/misc.js')
const { skewDays, loadYaml } = require("../misc/util.js");

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

async function findCheapHours(priceObject, hourCount = 5) {
  const prices = priceObject.hourly;
  const filteredPrices = prices.map(
    ({
      startTime,
      endTime,
      spotPrice,
      gridFixedPrice,
      supplierFixedPrice,
    }) => ({
      hour: format(new Date(startTime), "HH"),
      //ts: startTime,
      spotPrice,
      //fixedPrice: parseFloat((gridFixedPrice + supplierFixedPrice).toFixed(4)),
    })
  );
  return filteredPrices
    .sort((a, b) => a.spotPrice - b.spotPrice)
    .slice(0, hourCount)
    .sort((a, b) => a.hour - b.hour);
  //return filteredPrices.sort((a, b) => a.spotPrice - b.spotPrice).slice(0, hourCount).sort((a, b) => a.timestamp - b.timestamp);
  //return cheap; //filteredPrices.sort((a, b) => a.hour - b.hour);
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

async function getSummary(priceObject) {
  return priceObject.daily;
}

/**
 * Merge price information from today and next day prices into an object
 * @param {string} list - The list identifier
 * @param {Object} obj - The object to which price information will be added
 * @returns {Promise<Object>} - The merged object with price information
 */
async function mergePrices(list, obj) {
  const idx = obj.hourIndex;
  if (obj.isHourEnd !== undefined) {
    //obj.spotPrice = dayPrices.hourly[idx].spotPrice;
    obj.gridFixedPrice = dayPrices.hourly[idx].gridFixedPrice;
    obj.supplierFixedPrice = dayPrices.hourly[idx].supplierFixedPrice;
    //obj.consumptionCurrentHour2 = obj.consumptionCurrentHour;
    if (debug) console.log('List1: mergePrices', obj);
  }

  if (list === "list1") {

  }

  if (list === "list2") {
    obj.spotPrice = dayPrices.hourly[idx].spotPrice;
    if (debug) console.log('List2: mergePrices', obj);
  }

  if (list === "list3") {
    //const hourlyProperties = ['startTime', 'endTime', 'spotPrice', 'gridFixedPrice', 'supplierFixedPrice']; //, 'customerPrice'];
    //const dailyProperties = ['minPrice', 'maxPrice', 'avgPrice', 'peakPrice', 'offPeakPrice1', 'offPeakPrice2'];

    let prevDayPrices = {};
    if (obj.isNewDay) {
      dayPrices = twoDaysData[1];
      prevDayPrices = twoDaysData[0];
      nextDayAvailable = false;
      obj.currentSummary = await getSummary(dayPrices);
      if (nextDayAvailable)
        obj.nextDaySummary = await getSummary(nextDayPrices);
    }

    obj.startTime = dayPrices.hourly[idx].startTime;
    obj.endTime = dayPrices.hourly[idx].endTime;
    obj.spotPrice = dayPrices.hourly[idx].spotPrice;
    obj.gridFixedPrice = dayPrices.hourly[idx].gridFixedPrice;
    obj.supplierFixedPrice = dayPrices.hourly[idx].supplierFixedPrice;

    obj.minPrice = dayPrices.daily.minPrice;
    obj.maxPrice = dayPrices.daily.maxPrice;
    obj.avgPrice = dayPrices.daily.avgPrice;
    obj.peakPrice = dayPrices.daily.peakPrice;
    obj.offPeakPrice1 = dayPrices.daily.offPeakPrice1;
    obj.offPeakPrice2 = dayPrices.daily.offPeakPrice2;

    obj.spotBelowAverage = dayPrices.hourly[idx].spotPrice < obj.avgPrice ? 1 : 0;

    const hours = 7;
    obj.cheapHours = await findCheapHours(dayPrices, hours);
    obj.pricesBelowAverage = await findPricesBelowAverage(dayPrices);
    if (debug)
      console.log("pricesBelowAverage", JSON.stringify(obj.pricesBelowAverage, null, 2));

    if (nextDayAvailable) {
      obj.startTimeDay2 = nextDayPrices.hourly[idx].startTime;
      obj.endTimeDay2 = nextDayPrices.hourly[idx].endTime;
      obj.spotPriceDay2 = nextDayPrices.hourly[idx].spotPrice;
      obj.gridFixedPriceDay2 = nextDayPrices.hourly[idx].gridFixedPrice;
      obj.supplierFixedPriceDay2 = nextDayPrices.hourly[idx].supplierFixedPrice;

      obj.minPriceDay2 = nextDayPrices.daily.minPrice;
      obj.maxPriceDay2 = nextDayPrices.daily.maxPrice;
      obj.avgPriceDay2 = nextDayPrices.daily.avgPrice;
      obj.peakPriceDay2 = nextDayPrices.daily.peakPrice;
      obj.offPeakPrice1Day2 = nextDayPrices.daily.offPeakPrice1;
      obj.offPeakPrice2Day2 = nextDayPrices.daily.offPeakPrice2;

      obj.cheapHoursNextDay = await findCheapHours(nextDayPrices, hours);
      obj.pricesBelowAverageDay2 = await findPricesBelowAverage(nextDayPrices);
      if (debug) console.log("pricesBelowAverageDay2", JSON.stringify(obj.pricesBelowAverageDay2, null, 2));
    }
    if (debug) console.log('List3: mergePrices:', obj);
  }

  return obj;
}

module.exports = { mergePrices };
