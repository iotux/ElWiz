#!/usr/bin/env node

'use strict';

const programName = 'fetchprices';
const fs = require('fs');
const yaml = require('yamljs');
const request = require('axios');
const Mqtt = require('./mqtt/mqtt.js');
const { format } = require('date-fns');
const UniCache = require('./misc/unicache');
const config = yaml.load('./config.yaml');

// Specific for Nord Pool
const priceRegion = config.priceRegion || 8; // Oslo
const priceCurrency = config.priceCurrency || 'NOK';
const nordPoolUri = 'https://www.nordpoolgroup.com/api/marketdata/page/10/' + priceCurrency + '/';
const currencyPath = config.currencyFilePath || './data/currencies';
const pricePath = './data/prices' // config.priceFilePath || './data/prices';
const pricePrefix = 'prices-';
const currencyPrefix = 'currencies-';

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
const scheduleMinutes = config.scheduleMinutes;

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

const nordPool = {
  // 'uri': "",
  headers: {
    accept: 'application/json',
    'Content-Type': 'text/json'
  },
  json: true
  // method: 'GET'
};

let runCounter = 0;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function uriDate(offset) {
  // offset equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const date = new Date(now.getTime() + oneDay * offset);
  const ret = format(date, 'dd-MM-yyyy');
  return ret;
}

function skewDays(days) {
  // offset equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const date = new Date(now.getTime() + oneDay * days);
  return format(date, 'yyyy-MM-dd');
}

async function getPrices(dayOffset) {
  const priceDate = skewDays(dayOffset);
  // Get prices for today and tomorrow
  if (!await priceDb.existsObject(skewDays(dayOffset)) && runCounter === 0) {
    const url = nordPoolUri + uriDate(dayOffset);
    // console.log('NordPool: ',url);
    await request(url, nordPool)
      .then(function (body) {
        const data = body.data.data;
        const rows = data.Rows;
        const oneDayPrices = {
          priceDate,
          priceProvider: 'Nord Pool',
          priceProviderUrl: url,
          hourly: [],
          daily: {}
        };

        if (rows[0].Columns[priceRegion].Value !== '-') {
          for (let i = 0; i < 24; i++) {
            const price = rows[i].Columns[priceRegion].Value;
            const startTime = rows[i].StartTime;
            const endTime = rows[i].EndTime;
            const curHour = startTime.split('T')[1].substr(0, 5);
            const gridPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
            let spotPrice = price.toString().replace(/ /g, '').replace(/(\d),/g, '.$1') / 100;
            spotPrice += spotPrice * spotVatPercent / 100;
            const priceObj = {
              startTime,
              endTime,
              spotPrice: spotPrice.toFixed(4) * 1,
              gridFixedPrice: gridPrice.toFixed(4) * 1,
              supplierFixedPrice: supplierPrice.toFixed(4) * 1
            };
            oneDayPrices.hourly.push(priceObj);
          }

          let minPrice = (rows[24].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.') * 0.001);
          let maxPrice = (rows[25].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.') * 0.001);
          let avgPrice = (rows[26].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.') * 0.001);
          let peakPrice = (rows[27].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.') * 0.001);
          let offPeakPrice1 = (rows[28].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.') * 0.001);
          let offPeakPrice2 = (rows[29].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.') * 0.001);

          oneDayPrices.daily = {
            minPrice: (minPrice += minPrice * spotVatPercent / 100).toFixed(4) * 1,
            maxPrice: (maxPrice += maxPrice * spotVatPercent / 100).toFixed(4) * 1,
            avgPrice: (avgPrice += avgPrice * spotVatPercent / 100).toFixed(4) * 1,
            peakPrice: (peakPrice += peakPrice * spotVatPercent / 100).toFixed(4) * 1,
            offPeakPrice1: (offPeakPrice1 += offPeakPrice1 * spotVatPercent / 100).toFixed(4) * 1,
            offPeakPrice2: (offPeakPrice2 += offPeakPrice2 * spotVatPercent / 100).toFixed(4) * 1
          };

          priceDb.createObject(PRICE_DB_PREFIX + priceDate, oneDayPrices);

        } else {
          console.log(programName + ': Day ahead prices are not ready:', priceDate);
        }
      })
      .catch(function (err) {
        if (err.response) {
          console.log('Error:', err.response.status, err.response.statusText);
          if (debug) console.log('Headers:', err.response.headers);
        }
      });
  }
  // Publish today and next day prices
  if (dayOffset >= 0 && !await priceDb.isEmpty()) {
    await priceDb.retrieveObject(skewDays(dayOffset))
      .then(function (obj) {
        //console.log(obj)
        publishMqtt(obj, skewDays(dayOffset));
        console.log(programName + ': MQTT message published:', pricePrefix + priceDate);
      })
  }
}

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
  //currencyRate = await getCurrencyRate(priceCurrency);

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
