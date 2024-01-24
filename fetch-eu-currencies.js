#!/usr/bin/env node

'use strict';

const fs = require('fs');
const yaml = require('yamljs');
const convert = require('xml-js');
const request = require('axios');
const { format } = require('date-fns');
const { skewDays } = require('./misc/util');
const UniCache = require('./misc/unicache');
const config = yaml.load('config.yaml');

const savePath = config.currencyFilePath || './data/currencies';
const debug = config.DEBUG;
const cacheType = config.cacheType || 'file';

const namePrefix = 'currencies-';
const url = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const keepDays = config.keepDays || 7;

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

const DB_PREFIX = namePrefix;
const DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: true,
  //syncInterval: 600,
  savePath: savePath,
};
const cacheName = `${DB_PREFIX}latest`;
const currencyDb = new UniCache(cacheName, DB_OPTIONS);

const options = {
  headers: {
    accept: 'application/xml',
    'Content-Type': 'text/xml'
  },
  method: 'GET'
};

function getEuroRates(cur) {
  const obj = {};
  for (let i = 0; i < cur.length; i++) {
    obj[cur[i]._attributes.currency] = cur[i]._attributes.rate * 1;
  }
  return obj;
}
async function getCurrencies() {
  retireDays(keepDays);

  request(url, options)
    .then(function (body) {
      const result = convert.xml2js(body.data, { compact: true, spaces: 4 });
      const root = result['gesmes:Envelope'].Cube.Cube;
      const obj = {
        status: 'OK',
        date: root._attributes.time,
        base: 'EUR',
        rates: getEuroRates(root.Cube)
      };

      //currencyDb.createObject(`${DB_PREFIX}latest`, obj);
      currencyDb.init(obj);
      console.log('Currencies stored as', `${DB_PREFIX}latest`);
      currencyDb.createObject(`${DB_PREFIX}${obj.date}`, obj);
      console.log('Currencies stored as', `${DB_PREFIX}${obj.date}`);
      if (debug) {
        console.log(JSON.stringify(obj, null, 2));
      }
    })
    .catch(function (err) {
      if (err.response) {
        console.log('Error:', err.response.status, err.response.statusText);
        console.log('Headers:', err.response.headers);
      }
    });
}
async function retireDays(offset) {
  // Count offset days backwards
  offset *= -1;
  const retireDate = skewDays(offset);
  const keys = await currencyDb.dbKeys(`${DB_PREFIX}${retireDate}'*'`);
  console.log('Retiring', keys);
  keys.forEach(async (key) => {
    if (key <= `${DB_PREFIX}${retireDate}`) {
      await currencyDb.deleteObject(key);
    }
  });
}

if (runNodeSchedule) {
  console.log('Fetch currency rates scheduling started..');
  schedule.scheduleJob(runSchedule, getCurrencies);
}

//currencyDb = new UniCache(null, DB_OPTIONS);

getCurrencies();
