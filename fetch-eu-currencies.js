#!/usr/bin/env node

"use strict"

const fs = require('fs');
const yaml = require("yamljs");
const convert = require('xml-js');
const request = require('axios');
const config = yaml.load("config.yaml");

const savePath = config.currencyFilePath || './data/currencies';
const debug = config.DEBUG;
const cacheType = config.cacheType || 'file';
const useRedis = (cacheType === 'redis');

const namePrefix = 'currencies-';
const url = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const runNodeSchedule = config.runNodeSchedule || true;
// Currency rates are available around 16:00 hours
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

let redisClient;
if (useRedis) {
  const { createClient } = require('redis');
  redisClient = createClient();
}

let options = {
  headers: {
    'accept': 'application/xml',
    'Content-Type': 'text/xml',
  },
  method: 'GET'
}

function getEuroRates(cur) {
  let obj = {}
  for (let i = 0; i < cur.length; i++) {
    obj[cur[i]._attributes.currency] = cur[i]._attributes.rate * 1
  }
  return obj
}
async function getCurrencies() {
  request(url, options)
    .then(function (body) {
      let result = convert.xml2js(body.data, { compact: true, spaces: 4 });
      let root = result['gesmes:Envelope']['Cube']['Cube']
      let obj = {
        "status": "OK",
        "date": root._attributes.time,
        "base": "EUR",
        "rates": getEuroRates( root.Cube)
      }

      let strObj = JSON.stringify(obj, null, 2);
      if (useRedis) {
        let redisKey = namePrefix + obj['date'];
        redisClient.set(redisKey, strObj);
        redisKey = namePrefix + 'latest';
        redisClient.set(redisKey, strObj);
      } else {
        let fileName = savePath + '/' + namePrefix + obj['date'] + '.json';
        fs.writeFileSync(fileName, strObj);
        fileName = savePath + '/' + namePrefix + 'latest.json';
        fs.writeFileSync(fileName, strObj);
      }
      if (debug) {
        console.log(JSON.stringify(obj, !debug, 2))
      }
    })
    .catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        console.log('Headers:', err.response.headers)
      }
    })
}

async function init() {
  if (useRedis && !redisClient.isOpen){
    redisClient.on('error', err => console.log('Redis Client Error', err));
    await redisClient.connect();
  }
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }
}

init();
if (runNodeSchedule) {
  console.log>("Fetch currency rates scheduling started..")
  schedule.scheduleJob(runSchedule, getCurrencies);
  getCurrencies();
} else {
  getCurrencies();
}
