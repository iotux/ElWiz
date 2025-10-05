#!/usr/bin/env node

'use strict';

const programName = 'fetchprices';
const fs = require('fs');
const axios = require('axios');
const MQTTClient = require('./mqtt/mqtt');
const UniCache = require('./misc/unicache');
const { addZero, skewDays, loadYaml, getNextDate } = require('./misc/util.js');
const { format, formatISO, parseISO } = require('date-fns');

// Specific for ENTSO-E
const convert = require('xml-js');
const { exit } = require('process');

const config = loadYaml('./config.yaml');
const regionMap = loadYaml('./priceregions.yaml');

//const nordPoolUrl = config.nordpoolBaseUrl || 'https://www.nordpoolgroup.com/api/marketdata/page/10';
const nordPoolUrl = `https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices?market=DayAhead`;
//const url = `${nordPoolUrl}&deliveryArea=${this.regionCode}&currency=${this.priceCurrency}&date=${urlDate}`;

const baseUrl = config.entsoeBaseUrl || 'https://web-api.tp.entsoe.eu/api';
const entsoeToken = config.priceAccessToken || null;
//const priceRegion = config.priceRegion || 8; // Oslo
const region = config.regionCode || 'NO1';
const regionCode = regionMap[region];

const priceFetchPriority = config.priceFetchPriority || 'nordpool';
const pricePath = config.priceFilePath || './data/prices';
const pricePrefix = 'prices-';

const priceCurrency = config.priceCurrency || 'NOK';
const currencyPath = config.currencyFilePath || './data/currencies';
const currencyPrefix = 'currencies-';

// Common constants
const debug = config.DEBUG || false;
const priceTopic = config.priceTopic || 'elwiz/prices';
const keepDays = config.keepDays || 7;

// Price interval configuration - 1h is default to maintain backward compatibility
const priceInterval = config.priceInterval || '1h'; // Valid values: '1h' (1 hour) or '15m' (15 minutes)

const supplierKwhPrice = config.supplierKwhPrice || 0;
const supplierDayPrice = config.supplierDayPrice || 0;
const supplierMonthPrice = config.supplierMonthPrice || 0;
const supplierVatPercent = config.supplierVatPercent || 0;

const spotVatPercent = config.spotVatPercent || 0;

const gridVatPercent = config.gridVatPercent || 0;
const gridKwhPrice = config.gridKwhPrice || 0;
const gridDayPrice = config.gridDayPrice || 0;
const gridMonthPrice = config.gridMonthPrice || 0;

const energyTax = config.energyTax || 0;

//const dayHoursStart = parseInt(config.dayHoursStart.split(':')[0]) || 6;
//const dayHoursEnd = parseInt(config.dayHoursEnd.split(':')[0]) || 22;
const dayHoursStart = config.dayHoursStart || 6;
const dayHoursEnd = config.dayHoursEnd || 22;
const energyDayPrice = config.energyDayPrice || 0;
const energyNightPrice = config.energyNightPrice || 0;
const cacheType = config.cacheType || 'file';

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'hassPublish');

let gridDayHourPrice;
let gridNightHourPrice;

let gridFixedPrice;
let supplierFixedPrice;

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

// UniCache options
const PRICE_DB_PREFIX = pricePrefix || 'prices-';
const PRICE_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: true,
  savePath: pricePath,
};
const priceDb = new UniCache(PRICE_DB_PREFIX, PRICE_DB_OPTIONS);

const CURR_DB_PREFIX = currencyPrefix || 'currencies-';
const CURR_DB_OPTIONS = {
  cacheType: cacheType,
  syncOnWrite: false,
  savePath: currencyPath,
};
const currencyDb = new UniCache(`${CURR_DB_PREFIX}latest`, CURR_DB_OPTIONS);

const nordPoolOpts = {
  headers: {
    accept: 'application/json',
    'Content-Type': 'text/json',
  },
  json: true,
};

const entsoeOpts = {
  method: 'get',
  headers: {
    accept: 'application/xml',
    'Content-Type': 'application/xml',
  },
};

let runCounter = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let currencyRate;

async function getCurrencyRate(currency) {
  if (await currencyDb.existsObject(`${CURR_DB_PREFIX}latest`)) {
    const obj = await currencyDb.retrieveObject(`${CURR_DB_PREFIX}latest`);
    let ret = obj.rates[currency];
    return ret;
  } else {
    console.log('Error: no currency object present');
    console.log(`Please run "./fetch-eu-currencies.js"`);
    exit(0);
  }
}

async function nordpoolDate(offset) {
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const date = new Date(now.getTime() + oneDay * offset);
  const ret = format(date, 'yyyy-MM-dd');
  return ret;
}

function xnordpoolDate(offset) {
  let date = new Date();
  date.setHours(0, 0, 0, 0); // Set to local midnight
  date.setDate(date.getDate() + offset); // Apply day offset
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  // Adjust the local midnight to UTC by adding the timezone offset
  const utcDate = new Date(date.getTime() + timezoneOffset);
  // Format the UTC date as 'yyyyMMddHHmm'
  const formattedUtcDate = format(utcDate, 'yyyy-MM-dd');
  return formattedUtcDate;
}

function entsoeDate(offset) {
  let date = new Date();
  date.setHours(0, 0, 0, 0); // Set to local midnight
  date.setDate(date.getDate() + offset); // Apply day offset
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  // Adjust the local midnight to UTC by adding the timezone offset
  const utcDate = new Date(date.getTime() + timezoneOffset);
  // Format the UTC date as 'yyyyMMddHHmm'
  const formattedUtcDate = format(utcDate, 'yyyyMMddHHmm');
  return formattedUtcDate;
}

function utcToLocalDateTime(isoString) {
  // If no argument is provided, use the current time
  const date = isoString ? parseISO(isoString) : new Date();
  return formatISO(date, { representation: 'complete' });
}

function averageCalc(arr, key, start = 0, end) {
  if (end === undefined) {
    end = arr.length - 1;
  }
  start = start < 0 ? 0 : start;
  end = end >= arr.length ? arr.length - 1 : end;

  let sum = 0;
  let count = 0;

  for (let i = start; i <= end; i++) {
    if (arr[i] && arr[i][key] !== undefined) {
      sum += arr[i][key];
      count++;
    }
  }

  return count > 0 ? sum / count : null;
}

async function getNordPoolPrices(dayOffset) {
  const priceDate = skewDays(dayOffset);
  const priceName = PRICE_DB_PREFIX + priceDate;
  const missingPrice = !(await priceDb.existsObject(priceName));
  let oneDayPrices;

  if (missingPrice) {
    const url = `${nordPoolUrl}&deliveryArea=${region}&currency=${priceCurrency}&date=${await nordpoolDate(dayOffset)}`;
    console.log(`Fetching: ${url}`);
    console.log(`Fetching: ${priceName}`);
    try {
      const response = await axios.get(url, nordPoolOpts);
      if (response.status === 200 && response.data) {
        const data = response.data;
        const priceObjects = data.multiAreaEntries;
        const priceObjectsCount = priceObjects.length;

        let minPrice = 9999;
        let maxPrice = 0;
        oneDayPrices = {
          priceDate: priceDate,
          priceProvider: 'Nord Pool',
          priceProviderUrl: url,
          hourly: [],
          daily: {},
        };

        // Handle different price object amounts based on the price interval
        if (priceInterval === '1h') {
          // Handle 1-hour interval
          if (priceObjectsCount === 96) {
            // 96 15-min prices: group 4 elements into 1 hour and calculate average (as per requirement)
            for (let curHour = 0; curHour < 24; curHour++) {
              const startIndex = curHour * 4;
              let hourlySum = 0;
              let validCount = 0;

              // Sum the 4 15-minute prices for this hour
              for (let i = 0; i < 4; i++) {
                const index = startIndex + i;
                if (index < priceObjects.length) {
                  const rawPrice = priceObjects[index].entryPerArea[region] / 1000;
                  let spotPrice = rawPrice;
                  spotPrice += (spotPrice * spotVatPercent) / 100;
                  hourlySum += spotPrice;
                  validCount++;
                }
              }

              // Calculate average price for the hour (as per requirement: "average price should be the hour price")
              const avgSpotPrice = validCount > 0 ? hourlySum / validCount : 0;
              const floatingPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;

              // Use the start and end times of the whole hour period
              const priceObj = {
                startTime: utcToLocalDateTime(priceObjects[startIndex].deliveryStart),
                endTime: utcToLocalDateTime(priceObjects[startIndex + 3].deliveryEnd),
                spotPrice: parseFloat(avgSpotPrice.toFixed(4)),
                floatingPrice: floatingPrice,
                fixedPrice: gridFixedPrice + supplierFixedPrice,
              };
              oneDayPrices.hourly.push(priceObj);

              minPrice = avgSpotPrice < minPrice ? avgSpotPrice : minPrice;
              maxPrice = avgSpotPrice > maxPrice ? avgSpotPrice : maxPrice;
            }
          } else if (priceObjectsCount === 24) {
            // 24 1-hour prices: each element price is the hour price (as per requirement)
            for (let curHour = 0; curHour < 24; curHour++) {
              const floatingPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
              let spotPrice = priceObjects[curHour].entryPerArea[region] / 1000;
              spotPrice += (spotPrice * spotVatPercent) / 100;
              const priceObj = {
                startTime: utcToLocalDateTime(priceObjects[curHour].deliveryStart),
                endTime: utcToLocalDateTime(priceObjects[curHour].deliveryEnd),
                spotPrice: parseFloat(spotPrice.toFixed(4)),
                floatingPrice: floatingPrice,
                fixedPrice: gridFixedPrice + supplierFixedPrice,
              };
              oneDayPrices.hourly.push(priceObj);

              minPrice = spotPrice < minPrice ? spotPrice : minPrice;
              maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice;
            }
          }
        } else if (priceInterval === '15m') {
          // Handle 15-minute interval
          if (priceObjectsCount === 96) {
            // 96 15-min prices: each element is the actual 15 minutes price (as per requirement)
            for (let curIndex = 0; curIndex < 96; curIndex++) {
              const hourOfDay = new Date(priceObjects[curIndex].deliveryStart).getHours(); // Get hour from actual start time
              const floatingPrice = hourOfDay >= dayHoursStart && hourOfDay < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
              let spotPrice = priceObjects[curIndex].entryPerArea[region] / 1000;
              spotPrice += (spotPrice * spotVatPercent) / 100;
              const priceObj = {
                startTime: utcToLocalDateTime(priceObjects[curIndex].deliveryStart),
                endTime: utcToLocalDateTime(priceObjects[curIndex].deliveryEnd),
                spotPrice: parseFloat(spotPrice.toFixed(4)),
                floatingPrice: floatingPrice,
                fixedPrice: gridFixedPrice + supplierFixedPrice,
              };
              oneDayPrices.hourly.push(priceObj);

              minPrice = spotPrice < minPrice ? spotPrice : minPrice;
              maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice;
            }
          } else if (priceObjectsCount === 24) {
            // 24 1-hour prices: each element is divided by 4, and the result is the 15 minutes price (as per requirement)
            for (let curHour = 0; curHour < 24; curHour++) {
              const rawSpotPrice = priceObjects[curHour].entryPerArea[region] / 1000;
              // Divide by 4 to get the 15-minute price (as per requirement)
              let quarterSpotPrice = rawSpotPrice / 4;
              quarterSpotPrice += (quarterSpotPrice * spotVatPercent) / 100;

              // Create 4 15-minute intervals for this hour using the original start time
              // To properly calculate 15-minute intervals, create a separate start/end time for each 15-min period
              const baseStart = new Date(priceObjects[curHour].deliveryStart);

              for (let quarter = 0; quarter < 4; quarter++) {
                const start = new Date(baseStart);
                start.setMinutes(baseStart.getMinutes() + quarter * 15);
                const end = new Date(start);
                end.setMinutes(start.getMinutes() + 15);

                const hourOfDay = start.getHours();
                const floatingPrice = hourOfDay >= dayHoursStart && hourOfDay < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;

                const priceObj = {
                  startTime: formatISO(start, { representation: 'complete' }),
                  endTime: formatISO(end, { representation: 'complete' }),
                  spotPrice: parseFloat(quarterSpotPrice.toFixed(4)),
                  floatingPrice: floatingPrice,
                  fixedPrice: gridFixedPrice + supplierFixedPrice,
                };
                oneDayPrices.hourly.push(priceObj);

                minPrice = quarterSpotPrice < minPrice ? quarterSpotPrice : minPrice;
                maxPrice = quarterSpotPrice > maxPrice ? quarterSpotPrice : maxPrice;
              }
            }
          }
        }

        // Calculate daily statistics
        // Adjust the peak/offPeak calculations based on interval
        const dayHoursStartInt = parseInt(dayHoursStart) || 6;
        const dayHoursEndInt = parseInt(dayHoursEnd) || 22;
        const startHourIndex = priceInterval === '1h' ? dayHoursStartInt : dayHoursStartInt * 4;
        const endHourIndex = priceInterval === '1h' ? dayHoursEndInt - 1 : dayHoursEndInt * 4 - 1;

        oneDayPrices.daily = {
          minPrice: parseFloat((minPrice + (minPrice * spotVatPercent) / 100).toFixed(4)),
          maxPrice: parseFloat((maxPrice + (maxPrice * spotVatPercent) / 100).toFixed(4)),
          avgPrice: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice').toFixed(4)),
          peakPrice: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', startHourIndex, endHourIndex).toFixed(4)),
          offPeakPrice1: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', 0, startHourIndex - 1).toFixed(4)),
          offPeakPrice2: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', endHourIndex + 1, oneDayPrices.hourly.length - 1).toFixed(4)),
        };

        // Store to cache
        await priceDb.createObject(priceName, oneDayPrices);
      } else {
        console.log(`getNordPoolPrices: Day ahead prices are not ready: ${priceName}`);
      }
    } catch (err) {
      if (err.response) {
        //console.log('Error:', err.response.status, err.response.statusText);
        if (debug) console.log(`Headers:\n${err.response.headers}`);
      }
    }
    return true;
  } else {
    return false;
  }
}

function entsoeUrl(entsoeToken, region, periodStart, periodEnd) {
  return `${baseUrl}?documentType=A44&securityToken=${entsoeToken}&in_Domain=${region}&out_Domain=${region}&periodStart=${periodStart}&periodEnd=${periodEnd}`;
}

async function getEntsoePrices(dayOffset) {
  const priceDate = skewDays(dayOffset);
  const priceName = PRICE_DB_PREFIX + priceDate;
  const missingPrice = !(await priceDb.existsObject(priceName));
  let oneDayPrices;
  if (missingPrice) {
    const url = entsoeUrl(entsoeToken, regionCode, entsoeDate(dayOffset), entsoeDate(dayOffset + 1));
    await axios
      .get(url, entsoeOpts)
      .then(async function (body) {
        const result = convert.xml2js(body.data, { compact: true, spaces: 4 });
        if (result.Publication_MarketDocument !== undefined) {
          const realMeat = result.Publication_MarketDocument.TimeSeries.Period;
          if (realMeat !== undefined) {
            console.log(`Fetching: ${priceName}`);
          } else {
            console.log(`Prices are not available: ${priceDate}`);
            return; // Exit the function early if prices are not available
          }
          let minPrice = 9999;
          let maxPrice = 0;
          oneDayPrices = {
            priceDate: priceDate,
            priceProvider: 'ENTSO-E',
            priceProviderUrl: entsoeUrl('*****', regionCode, entsoeDate(dayOffset), entsoeDate(dayOffset + 1)),
            hourly: [],
            daily: {},
          };

          // Determine number of price points in the data
          const priceObjects = Array.isArray(realMeat.Point) ? realMeat.Point : [realMeat.Point];
          const priceObjectsCount = priceObjects.length;

          if (priceInterval === '1h') {
            // Handle 1-hour interval
            if (priceObjectsCount === 96) {
              // 96 15-min prices: group 4 elements into 1 hour and calculate average (as per requirement)
              for (let curHour = 0; curHour < 24; curHour++) {
                const startIndex = curHour * 4;
                let hourlySum = 0;
                let validCount = 0;

                // Sum the 4 15-minute prices for this hour
                for (let i = 0; i < 4; i++) {
                  const index = startIndex + i;
                  if (index < priceObjects.length) {
                    const rawPrice = (priceObjects[index]['price.amount']._text * currencyRate) / 1000;
                    let spotPrice = rawPrice;
                    spotPrice += (spotPrice * spotVatPercent) / 100;
                    hourlySum += spotPrice;
                    validCount++;
                  }
                }

                // Calculate average price for the hour (as per requirement: "average price should be the hour price")
                const avgSpotPrice = validCount > 0 ? hourlySum / validCount : 0;
                // For now, we need to determine the hour based on the time information in the data if available
                // For ENTSO-E, we'll need to get the hour from the Period.TimeInterval
                const floatingPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;

                // For simplicity in this version, we'll use a generic approach
                // since the realMeat structure may differ from NordPool
                const currentHourStart = new Date();
                currentHourStart.setHours(curHour, 0, 0, 0);
                const currentHourEnd = new Date(currentHourStart);
                currentHourEnd.setHours(currentHourEnd.getHours() + 1);

                const priceObj = {
                  startTime: formatISO(currentHourStart, { representation: 'complete' }),
                  endTime: formatISO(currentHourEnd, { representation: 'complete' }),
                  spotPrice: parseFloat(avgSpotPrice.toFixed(4)),
                  floatingPrice: floatingPrice,
                  fixedPrice: gridFixedPrice + supplierFixedPrice,
                };
                oneDayPrices.hourly.push(priceObj);

                minPrice = avgSpotPrice < minPrice ? avgSpotPrice : minPrice;
                maxPrice = avgSpotPrice > maxPrice ? avgSpotPrice : maxPrice;
              }
            } else if (priceObjectsCount === 24) {
              // 24 1-hour prices: each element price is the hour price (as per requirement)
              for (let curHour = 0; curHour < 24; curHour++) {
                const floatingPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
                let spotPrice = (priceObjects[curHour]['price.amount']._text * currencyRate) / 1000;
                spotPrice += (spotPrice * spotVatPercent) / 100;

                const currentHourStart = new Date();
                currentHourStart.setHours(curHour, 0, 0, 0);
                const currentHourEnd = new Date(currentHourStart);
                currentHourEnd.setHours(currentHourEnd.getHours() + 1);

                const priceObj = {
                  startTime: formatISO(currentHourStart, { representation: 'complete' }),
                  endTime: formatISO(currentHourEnd, { representation: 'complete' }),
                  spotPrice: parseFloat(spotPrice.toFixed(4)),
                  floatingPrice: floatingPrice,
                  fixedPrice: gridFixedPrice + supplierFixedPrice,
                };
                oneDayPrices.hourly.push(priceObj);

                minPrice = spotPrice < minPrice ? spotPrice : minPrice;
                maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice;
              }
            }
          } else if (priceInterval === '15m') {
            // Handle 15-minute interval
            if (priceObjectsCount === 96) {
              // 96 15-min prices: each element is the actual 15 minutes price (as per requirement)
              for (let curIndex = 0; curIndex < 96; curIndex++) {
                const hourOfDay = Math.floor(curIndex / 4); // 4 15-min slots per hour
                const floatingPrice = hourOfDay >= dayHoursStart && hourOfDay < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
                let spotPrice = (priceObjects[curIndex]['price.amount']._text * currencyRate) / 1000;
                spotPrice += (spotPrice * spotVatPercent) / 100;

                // Create a 15-minute time interval
                const currentHourStart = new Date();
                currentHourStart.setHours(Math.floor(curIndex / 4), (curIndex % 4) * 15, 0, 0);
                const currentHourEnd = new Date(currentHourStart);
                currentHourEnd.setMinutes(currentHourStart.getMinutes() + 15);

                const priceObj = {
                  startTime: formatISO(currentHourStart, { representation: 'complete' }),
                  endTime: formatISO(currentHourEnd, { representation: 'complete' }),
                  spotPrice: parseFloat(spotPrice.toFixed(4)),
                  floatingPrice: floatingPrice,
                  fixedPrice: gridFixedPrice + supplierFixedPrice,
                };
                oneDayPrices.hourly.push(priceObj);

                minPrice = spotPrice < minPrice ? spotPrice : minPrice;
                maxPrice = spotPrice > maxPrice ? spotPrice : maxPrice;
              }
            } else if (priceObjectsCount === 24) {
              // 24 1-hour prices: each element is divided by 4, and the result is the 15 minutes price (as per requirement)
              for (let curHour = 0; curHour < 24; curHour++) {
                const rawSpotPrice = (priceObjects[curHour]['price.amount']._text * currencyRate) / 1000;
                // Divide by 4 to get the 15-minute price (as per requirement)
                let quarterSpotPrice = rawSpotPrice / 4;
                quarterSpotPrice += (quarterSpotPrice * spotVatPercent) / 100;

                // Create 4 15-minute intervals for this hour
                for (let quarter = 0; quarter < 4; quarter++) {
                  const floatingPrice = curHour >= dayHoursStart && curHour < dayHoursEnd ? gridDayHourPrice : gridNightHourPrice;
                  const currentHourStart = new Date();
                  currentHourStart.setHours(curHour, quarter * 15, 0, 0); // Each quarter is 15 minutes
                  const currentHourEnd = new Date(currentHourStart);
                  currentHourEnd.setMinutes(currentHourStart.getMinutes() + 15);

                  const priceObj = {
                    startTime: formatISO(currentHourStart, { representation: 'complete' }),
                    endTime: formatISO(currentHourEnd, { representation: 'complete' }),
                    spotPrice: parseFloat(quarterSpotPrice.toFixed(4)),
                    floatingPrice: floatingPrice,
                    fixedPrice: gridFixedPrice + supplierFixedPrice,
                  };
                  oneDayPrices.hourly.push(priceObj);

                  minPrice = quarterSpotPrice < minPrice ? quarterSpotPrice : minPrice;
                  maxPrice = quarterSpotPrice > maxPrice ? quarterSpotPrice : maxPrice;
                }
              }
            }
          }

          // Calculate daily statistics
          // Adjust the peak/offPeak calculations based on interval
          const dayHoursStartInt = parseInt(dayHoursStart) || 6;
          const dayHoursEndInt = parseInt(dayHoursEnd) || 22;
          const startHourIndex = priceInterval === '1h' ? dayHoursStartInt : dayHoursStartInt * 4;
          const endHourIndex = priceInterval === '1h' ? dayHoursEndInt - 1 : dayHoursEndInt * 4 - 1;

          oneDayPrices.daily = {
            minPrice: parseFloat((minPrice + (minPrice * spotVatPercent) / 100).toFixed(4)),
            maxPrice: parseFloat((maxPrice + (maxPrice * spotVatPercent) / 100).toFixed(4)),
            avgPrice: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice').toFixed(4)),
            peakPrice: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', startHourIndex, endHourIndex).toFixed(4)),
            offPeakPrice1: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', 0, startHourIndex - 1).toFixed(4)),
            offPeakPrice2: parseFloat(averageCalc(oneDayPrices.hourly, 'spotPrice', endHourIndex + 1, oneDayPrices.hourly.length - 1).toFixed(4)),
          };

          // Store to cache
          await priceDb.createObject(priceName, oneDayPrices);
        } else {
          console.log(`getEntsoePrices: Day ahead prices are not ready: ${priceDate}`);
        }
      })
      .catch(function (err) {
        if (err.response) {
          if (debug) console.log(`Headers:\n${err.response.headers}`);
          console.log(`Error:' ${err.response.status}: ${err.response.statusText}`);
          if (err.response.status === 401) {
            console.log('The Entso-E API requires an access token. Please see https://transparency.entsoe.eu/content/static_content/download?path=/Static%20content/API-Token-Management.pdf');
          }
          process.exit(1);
        }
      });
    return true;
  } else {
    return false;
  }
}

async function publishMqtt(priceDate, priceObject) {
  await mqttClient.waitForConnect();
  const topic = `${priceTopic}/${priceDate}`;
  try {
    if (priceObject === null) {
      // Remove old retained prices
      await mqttClient.publish(topic, '', { retain: true, qos: 1 });
      console.log(`${programName}: MQTT message removed: ${PRICE_DB_PREFIX}${priceDate}`);
    } else {
      // Publish today and next day prices
      await mqttClient.publish(topic, JSON.stringify(priceObject, debug ? null : undefined, 2), { retain: true, qos: 1 });
      console.log(`${programName}: MQTT message published: ${PRICE_DB_PREFIX}${priceDate}`);
    }
  } catch (err) {
    console.log(`${programName}: MQTT message error`, err);
  }
}

async function retireDays(offset) {
  offset *= -1;
  const priceDate = skewDays(offset);
  const keys = await priceDb.dbKeys(PRICE_DB_PREFIX + '*');
  keys.forEach(async (key) => {
    if (key <= `${PRICE_DB_PREFIX}${priceDate}`) {
      await priceDb.deleteObject(key);
    }
  });
}

async function init() {
  let nightPrice = energyNightPrice + (energyNightPrice * gridVatPercent) / 100;
  gridNightHourPrice = parseFloat(nightPrice.toFixed(4));

  let dayPrice = energyDayPrice + (energyDayPrice * gridVatPercent) / 100;
  gridDayHourPrice = parseFloat(dayPrice.toFixed(4));

  let floatingPrice = supplierKwhPrice + gridKwhPrice + energyTax;
  floatingPrice += floatingPrice * (supplierVatPercent / 100);
  floatingPrice = parseFloat(floatingPrice.toFixed(4));

  // A fixed monthly price addition, distributed hourly
  let fixedPrice = gridMonthPrice / 720;
  fixedPrice += (fixedPrice * gridVatPercent) / 100;
  gridFixedPrice = parseFloat(fixedPrice.toFixed(4));

  fixedPrice = supplierMonthPrice / 720;
  fixedPrice += (fixedPrice * supplierVatPercent) / 100;
  supplierFixedPrice = parseFloat(fixedPrice.toFixed(4));
}

async function run() {
  if (runNodeSchedule) {
    console.log('Fetch prices scheduled run...');
  }

  await retireDays(keepDays);

  for (let i = (keepDays - 1) * -1; i <= 1; i++) {
    if (!(await priceDb.existsObject(`${PRICE_DB_PREFIX}${skewDays(i)}`))) {
      if (priceFetchPriority === 'nordpool') {
        const success = await getNordPoolPrices(i);
        if (!success) {
          currencyRate = await getCurrencyRate(priceCurrency);
          await getEntsoePrices(i);
        }
      } else {
        currencyRate = await getCurrencyRate(priceCurrency);
        const success = await getEntsoePrices(i);
        if (!success) {
          await getNordPoolPrices(i);
        }
      }
    }
  }

  await delay(2000);

  if (await priceDb.existsObject(`${PRICE_DB_PREFIX}${skewDays(1)}`)) {
    console.log('NextDayAvailable');
    await publishMqtt(skewDays(-1), null);
    //await publishMqtt(skewDays(-1), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(-1)}`));
    await publishMqtt(skewDays(0), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(0)}`));
    await publishMqtt(skewDays(1), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(1)}`));
  } else {
    await publishMqtt(skewDays(-2), null);
    await publishMqtt(skewDays(-1), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(-1)}`));
    await publishMqtt(skewDays(0), await priceDb.retrieveObject(`${PRICE_DB_PREFIX}${skewDays(0)}`));
  }
}

init();

if (runNodeSchedule) {
  schedule.scheduleJob(runSchedule, run);
}

console.log(`${programName}: Fetch prices starting...`);
run();
