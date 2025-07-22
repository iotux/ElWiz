const { skewDays } = require('../../misc/util'); // Assuming util.js is in misc folder at root
const { event } = require('../../misc/misc.js');

// Define parseJsonSafely locally within this module
function parseJsonSafely(message, logger = console) {
  let messageString;
  try {
    // Ensure message is not null and toString exists, otherwise handle as error
    if (message === null || typeof message.toString !== 'function') {
      if (logger && logger.error) {
        logger.error('[parseJsonSafely] Received null message or message without toString method.');
      }
      return { error: true, message: 'Invalid message object received (null or no toString).', data: null };
    }
    messageString = message.toString(); // Convert buffer/message to string
  } catch (e) {
    if (logger && logger.error) {
      logger.error(`[parseJsonSafely] Error converting message to string: ${e.message}`);
    }
    return { error: true, message: `Error converting message to string: ${e.message}`, data: null };
  }

  // typeof check is still good as message.toString() might not return a string in some edge cases,
  // though typically it should for Buffer objects from MQTT.
  if (typeof messageString !== 'string') {
    if (logger && logger.error) {
      logger.error(`[parseJsonSafely] message.toString() did not return a string. Type was: ${typeof messageString}`);
    }
    return { error: true, message: `message.toString() did not return a string (type: ${typeof messageString}).`, data: null };
  }

  const trimmedString = messageString.trim();
  if (trimmedString === '') {
    if (logger && logger.info) {
      // Using info or warn for empty strings might be less alarming than error
      logger.info(`[parseJsonSafely] Received empty string after trim. Original (if string): "${messageString.length > 100 ? messageString.substring(0, 100) + '...' : messageString}"`);
    }
    return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
  }

  try {
    const data = JSON.parse(trimmedString);
    return { error: false, message: 'Successfully parsed JSON.', data: data };
  } catch (e) {
    if (logger && logger.error) {
      logger.error(`[parseJsonSafely] Error parsing JSON: ${e.message} for input (first 100 chars): "${trimmedString.substring(0, 100)}"`);
    }
    // Ensure e.message is a string, provide fallback if not.
    const errorMessage = e && typeof e.message === 'string' && e.message ? e.message : 'Unknown JSON parse error';
    return { error: true, message: `Error parsing JSON: ${errorMessage}`, data: null };
  }
}

class PriceService {
  constructor(mqttClient, config, logger = console, eventEmitter) {
    this.mqttClient = mqttClient;
    this.config = config; // Expects { priceTopic: 'elwiz/prices', debug: true/false }
    this.logger = logger;
    this.event = eventEmitter;

    this.priceTopic = this.config.priceTopic || 'elwiz/prices';
    this.debug = this.config.debug || false;

    // Internal state
    this.twoDaysData = []; // Holds up to two most recent, unique-by-date, price data objects
    this.dayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.prevDayPrices = { priceDate: null, hourly: [], daily: {} }; // Optional, but good for context
    this.nextDayAvailable = false;
    this.newDataAvailable = false;

    this.priceUpdateTimeout = null;
    this.initialLoadTimeout = null; // For a slightly longer delay on first load

    this._subscribeToPriceTopic();
    this._scheduleDailyRollover(); // Schedule a daily check for rollover
  }

  _subscribeToPriceTopic() {
    const topic = `${this.priceTopic}/#`;
    this.mqttClient.subscribe(topic, (err) => {
      if (err) {
        this.logger.error(`[PriceService] Subscription error for ${topic}: ${err.message}`);
      } else {
        if (this.debug) this.logger.info(`[PriceService] Subscribed to ${topic}`);
        // Trigger initial processing after a short delay to allow retained messages to arrive
        if (this.initialLoadTimeout) clearTimeout(this.initialLoadTimeout);
        this.initialLoadTimeout = setTimeout(() => this.processReceivedPrices(), 2000); // 2s for initial retained messages
      }
    });

    this.mqttClient.on('message', (msgTopic, message) => {
      if (msgTopic.startsWith(this.priceTopic)) {
        if (message.length === 0) {
            if (this.debug) this.logger.info(`[PriceService] Received empty message on ${msgTopic}. Ignoring.`);
            return;
        }
        if (this.debug) this.logger.info(`[PriceService] Received MQTT message on ${msgTopic}`);
        // Pass the raw message object to parseJsonSafely
        const result = parseJsonSafely(message, this.logger);

        if (!result.error && result.data && result.data.priceDate && Array.isArray(result.data.hourly)) {
          // Add new data, ensuring no exact duplicates based on content if necessary,
          // or just update if priceDate matches.
          const existingIndex = this.twoDaysData.findIndex((d) => d.priceDate === result.data.priceDate);
          if (existingIndex !== -1) {
            // Potentially compare if new data is actually different before replacing
            this.twoDaysData[existingIndex] = result.data;
            if (this.debug) this.logger.info(`[PriceService] Updated price data for date: ${result.data.priceDate}`);
            this.newDataAvailable = true;
          } else {
            this.twoDaysData.push(result.data);
            if (this.debug) this.logger.info(`[PriceService] Added new price data for date: ${result.data.priceDate}`);
            this.newDataAvailable = true;

          // Assuming h.startTime is already in the server's local time and does not need conversion.
          // If the source provides UTC, this section would need to be re-enabled and verified.
          // The previous logic was:
          // if (result.data.hourly && this.config.timezoneOffset !== undefined) {
          //   result.data.hourly.forEach(h => {
          //     const utcDate = new Date(h.startTime + 'Z');
          //     const serverLocalDate = new Date(utcDate.getTime() + (this.config.timezoneOffset * 60 * 60 * 1000));
          //     h.startTime = serverLocalDate.toISOString().slice(0, 19);
          //   });
          // }
          }

          // Debounce processing
          if (this.priceUpdateTimeout) clearTimeout(this.priceUpdateTimeout);
          this.priceUpdateTimeout = setTimeout(() => this.processReceivedPrices(), 500); // 500ms debounce
        } else {
          // Updated error logging
          const detailMessage = result && result.message ? result.message : result && result.error ? String(result.error) : 'Unknown parsing error';
          this.logger.error(`[PriceService] Error processing price message for topic ${msgTopic}. Details: ${detailMessage}`);
        }
      }
    });
  }

  processReceivedPrices() {
    if (this.debug) this.logger.info(`[PriceService] Starting processReceivedPrices. twoDaysData has ${this.twoDaysData.length} items.`);

    if (this.twoDaysData.length === 0) {
      if (this.debug) this.logger.info('[PriceService] No data in twoDaysData to process.');
      // Call it again after a while in case messages are delayed (especially on startup)
      if (this.initialLoadTimeout) clearTimeout(this.initialLoadTimeout); // Clear previous longer timeout
      this.initialLoadTimeout = setTimeout(() => this.processReceivedPrices(), 5000); // Retry in 5s
      return;
    }

    // Sort by date to easily find the latest
    this.twoDaysData.sort((a, b) => new Date(a.priceDate) - new Date(b.priceDate));

    // Deduplicate, keeping the latest entry for each date (most recent version of a day's prices)
    const uniquePriceData = [];
    const seenDates = new Set();
    for (let i = this.twoDaysData.length - 1; i >= 0; i--) {
      if (this.twoDaysData[i] && this.twoDaysData[i].priceDate) {
        // Ensure data is valid
        if (!seenDates.has(this.twoDaysData[i].priceDate)) {
          uniquePriceData.unshift(this.twoDaysData[i]);
          seenDates.add(this.twoDaysData[i].priceDate);
        }
      }
    }
    this.twoDaysData = uniquePriceData;

    // Keep only the two most recent distinct days
    if (this.twoDaysData.length > 2) {
      this.twoDaysData = this.twoDaysData.slice(this.twoDaysData.length - 2);
    }

    if (this.debug) this.logger.info(`[PriceService] Filtered twoDaysData (max 2 latest distinct days): ${JSON.stringify(this.twoDaysData.map((d) => d.priceDate))}`);

    const todayStr = skewDays(0);
    const yesterdayStr = skewDays(-1);
    const tomorrowStr = skewDays(1);

    // Reset current price states before reassignment
    // const oldDayPricesDate = this.dayPrices.priceDate; // For logging or specific checks if needed - removed for now
    this.dayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.prevDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayAvailable = false;

    if (this.twoDaysData.length === 0) {
      if (this.debug) this.logger.warn('[PriceService] No valid price data remains after filtering.');
      // Consider if a retry mechanism like initialLoadTimeout is still needed here if data disappears
      return;
    }

    // Assign data from twoDaysData to the correct day slots
    this.twoDaysData.forEach((data) => {
      if (!data || !data.priceDate) {
        if (this.debug) this.logger.warn('[PriceService] Skipping invalid data entry in twoDaysData.');
        return;
      }

      const dataDate = data.priceDate;
      if (dataDate === todayStr) {
        this.dayPrices = { ...data, hourly: data.hourly || [], daily: data.daily || {} };
        if (this.debug) this.logger.info(`[PriceService] Assigned data for ${dataDate} to dayPrices.`);
      } else if (dataDate === tomorrowStr) {
        this.nextDayPrices = { ...data, hourly: data.hourly || [], daily: data.daily || {} };
        this.nextDayAvailable = true;
        if (this.debug) this.logger.info(`[PriceService] Assigned data for ${dataDate} to nextDayPrices.`);
      } else if (dataDate === yesterdayStr) {
        this.prevDayPrices = { ...data, hourly: data.hourly || [], daily: data.daily || {} };
        if (this.debug) this.logger.info(`[PriceService] Assigned data for ${dataDate} to prevDayPrices.`);
      } else {
        // This case should ideally not happen if twoDaysData is correctly filtered to most recent two
        // OR if it's data for a day that is not yesterday, today, or tomorrow relative to current time.
        if (this.debug) this.logger.warn(`[PriceService] Data for ${dataDate} in twoDaysData (${this.twoDaysData.map((d) => d.priceDate).join(', ')}) does not match today (${todayStr}), tomorrow (${tomorrowStr}), or yesterday (${yesterdayStr}).`);
      }
    });

    // After attempting assignments, check if today's data is actually available.
    if (!this.dayPrices.priceDate) {
      if (this.debug) {
        this.logger.warn(`[PriceService] Today's (${todayStr}) price data is not available in twoDaysData. dayPrices will be empty. prevDayPrices is ${this.prevDayPrices.priceDate || 'empty'}. nextDayPrices is ${this.nextDayPrices.priceDate || 'empty'}`);
      }
    }

    // The "Potential midnight scenario" check that called performMidnightRollover directly from here
    // has been removed. performMidnightRollover is triggered by its own timer.
    // processReceivedPrices should be idempotent and reflect the state based on current twoDaysData and todayStr.

    if (this.debug) {
      this.logger.info(`[PriceService] Processed prices. Today: ${todayStr}`);
      this.logger.info(`  dayPrices: ${this.dayPrices.priceDate || 'None'}`);
      this.logger.info(`  nextDayPrices: ${this.nextDayPrices.priceDate || 'None'}, Available: ${this.nextDayAvailable}`);
      this.logger.info(`  prevDayPrices: ${this.prevDayPrices.priceDate || 'None'}`);
    }
    this.event.emit('newPrices');
  }

  _scheduleDailyRollover() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 1, 0, 0); // 00:01:00 AM to be safe

    const msToMidnight = tomorrow.getTime() - now.getTime();

    if (this.debug) this.logger.info(`[PriceService] Midnight rollover scheduled in ${msToMidnight / 1000 / 60} minutes.`);

    setTimeout(() => {
      if (this.debug) this.logger.info('[PriceService] Performing scheduled daily rollover check.');
      this.performMidnightRollover();
      this._scheduleDailyRollover(); // Reschedule for the next day
    }, msToMidnight);
  }

  performMidnightRollover() {
    const newTodayStr = skewDays(0); // Get the date for the new day
    if (this.debug) {
      this.logger.info(`[PriceService] Midnight Rollover: Running for new date ${newTodayStr}. Triggering price processing.`);
    }

    // Simply call processReceivedPrices. It will use the new todayStr
    // and correctly re-evaluate dayPrices, nextDayPrices, etc., from twoDaysData.
    this.processReceivedPrices();

    if (this.debug) {
      this.logger.info(`[PriceService] Midnight Rollover: Price processing complete for ${newTodayStr}.`);
      this.logger.info(`  New dayPrices: ${this.dayPrices.priceDate || 'None'}`);
      this.logger.info(`  New nextDayPrices: ${this.nextDayPrices.priceDate || 'None'}, Available: ${this.nextDayAvailable}`);
      this.logger.info(`  New prevDayPrices: ${this.prevDayPrices.priceDate || 'None'}`);
    }
  }

  // --- Public Methods ---

  getHourlyData(hourIndex, targetDay = 'current') {
    if (hourIndex < 0 || hourIndex > 23) return null;

    let source;
    if (targetDay === 'current') {
      source = this.dayPrices;
    } else if (targetDay === 'next' && this.nextDayAvailable) {
      source = this.nextDayPrices;
    } else if (targetDay === 'previous') {
      source = this.prevDayPrices;
    } else {
      return null;
    }

    if (source && source.hourly && source.hourly[hourIndex]) {
      return source.hourly[hourIndex];
    }
    if (this.debug && source && source.priceDate) this.logger.warn(`[PriceService] No hourly data for ${targetDay} day ${source.priceDate} at hour ${hourIndex}.`);
    return null;
  }

  getCurrentDaySummary() {
    return this.dayPrices.daily || {};
  }

  getNextDaySummary() {
    return this.nextDayAvailable ? this.nextDayPrices.daily || {} : null;
  }

  getPreviousDaySummary() {
    return this.prevDayPrices.daily || {};
  }

  getCurrentDayHourlyArray() {
    return this.dayPrices.hourly || [];
  }

  getNextDayHourlyArray() {
    return this.nextDayAvailable ? this.nextDayPrices.hourly || [] : [];
  }

  getPreviousDayHourlyArray() {
    return this.prevDayPrices.hourly || [];
  }

  isNextDayAvailable() {
    return this.nextDayAvailable;
  }

  hasNewData() {
    return this.newDataAvailable;
  }

  clearNewDataFlag() {
    this.newDataAvailable = false;
  }

  getCurrentPriceDate() {
    return this.dayPrices.priceDate;
  }

  getNextPriceDate() {
    return this.nextDayAvailable ? this.nextDayPrices.priceDate : null;
  }

  getPreviousPriceDate() {
    return this.prevDayPrices.priceDate;
  }
}

module.exports = PriceService;
