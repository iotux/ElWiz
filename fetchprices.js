#!/usr/bin/env node

'use strict';

const programName = 'fetchprices';
const fs = require('fs');
const yaml = require('yamljs');
const request = require('axios');
const Mqtt = require('./mqtt/mqtt.js');
const { format, formatISO } = require('date-fns');
const { addZero, skewDays } = require('./misc/util.js');
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

async function uriDate(offset) {
  // offset equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const date = new Date(now.getTime() + oneDay * offset);
  const ret = format(date, 'dd-MM-yyyy');
  return ret;
}

async function calcAvg(start, end, obj) {
  let res = 0;
  for (let i = start; i < end; i++) {
    res += obj[i].spotPrice;
  }
  return (res / (end - start));
}

async function getPrices(dayOffset) {
  let oneDayPrices;
  const priceDate = skewDays(dayOffset);
  const priceName = PRICE_DB_PREFIX + priceDate;
  // Get prices for today and tomorrow
  const missingPrice = !await priceDb.existsObject(priceName);
  // Get prices absent from timespan
  if (missingPrice) {
    const url = nordPoolUri + await uriDate(dayOffset);
    console.log('Fetching:', priceName);
    // console.log('NordPool: ',url);
    await request(url, nordPool)
      .then(function (body) {
        const data = body.data.data;
        const rows = data.Rows;
        oneDayPrices = {
          priceDate,
          priceProvider: 'Nord Pool',
          priceProviderUrl: url,
          hourly: [],
          daily: {}
        };

        if (rows[0].Columns[priceRegion].Value !== '-') {
          for (let i = 0; i <= 23; i++) {
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
          //console.log('Averages before', peakPrice, offPeakPrice1, offPeakPrice2);
          if (typeof peakPrice !== 'number')
            peakPrice = parseFloat(calcAvg(6, 22, oneDayPrices.hourly).toFixed(4));
          if (typeof offPeakPrice1 !== 'number')
            offPeakPrice1 = parseFloat(calcAvg(0, 6, oneDayPrices.hourly).toFixed(4));
          if (typeof offPeakPrice2 !== 'number')
            offPeakPrice2 = parseFloat(calcAvg(22, 24, oneDayPrices.hourly).toFixed(4));
          //console.log('Averages after', peakPrice, offPeakPrice1, offPeakPrice2);

          oneDayPrices.daily = {
            minPrice: parseFloat((minPrice += minPrice * spotVatPercent / 100).toFixed(4)),
            maxPrice: parseFloat((maxPrice += maxPrice * spotVatPercent / 100).toFixed(4)),
            avgPrice: parseFloat((avgPrice += avgPrice * spotVatPercent / 100).toFixed(4)),
            peakPrice: parseFloat((peakPrice += peakPrice * spotVatPercent / 100).toFixed(4)),
            offPeakPrice1: parseFloat((offPeakPrice1 += offPeakPrice1 * spotVatPercent / 100).toFixed(4)),
            offPeakPrice2: parseFloat((offPeakPrice2 += offPeakPrice2 * spotVatPercent / 100).toFixed(4)),
            //spread: parseFloat((maxPrice - minPrice).toFixed(4)),
            //offPeakSpread: parseFloat((peakPrice - (offPeakPrice1 + offPeakPrice2) / 2).toFixed(4)),
            //spreadPercent: parseFloat(((maxPrice - minPrice) / maxPrice * 100).toFixed(4)),
            //offPeakSpreadPercent: parseFloat(((peakPrice - (offPeakPrice1 + offPeakPrice2) / 2) / peakPrice * 100).toFixed(4))
          };

          priceDb.createObject(priceName, oneDayPrices);

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
  // Publish yesterday, today and tomorrow day prices
  if (await priceDb.existsObject(priceName) && dayOffset >= -1) {
    let obj = await priceDb.retrieveObject(priceName)
    await publishMqtt(priceDate, obj);
  } else {
  // Unpublish retained MQTT messages before yesterday
  // to be sure that we don't have dangling retained prices
    if (dayOffset < -1 && dayOffset > -5)
      await publishMqtt(priceDate, null);
  }
} // getPrices()

async function publishMqtt(priceDate, priceObject) {
  const topic = priceTopic + '/' + priceDate;
  try {
    if (priceObject === null) {
      // Remove old retained prices
      await mqttClient.publish(topic, '', { retain: true, qos: 1 });
      console.log(programName + ': MQTT message removed:', pricePrefix + priceDate);
    } else {
      // Publish today and next day prices
      await mqttClient.publish(topic, JSON.stringify(priceObject, debug ? null : undefined, 2), { retain: true, qos: 1 });
      console.log(programName + ': MQTT message published:', pricePrefix + priceDate);
    }
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
  if (runNodeSchedule) {
    console.log('Fetch prices scheduled run...');
    //await delay(1000);
  } // 1 second

  await retireDays(keepDays);

  for (let i = (keepDays - 1) * -1; i <= 1; i++) {
    await getPrices(i);
  }
}

init();

if (runNodeSchedule) {
  schedule.scheduleJob(runSchedule, run);
}
// First a single run to init prices
priceDb = new UniCache(PRICE_DB_PREFIX, PRICE_DB_OPTIONS);
console.log(programName + ': Fetch prices starting...');
run();
