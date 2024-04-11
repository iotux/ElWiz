const yaml = require("yamljs");
const Mqtt = require("../mqtt/mqtt.js");
const { format, formatISO } = require("date-fns");
const configFile = "./config.yaml";
// const { event } = require('../misc/misc.js')
const { skewDays } = require("../misc/util.js");

const config = yaml.load(configFile);
const priceTopic = config.priceTopic || "elwiz/prices";

const mqttClient = Mqtt.mqttClient();

let prevDayPrices = {};
let dayPrices = {};
let nextDayPrices = {};
let prevDayH23 = {};
let todayH23 = {};
let hourlyPrice = {};
let nextDayHourlyPrice = {};
let nextDayAvailable = false;

mqttClient.on("connect", () => {
  mqttClient.subscribe(priceTopic + "/#", (err) => {
    if (err) {
      console.log("Subscription error");
    }
  });
});

mqttClient.on("message", (topic, message) => {
  const yesterday = skewDays(-1);
  const today = skewDays(0);
  const tomorrow = skewDays(1);
  const [topic1, topic2, topic3] = topic.split("/");
  if (`${topic1}/${topic2}` === priceTopic) {
    const prices = JSON.parse(message.toString());
    if (topic3 === yesterday) {
      prevDayPrices = prices;
      prevDayH23 = prevDayPrices.hourly[23];
    } else if (topic3 === today) {
      nextDayAvailable = false;
      dayPrices = prices;
      todayH23 = dayPrices.hourly[23];
      hourlyPrice = [prevDayH23].concat(dayPrices.hourly).slice(0, 24);
      // If today's price date is present, nextDayPrices
      // are not available yet, so set them equal to dayPrices
      //!!!!!!!!!!!!!!!
      nextDayPrices = JSON.parse(JSON.stringify(dayPrices));
      nextDayHourlyPrice = [todayH23].concat(nextDayPrices.hourly).slice(0, 24);
      // Update the last hour price
    } else if (topic3 === tomorrow) {
      nextDayAvailable = true;
      nextDayPrices = prices;
      todayH23 = dayPrices.hourly[23];
      nextDayHourlyPrice = [todayH23].concat(nextDayPrices.hourly).slice(0, 24);
    }
  }
});

async function mergeData(priceObject, todayH23) {
  // Strip off the summary (priceObject.daily)
  const prices = [todayH23].concat(priceObject.hourly).slice(0, 24);
  const filteredPrices = prices.map(
    ({
      startTime,
      endTime,
      spotPrice,
      gridFixedPrice,
      supplierFixedPrice,
    }) => ({
      hour: format(new Date(endTime), "HH"),
      //timestamp: endTime,
      startTime,
      endTime,
      spotPrice,
      fixedPrice: parseFloat((gridFixedPrice + supplierFixedPrice).toFixed(4)),
    })
  );
  //console.log('filteredPrices', filteredPrices);
  return filteredPrices;
}

async function sortPrices(priceObject, todayH23) {
  //const summary = priceObject.daily;
  const prices = [todayH23].concat(priceObject).slice(0, 24);
  const filteredPrices = prices.map(
    ({ endTime, spotPrice, gridFixedPrice, supplierFixedPrice }) => ({
      hour: format(new Date(endTime), "HH"),
      timestamp: endTime,
      spotPrice,
      fixedPrice: parseFloat((gridFixedPrice + supplierFixedPrice).toFixed(4)),
    })
  );
  return filteredPrices.sort((a, b) => a.customerPrice - b.customerPrice);
}

async function findCheapHours(priceObject, hourCount = 5) {
  //const summary = priceObject.daily;
  //prices = [todayH23].concat(priceObject.hourly).slice(0, 24);
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
  if (list === "list1") {

  } else

  if (list === "list2") {
    //return obj;
  } else

  if (list === "list3") {
    const idx = obj.hourIndex; //parseInt(obj.timestamp.substring(11, 13));
    //const hourlyProperties = ['startTime', 'endTime', 'spotPrice', 'gridFixedPrice', 'supplierFixedPrice']; //, 'customerPrice'];
    //const dailyProperties = ['minPrice', 'maxPrice', 'avgPrice', 'peakPrice', 'offPeakPrice1', 'offPeakPrice2'];

    let prevDayPrices = {};
    if (obj.isNewDay) {
      nextDayAvailable = false;
      //obj.currentSummary = await getSummary(dayPrices);
      //obj.nextDaySummary = await getSummary(nextDayPrices);
      prevDayPrices = dayPrices;
      dayPrices = nextDayPrices;
      hourlyPrice = nextDayHourlyPrice;
      obj.currentSummary = await getSummary(dayPrices);
      obj.nextDaySummary = await getSummary(nextDayPrices);
    }

    obj.startTime = hourlyPrice[idx].startTime;
    obj.endTime = hourlyPrice[idx].endTime;
    obj.spotPrice = hourlyPrice[idx].spotPrice;
    obj.gridFixedPrice = hourlyPrice[idx].gridFixedPrice;
    obj.supplierFixedPrice = hourlyPrice[idx].supplierFixedPrice;

    obj.minPrice = dayPrices.daily.minPrice;
    obj.maxPrice = dayPrices.daily.maxPrice;
    obj.avgPrice = dayPrices.daily.avgPrice;
    obj.peakPrice = dayPrices.daily.peakPrice;
    obj.offPeakPrice1 = dayPrices.daily.offPeakPrice1;
    obj.offPeakPrice2 = dayPrices.daily.offPeakPrice2;
    obj.spotBelowAverage =
      dayPrices.hourly[idx].spotPrice < obj.avgPrice ? 1 : 0;

    obj.minPriceDay2 = nextDayPrices.daily.minPrice;
    obj.maxPriceDay2 = nextDayPrices.daily.maxPrice;
    obj.avgPriceDay2 = nextDayPrices.daily.avgPrice;
    obj.peakPriceDay2 = nextDayPrices.daily.peakPrice;
    obj.offPeakPrice1Day2 = nextDayPrices.daily.offPeakPrice1;
    obj.offPeakPrice2Day2 = nextDayPrices.daily.offPeakPrice2;
    obj.spotBelowAverageDay2 =
      nextDayPrices.hourly[idx].spotPrice < obj.avgPriceDay2 ? 1 : 0;

    //if (nextDayAvailable) {
    obj.startTimeDay2 = nextDayHourlyPrice[idx].startTime;
    obj.endTimeDay2 = nextDayHourlyPrice[idx].endTime;
    obj.spotPriceDay2 = nextDayHourlyPrice[idx].spotPrice;
    obj.gridFixedPriceDay2 = nextDayHourlyPrice[idx].gridFixedPrice;
    obj.supplierFixedPriceDay2 = nextDayHourlyPrice[idx].supplierFixedPrice;
    //}
    //console.log('MergePrices: list3', obj);
    const hours = 7;
    obj.cheapHours = await findCheapHours(dayPrices, hours);
    obj.pricesBelowAverage = await findPricesBelowAverage(dayPrices);
    console.log("pricesBelowAverage", JSON.stringify(obj.pricesBelowAverage, null, 2)
    );
    if (nextDayAvailable) {
      obj.cheapHoursNextDay = await findCheapHours(nextDayPrices, hours);
      obj.pricesBelowAverageDay2 = await findPricesBelowAverage(nextDayPrices);
      console.log("pricesBelowAverageDay2", JSON.stringify(obj.pricesBelowAverageDay2, null, 2)
      );
    }
    //console.log('hourlyPrice', hourlyPrice);
  }
  //console.log('nextDayPrices:', nextDayPrices);

  return obj;
}

module.exports = { mergePrices };
