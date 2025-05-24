
const MQTTClient = require("../mqtt/mqtt");
const { format, formatISO, nextDay } = require("date-fns");
const configFile = "./config.yaml";
const { skewDays, loadYaml, isNewDay } = require("../misc/util.js");

const config = loadYaml(configFile);
const debug = config.mergeprices.debug || false;

const priceTopic = config.priceTopic || "elwiz/prices";

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'mergePrices');
mqttClient.waitForConnect();

let prevDayPrices = { hourly: [], daily: {} };
let dayPrices = { hourly: [], daily: {} };
let nextDayPrices = { hourly: [], daily: {} };

let twoDaysData = [];
let timerInit = true; // Used to debounce initial loading
let priceUpdateTimeout = null; // To manage the timeout

let nextDayAvailable = false;

mqttClient.subscribe(priceTopic + "/#", (err) => {
  if (err) {
    console.error("mergePrices: Subscription error", err);
  } else {
    if (debug) console.log("mergePrices: Subscribed to", priceTopic + "/#");
  }
});

function processReceivedPrices() {
  const today = skewDays(0);
  if (debug) console.log("mergePrices: Processing received prices. twoDaysData.length:", twoDaysData.length, "Today is:", today);

  // Sort twoDaysData by priceDate to ensure correct order
  twoDaysData.sort((a, b) => new Date(a.priceDate) - new Date(b.priceDate));

  // Deduplicate twoDaysData, keeping the latest entry for each date
  const uniquePrices = [];
  const seenDates = new Set();
  for (let i = twoDaysData.length - 1; i >= 0; i--) {
    if (!seenDates.has(twoDaysData[i].priceDate)) {
      uniquePrices.unshift(twoDaysData[i]);
      seenDates.add(twoDaysData[i].priceDate);
    }
  }
  twoDaysData = uniquePrices.slice(-2); // Keep at most 2 days

  if (debug) console.log("mergePrices: Filtered twoDaysData:", JSON.stringify(twoDaysData.map(d => d.priceDate)));

  prevDayPrices = { hourly: [], daily: {} }; // Reset
  dayPrices = { hourly: [], daily: {} };     // Reset
  nextDayPrices = { hourly: [], daily: {} }; // Reset
  nextDayAvailable = false;

  if (twoDaysData.length === 0) {
    if (debug) console.warn("mergePrices: No price data available in twoDaysData after processing.");
    return;
  }

  if (twoDaysData.length === 1) {
    const singleData = twoDaysData[0];
    if (singleData.priceDate === today) {
      dayPrices = singleData;
      if (debug) console.log("mergePrices: Using single data for today's prices:", dayPrices.priceDate);
    } else if (singleData.priceDate > today) {
      nextDayPrices = singleData;
      nextDayAvailable = true;
      if (debug) console.log("mergePrices: Using single data for next day's prices:", nextDayPrices.priceDate);
    } else { // singleData is for a previous day
      prevDayPrices = singleData; // Or potentially dayPrices if it's yesterday and today is missing.
                                  // This logic might need refinement if we strictly need 'today'.
                                  // For now, if it's past, consider it prevDay.
      if (debug) console.log("mergePrices: Using single data for prev day's prices:", prevDayPrices.priceDate);
    }
  } else { // twoDaysData.length === 2
    const firstDay = twoDaysData[0];
    const secondDay = twoDaysData[1];

    if (secondDay.priceDate === today) { // [yesterday, today]
      prevDayPrices = firstDay;
      dayPrices = secondDay;
      nextDayAvailable = false;
      if (debug) console.log("mergePrices: Using data for prevDay:", prevDayPrices.priceDate, "and dayPrices:", dayPrices.priceDate);
    } else if (firstDay.priceDate === today && secondDay.priceDate > today) { // [today, tomorrow]
      dayPrices = firstDay;
      nextDayPrices = secondDay;
      nextDayAvailable = true;
      if (debug) console.log("mergePrices: Using data for dayPrices:", dayPrices.priceDate, "and nextDayPrices:", nextDayPrices.priceDate);
    } else if (firstDay.priceDate < today && secondDay.priceDate > today) { // [yesterday, tomorrow] - today missing
        prevDayPrices = firstDay;
        nextDayPrices = secondDay; // dayPrices remains empty, nextDay is available
        nextDayAvailable = true;
        if (debug) console.log("mergePrices: Today's prices missing. PrevDay:", prevDayPrices.priceDate, "NextDay:", nextDayPrices.priceDate);
    } else { // Other combinations, e.g. [way-past, yesterday], or [tomorrow, day-after-tomorrow]
        // This logic prioritizes having 'dayPrices' set if possible, even if it means using older data.
        // Or if the data is for future, it loads into nextDay.
        if (secondDay.priceDate < today) { // Both are past days
            prevDayPrices = firstDay; // first is older
            dayPrices = secondDay;    // second is "today" relative to these two past days
            if (debug) console.log("mergePrices: Both data are past. PrevDay:", prevDayPrices.priceDate, "DayPrices (as most recent of two past):", dayPrices.priceDate);
        } else if (firstDay.priceDate > today) { // Both are future days
            nextDayPrices = firstDay; // first is "next day"
            // Potentially load secondDay into a "dayAfterNextPrices" if needed, or ignore.
            nextDayAvailable = true;
            if (debug) console.log("mergePrices: Both data are future. NextDayPrices:", nextDayPrices.priceDate, "Second future day:", secondDay.priceDate);
        } else {
             if (debug) console.log("mergePrices: Unhandled case for price data assignment. twoDaysData:", JSON.stringify(twoDaysData.map(d=>d.priceDate)));
        }
    }
  }
  // Ensure .hourly is always an array
  dayPrices.hourly = dayPrices.hourly || [];
  nextDayPrices.hourly = nextDayPrices.hourly || [];
  prevDayPrices.hourly = prevDayPrices.hourly || [];
  dayPrices.daily = dayPrices.daily || {};
  nextDayPrices.daily = nextDayPrices.daily || {};
  prevDayPrices.daily = prevDayPrices.daily || {};


  if (debug) {
    console.log("mergePrices: Final effective dayPrices date:", dayPrices.priceDate || "None");
    console.log("mergePrices: Final effective nextDayPrices date:", nextDayPrices.priceDate || "None", "Available:", nextDayAvailable);
    console.log("mergePrices: Final effective prevDayPrices date:", prevDayPrices.priceDate || "None");
  }
}


mqttClient.on("message", (topic, message) => {
  const [topic1, topic2] = topic.split("/");
  if (`${topic1}/${topic2}` === priceTopic) {
    const result = parseJsonSafely(message);
    if (!result.error && result.data && result.data.priceDate && result.data.hourly) {
      if (debug) console.log("mergePrices: Received price data for date:", result.data.priceDate);
      
      // Add to twoDaysData, ensuring no duplicates for the same priceDate, keeping the latest.
      const existingIndex = twoDaysData.findIndex(d => d.priceDate === result.data.priceDate);
      if (existingIndex !== -1) {
        twoDaysData[existingIndex] = result.data; // Update if exists
      } else {
        twoDaysData.push(result.data);
      }

      // Sort by date and keep only the latest two distinct dates
      twoDaysData.sort((a, b) => new Date(a.priceDate) - new Date(b.priceDate));
      const uniqueLatestPrices = [];
      const seenDates = new Set();
      for (let i = twoDaysData.length - 1; i >= 0; i--) {
          if (!seenDates.has(twoDaysData[i].priceDate)) {
              uniqueLatestPrices.unshift(twoDaysData[i]);
              seenDates.add(twoDaysData[i].priceDate);
          }
      }
      twoDaysData = uniqueLatestPrices.slice(-2);


      if (timerInit) { // Apply short delay only for the very first message processing sequence
        timerInit = false; // Prevent this immediate re-trigger
        if (priceUpdateTimeout) clearTimeout(priceUpdateTimeout);
        priceUpdateTimeout = setTimeout(() => {
          processReceivedPrices();
        }, 500);
      } else { // For subsequent messages, process more immediately or with a shorter debounce
        if (priceUpdateTimeout) clearTimeout(priceUpdateTimeout);
        priceUpdateTimeout = setTimeout(() => {
          processReceivedPrices();
        }, 50); // Shorter delay for subsequent updates
      }

    } else {
      console.error('mergePrices: Error parsing price message or invalid data format:', result.error || "Invalid data");
    }
  }
});

function parseJsonSafely(message) {
  let buffer;
  try {
    buffer = message.toString();
  } catch (err) {
    console.log('mergePrices: Error converting buffer to string:', err);
    return { error: true, message: 'Message cannot be parsed as atring', data: null };
  }
  // Trim the input to remove leading/trailing whitespace
  const trimmedString = buffer.trim();

  // Check if the input is empty
  if (trimmedString === '') {
    return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
  }

  // Attempt to parse the JSON string
  try {
    const data = JSON.parse(trimmedString);
    return { error: false, message: 'Successfully parsed JSON.', data: data };
  } catch (error) {
    return { error: true, message: `Error parsing JSON: ${error.message}`, data: null };
  }
}

async function findPricesBelowAverage(priceObject) {
  const prices = priceObject.hourly;
  const average = dayPrices.daily.avgPrice;
  const filteredPrices = prices
    .filter(({ spotPrice }) => spotPrice < average) // Filter prices below average
    .map(({ startTime, spotPrice }) => ({
      hour: format(new Date(startTime), "HH"),
      spotPrice,
    }));

  return {
    date: priceObject.priceDate,
    avgPrice: average,
    hours: filteredPrices,
  };
  //return filteredPrices;
}

/**
 * Merge price information from today and next day prices into an object
 * @param {string} list - The list identifier (e.g., 'list1', 'list2', 'list3')
 * @param {Object} obj - The AMS data object to which price information will be added
 * @returns {Promise<Object>} - The merged object with price information
 */
async function mergePrices(list, obj) {
  const idx = obj.hourIndex; // 0-23

  if (idx === undefined || idx < 0 || idx > 23) {
    if (debug) console.warn(`mergePrices: Invalid hourIndex ${idx} in obj:`, obj);
    return obj; // Return object unmodified if hourIndex is invalid
  }

  // Midnight rollover logic: If it's the first hour of the day (idx 0)
  // and it's marked as the start of the hour (or a list3 message, which is always hourly)
  // and next day's prices were available, roll them over.
  if (idx === 0 && (obj.isHourStart || list === 'list3') && nextDayAvailable) {
    if (dayPrices.priceDate !== nextDayPrices.priceDate) { // Avoid re-assigning if already rolled or same date
        prevDayPrices = dayPrices; // Yesterday's prices are now what 'dayPrices' was
        dayPrices = nextDayPrices; // Today's prices are now what 'nextDayPrices' was
        nextDayPrices = { hourly: [], daily: {} }; // Clear nextDayPrices
        nextDayAvailable = false;
        if (debug) console.log(`mergePrices: Midnight rollover. New dayPrices date: ${dayPrices.priceDate}, prevDayPrices date: ${prevDayPrices.priceDate}`);
        // After rollover, attempt to fetch new "next day" prices if a mechanism exists
        // For now, it relies on new MQTT messages for the *new* next day.
    }
  }

  const currentHourData = dayPrices.hourly && dayPrices.hourly[idx] ? dayPrices.hourly[idx] : null;
  const currentDailyData = dayPrices.daily || {};

  if (currentHourData) {
    obj.startTime = currentHourData.startTime;
    obj.endTime = currentHourData.endTime;
    obj.spotPrice = currentHourData.spotPrice;
    obj.floatingPrice = currentHourData.floatingPrice; // May not exist on all price objects
    obj.fixedPrice = currentHourData.fixedPrice;       // May not exist on all price objects
  } else {
    if (debug && dayPrices.priceDate) { // Log only if we expected data for dayPrices
        console.warn(`mergePrices: Missing hourly price data for ${dayPrices.priceDate} at hour ${idx}.`);
    }
    // Set defaults if no hourly data for current hour
    obj.spotPrice = null;
    obj.floatingPrice = null;
    obj.fixedPrice = null;
  }

  // Daily summary data from dayPrices
  obj.minPrice = currentDailyData.minPrice;
  obj.maxPrice = currentDailyData.maxPrice;
  obj.avgPrice = currentDailyData.avgPrice;
  obj.peakPrice = currentDailyData.peakPrice;
  obj.offPeakPrice1 = currentDailyData.offPeakPrice1;
  obj.offPeakPrice2 = currentDailyData.offPeakPrice2;

  if (obj.spotPrice !== null && obj.avgPrice !== null) {
    obj.spotBelowAverage = obj.spotPrice < obj.avgPrice ? 1 : 0;
  } else {
    obj.spotBelowAverage = 0;
  }
  
  if (dayPrices.hourly && dayPrices.hourly.length > 0) {
      obj.pricesBelowAverage = await findPricesBelowAverage(dayPrices);
  } else {
      obj.pricesBelowAverage = { date: dayPrices.priceDate, avgPrice: obj.avgPrice, hours: [] };
  }


  // Handle next day's data if available
  if (nextDayAvailable && nextDayPrices.hourly && nextDayPrices.hourly[idx]) {
    const nextDayHourData = nextDayPrices.hourly[idx];
    const nextDailyData = nextDayPrices.daily || {};

    obj.startTimeDay2 = nextDayHourData.startTime;
    obj.endTimeDay2 = nextDayHourData.endTime;
    obj.spotPriceDay2 = nextDayHourData.spotPrice;
    obj.floatingPriceDay2 = nextDayHourData.floatingPrice;
    obj.fixedPriceDay2 = nextDayHourData.fixedPrice;
    
    obj.minPriceDay2 = nextDailyData.minPrice;
    obj.maxPriceDay2 = nextDailyData.maxPrice;
    obj.avgPriceDay2 = nextDailyData.avgPrice;
    obj.peakPriceDay2 = nextDailyData.peakPrice;
    obj.offPeakPrice1Day2 = nextDailyData.offPeakPrice1;
    obj.offPeakPrice2Day2 = nextDailyData.offPeakPrice2;
    
    if (nextDayPrices.hourly.length > 0) {
        obj.pricesBelowAverageDay2 = await findPricesBelowAverage(nextDayPrices);
    } else {
        obj.pricesBelowAverageDay2 = { date: nextDayPrices.priceDate, avgPrice: obj.avgPriceDay2, hours: [] };
    }

  } else {
    // Clear Day2 fields if next day data is not available or hour is missing
    obj.startTimeDay2 = null;
    obj.endTimeDay2 = null;
    obj.spotPriceDay2 = null;
    // ... and so on for all Day2 fields
    obj.minPriceDay2 = null;
    obj.maxPriceDay2 = null;
    obj.avgPriceDay2 = null;
    obj.pricesBelowAverageDay2 = { date: nextDayPrices.priceDate, avgPrice: null, hours: [] };
  }

  // CustomerPrice calculation remains conditional on isHourEnd and consumptionCurrentHour
  if (obj.isHourEnd && obj.consumptionCurrentHour !== undefined && obj.spotPrice !== null && obj.floatingPrice !== null && obj.fixedPrice !== null) {
    if (obj.consumptionCurrentHour !== 0) { // Avoid division by zero
      obj.customerPrice = parseFloat((obj.spotPrice + obj.floatingPrice + (obj.fixedPrice / obj.consumptionCurrentHour)).toFixed(4));
    } else {
      // Handle cases where consumption is zero, perhaps customerPrice is just spot + floating
      obj.customerPrice = parseFloat((obj.spotPrice + obj.floatingPrice).toFixed(4));
    }
  } else {
    obj.customerPrice = null; // Set to null if conditions aren't met
  }

  if (debug && (list !== 'list1' || obj.isHourStart || obj.isHourEnd)) { // Keep debug logging manageable
    console.log(`mergePrices (list ${list}, hour ${idx}):`, JSON.stringify(obj, null, 2));
  }

  return obj;
}

module.exports = { mergePrices };
