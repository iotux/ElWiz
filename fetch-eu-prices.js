#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
const request = require('axios') //.default;
const mqtt = require("mqtt");
const convert = require('xml-js');
const { format } = require('date-fns')
const { exit } = require('process');
const { runInContext } = require('vm');

const config = yaml.load("config.yaml");
const debug = config.DEBUG
const currencyDirectory = config.currencyDirectory;
const savePath = config.priceDirectory;
const currency = config.priceCurrency;
const VAT = config.spotVatPercent / 100;

const keepDays = config.keepDays;
const priceRegion = config.priceRegion;

const runNodeSchedule = config.runNodeSchedule;
const scheduleHours = config.scheduleHours;
const scheduleMinutes = config.scheduleMinutes;
const computePrices = config.computePrices;

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

let client;
let fetchDay = 1;
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

function calcAvg(start, end, obj, decimals) {
  let res = 0;
  for (let i = start; i < end; i++) {
    res += obj[i].spotPrice;
  }
  return (res / (end - start)).toFixed(decimals) * 1
}

function entsoeUrl(token, periodStart, periodEnd) {
  return baseUrl + "?documentType=A44"
    + "&in_Domain=10YNO-3--------J"
    + "&out_Domain=10YNO-3--------J"
    + "&securityToken=" + token
    + "&periodStart=" + periodStart
    + "&periodEnd=" + periodEnd;
}

async function getPrices(days) {
  if (!fs.existsSync(savePath + "/prices-" + skewDays(days) + ".json")) {
    let url = entsoeUrl(token, entsoeDate(days), entsoeDate(days + 1));
    //console.log(reqOpts)
    await request.get(url, reqOpts).then(function (body) {
      //console.log(body.data)
      let result = convert.xml2js(body.data, { compact: true, spaces: 4 });
      //console.log(result)
      if (result.Publication_MarketDocument !== undefined) {
        let realMeat = result.Publication_MarketDocument.TimeSeries.Period;
        let startDay = getDate(realMeat.timeInterval.start._text);
        let endDay = getDate(realMeat.timeInterval.end._text);
        let minPrice = 9999;
        let maxPrice = 0;
        let oneDayPrices = {
          hourly: [],
          daily: {}
        }
        for (let i = 0; i <= 23; i++) {
          let spotPrice = ((realMeat.Point[i]["price.amount"]._text * currencyRate) / 1000).toFixed(4) * 1;
          oneDayPrices['hourly'].push({
            startTime: startDay + 'T' + addZero(realMeat.Point[i].position._text - 1) + ':00:00',
            endTime: i === 23 ? endDay + 'T00:00:00'
              : startDay + 'T' + addZero(realMeat.Point[i].position._text) + ':00:00',
            spotPrice: spotPrice,
            //customerPrice: 0,
          })
          minPrice = spotPrice < minPrice ? spotPrice : minPrice;
          maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice
        }
  
        oneDayPrices['daily'] = {
          minPrice: minPrice.toFixed(4) * 1,
          maxPrice: maxPrice.toFixed(4) * 1,
          avgPrice: calcAvg(0, 24, oneDayPrices['hourly'], 4),
          peakPrice: calcAvg(6, 22, oneDayPrices['hourly'], 4),
          offPeakPrice1: calcAvg(0, 6, oneDayPrices['hourly'], 4),
          offPeakPrice2: calcAvg(22, 24, oneDayPrices['hourly'], 4),
        }
        //let date = oneDayPrices['hourly'][0].startTime.substr(0, 10) + ".json";
        let file = savePath + '/prices-' + skewDays(days) + '.json';
        fs.writeFileSync(file, JSON.stringify(oneDayPrices, false, 2));
      } else {
        console.log("Day ahead prices are not ready");
        exit(0)
      }
    }).catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        if (debug) console.log('Headers:', err.response.headers)
      }
    })
  }
}

async function run() {
  if (!fs.existsSync(currencyDirectory)) {
    console.log("No currency file present");
    console.log('Please run "./fetch-eu-currencies.js"');
    exit(0);
  } else {
    currencyRate = getCurrency(currency);
  }
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
    await getPrices(0);
  }
  await getPrices(1)
}

if (runNodeSchedule) {
  //let sched =
  schedule.scheduleJob(runSchedule, run)
} else {
  run();
}
