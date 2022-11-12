#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
const request = require('axios');
const { format } = require('date-fns');
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

let oneDayPrices = [];

function addZero(num) {
  if (num <= 9) {
    return "0" + num;
  }
  return num;
}

function getDate(ts) {
  // Returns date fit for file name
  let date = new Date(ts);
  return format(date,"yyyy-MM-dd")
}

function uriDate(days) {
  // days equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  let oneDay = 24 * 60 * 60 * 1000;
  let now = new Date();
  let date = new Date(now.getTime() + oneDay * days);
  let ret = format(date, 'dd-MM-yyyy');
  return ret;
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

function retireDays(days) {
  // Count days backwards
  while (fs.existsSync(savePath + "/prices-" + skewDays(days * -1) + ".json")) {
    fs.unlinkSync(savePath + "/prices-" + skewDays(days++ * -1) + ".json");
  }
}

function writeFile() {
  //console.log(oneDayPrices)
  if (oneDayPrices[0] !== undefined) {
    let date = oneDayPrices[0].startTime.substr(0, 10) + ".json";
    fs.writeFileSync(savePath + "/prices-" + date, JSON.stringify(oneDayPrices, false, 2));
    oneDayPrices = [];
  }
};

async function getPrices(days) {
  if (!fs.existsSync(savePath + "/prices-" + skewDays(days) + ".json")) {
    let url = nordPoolUri + uriDate(days);
    await request(url, nordPool)
      .then(function (body) {
        let data = body.data.data
        //console.log(data.Rows)
        let rows = data.Rows;
        for (let i = 0; i < 24; i++) {
          let price = rows[i].Columns[priceRegion].Value;
          if (price === '-') {
            console.log("Day ahead prices are not ready");
            exit(0)
          }
          let priceObj = {
            startTime: rows[i].StartTime,
            endTime: rows[i].EndTime,
            price: (price.toString().replace(/ /g, '').replace(/(\d)\,/g, '.$1') / 100).toFixed(4) * 1
          }
          oneDayPrices.push(priceObj);
        }
      })
    .catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        console.log('Headers:', err.response.headers)
      }
    }).then(writeFile)
  }
}

async function run() {
  await retireDays(keepDays);
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

