#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
const request = require('axios');
const Mqtt = require('./mqtt/mqtt.js');
const { format } = require('date-fns');
const config = yaml.load("config.yaml");

// Specific for Nord Pool
const priceCurrency = config.priceCurrency || './data/prices';
const nordPoolUri =  "https://www.nordpoolgroup.com/api/marketdata/page/10/" + priceCurrency + "/";
const priceRegion = config.priceRegion || 8;

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
const scheduleMinutes = config.scheduleMinutes;

let dayPrices = undefined;
let nextDayPrices = undefined;

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

let nordPool = {
    //'uri': "",
  headers: {
    'accept': 'application/json',
    'Content-Type': 'text/json',
  },
  json: true
  //method: 'GET'
};

function addZero(num) {
  if (num <= 9) {
    return "0" + num;
  }
  return num;
};

function getDate(ts) {
  // Returns date fit for file name
  let date = new Date(ts);
  return format(date,"yyyy-MM-dd")
}

function uriDate(offset) {
  // offset equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  let oneDay = 24 * 60 * 60 * 1000;
  let now = new Date();
  let date = new Date(now.getTime() + oneDay * offset);
  let ret = format(date, 'dd-MM-yyyy');
  return ret;
}

function skewDays(days) {
  // offset equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  let oneDay = 24 * 60 * 60 * 1000;
  let now = new Date();
  let date = new Date(now.getTime() + oneDay * days);
  return format(date, 'yyyy-MM-dd');
}

function getFileName (priceDate){
  return savePath + "/prices-" + priceDate + ".json";
}

function getRedisKey (priceDate)  {
  return "prices-" + priceDate;
}

async function hasDayPrice(priceDate) {
  if (useRedis) {
    return (await redisClient.get(getRedisKey(priceDate)) !== null);
  } else {
    return fs.existsSync(getFileName(priceDate))
  }
}

async function getDayPrice(priceDate) {
  if (useRedis) {
    return (await redisClient.get(getRedisKey(priceDate)));
  } else {
    return fs.readFileSync(getFileName(priceDate))
  }
}

async function retireDays(offset) {
  // Count offset days backwards
  offset *= -1;
  const priceDate = skewDays(offset);
  console.log('priceDate', priceDate)
  if (useRedis) {
    const keys = await redisClient.keys('prices-*');
    keys.forEach(async (key) => {
      if (key <= `prices-${priceDate}`) {
        await redisClient.del(key);
        console.log("Redis data removed:", key);
      }
    });
  } else {
    const files = fs.readdirSync('./data/prices/');
    files.forEach(async (file) => {
      if (file <= `prices-${priceDate}.json`) {
        fs.unlinkSync('./data/prices/' + file);
        console.log("File deleted:", file);
      }
    });
  }
}

async function savePrices(offset, obj) {
  const priceDate = skewDays(offset);
  if (useRedis) {
    await redisClient.set(getRedisKey(priceDate), JSON.stringify(obj, debug ? null : undefined, 2));
    console.log('fetchprices: prices sent to Redis -', 'prices-' + priceDate);
  } else {
    fs.writeFileSync(getFileName(priceDate), JSON.stringify(obj, debug ? null : undefined, 2));
    console.log('fetchprices: prices stored as', getFileName(priceDate));
  }
}

async function getPrices(dayOffset) {
  const priceDate = skewDays(dayOffset);
  // Get prices for today and tomorrow
  if (!await hasDayPrice(priceDate)) {
    console.log('getPrices', priceDate)
    let url = nordPoolUri + uriDate(dayOffset);
    //console.log('NordPool: ',url);
    await request(url, nordPool)
      .then(function (body) {
        let data = body.data.data;
        let rows = data.Rows;
        let oneDayPrices = {
          priceDate: priceDate,
          priceProvider: 'Nord Pool',
          priceProviderUrl: url,
          hourly: [],
          daily: {}
        }

        if (rows[0].Columns[priceRegion].Value !== '-'){
          for (let i = 0; i < 24; i++) {
            let price = rows[i].Columns[priceRegion].Value;
            let startTime = rows[i].StartTime;
            let endTime = rows[i].EndTime;
            let curHour = startTime.split('T')[1].substr(0, 5);
            let gridPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
            let spotPrice = price.toString().replace(/ /g, '').replace(/(\d)\,/g, '.$1') / 100;
            spotPrice += spotPrice * spotVatPercent / 100;
            let priceObj = {
              startTime: startTime,
              endTime: endTime,
              spotPrice: spotPrice.toFixed(4) * 1,
              gridFixedPrice: gridPrice.toFixed(4) * 1,
              supplierFixedPrice: supplierPrice.toFixed(4) * 1
            }
            oneDayPrices['hourly'].push(priceObj);
          }

          let minPrice = (rows[24].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001);
          let maxPrice = (rows[25].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001);
          let avgPrice = (rows[26].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001);
          let peakPrice = (rows[27].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001);
          let offPeakPrice1 = (rows[28].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001);
          let offPeakPrice2 = (rows[29].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001);

          oneDayPrices['daily'] = {
            minPrice: (minPrice += minPrice * spotVatPercent / 100).toFixed(4) * 1,
            maxPrice: (maxPrice += maxPrice * spotVatPercent / 100).toFixed(4) * 1,
            avgPrice: (avgPrice += avgPrice * spotVatPercent / 100).toFixed(4) * 1,
            peakPrice: (peakPrice += peakPrice * spotVatPercent / 100).toFixed(4) * 1,
            offPeakPrice1: (offPeakPrice1 += offPeakPrice1 * spotVatPercent / 100).toFixed(4) * 1,
            offPeakPrice2: (offPeakPrice2 += offPeakPrice2 * spotVatPercent / 100).toFixed(4) * 1
          }

          savePrices(dayOffset, oneDayPrices);

          // Publish today and next day prices
          if (dayOffset === 0 || dayOffset === 1) {
            mqttClient.publish(priceTopic + '/' + priceDate, JSON.stringify(oneDayPrices, debug ? null : undefined, 2), { retain: true, qos: 1 });
            console.log('fetchprices: MQTT message published', priceDate);
          }
        } else {
          console.log("Day ahead prices are not ready:", priceDate);
        }
      })
      .catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        console.log('Headers:', err.response.headers)
      }
    })
  } else {
    // Publish today and next day prices
    if (dayOffset === 0 || dayOffset === 1 && hasDayPrice(priceDate)) {
      let priceObject = await JSON.parse(await getDayPrice(priceDate))
      await mqttClient.publish(priceTopic + '/' + priceDate, JSON.stringify(priceObject, debug ? null : undefined, 2), { retain: true, qos: 1 });
      console.log('fetchprices: MQTT message published', priceDate);
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
  await retireDays(keepDays);
  for (let i = (keepDays - 1) * -1; i <= 0; i++) {
    await getPrices(i);
  }
  await getPrices(1);
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

