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

//const computePrices = config.computePrices;
const supplierKwhPrice = config.supplierKwhPrice;
const supplierMonthPrice = config.supplierMonthPrice;
const supplierVatPercent = config.supplierVatPercent; 

const spotVatPercent = config.spotVatPercent;

const gridKwhPrice = config.gridKwhPrice;
const gridDayPrice = config.gridDayPrice;
const gridVatPercent = config.gridVatPercent;
const savePath = config.priceDirectory;

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

function retireDays(offset) {
  // Count offset days backwards
  while (fs.existsSync(savePath + "/prices-" + skewDays(offset * -1) + ".json")) {
    fs.unlinkSync(savePath + "/prices-" + skewDays(offset * -1) + ".json");
    console.log("Price file removed:", savePath + "/prices-" + skewDays(offset * -1) + ".json")
    offset++;
  }
}

function writeFile(fileName) {
  //let fileName = savePath + "/prices-" + skewDays(offset) + ".json"
    fs.writeFileSync(fileName, JSON.stringify(oneDayPrices, false, 2));
    console.log("Price file saved:", fileName);
    oneDayPrices = { hourly: [], daily: undefined}
};

async function getPrices(dayOffset) {
  let fileName = savePath + "/prices-" + skewDays(dayOffset) + ".json";
  if (!fs.existsSync(fileName)) {
    let url = nordPoolUri + uriDate(dayOffset);
    //console.log('NordPool: ',url);
    await request(url, nordPool)
      .then(function (body) {
        let data = body.data.data;
        let rows = data.Rows;
        for (let i = 0; i < 24; i++) {
          let price = rows[i].Columns[priceRegion].Value;
          if (price === '-') {
            console.log("Day ahead prices are not ready:", skewDays(dayOffset));
            exit(0);
          }
          let priceObj = {
            startTime: rows[i].StartTime,
            endTime: rows[i].EndTime,
            spotPrice: (price.toString().replace(/ /g, '').replace(/(\d)\,/g, '.$1') / 100).toFixed(4) * 1,
            customerPrice: 0
          }
          //console.log(rows[i].StartTime)
          oneDayPrices['hourly'].push(priceObj);
        }
        oneDayPrices.daily = {
          minPrice: (rows[24].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001).toFixed(4) * 1,
          maxPrice: (rows[25].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001).toFixed(4) * 1,
          avgPrice: (rows[26].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001).toFixed(4) * 1,
          peakPrice: (rows[27].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001).toFixed(4) * 1,
          offPeakPrice1: (rows[28].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001).toFixed(4) * 1,
          offPeakPrice2: (rows[29].Columns[priceRegion].Value.toString().replace(/ /g, '').replace(/\,/g, '.') * 0.001).toFixed(4) * 1,
        }
        writeFile(fileName);
      })
      .catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        console.log('Headers:', err.response.headers)
      }
    })
  }
}

async function run() {
  await retireDays(keepDays);
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
    for (let i = (keepDays - 1) * -1; i <= 0; i++) {
      await getPrices(i);
    }
  }
  await getPrices(1)
}

if (runNodeSchedule) {
  //let sched =
  schedule.scheduleJob(runSchedule, run)
} else {
  run();
}

