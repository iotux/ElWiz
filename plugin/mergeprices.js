const yaml = require('yamljs');
const Mqtt = require('../mqtt/mqtt.js');
const { format } = require('date-fns');
const configFile = './config.yaml';
// const { event } = require('../misc/misc.js')
const { skewDays } = require('../misc/util.js');

const config = yaml.load(configFile);
const priceTopic = config.priceTopic || 'elwiz/prices';

const mqttClient = Mqtt.mqttClient();

let prevDayPrices = {};
let dayPrices = {};
let nextDayPrices = {};
let prevDayH23 = {};
let todayH23 = {};
let hourlyPrice = {};
let nextDayHourlyPrice = {};
let nextDayAvailable = false;

mqttClient.on('connect', () => {
  mqttClient.subscribe(priceTopic + '/#', (err) => {
    if (err) {
      console.log('Subscription error');
    }
  });
});

mqttClient.on('message', (topic, message) => {
  const yesterday = skewDays(-1);
  const today = skewDays(0);
  const tomorrow = skewDays(1);
  const [topic1, topic2, date] = topic.split('/');
  if (topic1 + '/' + topic2 === priceTopic) {
    if (date === yesterday) {
      prevDayPrices = JSON.parse(message.toString());
      prevDayH23 = prevDayPrices.hourly[23];
    } else if (date === today) {
      nextDayAvailable = false;
      dayPrices = JSON.parse(message.toString());
      todayH23 = dayPrices.hourly[23];
      hourlyPrice = [prevDayH23].concat(dayPrices.hourly).slice(0, 24)
      // If today's price date is present, nextDayPrices
      // are not available yet, so set them equal to dayPrices
      //!!!!!!!!!!!!!!!
      nextDayPrices = JSON.parse(JSON.stringify(dayPrices));
      nextDayHourlyPrice = [todayH23].concat(nextDayPrices.hourly).slice(0, 24)
      // Update the last hour price
    } else if (date === tomorrow) {
      nextDayAvailable = true;
      nextDayPrices = JSON.parse(message.toString());
      todayH23 = dayPrices.hourly[23];
      //nextDayHourlyPrice = skewPrices(nextDayPrices, todayH23);
      nextDayHourlyPrice = [todayH23].concat(nextDayPrices.hourly).slice(0, 24)
    }
  }
  //console.log('hourlyPrice', hourlyPrice);
});

async function skewPrices(priceObject, todayH23) {
  const skewedPrices = [todayH23].concat(priceObject.hourly).slice(0, 24);
  return skewedPrices;
}

async function mergeData(priceObject, todayH23) {
  // Strip off the summary (priceObject.daily)
  const prices = [todayH23].concat(priceObject.hourly).slice(0, 24);
  const filteredPrices = prices.map(({ startTime, endTime, spotPrice, gridFixedPrice, supplierFixedPrice }) => ({
    hour: format(new Date(endTime), 'HH'),
    //timestamp: endTime,
    startTime,
    endTime,
    spotPrice,
    fixedPrice: parseFloat((gridFixedPrice + supplierFixedPrice).toFixed(4)),
  }));
  //console.log('filteredPrices', filteredPrices);
  return filteredPrices;
}

async function sortPrices(priceObject, todayH23) {
  //const summary = priceObject.daily;
  const prices = [todayH23].concat(priceObject).slice(0, 24);
  const filteredPrices = prices.map(({ endTime, spotPrice, gridFixedPrice, supplierFixedPrice }) => ({
    hour: format(new Date(endTime), 'HH'),
    timestamp: endTime,
    spotPrice,
    fixedPrice: parseFloat((gridFixedPrice + supplierFixedPrice).toFixed(4)),
  }));
  return filteredPrices.sort((a, b) => a.customerPrice - b.customerPrice);
}

async function findCheapHours(priceObject, hourCount = 5) {
  //const summary = priceObject.daily;
  //prices = [todayH23].concat(priceObject.hourly).slice(0, 24);
  const prices = priceObject.hourly;
  const filteredPrices = prices.map(({ startTime, endTime, spotPrice, gridFixedPrice, supplierFixedPrice }) => ({
    hour: format(new Date(startTime), 'HH'),
    //ts: startTime,
    spotPrice,
    //fixedPrice: parseFloat((gridFixedPrice + supplierFixedPrice).toFixed(4)),
  }));
  return filteredPrices.sort((a, b) => a.spotPrice - b.spotPrice).slice(0, hourCount).sort((a, b) => a.hour - b.hour);
  //return filteredPrices.sort((a, b) => a.spotPrice - b.spotPrice).slice(0, hourCount).sort((a, b) => a.timestamp - b.timestamp);
  //return cheap; //filteredPrices.sort((a, b) => a.hour - b.hour);
}

async function splitPrices(priceObj, todayH23, threshold1, threshold2) {
  const summary = priceObj.daily;
  const prices = priceObj.hourly;
  const sortedPrices = await sortPrices(prices, todayH23);

  //thres1 = threshold1 * highestPrice / 100;
  //thres2 = threshold2 * highestPrice / 100;
  //console.log('sortedPrices', sortedPrices)
  const filtered2 = sortedPrices.filter(price => price.spotPrice < threshold2 * summary.maxPrice / 100);
  //!!!console.log('threshold2', filtered2.sort((a, b) => a.hour - b.hour));

  const table1 = sortedPrices.filter(price => price.spotPrice < threshold1 * summary.maxPrice / 100);
  //!!!console.log('threshold1', table1.sort((a, b) => a.hour - b.hour))

  let lastHour = parseInt(table1[table1.length - 1].hour);
  const table2 = filtered2.filter(price => {
    const currentHour = parseInt(price.hour);
    if (currentHour <= lastHour) return false;
    lastHour = currentHour;
    return true;
  });

  //table2 = table2.sort((a, b) => a.hour - b.hour)
  return {
    lowLevel: table1.sort((a, b) => a.hour - b.hour),
    mediumLevel: table2.sort((a, b) => a.hour - b.hour)
  };
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

  if (list === 'list1') {
    //return obj;
  }

  if (list === 'list2') {
    //return obj;
  }
  //if (list === 'list1' || list === 'list2') return obj;

  if (list === 'list3') {
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
    obj.spotBelowAverage = dayPrices.hourly[idx].spotPrice < obj.avgPrice ? true : false

    obj.minPriceDay2 = nextDayPrices.daily.minPrice;
    obj.maxPriceDay2 = nextDayPrices.daily.maxPrice;
    obj.avgPriceDay2 = nextDayPrices.daily.avgPrice;
    obj.peakPriceDay2 = nextDayPrices.daily.peakPrice;
    obj.offPeakPrice1Day2 = nextDayPrices.daily.offPeakPrice1;
    obj.offPeakPrice2Day2 = nextDayPrices.daily.offPeakPrice2;
    obj.spotBelowAverageDay2 = nextDayPrices.hourly[idx].spotPrice < obj.avgPriceDay2 ? true : false

    //if (nextDayAvailable) {
    //const nextDayHourlyPrice = await skewPrices(nextDayPrices, todayH23)
    obj.startTimeDay2 = nextDayHourlyPrice[idx].startTime;
    obj.endTimeDay2 = nextDayHourlyPrice[idx].endTime;
    obj.spotPriceDay2 = nextDayHourlyPrice[idx].spotPrice;
    obj.gridFixedPriceDay2 = nextDayHourlyPrice[idx].gridFixedPrice;
    obj.supplierFixedPriceDay2 = nextDayHourlyPrice[idx].supplierFixedPrice;
    //}
    //console.log('MergePrices: list3', obj);
    const hours = 7;
    obj.cheapHours = await findCheapHours(dayPrices, hours);
    if (nextDayAvailable)
      obj.cheapHoursNextDay = await findCheapHours(nextDayPrices, hours);
    //console.log('hourlyPrice', hourlyPrice);
  }
  //console.log('nextDayPrices:', nextDayPrices);

  //let idx = obj.timestamp.substring(11, 13) * 1;
  //console.log('obj ============> ', obj);
  //!!!const twoTables = await splitPrices(dayPrices, prevDayH23, 90, 95);
  //!!!console.log('twoTables', twoTables);
  //const idx = parseInt(obj.meterDate.substring(11, 13));
  //const idx = parseInt(obj.timestamp.substring(11, 13));

  //if (obj.isNewDay) {
  //  obj.currentSummary = await getSummary(dayPrices);
  //  obj.nextDaySummary = await getSummary(nextDayPrices);
  //}
  return obj;
}

module.exports = { mergePrices };
