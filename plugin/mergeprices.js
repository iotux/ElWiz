const { format } = require('date-fns');
const { loadYaml } = require('../misc/util.js');
const { event } = require('../misc/misc.js');
const { calculateCost } = require('../plugin/calculatecost.js');

const configFile = './config.yaml';
const config = loadYaml(configFile);
const debug = config.mergeprices.debug || false;

let priceServiceInstance = null;
let isFullReportDue = true;
let _lastFullReportDate = null;

async function triggerFullReport() {
  if (!priceServiceInstance) {
    if (debug) console.log('mergeprices: Cannot trigger full report, PriceService not initialized.');
    return;
  }

  const currentHour = new Date().getHours();
  let obj = { hourIndex: currentHour, isNewHour: true };

  if (debug) console.log('mergeprices: Triggering full report due to new prices.');

  // Emit an event that plugselector can listen for, to keep the systems decoupled.
  // We use 'list3' as it's the most comprehensive one.
  event.emit('list3', obj);
}

function initialize(serviceInstance) {
  if (!serviceInstance) {
    throw new Error('PriceService instance is required for mergeprices module.');
  }
  priceServiceInstance = serviceInstance;

  event.on('newPrices', () => {
    isFullReportDue = true;
    if (debug) console.log('mergeprices: newPrices event received, isFullReportDue set to true.');
    triggerFullReport(); // Trigger the report immediately
  });

  if (debug) console.log('mergeprices: Initialized with PriceService.');
}

async function findPricesBelowAverage(priceObjectDate, hourlyPrices, dailyAveragePrice) {
  if (!hourlyPrices || hourlyPrices.length === 0 || dailyAveragePrice === null || dailyAveragePrice === undefined) {
    return {
      date: priceObjectDate,
      avgPrice: dailyAveragePrice,
      hours: [],
    };
  }

  const filteredPrices = hourlyPrices
    .filter(({ spotPrice }) => spotPrice < dailyAveragePrice)
    .map(({ startTime, spotPrice }) => ({
      hour: format(new Date(startTime), 'HH'),
      spotPrice,
    }));

  return {
    date: priceObjectDate,
    avgPrice: dailyAveragePrice,
    hours: filteredPrices,
  };
}

async function mergePrices(list, obj) {
  if (!priceServiceInstance) {
    if (debug) console.error('mergeprices: PriceService not initialized. Cannot merge prices.');
    return obj;
  }

  const idx = obj.hourIndex;

  if (idx === undefined || idx < 0 || idx > 23) {
    if (debug) console.warn(`mergePrices: Invalid hourIndex ${idx} in obj for list ${list}`);
    return obj;
  }

  const currentPriceDate = priceServiceInstance.getCurrentPriceDate();
  const sendFullReport = isFullReportDue || _lastFullReportDate !== currentPriceDate;
  const shouldUpdateHourlyPrices = obj.isNewHour || obj.isHourEnd || sendFullReport; // New condition for hourly prices

  if (shouldUpdateHourlyPrices) {
    // Only update hourly prices if this condition is met
    const currentHourData = priceServiceInstance.getHourlyData(idx, 'current');
    if (currentHourData) {
      obj.spotPrice = currentHourData.spotPrice;
      obj.floatingPrice = currentHourData.floatingPrice;
      obj.fixedPrice = currentHourData.fixedPrice;
      if (obj.spotPrice !== null && obj.floatingPrice !== null && obj.fixedPrice !== null) {
        obj.customerPrice = parseFloat((obj.spotPrice + obj.floatingPrice + obj.fixedPrice).toFixed(4));
      } else {
        obj.customerPrice = null;
      }
      obj.startTime = currentHourData.startTime;
      obj.endTime = currentHourData.endTime;
    }
  }

  if (sendFullReport) {
    if (debug) console.log(`mergeprices: Sending full report for list ${list}, hour ${idx}. Reason: isFullReportDue=${isFullReportDue}, _lastFullReportDate=${_lastFullReportDate}, currentPriceDate=${currentPriceDate}`);
    const currentDailySummary = priceServiceInstance.getCurrentDaySummary();
    const currentDayHourlyArray = priceServiceInstance.getCurrentDayHourlyArray();

    obj.minPrice = currentDailySummary.minPrice;
    obj.maxPrice = currentDailySummary.maxPrice;
    obj.avgPrice = currentDailySummary.avgPrice;
    obj.peakPrice = currentDailySummary.peakPrice;
    obj.offPeakPrice1 = currentDailySummary.offPeakPrice1;
    obj.offPeakPrice2 = currentDailySummary.offPeakPrice2;

    if (obj.spotPrice !== null && obj.avgPrice !== null && obj.avgPrice !== undefined) {
      obj.spotBelowAverage = obj.spotPrice < obj.avgPrice ? 1 : 0;
    } else {
      obj.spotBelowAverage = 0;
    }

    obj.pricesBelowAverage = await findPricesBelowAverage(currentPriceDate, currentDayHourlyArray, obj.avgPrice);

    if (priceServiceInstance.isNextDayAvailable()) {
      const nextHourData = priceServiceInstance.getHourlyData(idx, 'next');
      const nextDailySummary = priceServiceInstance.getNextDaySummary();
      const nextDayHourlyArray = priceServiceInstance.getNextDayHourlyArray();
      const nextPriceDate = priceServiceInstance.getNextPriceDate();

      if (nextHourData) {
        obj.startTimeDay2 = nextHourData.startTime;
        obj.endTimeDay2 = nextHourData.endTime;
        obj.spotPriceDay2 = nextHourData.spotPrice;
        obj.floatingPriceDay2 = nextHourData.floatingPrice;
        obj.fixedPriceDay2 = nextHourData.fixedPrice;
      }

      obj.minPriceDay2 = nextDailySummary.minPrice;
      obj.maxPriceDay2 = nextDailySummary.maxPrice;
      obj.avgPriceDay2 = nextDailySummary.avgPrice;
      obj.peakPriceDay2 = nextDailySummary.peakPrice;
      obj.offPeakPrice1Day2 = nextDailySummary.offPeakPrice1;
      obj.offPeakPrice2Day2 = nextDailySummary.offPeakPrice2;

      obj.pricesBelowAverageDay2 = await findPricesBelowAverage(nextPriceDate, nextDayHourlyArray, obj.avgPriceDay2);
    }
    isFullReportDue = false; // Reset the flag
    _lastFullReportDate = currentPriceDate; // Update the last full report date
  } else {
    if (debug) console.log(`mergeprices: Sending partial report for list ${list}, hour ${idx}.`);
  }

  if (debug) {
    if (list === 'list1' || list === 'list2' || sendFullReport) {
      console.log(`mergePrices, ${list}: ${JSON.stringify(obj, null, 2)}`);
    }
  }

  if (config.calculateCost) {
    try {
      obj = await calculateCost(list, obj);
    } catch (error) {
      console.error('mergeprices: Error calling calculateCost:', error);
    }
  }

  return obj;
}

module.exports = { initialize, mergePrices };
