#!/usr/bin/env node

'use strict';

const programName = 'fetchprices';
const fs = require('fs');
const request = require('axios');
const MQTTClient = require('./mqtt/mqtt');
const UniCache = require('./misc/unicache');
const { addZero, skewDays, loadYaml } = require('./misc/util.js');
const { format, formatISO } = require('date-fns');

// Specific for ENTSO-E
const convert = require('xml-js');
const { exit } = require('process');

const config = loadYaml('./config.yaml');
const regionMap = loadYaml('./priceregions.yaml');

const nordPoolUrl = config.nordpoolBaseUrl || 'https://www.nordpoolgroup.com/api/marketdata/page/10';
const baseUrl = config.entsoeBaseUrl || 'https://web-api.tp.entsoe.eu/api';
const entsoeToken = config.priceAccessToken || null;
const priceRegion = config.priceRegion || 8; // Oslo
const region = config.regionCode || 'NO1';
const regionCode = regionMap[region];

const priceFetchPriority = config.priceFetchPriority || 'nordpool';
const pricePath = config.priceFilePath || './data/prices';
const pricePrefix = 'prices-';

const priceCurrency = config.priceCurrency || 'NOK';
const currencyPath = config.currencyFilePath || './data/currencies';
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

//const dayHoursStart = parseInt(config.dayHoursStart.split(':')[0]) || 6;
//const dayHoursEnd = parseInt(config.dayHoursEnd.split(':')[0]) || 22;
const dayHoursStart = config.dayHoursStart || 6;
const dayHoursEnd = config.dayHoursEnd || 22;
const energyDayPrice = config.energyDayPrice || 0;
const energyNightPrice = config.energyNightPrice || 0;
const cacheType = config.cacheType || 'file';

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'hassPublish');

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

// UniCache options
const PRICE_DB_PREFIX = pricePrefix || 'prices-';
const PRICE_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: true,
  savePath: pricePath,
};
const priceDb = new UniCache(PRICE_DB_PREFIX, PRICE_DB_OPTIONS);

const CURR_DB_PREFIX = currencyPrefix || 'currencies-';
const CURR_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: false,
  savePath: currencyPath,
};
const currencyDb = new UniCache(`${CURR_DB_PREFIX}latest`, CURR_DB_OPTIONS);

const nordPoolOpts = {
  headers: {
    accept: 'application/json',
    'Content-Type': 'text/json',
  },
  json: true,
};

const entsoeOpts = {
  method: 'get',
  headers: {
    accept: 'application/xml',
    'Content-Type': 'application/xml',
  },
};

let runCounter = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let currencyRate;

async function getCurrencyRate(currency) {
  if (await currencyDb.existsObject(`${CURR_DB_PREFIX}latest`)) {
    const obj = await currencyDb.retrieveObject(`${CURR_DB_PREFIX}latest`);
    let ret = obj.rates[currency];
    return ret;
  } else {
    console.log('Error: no currency object present');
    console.log(`Please run "./fetch-eu-currencies.js"`);
    exit(0);
  }
}

async function nordpoolDate(offset) {
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const date = new Date(now.getTime() + oneDay * offset);
  const ret = format(date, 'dd-MM-yyyy');
  return ret;
}

function entsoeDate(offset) {
  let date = new Date();
  date.setHours(0, 0, 0, 0); // Set to local midnight
  date.setDate(date.getDate() + offset); // Apply day offset
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  // Adjust the local midnight to UTC by adding the timezone offset
  const utcDate = new Date(date.getTime() + timezoneOffset);
  // Format the UTC date as 'yyyyMMddHHmm'
  const formattedUtcDate = format(utcDate, 'yyyyMMddHHmm');
  return formattedUtcDate;
}

function averageCalc(arr, key, start = 0, end) {
  if (end === undefined) {
    end = arr.length - 1;
  }
  start = start < 0 ? 0 : start;
  end = end >= arr.length ? arr.length - 1 : end;

  let sum = 0;
  let count = 0;

  for (let i = start; i <= end; i++) {
    if (arr[i] && arr[i][key] !== undefined) {
      sum += arr[i][key];
      count++;
    }
  }

  return count > 0 ? sum / count : null;
}

function entsoeUrl(entsoeToken, region, periodStart, periodEnd) {
  return `${baseUrl}?documentType=A44&securityToken=${entsoeToken}&in_Domain=${region}&out_Domain=${region}&periodStart=${periodStart}&periodEnd=${periodEnd}`;
}

async function getNordPoolPrices(dayOffset) {
  const priceDate = skewDays(dayOffset);
  const priceName = PRICE_DB_PREFIX + priceDate;
  const missingPrice = !(await priceDb.existsObject(priceName));
  let oneDayPrices;

  if (missingPrice) {
    const url = `${nordPoolUrl}/${priceCurrency}/${await nordpoolDate(dayOffset)}`;
    console.log(`Fetching: ${priceName}`);
    try {
      const body = await request(url, nordPoolOpts);
      const data = body.data.data;
      const rows = data.Rows;
      oneDayPrices = {
        priceDate,
        priceProvider: 'Nord Pool',
        priceProviderUrl: url,
        hourly: [],
        daily: {},
      };

      if (rows[0].Columns[priceRegion].Value !== '-') {
        for (let curHour = 0; curHour <= 23; curHour++) {
          const price = rows[curHour].Columns[priceRegion].Value;
          const startTime = rows[curHour].StartTime;
          const endTime = rows[curHour].EndTime;
          const gridPrice =
            curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
          let spotPrice = price.toString().replace(/ /g, '').replace(/(\d),/g, '.$1') / 100;
          spotPrice += (spotPrice * spotVatPercent) / 100;
          const priceObj = {
            startTime,
            endTime,
            spotPrice: parseFloat(spotPrice.toFixed(4)),
            gridFixedPrice: parseFloat(gridPrice.toFixed(4)),
            supplierFixedPrice: parseFloat(supplierPrice.toFixed(4)),
          };
          oneDayPrices.hourly.push(priceObj);
        }

        let minPrice = parseFloat(rows[24].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.')) * 0.001;
        let maxPrice = parseFloat(rows[25].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.')) * 0.001;
        let avgPrice = parseFloat(rows[26].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.')) * 0.001;

        let peakPrice = parseFloat(rows[27].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.')) * 0.001;
        let offPeakPrice1 = parseFloat(rows[28].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.')) * 0.001;
        let offPeakPrice2 = parseFloat(rows[29].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/,/g, '.')) * 0.001;

        if (Number.isNaN(peakPrice)) {
          peakPrice = parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', dayHoursStart, dayHoursEnd - 1).toFixed(4));
          offPeakPrice1 = parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', 0, dayHoursStart - 1).toFixed(4));
          offPeakPrice2 = parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', dayHoursEnd, 23).toFixed(4));
        }

        oneDayPrices.daily = {
          minPrice: parseFloat((minPrice += (minPrice * spotVatPercent) / 100).toFixed(4)),
          maxPrice: parseFloat((maxPrice += (maxPrice * spotVatPercent) / 100).toFixed(4)),
          avgPrice: parseFloat((avgPrice += (avgPrice * spotVatPercent) / 100).toFixed(4)),
          peakPrice: parseFloat((peakPrice += (peakPrice * spotVatPercent) / 100).toFixed(4)),
          offPeakPrice1: parseFloat((offPeakPrice1 += (offPeakPrice1 * spotVatPercent) / 100).toFixed(4)),
          offPeakPrice2: parseFloat((offPeakPrice2 += (offPeakPrice2 * spotVatPercent) / 100).toFixed(4)),
        };

        // Store to cache
        await priceDb.createObject(priceName, oneDayPrices);
      } else {
        console.log(`getNordPoolPrices: Day ahead prices are not ready: ${priceName}`);
      }
    } catch (err) {
      if (err.response) {
        //console.log('Error:', err.response.status, err.response.statusText);
        if (debug) console.log(`Headers:\n${err.response.headers}`);
      }
    }
    return true;
  } else {
    return false;
  }
}

async function getEntsoePrices(dayOffset) {
  const priceDate = skewDays(dayOffset);
  const nextDate = skewDays(dayOffset + 1);
  const priceName = PRICE_DB_PREFIX + priceDate;
  const missingPrice = !(await priceDb.existsObject(priceName));
  let oneDayPrices;
  if (missingPrice) {
    const url = entsoeUrl(entsoeToken, regionCode, entsoeDate(dayOffset), entsoeDate(dayOffset + 1));
    await request.get(url, entsoeOpts)
      .then(async function (body) {
        const result = convert.xml2js(body.data, { compact: true, spaces: 4 });
        if (result.Publication_MarketDocument !== undefined) {
          const realMeat = result.Publication_MarketDocument.TimeSeries.Period;
          if (realMeat !== undefined) {
            console.log(`Fetching: ${priceName}`);
          } else {
            console.log(`Prices are not available: ${priceDate}`);
            return; // Exit the function early if prices are not available
          }
          let minPrice = 9999;
          let maxPrice = 0; oneDayPrices = {
            priceDate: priceDate,
            priceProvider: "ENTSO-E",
            priceProviderUrl: entsoeUrl("*****", priceRegion, entsoeDate(dayOffset), entsoeDate(dayOffset + 1)),
            hourly: [],
            daily: {},
          };

          for (let curHour = 0; curHour <= 23; curHour++) {
            const gridPrice = curHour >= dayHoursStart && curHour < dayHoursEnd
              ? gridDayHourPrice
              : gridNightHourPrice;
            let spotPrice = (realMeat.Point[curHour]['price.amount']._text * currencyRate) / 1000;
            spotPrice += (spotPrice * spotVatPercent) / 100;
            const priceObj = {
              startTime: `${priceDate}T${addZero(curHour)}:00:00`,
              endTime: curHour === 23 ? `${nextDate}T00:00:00` : `${priceDate}T${addZero(curHour + 1)}:00:00`,
              spotPrice: parseFloat(spotPrice.toFixed(4)),
              gridFixedPrice: parseFloat(gridPrice.toFixed(4)),
              supplierFixedPrice: parseFloat(supplierPrice.toFixed(4)),
            };
            oneDayPrices.hourly.push(priceObj);

            minPrice = spotPrice < minPrice ? spotPrice : minPrice;
            maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice;
          }

          oneDayPrices.daily = {
            minPrice: parseFloat((minPrice + (minPrice * spotVatPercent) / 100).toFixed(4)),
            maxPrice: parseFloat((maxPrice + (maxPrice * spotVatPercent) / 100).toFixed(4)),
            avgPrice: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice').toFixed(4)),
            peakPrice: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', dayHoursStart, dayHoursEnd - 1).toFixed(4)),
            offPeakPrice1: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', 0, dayHoursStart - 1).toFixed(4)),
            offPeakPrice2: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', dayHoursEnd, 23).toFixed(4)),
          };

          // Store to cache
          await priceDb.createObject(priceName, oneDayPrices);
        } else {
          console.log(`getEntsoePrices: Day ahead prices are not ready: ${priceDate}`);
        }
      })
      .catch(function (err) {
        if (err.response) {
          if (debug) console.log(`Headers:\n${err.response.headers}`);
          console.log(`Error:' ${err.response.status}: ${err.response.statusText}`);
          if (err.response.status === 401) {
            console.log('The Entso-E API requires an access token. Please see https://transparency.entsoe.eu/content/static_content/download?path=/Static%20content/API-Token-Management.pdf');
          }
          process.exit(1);
        }
      });
    return true;
  } else {
    return false;
  }
}

async function publishMqtt(priceDate, priceObject) {
  await mqttClient.waitForConnect();
  const topic = `${priceTopic}/${priceDate}`;
  try {
    if (priceObject === null) {
      // Remove old retained prices
      await mqttClient.publish(topic, '', { retain: true, qos: 1 });
      console.log(`${programName}: MQTT message removed: ${PRICE_DB_PREFIX}${priceDate}`);
    } else {
      // Publish today and next day prices
      await mqttClient.publish(
        topic,
        JSON.stringify(priceObject, debug ? null : undefined, 2),
        { retain: true, qos: 1 }
      );
      console.log(`${programName}: MQTT message published: ${PRICE_DB_PREFIX}${priceDate}`);
    }
  } catch (err) {
    console.log(`${programName}: MQTT message error`, err);
  }
}

async function retireDays(offset) {
  offset *= -1;
  const priceDate = skewDays(offset);
  const keys = await priceDb.dbKeys(PRICE_DB_PREFIX + '*');
  keys.forEach(async (key) => {
    if (key <= `${PRICE_DB_PREFIX}${priceDate}`) {
      await priceDb.deleteObject(key);
    }
  });
}

async function init() {
  let price = gridDayPrice / 24;
  price += gridMonthPrice / 720; // 30 x 24 is close enough;
  gridNightHourPrice = price + energyNightPrice;
  gridNightHourPrice += (gridNightHourPrice * gridVatPercent) / 100;

  gridDayHourPrice = price + energyDayPrice;
  gridDayHourPrice += (gridDayHourPrice * gridVatPercent) / 100;

  supplierPrice = supplierDayPrice / 24;
  supplierPrice += supplierMonthPrice / 720;
  supplierPrice += (supplierPrice * supplierVatPercent) / 100;
}

async function run() {
  if (runNodeSchedule) {
    console.log('Fetch prices scheduled run...');
  }

  await retireDays(keepDays);

  for (let i = (keepDays - 1) * -1; i <= 1; i++) {
    if (!await priceDb.existsObject(`${PRICE_DB_PREFIX}${skewDays(i)}`)) {
      if (priceFetchPriority === "nordpool") {
        const success = await getNordPoolPrices(i);
        if (!success) {
          currencyRate = await getCurrencyRate(priceCurrency);
          await getEntsoePrices(i);
        }
      } else {
        currencyRate = await getCurrencyRate(priceCurrency);
        const success = await getEntsoePrices(i);
        if (!success) {
          await getNordPoolPrices(i);
        }
      }
    }
  }

  await delay(2000);

  if (await priceDb.existsObject(`${PRICE_DB_PREFIX}${skewDays(1)}`)) {
    console.log('NextDayAvailable')
    await publishMqtt(skewDays(-1), null);
    //await publishMqtt(skewDays(-1), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(-1)}`));
    await publishMqtt(skewDays(0), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(0)}`));
    await publishMqtt(skewDays(1), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(1)}`));
  } else {
    await publishMqtt(skewDays(-2), null);
    await publishMqtt(skewDays(-1), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(-1)}`));
    await publishMqtt(skewDays(0), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(0)}`));
  }
}

init();

if (runNodeSchedule) {
  schedule.scheduleJob(runSchedule, run);
}

console.log(`${programName}: Fetch prices starting...`);
run();
