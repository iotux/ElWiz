#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
const request = require('axios') //.default;
const { createClient } = require('redis');
const mqtt = require("mqtt");
const convert = require('xml-js');
const { format } = require('date-fns')
const { exit } = require('process');
const { runInContext } = require('vm');
const config = yaml.load("config.yaml");

const client = createClient();

const debug = config.DEBUG
const keepDays = config.keepDays;
const currencyDirectory = config.currencyDirectory;
const priceCurrency = config.priceCurrency;
const priceRegion = config.priceRegion;

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

const currencyFile = currencyDirectory + '/currencies-latest.json';

const baseUrl = "https://transparency.entsoe.eu/api";
const token = config.priceAccessToken;

let reqOpts = {
  method: "get",
  headers: {
    'accept': 'application/xml',
    'Content-Type': 'text/xml',
  },
}

let currencyRate;

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
  if (!fs.existsSync(savePath + "/prices-" + skewDays(dayOffset) + ".json")) {
    let url = entsoeUrl(token, entsoeDate(dayOffset), entsoeDate(dayOffset + 1));
    let fileName = savePath + '/prices-' + skewDays(dayOffset) + '.json';
    let redisKey = "prices-" + skewDays(dayOffset);

    await request.get(url, reqOpts).then(function (body) {
      let result = convert.xml2js(body.data, { compact: true, spaces: 4 });
      if (result.Publication_MarketDocument !== undefined) {
        let realMeat = result.Publication_MarketDocument.TimeSeries.Period;
        let startDay = getDate(realMeat.timeInterval.start._text);
        let endDay = getDate(realMeat.timeInterval.end._text);
        let minPrice = 9999;
        let maxPrice = 0;
        let oneDayPrices = {
          priceProvider: 'ENTSO-E',
          priceProviderUrl: url,
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
            supplierFixedPrice: supplierPrice.toFixed(4) * 1,
            customerPrice: undefined
          }
          //console.log(priceObj)
          oneDayPrices['hourly'].push(priceObj);

          minPrice = spotPrice < minPrice ? spotPrice : minPrice;
          maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice
          //console.log(oneDayPrices)
        }
  
        oneDayPrices['daily'] = {
          minPrice: (minPrice += minPrice * spotVatPercent / 100).toFixed(4) * 1,
          maxPrice: (maxPrice += maxPrice * spotVatPercent / 100).toFixed(4) * 1,
          avgPrice: (calcAvg(0, 24, oneDayPrices['hourly'])).toFixed(4) * 1,
          peakPrice: (calcAvg(6, 22, oneDayPrices['hourly'])).toFixed(4) * 1,
          offPeakPrice1: (calcAvg(0, 6, oneDayPrices['hourly'])).toFixed(4) * 1,
          offPeakPrice2: (calcAvg(22, 24, oneDayPrices['hourly'])).toFixed(4) * 1,
        }
        //let date = oneDayPrices['hourly'][0].startTime.substr(0, 10) + ".json";

        client.set(redisKey, oneDayPrices);
        fs.writeFileSync(fileName, JSON.stringify(oneDayPrices, false, 2));
        console.log("Price file saved:", fileName);
      } else {
        console.log("Day ahead prices are not ready", skewDays(dayOffset));
      }
    }).catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        if (debug) console.log('Headers:', err.response.headers)
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
  client.on('error', err => console.log('Redis Client Error', err));
  await client.connect();
  if (!fs.existsSync(currencyDirectory)) {
    console.log("No currency file present");
    console.log('Please run "./fetch-eu-currencies.js"');
    // exit(0); // This results in frequent pm2 restarts
  } else {
    currencyRate = getCurrency(priceCurrency);
  }
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }
  for (let i = (keepDays - 1) * -1; i <= 0; i++) {
    await getPrices(i);
  }
  await getPrices(1)
}

init();

if (runNodeSchedule) {
  // First a single run to init prices
  run();
  console.log("Fetch prices scheduling started...");
  schedule.scheduleJob(runSchedule, run)
} else {
  run();
}
