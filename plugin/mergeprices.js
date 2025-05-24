const { format } = require("date-fns"); // formatISO, nextDay removed as not used
const { loadYaml } = require("../misc/util.js"); // skewDays, isNewDay removed as PriceService handles date logic

const configFile = "./config.yaml";
const config = loadYaml(configFile); // Still needed for 'debug' flag locally
const debug = config.mergeprices.debug || false;

// priceTopic is not needed here anymore as PriceService handles its own subscription

// Global variable to hold the PriceService instance
let priceServiceInstance = null;

/**
 * Initializes the mergeprices module with a PriceService instance.
 * @param {Object} serviceInstance - An instance of PriceService.
 */
function initialize(serviceInstance) {
  if (!serviceInstance) {
    throw new Error(
      "PriceService instance is required for mergeprices module.",
    );
  }
  priceServiceInstance = serviceInstance;
  if (debug)
    console.log("mergeprices: Initialized with PriceService instance.");
}

async function findPricesBelowAverage(
  priceObjectDate,
  hourlyPrices,
  dailyAveragePrice,
) {
  if (
    !hourlyPrices ||
    hourlyPrices.length === 0 ||
    dailyAveragePrice === null ||
    dailyAveragePrice === undefined
  ) {
    return {
      date: priceObjectDate,
      avgPrice: dailyAveragePrice,
      hours: [],
    };
  }

  const filteredPrices = hourlyPrices
    .filter(({ spotPrice }) => spotPrice < dailyAveragePrice) // Filter prices below average
    .map(({ startTime, spotPrice }) => ({
      hour: format(new Date(startTime), "HH"), // Ensure startTime is valid Date or parsable
      spotPrice,
    }));

  return {
    date: priceObjectDate,
    avgPrice: dailyAveragePrice,
    hours: filteredPrices,
  };
}

/**
 * Merge price information from PriceService into an AMS data object.
 * @param {string} list - The list identifier (e.g., 'list1', 'list2', 'list3')
 * @param {Object} obj - The AMS data object to which price information will be added
 * @returns {Promise<Object>} - The merged object with price information
 */
async function mergePrices(list, obj) {
  if (!priceServiceInstance) {
    if (debug)
      console.error(
        "mergeprices: PriceService not initialized. Cannot merge prices.",
      );
    return obj; // Return object unmodified
  }

  const idx = obj.hourIndex; // 0-23

  if (idx === undefined || idx < 0 || idx > 23) {
    if (debug)
      console.warn(
        `mergePrices: Invalid hourIndex ${idx} in obj for list ${list}`,
      );
    return obj;
  }

  // PriceService's internal state should already be rolled over by its daily scheduler.
  // We just fetch current and next day data based on the hourIndex.

  const currentHourData = priceServiceInstance.getHourlyData(idx, "current");
  const currentDailySummary = priceServiceInstance.getCurrentDaySummary();
  const currentDayHourlyArray = priceServiceInstance.getCurrentDayHourlyArray();
  const currentPriceDate = priceServiceInstance.getCurrentPriceDate();

  if (currentHourData) {
    obj.startTime = currentHourData.startTime;
    obj.endTime = currentHourData.endTime;
    obj.spotPrice = currentHourData.spotPrice;
    obj.floatingPrice = currentHourData.floatingPrice;
    obj.fixedPrice = currentHourData.fixedPrice;
  } else {
    if (debug && currentPriceDate) {
      console.warn(
        `mergePrices: Missing current hourly price data for ${currentPriceDate} at hour ${idx}.`,
      );
    }
    obj.spotPrice = null;
    obj.floatingPrice = null;
    obj.fixedPrice = null;
  }

  obj.minPrice = currentDailySummary.minPrice;
  obj.maxPrice = currentDailySummary.maxPrice;
  obj.avgPrice = currentDailySummary.avgPrice;
  obj.peakPrice = currentDailySummary.peakPrice;
  obj.offPeakPrice1 = currentDailySummary.offPeakPrice1;
  obj.offPeakPrice2 = currentDailySummary.offPeakPrice2;

  if (
    obj.spotPrice !== null &&
    obj.avgPrice !== null &&
    obj.avgPrice !== undefined
  ) {
    obj.spotBelowAverage = obj.spotPrice < obj.avgPrice ? 1 : 0;
  } else {
    obj.spotBelowAverage = 0;
  }

  obj.pricesBelowAverage = await findPricesBelowAverage(
    currentPriceDate,
    currentDayHourlyArray,
    obj.avgPrice,
  );

  // Handle next day's data
  if (priceServiceInstance.isNextDayAvailable()) {
    const nextHourData = priceServiceInstance.getHourlyData(idx, "next");
    const nextDailySummary = priceServiceInstance.getNextDaySummary();
    const nextDayHourlyArray = priceServiceInstance.getNextDayHourlyArray();
    const nextPriceDate = priceServiceInstance.getNextPriceDate();

    if (nextHourData) {
      obj.startTimeDay2 = nextHourData.startTime;
      obj.endTimeDay2 = nextHourData.endTime;
      obj.spotPriceDay2 = nextHourData.spotPrice;
      obj.floatingPriceDay2 = nextHourData.floatingPrice;
      obj.fixedPriceDay2 = nextHourData.fixedPrice;
    } else {
      if (debug && nextPriceDate) {
        console.warn(
          `mergePrices: Missing next day hourly price data for ${nextPriceDate} at hour ${idx}.`,
        );
      }
      obj.startTimeDay2 = null;
      obj.endTimeDay2 = null;
      obj.spotPriceDay2 = null;
      obj.floatingPriceDay2 = null;
      obj.fixedPriceDay2 = null;
    }

    obj.minPriceDay2 = nextDailySummary.minPrice;
    obj.maxPriceDay2 = nextDailySummary.maxPrice;
    obj.avgPriceDay2 = nextDailySummary.avgPrice;
    obj.peakPriceDay2 = nextDailySummary.peakPrice;
    obj.offPeakPrice1Day2 = nextDailySummary.offPeakPrice1;
    obj.offPeakPrice2Day2 = nextDailySummary.offPeakPrice2;

    obj.pricesBelowAverageDay2 = await findPricesBelowAverage(
      nextPriceDate,
      nextDayHourlyArray,
      obj.avgPriceDay2,
    );
  } else {
    obj.startTimeDay2 = null;
    obj.endTimeDay2 = null;
    obj.spotPriceDay2 = null;
    obj.floatingPriceDay2 = null;
    obj.fixedPriceDay2 = null;
    obj.minPriceDay2 = null;
    obj.maxPriceDay2 = null;
    obj.avgPriceDay2 = null;
    obj.peakPriceDay2 = null;
    obj.offPeakPrice1Day2 = null;
    obj.offPeakPrice2Day2 = null;
    obj.pricesBelowAverageDay2 = { date: null, avgPrice: null, hours: [] };
  }

  // CustomerPrice calculation remains conditional
  if (
    obj.isHourEnd &&
    obj.consumptionCurrentHour !== undefined &&
    obj.spotPrice !== null &&
    obj.floatingPrice !== null &&
    obj.floatingPrice !== undefined &&
    obj.fixedPrice !== null &&
    obj.fixedPrice !== undefined
  ) {
    if (obj.consumptionCurrentHour !== 0) {
      obj.customerPrice = parseFloat(
        (
          obj.spotPrice +
          obj.floatingPrice +
          obj.fixedPrice / obj.consumptionCurrentHour
        ).toFixed(4),
      );
    } else {
      obj.customerPrice = parseFloat(
        (obj.spotPrice + obj.floatingPrice).toFixed(4),
      );
    }
  } else {
    obj.customerPrice = null;
  }

  if (debug && (list !== "list1" || obj.isHourStart || obj.isHourEnd)) {
    console.log(
      `mergePrices (list ${list}, hour ${idx}): Data merged. SpotPrice: ${obj.spotPrice}`,
    );
  }

  return obj;
}

module.exports = { initialize, mergePrices };
