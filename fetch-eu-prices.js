#!/usr/bin/env node

'use strict';

const programName = 'fetch-eu-prices';
const fs = require('fs');
const yaml = require('yamljs');
const request = require('axios'); // .default;
const Mqtt = require('./mqtt/mqtt.js');
const { format } = require('date-fns');
const UniCache = require('./misc/unicache');
const config = yaml.load('config.yaml');
const regionMap = yaml.load('priceregions.yaml');

// Specific for ENTSO-E
const convert = require('xml-js');
const { exit } = require('process');
const { stringify } = require('querystring');
// For testing puposes
// const baseUrl = "https://web-api.tp-iop.entsoe.eu/api"
// For production
const baseUrl = 'https://web-api.tp.entsoe.eu/api';
const token = config.priceAccessToken;
const regionCode = config.regionCode || 'NO1';
const priceRegion = regionMap[regionCode];
const priceCurrency = config.priceCurrency || 'NOK';
const currencyPath = config.currencyFilePath || './data/currencies';
const pricePath = './data/prices' // config.priceFilePath || './data/prices';
const pricePrefix = 'prices-';
const currencyPrefix = 'currencies-';

const debug = config.DEBUG || false;
const priceTopic = config.priceTopic || 'elwiz/prices';
const keepDays = config.keepDays || 7;

const spotVatPercent = config.spotVatPercent || 0;
const supplierDayPrice = config.supplierDayPrice || 0;
const supplierMonthPrice = config.supplierMonthPrice || 0;
const supplierVatPercent = config.supplierVatPercent || 0;

const gridDayPrice = config.gridDayPrice || 0;
const gridMonthPrice = config.gridMonthPrice || 0;
const gridVatPercent = config.gridVatPercent || 0;

const dayHoursStart = config.dayHoursStart | '06:00';
const dayHoursEnd = config.dayHoursEnd || '22:00';
const energyDayPrice = config.energyDayPrice || 0;
const energyNightPrice = config.energyNightPrice || 0;
const cacheType = config.cacheType || 'file';

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

let priceDb;

// UniCache options
const PRICE_DB_PREFIX = pricePrefix || 'prices-';
const PRICE_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: true,
  //syncOnClose: false,
  //syncInterval: 600,
  savePath: pricePath, // Valid for cacheType: 'file'
};
const RO_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: false, // R/O cache
  //syncInterval: 600,
  savePath: pricePath,
};
const CURR_DB_PREFIX = currencyPrefix || 'currencies-';
const CURR_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: false, // R/O cache
  //syncInterval: 600,
  savePath: currencyPath,
};

const reqOpts = {
  method: 'get',
  headers: {
    accept: 'application/xml',
    'Content-Type': 'application/xml'
  }
};
let runCounter = 0;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function addZero(num) {
  if (num * 1 <= 9) {
    return '0' + num;
  }
  return num;
}

let currencyRate;

async function getCurrencyRate(currency) {
  const currencyDb = new UniCache(CURR_DB_PREFIX + 'latest', CURR_DB_OPTIONS);
  if (currencyDb.existsObject(CURR_DB_PREFIX + 'latest')) {
    const obj = await currencyDb.retrieveObject(CURR_DB_PREFIX + 'latest');
    let ret = obj.rates[currency];
    return ret;
  } else {
    console.log('Error: no currency object present');
    console.log('Please run "./fetch-eu-currencies.js"');
    exit(0);
  }
}

function getDate(ts) {
  // Returns date fit for file name
  const date = new Date(ts);
  return format(date, 'yyyy-MM-dd');
}

function skewDays(days) {
  // days equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const date = new Date(now.getTime() + oneDay * days);
  return format(date, 'yyyy-MM-dd');
}

function getFileName(priceDate) {
  return savePath + '/' + pricePrefix + priceDate + '.json';
}

function getKeyName(priceDate) {
  return pricePrefix + priceDate;
}

function entsoeDate(days) {
  // Returns UTC time in Entsoe format
  const oneDay = 86400000; // 24 * 60 * 60 * 1000
  const now = new Date();
  const date = new Date(now.getTime() + oneDay * days);
  const midnight = format(date, 'yyyy-MM-dd 00:00:00');
  const res = new Date(midnight).toJSON();
  return res.substr(0, 4) +
    res.substr(5, 2) +
    res.substr(8, 2) +
    res.substr(11, 2) + '00';
}

function calcAvg(start, end, obj) {
  let res = 0;
  for (let i = start; i < end; i++) {
    res += obj[i].spotPrice;
  }
  return (res / (end - start));
}

function entsoeUrl(token, region, periodStart, periodEnd) {
  return baseUrl + '?documentType=A44' +
    '&securityToken=' + token +
    '&in_Domain=' + region +
    '&out_Domain=' + region +
    '&periodStart=' + periodStart +
    '&periodEnd=' + periodEnd;
}

async function getPrices(dayOffset) {
  const priceDate = skewDays(dayOffset);
  // Get prices for today and tomorrow
  if (!await priceDb.existsObject(skewDays(dayOffset)) && runCounter === 0) {
    const url = entsoeUrl(token, priceRegion, entsoeDate(dayOffset), entsoeDate(dayOffset + 1));
    //console.log('entsoeUrl:', priceRegion, entsoeDate(dayOffset), entsoeDate(dayOffset + 1), await priceDb.isEmpty());
    await request.get(url, reqOpts).then(function (body) {
      const result = convert.xml2js(body.data, { compact: true, spaces: 4 });
      if (result.Publication_MarketDocument !== undefined) {
        const realMeat = result.Publication_MarketDocument.TimeSeries.Period;
        const startDay = getDate(realMeat.timeInterval.start._text);
        const endDay = getDate(realMeat.timeInterval.end._text);
        let minPrice = 9999;
        let maxPrice = 0;
        const oneDayPrices = {
          priceDate: priceDate,
          priceProvider: 'ENTSO-E',
          priceProviderUrl: entsoeUrl('*****', priceRegion, entsoeDate(dayOffset), entsoeDate(dayOffset + 1)),
          hourly: [],
          daily: {}
        };
        for (let i = 0; i <= 23; i++) {
          const curHour = addZero(realMeat.Point[i].position._text - 1) + ':00';
          const nextHour = addZero(realMeat.Point[i].position._text) + ':00';
          const startTime = startDay + 'T' + curHour + ':00';
          const endTime = i === 23 ? endDay + 'T00:00:00' : startDay + 'T' + nextHour + ':00';
          const gridPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
          let spotPrice = (realMeat.Point[i]['price.amount']._text * currencyRate) / 1000;
          spotPrice += spotPrice * spotVatPercent / 100;
          const priceObj = {
            startTime: startTime,
            endTime: endTime,
            spotPrice: spotPrice.toFixed(4) * 1,
            gridFixedPrice: gridPrice.toFixed(4) * 1,
            supplierFixedPrice: supplierPrice.toFixed(4) * 1
          };
          // console.log(priceObj)
          oneDayPrices.hourly.push(priceObj);

          minPrice = spotPrice < minPrice ? spotPrice : minPrice;
          maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice;
        }

        oneDayPrices.daily = {
          minPrice: (minPrice += minPrice * spotVatPercent / 100).toFixed(4) * 1,
          maxPrice: (maxPrice += maxPrice * spotVatPercent / 100).toFixed(4) * 1,
          avgPrice: (calcAvg(0, 24, oneDayPrices.hourly)).toFixed(4) * 1,
          peakPrice: (calcAvg(6, 22, oneDayPrices.hourly)).toFixed(4) * 1,
          offPeakPrice1: (calcAvg(0, 6, oneDayPrices.hourly)).toFixed(4) * 1,
          offPeakPrice2: (calcAvg(22, 24, oneDayPrices.hourly)).toFixed(4) * 1
        };

        priceDb.createObject(PRICE_DB_PREFIX + priceDate, oneDayPrices);

      } else {
        console.log('Day ahead prices are not ready', priceDate);
      }
    }).catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        if (debug) console.log('Headers:', err.response.headers);
      }
    });
  }
  // Publish today and next day prices
  if (dayOffset >= 0 && !await priceDb.isEmpty()) {
    await priceDb.fetch()
      .then(function (obj) {
        //console.log(obj)
        publishMqtt(obj, skewDays(dayOffset));
        console.log(programName + ': MQTT message published:', pricePrefix + priceDate);
      })
  }
} // getPrices()

async function publishMqtt(priceObject, priceDate) {
  // Publish today and next day prices
  try {
    await mqttClient.publish(
      priceTopic + '/' + priceDate,
      JSON.stringify(priceObject, debug ? null : undefined, 2),
      { retain: true, qos: 1 }
    );
    console.log(programName + ': MQTT message published:', pricePrefix + priceDate);
  } catch (err) {
    console.log(programName, ': MQTT publish error', err);
  }
}

async function retireDays(offset) {
  // Count offset days backwards
  offset *= -1;
  const priceDate = skewDays(offset);
  const keys = await priceDb.dbKeys(PRICE_DB_PREFIX + '*');
  keys.forEach(async (key) => {
    if (key <= `${pricePrefix}${priceDate}`) {
      await priceDb.deleteObject(key);
    }
  });
}

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
}

async function run() {
  // With scheduled run, It may help to avoid missing currencies
  if (runNodeSchedule) {
    console.log('Fetch prices scheduled run...');
    await delay(1000);
  } // 1 second
  currencyRate = await getCurrencyRate(priceCurrency);

  await retireDays(keepDays);

  for (let i = (keepDays - 1) * -1; i <= 1; i++) {
    await getPrices(i);
  }
}

init();

if (runNodeSchedule) {
  console.log(programName + ': Fetch prices scheduling started');
  schedule.scheduleJob(runSchedule, run);
}
// First a single run to init prices
priceDb = new UniCache(PRICE_DB_PREFIX, PRICE_DB_OPTIONS);
run();

/*
setInterval(function () {
  console.log("Second run is running");
  run();
}, 1000 * 60 * 1);
*/
