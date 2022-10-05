#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
//const dateFormat = require('dateformat');
const request = require('request-promise');

const C = yaml.load("config.yaml");

const runNodeSchedule = C.runNodeSchedule;
const keepDays = C.keepDays;
const priceCurrency = C.priceCurrency;
const priceRegion = C.priceRegion;
const scheduleHours = C.scheduleHours;
const scheduleMinutes = C.scheduleMinutes;

const nordPoolUri =  "https://www.nordpoolgroup.com/api/marketdata/page/10/" + priceCurrency + "/";

let fetchDay = "";

let schedule;
let runSchedule;
if (runNodeSchedule) {
  schedule = require('node-schedule');
  runSchedule = new schedule.RecurrenceRule();
  runSchedule.hour = scheduleHours;
  runSchedule.minute = scheduleMinutes;
}

let nordPool = {
    'uri': "",
  // "https://www.nordpoolgroup.com/api/marketdata/page/10/" + priceCurrency + "/" + fetchDay,
  headers: {
    'accept': 'application/json',
    'Content-Type': 'text/json',
  },
  json: true
  //method: 'GET'
};

const daysInMonth = [undefined, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const computePrices = C.computePrices;
const supplierKwhPrice = C.supplierKwhPrice; //0.0277;
const supplierMonthPrice = C.supplierMonthPrice; // 9.0;
const supplierVatPercent = C.supplierVatPercent;  // 25 

const spotVatPercent = C.spotVatPercent;

const gridKwhPrice = C.gridKwhPrice; //0.4454;
const gridDayPrice = C.gridDayPrice; //6.66;
const gridVatPercent = C.gridVatPercent;

let oneDayPrices = [];

function addZero(num) {
  if (num <= 9) {
    return "0" + num;
  }
  return num;
}

function flipDate(day) {
  return day.split("-")[2] + "-" + day.split("-")[1] + "-" + day.split("-")[0];
}

function fileDate(days) {
  // days equal to 0 is today
  // Negative values are daycount in the past
  // Positive are daycount in the future
  let oneDay = 24 * 60 * 60 * 1000;
  let now = new Date();
  let date = new Date(now.getTime() + oneDay * days);
  let day = date.toLocaleDateString();
  let ret = day.split("-")[0]
    + "-" + addZero(day.split("-")[1])
    + "-" + addZero(day.split("-")[2]);
  return ret;
}

function retireDays(days) {
  // Count days backwards
  while (fs.existsSync("./data/prices-" + fileDate(days * -1) + ".json")) {
    fs.unlinkSync("./data/prices-" + fileDate(days++ * -1) + ".json");
  }
}

function getValues (data) {
  let date = oneDayPrices[0].startTime.substr(0, 10) + ".json";
  fs.writeFileSync("./data/prices-" + date, JSON.stringify(oneDayPrices, false, 2));
  oneDayPrices = [];
};

function computePrice(priceObj) {
  let month = priceObj.startTime.split("-")[1] * 1;
  let supplierPrice = supplierKwhPrice + supplierMonthPrice / daysInMonth[month] / 24;
  supplierPrice += supplierPrice  * supplierVatPercent / 100;
  supplierPrice += priceObj.price * 1 + priceObj.price * spotVatPercent / 100;
  let gridPrice = gridKwhPrice + gridDayPrice / 24;
  gridPrice += gridDayPrice * gridVatPercent / 100;
  return {
    startTime: priceObj.startTime,
    endTime: priceObj.endTime,
    spotPrice: priceObj.price * 1,
    customerPrice: (supplierPrice + gridPrice).toFixed(4) * 1
  }
}

function initData() {
  if (!fs.existsSync("./data")) {
    fs.mkdirSync("./data");
    fetchDay = flipDate(fileDate(0));
    fetchData(fetchDay);
    // The default is to fetch prices for one day ahead 
    fetchDay = "";
  }
}

function fetchData(fetchDate) {
  retireDays(keepDays);
  if (!fs.existsSync("./data/prices-" + fetchDate + ".json")) {
    nordPool.uri = nordPoolUri + fetchDay;
    request(nordPool)
      .then(function (body) {
        let rows = body.data.Rows;
        for (let i = 0; i < 24; i++) {
          let price = rows[i].Columns[priceRegion].Value;
          let priceObj = {
            startTime: rows[i].StartTime,
            endTime: rows[i].EndTime,
            price: price.toString().replace(/ /g, '').replace(/(\d)\,/g, '.$1')
          }
          if (computePrices)
            oneDayPrices.push(computePrice(priceObj));
          else
            oneDayPrices.push(priceObj);
        }
      })
      .catch(function (e) {
        console.log(e)
      })
      .then(getValues)
  }
}

initData();

if (runNodeSchedule) {
  let sched = schedule.scheduleJob(runSchedule, function() {
    fetchData(fetchDay);
  })
} else
  fetchData(fetchDay);
