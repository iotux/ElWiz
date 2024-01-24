
// const { format } = require('date-fns');
const yaml = require('yamljs');
const { event } = require('../misc/misc.js');
const { getDate, getPreviousHour, getCurrentDate, skewDays, getPreviousDate, getNextDate } = require('../misc/util.js');
const UniCache = require('../misc/unicache.js');
const db = require('../misc/dbinit.js');

const configFile = './config.yaml';
const config = yaml.load(configFile);
const storageDebug = config.storageDebug || config.DEBUG;

const DAY_DB_PREFIX = 'daydata-';
const DAY_SUM_PREFIX = 'daysummary-';
const DB_OPTIONS = {
  cacheType: 'redis',
  syncOnWrite: true,
  //syncInterval: 600,
  savePath: './data/history'
};
let dayDb;
let sumDb;
let currentDate;
let previousDate;

async function calculateSums(array, keysToKeep, decimals) {
  const result = array.reduce((summedObj, obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'number' && keysToKeep.includes(key)) {
        summedObj[key] = (summedObj[key] || 0) + obj[key];
      }
    }
    return summedObj;
  }, {});

  // Round each numeric element to 4 decimals
  for (const key in result) {
    if (typeof result[key] === 'number') {
      result[key] = parseFloat(result[key].toFixed(decimals));
    }
  }

  return result;
}

async function getMeterSums(date) {
  console.log('getMeterSums', date);
  const PREFIX = DAY_DB_PREFIX;
  const current = await dayDb.retrieveObject(PREFIX + date);
  const previous = await dayDb.retrieveObject(PREFIX + getPreviousDate(date));
  const ret = {
    date: date,
    consumption: parseFloat((current[current.length - 1].lastMeterConsumption - previous[previous.length - 1].lastMeterConsumption).toFixed(4)),
    production: parseFloat((current[current.length - 1].lastMeterProduction - previous[previous.length - 1].lastMeterProduction).toFixed(4)),
  }
  return ret;
}

function onStorageEvent1(obj) {
  delete obj.timestamp;
  if (storageDebug)
    console.log('List1: redisdb', obj);
}

async function onStorageEvent2(obj) {
  if (storageDebug)
    console.log('List2: redisdb', obj);
}

async function onStorageEvent3(obj) {
  // TODO: Get prices and cost from previous hour?
  // 2023-02-01T00:00:00
  const isMidnight = obj.timestamp.substring(11, 16) === '00:00';
  const isNewDay = obj.startTime.substring(11, 16) === '00:00';
  const storageDate = obj.startTime.substring(0, 10);
  console.log('List3: redisdb', storageDate);
  const dbObj = {
    timestamp: obj.timestamp,
    startTime: obj.startTime,
    endTime: obj.endTime,
    lastMeterConsumption: obj.lastMeterConsumption,
    lastMeterProduction: obj.lastMeterProduction,
    accumulatedConsumptionLastHour: obj.accumulatedConsumptionLastHour,
    accumulatedProductionLastHour: obj.accumulatedProductionLastHour,
    spotPrice: obj.spotPrice,
    customerPrice: obj.customerPrice,
    costLastHour: obj.costLastHour,
    rewardLastHour: obj.rewardLastHour,
  };
  //console.log('List3: redisdb:dbObj', dbObj);
  // Create and stack the hourly data
  if (isNewDay) { //} || !await dayDb.existsObject(DAY_DB_PREFIX + storageDate)) {
    //if (!await dayDb.existsObject(DAY_DB_PREFIX + storageDate)) {
    //dbObj.createObject = true;
    await dayDb.createObject(DAY_DB_PREFIX + storageDate, [dbObj]);
    //console.log('List3: dbObj:createObject', storageDate, dbObj);
  } else {
    //dbObj.pushObject = true;
    await dayDb.pushObject(DAY_DB_PREFIX + storageDate, dbObj);
    //console.log('List3: dbObj:pushObject', storageDate, dbObj);
  }
  await dayDb.sync();

  if (isMidnight) {
    //if (true) {
    //const storageMonth = storageDate.substring(0, 7);
    //const isNewMonth = storageDate.substring(8, 10) === "01";
    const storageMonth = obj.timestamp.substring(0, 7);
    const isNewMonth = obj.timestamp.substring(8, 10) === "01";
    //const storageDate = '2023-09-09';
    //const storageMonth = '2023-11';
    //const isNewMonth = false;

    //const dayData = await dayDb.retrieveObject(DAY_DB_PREFIX + getPreviousDate(storageDate));
    const dayData = await dayDb.retrieveObject(DAY_DB_PREFIX + storageDate);
    //const dayData = await dayDb.retrieveObject(DAY_DB_PREFIX + '2023-09-13');

    const costSums = await calculateSums(dayData, ['costLastHour', 'rewardLastHour'], 4);
    //console.log('List3: costSums', costSums);
    //const sums = await calculateSums(dayData, ['accumulatedConsumptionLastHour', 'accumulatedProductionLastHour', 'costLastHour', 'rewardLastHour'], 4);
    //console.log('List3: sums', sums);
    const amsSums = await getMeterSums(storageDate);
    //console.log('List3: amsSums', amsSums);

    const sumObj = {
      timestamp: obj.timestamp,
      startTime: dayData[0].startTime,
      endTime: dayData[dayData.length - 1].endTime,
      //endTime: storageDate + 'T00:00:00',
      //start: obj.startTime,
      //end: obj.endTime,
      //end: dayData[dayData.length - 1].endTime,
      //lastMeterConsumption: obj.lastMeterConsumption,
      lastMeterConsumption: dayData[dayData.length - 1].lastMeterConsumption,
      lastMeterProduction: dayData[dayData.length - 1].lastMeterProduction,
      // Sum up consumption and cost
      consumption: amsSums.consumption,
      production: amsSums.production,
      costToday: costSums.costLastHour,
      rewardToday: costSums.rewardLastHour,
    }

    console.log('List3: redisdb:sumObj', sumObj);

    if (isNewMonth) { // || !await sumDb.existsObject(DAY_SUM_PREFIX + storageMonth)) {
      sumObj.isNewMonth = true;
      await sumDb.createObject(DAY_SUM_PREFIX + storageMonth, [sumObj]);
    } else {
      //sumObj.isNewMonth = false;
      await sumDb.pushObject(DAY_SUM_PREFIX + storageMonth, sumObj);
    }
    await sumDb.sync();

    //console.log('List3: redisdb:sumObj', sumObj);
  }
}

const redisdb = {
  // Plugin constants
  isVirgin: true,

  init: async function () {
    // Run once
    if (this.isVirgin) {
      const currentDate = getCurrentDate(); // 2023-08-01
      const dbName = DAY_DB_PREFIX + currentDate;
      console.log('redisdb init:', dbName);
      dayDb = new UniCache(dbName, DB_OPTIONS);
      //if (await dayDb.isEmpty()) {
      //  await dayDb.init([]);
      //}
      /*
      await dayDb.fetch().then(function (data) {
        if (storageDebug) {
          console.log('Day data loaded', data);
        }
      });
      */
      const sumName = DAY_SUM_PREFIX + currentDate.substring(0, 7); // 2023-08
      sumDb = new UniCache(sumName, DB_OPTIONS);
      //if (await sumDb.isEmpty()) {
      //  await sumDb.init([]);
      //}
      // Fetch the data from the cache and log it

      await sumDb.fetch(sumName).then(function (data) {
        //if (storageDebug) {
        console.log('Summary data loaded', data);
        //}
      });

      //event.on('storage1', onStorageEvent1);
      //event.on('storage2', onStorageEvent2);
      event.on('storage3', onStorageEvent3);
      this.isVirgin = false;
    }
  }

};
redisdb.init();
module.exports = redisdb;
