#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
const request = require('axios') //.default;
const Mqtt = require('./mqtt/mqtt.js');
const { format } = require('date-fns')
const config = yaml.load("config.yaml");

// Specific for ENTSO-E
const convert = require('xml-js');
const { exit } = require('process');
// For testing puposes
// const baseUrl = "https://web-api.tp-iop.entsoe.eu/api"
// For production
const baseUrl = "https://web-api.tp.entsoe.eu/api";
const token = config.priceAccessToken;
//const priceRegion = config.priceRegion || 8;
const priceCurrency = config.priceCurrency || './data/prices';
const currencyDirectory = config.currencyDirectory || './data/currencies';
const currencyFile = currencyDirectory + '/currencies-latest.json';

// Common constants
const debug = config.DEBUG || false;
const priceTopic = config.priceTopic || 'elwiz/prices';
const keepDays = config.keepDays || 7;

const spotVatPercent = config.spotVatPercent || 0;
const supplierDayPrice = config.supplierDayPrice || 0;
const supplierMonthPrice = config.supplierMonthPrice || 0;
const supplierVatPercent = config.supplierVatPercent || 0;

const gridDayPrice = config.gridDayPrice || 0;
const gridMonthPrice = config.gridMonthPrice || 0;
const gridVatPercent = config.gridVatPercent  || 0;

const dayHoursStart = config.dayHoursStart | '06:00';
const dayHoursEnd = config.dayHoursEnd || '22:00';
const energyDayPrice = config.energyDayPrice || 0;
const energyNightPrice = config.energyNightPrice || 0;
const savePath = config.priceDirectory;
const cacheType = config.cacheType || 'file';
const useRedis = (cacheType === 'redis');

const mqttClient = Mqtt.mqttClient();

let gridDayHourPrice;
let gridNightHourPrice;
let supplierPrice;

const runNodeSchedule = config.runNodeSchedule;
const scheduleHours = config.scheduleHours;
const scheduleMinutes = config.scheduleEuMinutes;

let schedule;
let runSchedule;
if (runNodeSchedule) {
  schedule = require('node-schedule');
  runSchedule = new schedule.RecurrenceRule();
  runSchedule.hour = scheduleHours;
  runSchedule.minute = scheduleMinutes;
}

let redisClient;
if (useRedis) {
  const { createClient } = require('redis');
  redisClient = createClient();
}

let reqOpts = {
  method: "get",
  headers: {
    'accept': 'application/xml',
    'Content-Type': 'application/xml',
  },
}

let currencyRate;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function addZero(num) {
  if (num * 1 <= 9) {
    return "0" + num;
  }
  return num;
}

function getCurrency(currency) {
  if (fs.existsSync(currencyFile)) {
    let data = fs.readFileSync(currencyFile, { encoding: 'utf8' }) //, flag:'r'});
    let obj = JSON.parse(data)
    //console.log('rate: ', obj['rates'])
    return obj['rates'][currency];
  } else {
    console.log('Error: currencyFile unable to read');
    exit(0);
  }
}

function getDate(ts) {
  // Returns date fit for file name
  let date = new Date(ts);
  return format(date,"yyyy-MM-dd")
}

function skewDays(days) {
  // days equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  let oneDay = 24 * 60 * 60 * 1000;
  let now = new Date();
  let date = new Date(now.getTime() + oneDay * days);
  let ret = format(date, 'yyyy-MM-dd');
  return ret;
}

function getFileName (offset){
  return savePath + "/prices-" + skewDays(offset) + ".json";
}

function getRedisKey (offset)  {
  return "prices-" + skewDays(offset);
}

async function hasDayPrice(dayOffset) {
  if (useRedis) {
    return (await redisClient.get(getRedisKey(dayOffset)) !== null);
  } else {
    return fs.existsSync(getFileName(dayOffset))
  }
}

async function getDayPrice(dayOffset) {
  if (useRedis) {
    return (await redisClient.get(getRedisKey(dayOffset)));
  } else {
    return fs.readFileSync(getFileName(dayOffset))
  }
}

async function retireDays(offset) {
  // Count offset days backwards
  offset *= -1;
  let finished = false;
  while (!finished) {
    if (await hasDayPrice(offset)) {
      if (useRedis) {
        await redisClient.del(getRedisKey(offset));
        console.log("Redis data removed:", getRedisKey(offset));
      } else {
        fs.unlinkSync(getFileName(offset));
        console.log("Price file removed:", offset, getFileName(offset));
      }
    }
    offset--;
    finished = (await hasDayPrice(offset) === false);
  }
}

async function savePrices(offset, obj) {
  if (useRedis) {
    await redisClient.set(getRedisKey(offset), JSON.stringify(obj, debug ? null : undefined, 2));
    console.log('fetchprices: prices sent to Redis -', skewDays(offset));
  } else {
    fs.writeFileSync(getFileName(offset), JSON.stringify(obj, debug ? null : undefined, 2));
    console.log('fetchprices: prices stored as', getFileName(offset));
  }
}

function entsoeDate(days) {
  // Returns UTC time in Entsoe format
  let oneDay = 86400000; // 24 * 60 * 60 * 1000
  let now = new Date();
  let date = new Date(now.getTime() + oneDay * days);
  let midnight = format(date, "yyyy-MM-dd 00:00:00")
  let res = new Date(midnight).toJSON();
  return res.substr(0, 4)
    + res.substr(5, 2)
    + res.substr(8, 2)
    + res.substr(11, 2) + '00';
}

function calcAvg(start, end, obj) {
  let res = 0;
  for (let i = start; i < end; i++) {
    res += obj[i].spotPrice;
  }
  return (res / (end - start))
}

function entsoeUrl(token, periodStart, periodEnd) {
  return baseUrl + "?documentType=A44"
    + "&in_Domain=10YNO-3--------J"
    + "&out_Domain=10YNO-3--------J"
    + "&securityToken=" + token
    + "&periodStart=" + periodStart
    + "&periodEnd=" + periodEnd;
}

async function getPrices(dayOffset) {
  // Get prices unconditionally for today and tomorrow
  if (!await hasDayPrice(dayOffset)) {
    let url = entsoeUrl(token, entsoeDate(dayOffset), entsoeDate(dayOffset + 1));
    await request.get(url, reqOpts).then(function (body) {
      let result = convert.xml2js(body.data, { compact: true, spaces: 4 });
      if (result.Publication_MarketDocument !== undefined) {
        let realMeat = result.Publication_MarketDocument.TimeSeries.Period;
        let startDay = getDate(realMeat.timeInterval.start._text);
        let endDay = getDate(realMeat.timeInterval.end._text);
        let minPrice = 9999;
        let maxPrice = 0;
        let oneDayPrices = {
          priceDate: skewDays(dayOffset),
          priceProvider: 'ENTSO-E',
          priceProviderUrl: entsoeUrl('*****',entsoeDate(dayOffset), entsoeDate(dayOffset + 1)),
          hourly: [],
          daily: {}
        }
        for (let i = 0; i <= 23; i++) {
          let curHour = addZero(realMeat.Point[i].position._text - 1) + ':00';
          let nextHour = addZero(realMeat.Point[i].position._text) + ':00';
          let startTime = startDay + 'T' + curHour + ':00';
          let endTime = i === 23 ? endDay + 'T00:00:00' : startDay + 'T' + nextHour + ':00';
          let gridPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
          let spotPrice = (realMeat.Point[i]["price.amount"]._text * currencyRate) / 1000;
          spotPrice += spotPrice * spotVatPercent / 100;
          let priceObj = {
            startTime: startTime,
            endTime: endTime,
            spotPrice: spotPrice.toFixed(4) * 1,
            gridFixedPrice: gridPrice.toFixed(4) * 1,
            supplierFixedPrice: supplierPrice.toFixed(4) * 1
          }
          //console.log(priceObj)
          oneDayPrices['hourly'].push(priceObj);

          minPrice = spotPrice < minPrice ? spotPrice : minPrice;
          maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice
        }

        oneDayPrices['daily'] = {
          minPrice: (minPrice += minPrice * spotVatPercent / 100).toFixed(4) * 1,
          maxPrice: (maxPrice += maxPrice * spotVatPercent / 100).toFixed(4) * 1,
          avgPrice: (calcAvg(0, 24, oneDayPrices['hourly'])).toFixed(4) * 1,
          peakPrice: (calcAvg(6, 22, oneDayPrices['hourly'])).toFixed(4) * 1,
          offPeakPrice1: (calcAvg(0, 6, oneDayPrices['hourly'])).toFixed(4) * 1,
          offPeakPrice2: (calcAvg(22, 24, oneDayPrices['hourly'])).toFixed(4) * 1,
        }

        savePrices(dayOffset, oneDayPrices);

        // Publish today and next day prices
        if (dayOffset === 0 || dayOffset === 1) {
          mqttClient.publish(priceTopic + '/' + skewDays(dayOffset), JSON.stringify(oneDayPrices, debug ? null : undefined, 2), { retain: true, qos: 1 });
          console.log('fetchprices: MQTT message published', skewDays(dayOffset));
        }

      } else {
        console.log("Day ahead prices are not ready", skewDays(dayOffset));
      }
    }).catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        if (debug) console.log('Headers:', err.response.headers)
      }
    })
  } else {
    // Publish today and next day prices
    if (dayOffset === 0 || dayOffset === 1 && hasDayPrice(skewDays(dayOffset))) {
      let priceObject = await JSON.parse(await getDayPrice(dayOffset));
      await mqttClient.publish(priceTopic + '/' + skewDays(dayOffset), JSON.stringify(priceObject, debug ? null : undefined, 2), { retain: true, qos: 1 });
      console.log('fetchprices: MQTT message published', skewDays(dayOffset));
    }
  }
}

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
    if (date < today) {
      // Remove previous retained messages
      mqttClient.publish(priceTopic + '/' + date, '', { retain: true });
    }
  }
});

async function init() {
  let price = gridDayPrice / 24;
  price += gridMonthPrice / 720; // 30 x 24 is close enough;
  gridNightHourPrice = price + energyNightPrice;
  gridNightHourPrice += gridNightHourPrice * gridVatPercent / 100;

  gridDayHourPrice = price + energyDayPrice;
  gridDayHourPrice += gridDayHourPrice * gridVatPercent / 100;

  supplierPrice = supplierDayPrice / 24;
  supplierPrice += supplierMonthPrice / 720;
  supplierPrice += supplierPrice * supplierVatPercent / 100;

  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }
  if (useRedis) {
    redisClient.on('error', err => console.log('Redis Client Error', err));
    await redisClient.connect();
  }
}

async function run() {
  // With scheduled run, It may help to avoid missing currencies
  if (runNodeSchedule)
    await delay(1000); // 1 second
  if (!fs.existsSync(currencyDirectory)) {
    console.log("No currency file present");
    console.log('Please run "./fetch-eu-currencies.js"');
    // exit(0); // This results in frequent pm2 restarts
  } else {
    currencyRate = await getCurrency(priceCurrency);

    await retireDays(keepDays);
    for (let i = (keepDays - 1) * -1; i <= 0; i++) {
      await getPrices(i);
    }
    await getPrices(1)
  }
}

init();

if (runNodeSchedule) {
  console.log("Fetch prices scheduling started...");
  schedule.scheduleJob(runSchedule, run);
  // First a single run to init prices
  run();
} else {
  run();
}
