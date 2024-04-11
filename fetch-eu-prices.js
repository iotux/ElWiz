#!/usr/bin/env node

"use strict";

const programName = "fetch-eu-prices";
const fs = require("fs");
const yaml = require("yamljs");
const request = require("axios"); // .default;
const Mqtt = require("./mqtt/mqtt.js");
const { format, formatISO, parseISO, addHours } = require("date-fns");
const { addZero, skewDays } = require("./misc/util.js");
const UniCache = require("./misc/unicache");
const config = yaml.load("config.yaml");
const regionMap = yaml.load("priceregions.yaml");

// Specific for ENTSO-E
const convert = require("xml-js");
const { exit } = require("process");

const baseUrl = config.entsoeBaseUrl || "https://web-api.tp.entsoe.eu/api";
const token = config.priceAccessToken;
const regionCode = config.regionCode || "NO1";
const priceRegion = regionMap[regionCode];
const priceCurrency = config.priceCurrency || "NOK";
const currencyPath = config.currencyFilePath || "./data/currencies";
const pricePath = "./data/prices"; // config.priceFilePath || './data/prices';
const pricePrefix = "prices-";
const currencyPrefix = "currencies-";

const debug = config.DEBUG || false;
const priceTopic = config.priceTopic || "elwiz/prices";
const keepDays = config.keepDays || 7;

const spotVatPercent = config.spotVatPercent || 0;
const supplierDayPrice = config.supplierDayPrice || 0;
const supplierMonthPrice = config.supplierMonthPrice || 0;
const supplierVatPercent = config.supplierVatPercent || 0;

const gridDayPrice = config.gridDayPrice || 0;
const gridMonthPrice = config.gridMonthPrice || 0;
const gridVatPercent = config.gridVatPercent || 0;

const dayHoursStart = config.dayHoursStart.split(':')[0] | "06";
const dayHoursEnd = config.dayHoursEnd.split(':')[0] || "22";
const energyDayPrice = config.energyDayPrice || 0;
const energyNightPrice = config.energyNightPrice || 0;
const cacheType = config.cacheType || "file";

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
  schedule = require("node-schedule");
  runSchedule = new schedule.RecurrenceRule();
  runSchedule.hour = scheduleHours;
  runSchedule.minute = scheduleMinutes;
}

let priceDb;

// UniCache options
const PRICE_DB_PREFIX = pricePrefix || "prices-";
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
const CURR_DB_PREFIX = currencyPrefix || "currencies-";
const CURR_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: false, // R/O cache
  //syncInterval: 600,
  savePath: currencyPath,
};

const reqOpts = {
  method: "get",
  headers: {
    accept: "application/xml",
    "Content-Type": "application/xml",
  },
};
let runCounter = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let currencyRate;

async function getCurrencyRate(currency) {
  const currencyDb = new UniCache(`${CURR_DB_PREFIX}latest`, CURR_DB_OPTIONS);
  if (currencyDb.existsObject(`${CURR_DB_PREFIX}latest`)) {
    //const obj = await currencyDb.retrieveObject(`${CURR_DB_PREFIX}latest`);
    const obj = await currencyDb.fetch();
    console.log(obj);
    let ret = obj.rates[currency];
    return ret;
  } else {
    console.log("Error: no currency object present");
    console.log('Please run "./fetch-eu-currencies.js"');
    exit(0);
  }
}

function getEuDateTime(date, offset) {
  const utcDateTime = new Date(date);
  const localTime = addHours(utcDateTime, offset);
  return formatISO(localTime, { representation: "complete" });
}

function getFileName(priceDate) {
  return savePath + "/" + pricePrefix + priceDate + ".json";
}

function getKeyName(priceDate) {
  return pricePrefix + priceDate;
}

function entsoeDate(offset) {
  let date = new Date();
  date.setHours(0, 0, 0, 0); // Set to local midnight
  date.setDate(date.getDate() + offset); // Apply day offset
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  // Adjust the local midnight to UTC by adding the timezone offset
  const utcDate = new Date(date.getTime() + timezoneOffset);
  // Format the UTC date as 'yyyyMMddHHmm'
  const formattedUtcDate = format(utcDate, "yyyyMMddHHmm");
  return formattedUtcDate;
}

function calcAvg(start, end, obj) {
  let res = 0;
  for (let i = start; i < end; i++) {
    res += obj[i].spotPrice;
  }
  return res / (end - start);
}

function averageCalc(obj, element, start = 0, end) {
  // Default end to the last index of the "obj" object array if not specified
  if (end === undefined) {
    end = obj.length - 1;
  }

  // Adjust start and end based on provided parameters to cover the whole array if necessary
  start = start < 0 ? 0 : start; // Ensure start is not less than 0
  end = end >= obj.length ? obj.length - 1 : end; // Ensure end does not exceed the array length

  let sum = 0;
  let count = 0;

  // Calculate the sum of the specified element from start to end indices
  for (let i = start; i <= end; i++) {
    if (obj[i] && obj[i][element] !== undefined) {
      sum += obj[i][element];
      count++;
    }
  }

  // Return the average or null if count is 0 to avoid division by zero
  return count > 0 ? sum / count : null;
}
function entsoeUrl(token, region, periodStart, periodEnd) {
  return `${baseUrl}?documentType=A44&securityToken=${token}&in_Domain=${region}&out_Domain=${region}&periodStart=${periodStart}&periodEnd=${periodEnd}`;
}

async function getPrices(dayOffset) {
  let oneDayPrices;
  const priceDate = skewDays(dayOffset);
  const nextDate = skewDays(dayOffset + 1);
  const priceName = PRICE_DB_PREFIX + priceDate;
  // Get prices for today and tomorrow
  const missingPrice = !(await priceDb.existsObject(priceName));
  if (missingPrice) {
    const url = entsoeUrl(token, priceRegion, entsoeDate(dayOffset), entsoeDate(dayOffset + 1));
   await request
      .get(url, reqOpts)
      .then(function (body) {
        const result = convert.xml2js(body.data, { compact: true, spaces: 4 });
        if (result.Publication_MarketDocument !== undefined) {
          //console.log(result.Publication_MarketDocument.TimeSeries.Period.Point)
          const realMeat = result.Publication_MarketDocument.TimeSeries.Period;
          if (realMeat !== undefined) console.log("Fetching:", priceName);
          else console.log("Prices are not available:", priceDate);
          //console.log('realMeat:', JSON.stringify(realMeat, null, 2));
          const start = realMeat.timeInterval.start._text;
          const end = realMeat.timeInterval.end._text;
          let minPrice = 9999;
          let maxPrice = 0;
          oneDayPrices = {
            priceDate: priceDate,
            priceProvider: "ENTSO-E",
            priceProviderUrl: entsoeUrl("*****", priceRegion, entsoeDate(dayOffset), entsoeDate(dayOffset + 1)),
            hourly: [],
            daily: {},
          };
          //console.log('oneDayPrices', oneDayPrices)
          for (const curHour = 0; curHour <= 23; curHour++) {
            const gridPrice = curHour >= parseInt(dayHoursStart) && curHour < parseInt(dayHoursEnd) ? gridDayHourPrice : gridNightHourPrice;
            let spotPrice = (realMeat.Point[i]["price.amount"]._text * currencyRate) / 1000;
            spotPrice += (spotPrice * spotVatPercent) / 100;
            const priceObj = {
              //startTime: getEuDateTime(priceDate, i),
              //endTime: getEuDateTime(priceDate, i + 1),
              startTime: `${priceDate}T${addZero(i)}:00:00`,
              endTime: i === 23 ? `${nextDate}T00:00:00}` : `${priceDate}T${addZero(i + 1)}:00:00`,
              spotPrice: spotPrice.toFixed(4) * 1,
              gridFixedPrice: gridPrice.toFixed(4) * 1,
              supplierFixedPrice: supplierPrice.toFixed(4) * 1,
            };
            oneDayPrices.hourly.push(priceObj);

            minPrice = spotPrice < minPrice ? spotPrice : minPrice;
            maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice;
          }

          oneDayPrices.daily = {minPrice: parseFloat((minPrice += (minPrice * spotVatPercent) / 100).toFixed(4)),
            maxPrice: parseFloat((maxPrice += (maxPrice * spotVatPercent) / 100).toFixed(4)),
            //avgPrice: parseFloat(calcAvg(0, 24, oneDayPrices.hourly).toFixed(4)),
            //peakPrice: parseFloat(calcAvg(6, 22, oneDayPrices.hourly).toFixed(4)),
            //offPeakPrice1: parseFloat(calcAvg(0, 6, oneDayPrices.hourly).toFixed(4)),
            //offPeakPrice2: parseFloat(calcAvg(22, 24, oneDayPrices.hourly).toFixed(4)),

            avgPrice: parseFloat(averageCalc(oneDayPrices.hourly,spotPrice).toFixed(4)),
            peakPrice: parseFloat(averageCalc(oneDayPrices.hourly,spotPrice, dayHoursStart, dayHoursEnd - 1).toFixed(4)),
            offPeakPrice1: parseFloat(averageCalc(oneDayPrices.hourly,spotPrice, 0, dayHoursStart - 1).toFixed(4)),
            offPeakPrice2: parseFloat(averageCalc(oneDayPrices.hourly,spotPrice, dayHoursEnd).toFixed(4)),
            //spread: parseFloat((maxPrice - minPrice).toFixed(4)),
            ///offPeakSpread: parseFloat((peakPrice - (offPeakPrice1 + offPeakPrice2) / 2).toFixed(4)),
            //spreadPercent: parseFloat(((maxPrice - minPrice) / maxPrice * 100).toFixed(4)),
            ///offPeakSpreadPercent: parseFloat(((peakPrice - (offPeakPrice1 + offPeakPrice2) / 2) / peakPrice * 100).toFixed(4))
          };
          //console.log(oneDayPrices)
          priceDb.createObject(priceName, oneDayPrices);
        } else {
          console.log("Day ahead prices are not ready:", priceDate);
        }
      })
      .catch(function (err) {
        if (err.response) {
          console.log("Error:", err.response.status, err.response.statusText);
          if (debug) console.log("Headers:", err.response.headers);
        }
      });
  }
  // Publish yesterday, today and tomorrow day prices
  if ((await priceDb.existsObject(priceName)) && dayOffset >= -1) {
    let obj = await priceDb.retrieveObject(priceName);
    await publishMqtt(priceDate, obj);
  } else {
    // Unpublish retained MQTT messages before yesterday
    // to be sure that we don't have dangling retained prices
    if (dayOffset < -1 && dayOffset > -5) await publishMqtt(priceDate, null);
  }
} // getPrices()

async function publishMqtt(priceDate, priceObject) {
  const topic = priceTopic + "/" + priceDate;
  try {
    if (priceObject === null) {
      // Remove old retained prices
      await mqttClient.publish(topic, "", { retain: true, qos: 1 });
      console.log(programName + ": MQTT message removed:", pricePrefix + priceDate);
    } else {
      // Publish today and next day prices
      await mqttClient.publish(topic, JSON.stringify(priceObject, debug ? null : undefined, 2), { retain: true, qos: 1 });
      console.log(programName + ": MQTT message published:", pricePrefix + priceDate);
    }
  } catch (err) {
    console.log(programName, ": MQTT publish error", err);
  }
}

async function retireDays(offset) {
  // Count offset days backwards
  offset *= -1;
  const priceDate = skewDays(offset);
  const keys = await priceDb.dbKeys(PRICE_DB_PREFIX + "*");
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
  gridNightHourPrice += (gridNightHourPrice * gridVatPercent) / 100;

  gridDayHourPrice = price + energyDayPrice;
  gridDayHourPrice += (gridDayHourPrice * gridVatPercent) / 100;

  supplierPrice = supplierDayPrice / 24;
  supplierPrice += supplierMonthPrice / 720;
  supplierPrice += (supplierPrice * supplierVatPercent) / 100;
}

async function run() {
  currencyRate = await getCurrencyRate(priceCurrency);
  if (runNodeSchedule) {
    console.log("Fetch prices scheduled run...");
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
console.log(programName + ": Fetch prices starting...");
run();
