#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
const request = require('axios');
const { format } = require('date-fns');
const { setWeekWithOptions } = require('date-fns/fp');
const config = yaml.load("config.yaml");

const keepDays = config.keepDays;
const priceCurrency = config.priceCurrency;
const priceRegion = config.priceRegion;
const nordPoolUri =  "https://www.nordpoolgroup.com/api/marketdata/page/10/" + priceCurrency + "/";

const spotVatPercent = config.spotVatPercent;
const supplierDayPrice = config.supplierDayPrice;
const supplierMonthPrice = config.supplierMonthPrice;
const supplierVatPercent = config.supplierVatPercent; 

const gridDayPrice = config.gridDayPrice;
const gridMonthPrice = config.gridMonthPrice;
const gridVatPercent = config.gridVatPercent;

const dayHoursStart = config.dayHoursStart;
const dayHoursEnd = config.dayHoursEnd;
const energyDayPrice = config.energyDayPrice;
const energyNightPrice = config.energyNightPrice;
const savePath = config.priceDirectory;
const useRedis = (config.cache === 'redis');

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

let client;
if (useRedis) {
  const { createClient } = require('redis');
  client = createClient();
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

const daysInMonth = [undefined, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

let oneDayPrices = {
  hourly: [],
  daily: {}
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

function skewDays(offset) {
  // offset equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  let oneDay = 24 * 60 * 60 * 1000;
  let now = new Date();
  let date = new Date(now.getTime() + oneDay * offset);
  let ret = format(date, 'yyyy-MM-dd');
  return ret;
}

async function retireDays(offset) {
  // Count offset days backwards
  while (fs.existsSync(savePath + "/prices-" + skewDays(offset * -1) + ".json")) {
    fs.unlinkSync(savePath + "/prices-" + skewDays(offset * -1) + ".json");
    console.log("Price file removed:", savePath + "/prices-" + skewDays(offset * -1) + ".json")
    offset++;
  }
}

function writeFile(prices, fileName) {
  //let fileName = savePath + "/prices-" + skewDays(offset) + ".json"
  fs.writeFileSync(fileName, JSON.stringify(prices, false, 2));
    console.log("Price file saved:", fileName);
};

async function getPrices(dayOffset) {
  let fileName = savePath + "/prices-" + skewDays(dayOffset) + ".json";
  let redisKey = "prices-" + skewDays(dayOffset);
  if (!fs.existsSync(fileName)) {
    let url = nordPoolUri + uriDate(dayOffset);
    //console.log('NordPool: ',url);
    await request(url, nordPool)
      .then(function (body) {
        let data = body.data.data;
        let rows = data.Rows;
        let oneDayPrices = {
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
              supplierFixedPrice: supplierPrice.toFixed(4) * 1,
              customerPrice: undefined
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
          if (useRedis)
            client.set(redisKey, JSON.stringify(oneDayPrices));
          writeFile(oneDayPrices, fileName);
        } else {
          console.log("Day ahead prices are not ready:", skewDays(dayOffset));
        }

      })
      .catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        console.log('Headers:', err.response.headers)
      }
    })
  }
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
  if (useRedis) {
    client.on('error', err => console.log('Redis Client Error', err));
    await client.connect();
  }
  await retireDays(keepDays);
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }
  for (let i = (keepDays - 1) * -1; i <= 0; i++) {
    await getPrices(i);
  }
  await getPrices(1);
  if (useRedis)
    await client.quit();
}

init();

if (runNodeSchedule) {
  run();
  console.log("Fetch prices scheduling started...");
  schedule.scheduleJob(runSchedule, run)
} else {
  run();
}

