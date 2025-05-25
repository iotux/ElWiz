const { skewDays } = require("../../misc/util"); // Assuming util.js is in misc folder at root

// Define parseJsonSafely locally within this module
function parseJsonSafely(messageString, logger = console) {
  if (typeof messageString !== 'string') {
    if (logger && logger.error) {
      logger.error('[parseJsonSafely] Input message is not a string.');
    }
    return { error: true, message: 'Input message is not a string.', data: null };
  }

  const trimmedString = messageString.trim();
  if (trimmedString === '') {
    return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
  }

  try {
    const data = JSON.parse(trimmedString);
    return { error: false, message: 'Successfully parsed JSON.', data: data };
  } catch (error) {
    if (logger && logger.error) {
      logger.error(`[parseJsonSafely] Error parsing JSON: ${error.message}`);
    }
    return { error: true, message: `Error parsing JSON: ${error.message}`, data: null };
  }
}

class PriceService {
  constructor(mqttClient, config, logger = console) {
    this.mqttClient = mqttClient;
    this.config = config; // Expects { priceTopic: 'elwiz/prices', debug: true/false }
    this.logger = logger;

    this.priceTopic = this.config.priceTopic || "elwiz/prices";
    this.debug = this.config.debug || false;

    // Internal state
    this.twoDaysData = []; // Holds up to two most recent, unique-by-date, price data objects
    this.dayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.prevDayPrices = { priceDate: null, hourly: [], daily: {} }; // Optional, but good for context
    this.nextDayAvailable = false;

    this.priceUpdateTimeout = null;
    this.initialLoadTimeout = null; // For a slightly longer delay on first load

    this._subscribeToPriceTopic();
    this._scheduleDailyRollover(); // Schedule a daily check for rollover
  }

  _subscribeToPriceTopic() {
    const topic = `${this.priceTopic}/#`;
    this.mqttClient.subscribe(topic, (err) => {
      if (err) {
        this.logger.error(
          `[PriceService] Subscription error for ${topic}: ${err.message}`,
        );
      } else {
        if (this.debug)
          this.logger.info(`[PriceService] Subscribed to ${topic}`);
        // Trigger initial processing after a short delay to allow retained messages to arrive
        if (this.initialLoadTimeout) clearTimeout(this.initialLoadTimeout);
        this.initialLoadTimeout = setTimeout(
          () => this.processReceivedPrices(),
          2000,
        ); // 2s for initial retained messages
      }
    });

    this.mqttClient.on("message", (msgTopic, message) => {
      if (msgTopic.startsWith(this.priceTopic)) {
        if (this.debug)
          this.logger.info(
            `[PriceService] Received MQTT message on ${msgTopic}`,
          );
        const messageString = message.toString(); // Convert buffer to string
        //const result = parseJsonSafely(messageString, this.logger); // Use local parseJsonSafely

        // TEMPORARY DEBUGGING:
        this.logger.info(`[PriceService DEBUG] Topic: ${msgTopic}, Raw Message: "${messageString}"`); 
        const result = parseJsonSafely(messageString, this.logger);
        this.logger.info(`[PriceService DEBUG] Topic: ${msgTopic}, Parse Result: ${JSON.stringify(result)}`); 

        if (
          !result.error &&
          result.data &&
          result.data.priceDate &&
          Array.isArray(result.data.hourly)
        ) {
          // Add new data, ensuring no exact duplicates based on content if necessary,
          // or just update if priceDate matches.
          const existingIndex = this.twoDaysData.findIndex(
            (d) => d.priceDate === result.data.priceDate,
          );
          if (existingIndex !== -1) {
            // Potentially compare if new data is actually different before replacing
            this.twoDaysData[existingIndex] = result.data;
            if (this.debug)
              this.logger.info(
                `[PriceService] Updated price data for date: ${result.data.priceDate}`,
              );
          } else {
            this.twoDaysData.push(result.data);
            if (this.debug)
              this.logger.info(
                `[PriceService] Added new price data for date: ${result.data.priceDate}`,
              );
          }

          // Debounce processing
          if (this.priceUpdateTimeout) clearTimeout(this.priceUpdateTimeout);
          this.priceUpdateTimeout = setTimeout(
            () => this.processReceivedPrices(),
            500,
          ); // 500ms debounce
        } else {
          this.logger.error(
            `[PriceService] Error parsing price message or invalid data format for topic ${msgTopic}: ${result.error || "Invalid data structure"}`,
          );
        }
      }
    });
  }

  processReceivedPrices() {
    if (this.debug)
      this.logger.info(
        `[PriceService] Starting processReceivedPrices. twoDaysData has ${this.twoDaysData.length} items.`,
      );

    if (this.twoDaysData.length === 0) {
      if (this.debug)
        this.logger.info("[PriceService] No data in twoDaysData to process.");
      // Call it again after a while in case messages are delayed (especially on startup)
      if (this.initialLoadTimeout) clearTimeout(this.initialLoadTimeout); // Clear previous longer timeout
      this.initialLoadTimeout = setTimeout(
        () => this.processReceivedPrices(),
        5000,
      ); // Retry in 5s
      return;
    }

    // Sort by date to easily find the latest
    this.twoDaysData.sort(
      (a, b) => new Date(a.priceDate) - new Date(b.priceDate),
    );

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

    if (this.debug)
      this.logger.info(
        `[PriceService] Filtered twoDaysData (max 2 latest distinct days): ${JSON.stringify(this.twoDaysData.map((d) => d.priceDate))}`,
      );

    const todayStr = skewDays(0); // Using imported skewDays

    // Reset current price states before reassignment
    const oldDayPricesDate = this.dayPrices.priceDate;
    this.dayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.prevDayPrices = { priceDate: null, hourly: [], daily: {} }; // Keep previous day's data if available
    this.nextDayAvailable = false;

    if (this.twoDaysData.length === 0) {
      if (this.debug)
        this.logger.warn(
          "[PriceService] No valid price data remains after filtering.",
        );
      return;
    }

    // Logic to assign to prev, current, next day based on 'todayStr'
    const dataCopy = [...this.twoDaysData]; // Work with a copy

    const todayDataIndex = dataCopy.findIndex((d) => d.priceDate === todayStr);
    let todayData = null;
    if (todayDataIndex !== -1) {
      todayData = dataCopy.splice(todayDataIndex, 1)[0];
      this.dayPrices = { ...todayData }; // Ensure hourly and daily are present
      this.dayPrices.hourly = this.dayPrices.hourly || [];
      this.dayPrices.daily = this.dayPrices.daily || {};
    }

    // Remaining data could be prev or next
    if (dataCopy.length > 0) {
      dataCopy.sort((a, b) => new Date(a.priceDate) - new Date(b.priceDate)); // Sort remaining
      const otherData = dataCopy[0]; // Could be yesterday or tomorrow

      if (new Date(otherData.priceDate) > new Date(todayStr)) {
        this.nextDayPrices = { ...otherData };
        this.nextDayPrices.hourly = this.nextDayPrices.hourly || [];
        this.nextDayPrices.daily = this.nextDayPrices.daily || {};
        this.nextDayAvailable = true;
      } else if (new Date(otherData.priceDate) < new Date(todayStr)) {
        this.prevDayPrices = { ...otherData };
        this.prevDayPrices.hourly = this.prevDayPrices.hourly || [];
        this.prevDayPrices.daily = this.prevDayPrices.daily || {};
        // If todayData was missing, and this 'otherData' is yesterday, assign it to dayPrices as fallback
        if (
          !this.dayPrices.priceDate &&
          oldDayPricesDate !== otherData.priceDate
        ) {
          // Avoid reassigning if it's the same old day
          this.dayPrices = { ...this.prevDayPrices }; // Use yesterday's as today's if today is missing
          if (this.debug)
            this.logger.warn(
              `[PriceService] Today's (${todayStr}) price data missing. Using yesterday's (${this.dayPrices.priceDate}) as current.`,
            );
        }
      }
    }

    // If dayPrices is still not set (e.g. only future data received), and nextDayPrices is set,
    // it might indicate it's just past midnight and today's data hasn't been "rolled over" yet.
    // The dailyRollover will handle this, or if today's data arrives, this logic will correct.
    if (
      !this.dayPrices.priceDate &&
      this.nextDayAvailable &&
      this.nextDayPrices.priceDate === todayStr
    ) {
      if (this.debug)
        this.logger.info(
          `[PriceService] Potential midnight scenario: nextDayPrices (${this.nextDayPrices.priceDate}) is today (${todayStr}). Performing rollover.`,
        );
      this.performMidnightRollover();
    }

    if (this.debug) {
      this.logger.info(`[PriceService] Processed prices. Today: ${todayStr}`);
      this.logger.info(`  dayPrices: ${this.dayPrices.priceDate || "None"}`);
      this.logger.info(
        `  nextDayPrices: ${this.nextDayPrices.priceDate || "None"}, Available: ${this.nextDayAvailable}`,
      );
      this.logger.info(
        `  prevDayPrices: ${this.prevDayPrices.priceDate || "None"}`,
      );
    }
  }

  _scheduleDailyRollover() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 1, 0, 0); // 00:01:00 AM to be safe

    const msToMidnight = tomorrow.getTime() - now.getTime();

    if (this.debug)
      this.logger.info(
        `[PriceService] Midnight rollover scheduled in ${msToMidnight / 1000 / 60} minutes.`,
      );

    setTimeout(() => {
      if (this.debug)
        this.logger.info(
          "[PriceService] Performing scheduled daily rollover check.",
        );
      this.performMidnightRollover();
      this._scheduleDailyRollover(); // Reschedule for the next day
    }, msToMidnight);
  }

  performMidnightRollover() {
    const todayStr = skewDays(0);
    if (this.nextDayAvailable && this.nextDayPrices.priceDate === todayStr) {
      this.prevDayPrices = { ...this.dayPrices }; // Current day becomes previous
      this.dayPrices = { ...this.nextDayPrices }; // Next day becomes current
      this.nextDayPrices = { priceDate: null, hourly: [], daily: {} }; // Clear next day
      this.nextDayAvailable = false;
      if (this.debug)
        this.logger.info(
          `[PriceService] Midnight Rollover: ${this.dayPrices.priceDate} is now current day. prevDay is ${this.prevDayPrices.priceDate}.`,
        );
      // Attempt to re-process twoDaysData in case the *new* next day's data is already there
      this.processReceivedPrices();
    } else if (
      this.nextDayAvailable &&
      new Date(this.nextDayPrices.priceDate) < new Date(todayStr)
    ) {
      // Stale nextDayPrices, clear it
      if (this.debug)
        this.logger.warn(
          `[PriceService] Midnight Rollover: Stale nextDayPrices found (${this.nextDayPrices.priceDate}) and cleared.`,
        );
      this.nextDayPrices = { priceDate: null, hourly: [], daily: {} };
      this.nextDayAvailable = false;
    } else {
      if (this.debug)
        this.logger.info(
          `[PriceService] Midnight Rollover: Conditions not met or no next day data to roll. Today: ${todayStr}, NextDay: ${this.nextDayPrices.priceDate}, Available: ${this.nextDayAvailable}`,
        );
    }
  }

  // --- Public Methods ---

  getHourlyData(hourIndex, targetDay = "current") {
    if (hourIndex < 0 || hourIndex > 23) return null;

    let source;
    if (targetDay === "current") {
      source = this.dayPrices;
    } else if (targetDay === "next" && this.nextDayAvailable) {
      source = this.nextDayPrices;
    } else if (targetDay === "previous") {
      source = this.prevDayPrices;
    } else {
      return null;
    }

    if (source && source.hourly && source.hourly[hourIndex]) {
      return source.hourly[hourIndex];
    }
    if (this.debug && source && source.priceDate)
      this.logger.warn(
        `[PriceService] No hourly data for ${targetDay} day ${source.priceDate} at hour ${hourIndex}.`,
      );
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

