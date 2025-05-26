// src/modules/priceService/index.js

const EventEmitter = require('events'); // Required if PriceServiceModule itself becomes an emitter, not strictly for eventBus usage.
const MQTTClient = require('../../../mqtt/mqtt'); // Adjust path if MQTTClient is moved/centralized

// Helper function: skewDays (remains the same as in original PriceService)
// It's self-contained, so can be a local helper or moved to core/utils.js later.
function skewDays(days) {
  const oneDay = 86400000;
  const baseDate = new Date(); // Use current date as base for skewing
  const targetDate = new Date(baseDate.getTime() + oneDay * days);
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Helper function: parseJsonSafely (remains the same as in original PriceService)
// Pass the logger to it if it needs to log internally, or rely on PriceServiceModule's logger.
function parseJsonSafely(message, logger) {
  let messageString;
  try {
    if (message === null || typeof message.toString !== 'function') {
      if (logger) logger.error('PriceServiceModule:parseJsonSafely', 'Received null message or message without toString method.');
      return { error: true, message: 'Invalid message object received (null or no toString).', data: null };
    }
    messageString = message.toString();
  } catch (e) {
    if (logger) logger.error('PriceServiceModule:parseJsonSafely', `Error converting message to string: ${e.message}`);
    return { error: true, message: `Error converting message to string: ${e.message}`, data: null };
  }

  if (typeof messageString !== 'string') {
    if (logger) logger.error('PriceServiceModule:parseJsonSafely', `message.toString() did not return a string. Type was: ${typeof messageString}`);
    return { error: true, message: `message.toString() did not return a string (type: ${typeof messageString}).`, data: null };
  }

  const trimmedString = messageString.trim();
  if (trimmedString === '') {
    if (logger) logger.info('PriceServiceModule:parseJsonSafely', `Received empty string after trim. Original (if string): "${messageString.length > 100 ? messageString.substring(0, 100) + '...' : messageString}"`);
    return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
  }

  try {
    const data = JSON.parse(trimmedString);
    return { error: false, message: 'Successfully parsed JSON.', data: data };
  } catch (e) {
    const errorMessage = e && typeof e.message === 'string' && e.message ? e.message : 'Unknown JSON parse error';
    if (logger) logger.error('PriceServiceModule:parseJsonSafely', `Error parsing JSON: ${errorMessage} for input (first 100 chars): "${trimmedString.substring(0, 100)}"`);
    return { error: true, message: `Error parsing JSON: ${errorMessage}`, data: null };
  }
}

class PriceServiceModule {
  constructor(moduleConfig, mainLogger, eventBus, mainMqttConfig) {
    this.config = moduleConfig; // e.g., { enabled, priceTopic, debug, mqttUrl, mqttOptions }
    this.logger = mainLogger;
    this.eventBus = eventBus;
    this.moduleName = 'PriceServiceModule'; // For logger prefix

    this.priceTopic = this.config.priceTopic || 'elwiz/prices';
    this.debug = this.config.debug || false; // Module-specific debug

    // MQTT Client: Instantiate its own for now.
    // mainMqttConfig would contain { url, options } if a shared client isn't passed directly.
    // For this phase, we'll use mqttUrl and mqttOptions from this module's config,
    // assuming main.js will ensure they are there (e.g., by merging global MQTT config into module config).
    const mqttUrl = this.config.mqttUrl || 'mqtt://localhost:1883'; // Get from module config or global
    const mqttOpts = this.config.mqttOptions || {}; // Get from module config or global

    // Give this MQTT client a unique ID for the broker
    const clientName = this.config.mqttClientName || 'ElWiz_PriceServiceModule_Client';

    // Pass a logger instance to MQTTClient if it accepts one
    // Here, we create a simple child-like logger for MQTT client for namespacing
    const mqttLogger = {
      debug: (message, ...args) => this.logger.debug(clientName, message, ...args),
      info: (message, ...args) => this.logger.info(clientName, message, ...args),
      warn: (message, ...args) => this.logger.warn(clientName, message, ...args),
      error: (message, ...args) => this.logger.error(clientName, message, ...args),
    };
    this.mqttClient = new MQTTClient(mqttUrl, mqttOpts, clientName, mqttLogger);

    // Internal state
    this.twoDaysData = [];
    this.dayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.prevDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayAvailable = false;

    this.priceUpdateTimeout = null;
    this.initialLoadTimeout = null;

    this.logger.info(this.moduleName, `Initializing with price topic: ${this.priceTopic}`);
  }

  start() {
    this.logger.info(this.moduleName, 'Starting PriceServiceModule...');
    this._connectMqttAndSubscribe();
    this._scheduleDailyRollover();
  }

  _connectMqttAndSubscribe() {
    // Assuming MQTTClient has a connect method or handles connection internally.
    // If it emits 'connect', subscriptions should happen there.
    // For now, let's assume the MQTTClient handles its own connection and we can subscribe.
    // If MQTTClient is based on Node's 'mqtt' library, 'connect' event is key.

    this.mqttClient.on('connect', () => {
      this.logger.info(this.moduleName, 'MQTT client connected. Subscribing to price topics.');
      this._subscribeToPriceTopic();
    });

    // If already connected (e.g. MQTTClient connects on instantiation)
    if (this.mqttClient.connected) {
      this.logger.info(this.moduleName, 'MQTT client was already connected. Subscribing to price topics.');
      this._subscribeToPriceTopic();
    }
    // The MQTTClient wrapper should also handle reconnections and re-subscriptions.
  }

  _subscribeToPriceTopic() {
    const topic = `${this.priceTopic}/#`;
    // Using the logger passed from main.js, prefixed with module name
    this.mqttClient.subscribe(topic, (err) => {
      if (err) {
        this.logger.error(this.moduleName, `Subscription error for ${topic}: ${err.message}`);
      } else {
        if (this.debug) this.logger.debug(this.moduleName, `Subscribed to ${topic}`);
        if (this.initialLoadTimeout) clearTimeout(this.initialLoadTimeout);
        this.initialLoadTimeout = setTimeout(() => this.processReceivedPrices(true), 2000);
      }
    });

    this.mqttClient.on('message', (msgTopic, message) => {
      if (msgTopic.startsWith(this.priceTopic)) {
        if (this.debug) this.logger.debug(this.moduleName, `Received MQTT message on ${msgTopic}`);

        // Pass the module's logger instance to parseJsonSafely
        const result = parseJsonSafely(message, this.logger);

        if (!result.error && result.data && result.data.priceDate && Array.isArray(result.data.hourly)) {
          const existingIndex = this.twoDaysData.findIndex((d) => d.priceDate === result.data.priceDate);
          if (existingIndex !== -1) {
            this.twoDaysData[existingIndex] = result.data;
            if (this.debug) this.logger.debug(this.moduleName, `Updated price data for date: ${result.data.priceDate}`);
          } else {
            this.twoDaysData.push(result.data);
            if (this.debug) this.logger.debug(this.moduleName, `Added new price data for date: ${result.data.priceDate}`);
          }

          if (this.priceUpdateTimeout) clearTimeout(this.priceUpdateTimeout);
          this.priceUpdateTimeout = setTimeout(() => this.processReceivedPrices(true), 500);
        } else {
          const detailMessage = result && result.message ? result.message : result && result.error ? String(result.error) : 'Unknown parsing error';
          this.logger.error(this.moduleName, `Error processing price message for topic ${msgTopic}. Details: ${detailMessage}`);
        }
      }
    });
  }

  processReceivedPrices(emitUpdate = false) {
    // Added emitUpdate flag
    if (this.debug) this.logger.debug(this.moduleName, `Starting processReceivedPrices. twoDaysData has ${this.twoDaysData.length} items.`);

    // Store current state for comparison later to see if an update should be emitted
    const oldStateSignature = this.debug ? JSON.stringify({ d: this.dayPrices.priceDate, n: this.nextDayPrices.priceDate }) : null;

    if (this.twoDaysData.length === 0) {
      if (this.debug) this.logger.debug(this.moduleName, 'No data in twoDaysData to process.');
      if (this.initialLoadTimeout) clearTimeout(this.initialLoadTimeout);
      this.initialLoadTimeout = setTimeout(() => this.processReceivedPrices(false), 5000); // Don't emit on these retries unless data actually changes
      return;
    }

    this.twoDaysData.sort((a, b) => new Date(a.priceDate) - new Date(b.priceDate));

    const uniquePriceData = [];
    const seenDates = new Set();
    for (let i = this.twoDaysData.length - 1; i >= 0; i--) {
      if (this.twoDaysData[i] && this.twoDaysData[i].priceDate) {
        if (!seenDates.has(this.twoDaysData[i].priceDate)) {
          uniquePriceData.unshift(this.twoDaysData[i]);
          seenDates.add(this.twoDaysData[i].priceDate);
        }
      }
    }
    this.twoDaysData = uniquePriceData;

    if (this.twoDaysData.length > 2) {
      this.twoDaysData = this.twoDaysData.slice(this.twoDaysData.length - 2);
    }

    if (this.debug) this.logger.debug(this.moduleName, `Filtered twoDaysData (max 2 latest distinct days): ${JSON.stringify(this.twoDaysData.map((d) => d.priceDate))}`);

    const todayStr = skewDays(0);
    const yesterdayStr = skewDays(-1);
    const tomorrowStr = skewDays(1);

    this.dayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.prevDayPrices = { priceDate: null, hourly: [], daily: {} };
    this.nextDayAvailable = false;

    if (this.twoDaysData.length === 0) {
      if (this.debug) this.logger.warn(this.moduleName, 'No valid price data remains after filtering.');
      // emitUpdate is false here typically, but if state changed from having data to no data, an event might be desired.
      // For now, only emit if processing leads to actual day/nextDay assignments.
      return;
    }

    let assignedSomething = false;
    this.twoDaysData.forEach((data) => {
      if (!data || !data.priceDate) {
        if (this.debug) this.logger.warn(this.moduleName, 'Skipping invalid data entry in twoDaysData.');
        return;
      }
      const dataDate = data.priceDate;
      if (dataDate === todayStr) {
        this.dayPrices = { ...data, hourly: data.hourly || [], daily: data.daily || {} };
        assignedSomething = true;
        if (this.debug) this.logger.debug(this.moduleName, `Assigned data for ${dataDate} to dayPrices.`);
      } else if (dataDate === tomorrowStr) {
        this.nextDayPrices = { ...data, hourly: data.hourly || [], daily: data.daily || {} };
        this.nextDayAvailable = true;
        assignedSomething = true;
        if (this.debug) this.logger.debug(this.moduleName, `Assigned data for ${dataDate} to nextDayPrices.`);
      } else if (dataDate === yesterdayStr) {
        this.prevDayPrices = { ...data, hourly: data.hourly || [], daily: data.daily || {} };
        // assignedSomething for prevDay doesn't necessarily mean a core state change for event emission
        if (this.debug) this.logger.debug(this.moduleName, `Assigned data for ${dataDate} to prevDayPrices.`);
      } else {
        if (this.debug) this.logger.warn(this.moduleName, `Data for ${dataDate} in twoDaysData does not match today, tomorrow, or yesterday.`);
      }
    });

    if (!this.dayPrices.priceDate) {
      if (this.debug) this.logger.warn(this.moduleName, `Today's (${todayStr}) price data is not available in twoDaysData. dayPrices will be empty.`);
    }

    if (this.debug) {
      this.logger.debug(this.moduleName, `Processed prices. Today: ${todayStr}`);
      this.logger.debug(this.moduleName, `  dayPrices: ${this.dayPrices.priceDate || 'None'}`);
      this.logger.debug(this.moduleName, `  nextDayPrices: ${this.nextDayPrices.priceDate || 'None'}, Available: ${this.nextDayAvailable}`);
      this.logger.debug(this.moduleName, `  prevDayPrices: ${this.prevDayPrices.priceDate || 'None'}`);
    }

    // Emit event if flag is true and there was some assignment or state potentially changed
    // More robust: check if oldStateSignature changed from newStateSignature
    const newStateSignature = this.debug ? JSON.stringify({ d: this.dayPrices.priceDate, n: this.nextDayPrices.priceDate }) : null;
    let actuallyChanged = true; // Assume changed if emitUpdate is true, unless we do signature checking
    if (this.debug && oldStateSignature !== null && newStateSignature !== null) {
      actuallyChanged = oldStateSignature !== newStateSignature;
    }

    if (emitUpdate && (assignedSomething || actuallyChanged)) {
      // Emit if explicitly told to AND something was assigned or state changed
      this.eventBus.emit('prices:updated', {
        currentDay: { ...this.dayPrices }, // Send copies
        nextDay: { ...this.nextDayPrices },
        prevDay: { ...this.prevDayPrices },
        nextDayAvailable: this.nextDayAvailable,
        currentPriceDate: this.getCurrentPriceDate(), // Use getters for consistency
        nextPriceDate: this.getNextPriceDate(),
        previousPriceDate: this.getPreviousPriceDate(),
      });
      if (this.debug) this.logger.debug(this.moduleName, 'Emitted prices:updated event.');
    } else if (emitUpdate && this.debug) {
      this.logger.debug(this.moduleName, 'Skipped emitting prices:updated event as no core data changed or nothing assigned.');
    }
  }

  _scheduleDailyRollover() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 1, 0, 0); // 00:01:00 AM

    const msToMidnight = tomorrow.getTime() - now.getTime();
    if (this.debug) this.logger.debug(this.moduleName, `Midnight rollover scheduled in ${msToMidnight / 1000 / 60} minutes.`);

    setTimeout(() => {
      if (this.debug) this.logger.debug(this.moduleName, 'Performing scheduled daily rollover check.');
      this.performMidnightRollover();
      this._scheduleDailyRollover();
    }, msToMidnight);
  }

  performMidnightRollover() {
    const newTodayStr = skewDays(0);
    if (this.debug) this.logger.debug(this.moduleName, `Midnight Rollover: Running for new date ${newTodayStr}. Triggering price processing.`);

    // Pass true to ensure event is emitted after rollover processing
    this.processReceivedPrices(true);

    if (this.debug) {
      this.logger.debug(this.moduleName, `Midnight Rollover: Price processing complete for ${newTodayStr}.`);
      // Logging of new state already happens in processReceivedPrices
    }
  }

  // --- Public Getter Methods (remain the same) ---
  getHourlyData(hourIndex, targetDay = 'current') {
    if (hourIndex < 0 || hourIndex > 23) return null;
    let source;
    if (targetDay === 'current') source = this.dayPrices;
    else if (targetDay === 'next' && this.nextDayAvailable) source = this.nextDayPrices;
    else if (targetDay === 'previous') source = this.prevDayPrices;
    else return null;
    if (source && source.hourly && source.hourly[hourIndex]) return source.hourly[hourIndex];
    if (this.debug && source && source.priceDate) this.logger.warn(this.moduleName, `No hourly data for ${targetDay} day ${source.priceDate} at hour ${hourIndex}.`);
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

module.exports = PriceServiceModule;
