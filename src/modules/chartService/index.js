// src/modules/chartService/index.js
const fs = require('fs');
const path = require('path');
const MQTTClient = require('../../../mqtt/mqtt'); // Adjusted path based on user feedback for priceService

// Helper function: skewDays (can be moved to core/utils.js later)
async function skewDays(days, baseDateInput = null, loggerForUtil) {
  const oneDay = 86400000;
  let baseTime;
  if (baseDateInput) {
    const parsedBaseDate = new Date(baseDateInput);
    if (!isNaN(parsedBaseDate.getTime())) {
      baseTime = parsedBaseDate.getTime();
    } else {
      if (loggerForUtil) loggerForUtil.warn('ChartServiceModule:skewDays', `Invalid baseDateInput: ${baseDateInput}. Falling back to Date.now().`);
      baseTime = Date.now();
    }
  } else {
    baseTime = Date.now();
  }
  const date = new Date(baseTime + oneDay * days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Helper function: getDateString (can be moved to core/utils.js later)
function getDateString(dateTime, loggerForUtil) {
  try {
    const now = new Date(dateTime);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch (e) {
    if (loggerForUtil) loggerForUtil.error('ChartServiceModule:getDateString', `Error formatting date: ${dateTime}`, e);
    // Fallback to current date string if error
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

class ChartServiceModule {
  constructor(moduleConfig, mainLogger, eventBusInstance) {
    this.config = moduleConfig; // Expects serverConfig properties + chart specific ones
    this.logger = mainLogger;
    this.eventBus = eventBusInstance;
    this.moduleName = 'ChartServiceModule';

    // Stored price data from PriceServiceModule events
    this.latestPriceData = {
      currentDay: { priceDate: null, hourly: [], daily: {} },
      nextDay: { priceDate: null, hourly: [], daily: {} },
      prevDay: { priceDate: null, hourly: [], daily: {} },
      nextDayAvailable: false,
      currentPriceDate: null,
      nextPriceDate: null,
      previousPriceDate: null,
    };

    this.chartData = [];
    this.offsetFactors = [];
    this.leftAvgOffsetFactor = 0;
    this.rightAvgOffsetFactor = 0;
    this.maxPrice = 0;
    this.isOnRightSide = false; // To track which part of the 2-day data is current
    this.currentDate = getDateString(new Date(), this.logger);
    this.currentHour = new Date().getHours();
    this.dataAvailable = false;
    this.timezoneOffset = -new Date().getTimezoneOffset() / 60;

    this.savePath = this.config.savePath || './data'; // From main serverConfig section
    this.saveFile = path.join(this.savePath, 'thresholds.json');

    // Chart behavior config
    this.fixedOffset = this.config.fixedAverageOffset || 0;
    this.stepFactor = this.config.adjustmentStepFactor || 1;
    this.verticalStepCount = this.config.verticalStepCount || 50;

    this.pubOpts = { retain: true, qos: 0 };
    this.statTopic = `${this.config.haBaseTopic || 'elwiz'}/chart`; // For publishing own status via MQTT
    this.chartAdjustmentTopic = this.config.chartTopic || 'elwiz/chart'; // For listening to adjustments

    // MQTT Client for chart adjustments
    const mqttUrl = this.config.mqttUrl || (this.config.mqtt && this.config.mqtt.url) || 'mqtt://localhost:1883';
    const mqttOpts = this.config.mqttOptions || (this.config.mqtt && this.config.mqtt.options) || {};
    const clientName = (this.config.mqtt && this.config.mqtt.clientName) || 'ElWiz_ChartServiceModule_Client';

    const mqttLogger = {
      debug: (message, ...args) => this.logger.debug(clientName, message, ...args),
      info: (message, ...args) => this.logger.info(clientName, message, ...args),
      warn: (message, ...args) => this.logger.warn(clientName, message, ...args),
      error: (message, ...args) => this.logger.error(clientName, message, ...args),
    };
    this.mqttClient = new MQTTClient(mqttUrl, mqttOpts, clientName, mqttLogger);

    this.logger.info(this.moduleName, 'Initialized.');
  }

  async start() {
    this.logger.info(this.moduleName, 'Starting...');
    await this.initializeOffsets(); // Load initial offsets
    this._setupEventListeners();
    this._connectMqttAndSubscribeAdjustments();
    // Initial chart data processing if there's any stale price data (e.g. from a quick restart)
    // Or rely on PriceService to emit soon after it starts.
    // For now, let's make it process once with potentially empty this.latestPriceData
    // This will ensure chartData is initialized to empty array if no prices yet.
    this._updateChartDataFromPrices(this.latestPriceData, true);
    this.logger.info(this.moduleName, 'Started and subscribed to prices:updated events.');
  }

  _setupEventListeners() {
    this.eventBus.on('prices:updated', (priceEventData) => {
      this.logger.info(this.moduleName, `Received 'prices:updated' event for date: ${priceEventData.currentPriceDate || 'N/A'}`);
      this.latestPriceData = priceEventData; // Store the latest full price data
      this._updateChartDataFromPrices(priceEventData, true); // Process it and allow event emission
    });
  }

  _connectMqttAndSubscribeAdjustments() {
    this.mqttClient.on('connect', () => {
      this.logger.info(this.moduleName, 'MQTT client for adjustments connected.');
      this._subscribeToChartAdjustmentTopic();
    });
    if (this.mqttClient.connected) {
      this.logger.info(this.moduleName, 'MQTT client for adjustments was already connected.');
      this._subscribeToChartAdjustmentTopic();
    }
  }

  _subscribeToChartAdjustmentTopic() {
    this.mqttClient.subscribe(`${this.chartAdjustmentTopic}/#`, (err) => {
      if (err) {
        this.logger.error(this.moduleName, `Subscription error for ${this.chartAdjustmentTopic}/#: ${err.message}`);
      } else {
        if (this.config.debug || false) this.logger.debug(this.moduleName, `Subscribed to ${this.chartAdjustmentTopic}/# for chart adjustments.`);
      }
    });

    this.mqttClient.on('message', (topic, message) => {
      if (topic.startsWith(this.chartAdjustmentTopic)) {
        if (this.config.debug || false) this.logger.debug(this.moduleName, `Received MQTT adjustment on ${topic}`);
        this._processMqttChartAdjustment(topic, message);
      }
    });
  }

  async initializeOffsets() {
    this.offsetFactors = await this._getOffsets(); // Renamed to avoid conflict if skewDays is also here
    this.logger.info(this.moduleName, `Thresholds initialized: ${JSON.stringify(this.offsetFactors)}`);
    if (this.offsetFactors && this.offsetFactors.length > 0 && this.offsetFactors[0]) {
      this.leftAvgOffsetFactor = this.offsetFactors[0].threshold;
      if (this.offsetFactors.length > 1 && this.offsetFactors[1]) {
        this.rightAvgOffsetFactor = this.offsetFactors[1].threshold;
      } else if (this.offsetFactors.length > 0) {
        // if only one factor, right is same as left
        this.rightAvgOffsetFactor = this.offsetFactors[0].threshold;
      }
    }
  }

  // Main data processing logic, now triggered by price events
  async _updateChartDataFromPrices(priceEventData, emitChartUpdate = false) {
    if (!priceEventData) {
      this.logger.warn(this.moduleName, 'Price event data not available to refresh chart data.');
      return false;
    }

    let day1 = { priceDate: null, hourly: [], daily: {} }; // Represents the first day to display
    let day2 = { priceDate: null, hourly: [], daily: {} }; // Represents the second day to display

    const pdCurrent = priceEventData.currentDay;
    const pdNext = priceEventData.nextDay;
    const pdPrev = priceEventData.prevDay;
    const nextDayAvail = priceEventData.nextDayAvailable;

    const hasContent = (dayObj) => dayObj && dayObj.priceDate && Array.isArray(dayObj.hourly) && dayObj.hourly.length > 0;

    if (nextDayAvail && hasContent(pdNext) && hasContent(pdCurrent)) {
      day1 = { ...pdCurrent, daily: pdCurrent.daily || {} };
      day2 = { ...pdNext, daily: pdNext.daily || {} };
      this.logger.info(this.moduleName, 'Chart data source: CURRENT day and NEXT day.');
    } else if (hasContent(pdCurrent) && hasContent(pdPrev)) {
      day1 = { ...pdPrev, daily: pdPrev.daily || {} };
      day2 = { ...pdCurrent, daily: pdCurrent.daily || {} };
      this.logger.info(this.moduleName, 'Chart data source: PREVIOUS day and CURRENT day.');
    } else if (hasContent(pdCurrent)) {
      day1 = { ...pdCurrent, daily: pdCurrent.daily || {} }; // Will be displayed as a single 24h day
      // day2 remains empty
      this.logger.info(this.moduleName, 'Chart data source: Only CURRENT day available.');
    } else {
      this.logger.info(this.moduleName, 'Chart data source: Not enough data for display (no current day).');
    }

    // Update summaries used by _recalculateMaxPrice
    this.currentDaySummaryForChart = day1.daily || {}; // Corresponds to first displayed day
    this.nextDaySummaryForChart = day2.daily || {}; // Corresponds to second displayed day

    // Update offsetFactors based on the dates of the days actually chosen for display
    await this._updateOffsetFactors(day1.priceDate, day2.priceDate);

    let newCombinedData = [];
    let processedSomething = false;

    if (day1.priceDate && day1.hourly.length > 0) {
      // offsetFactors[0] should now correspond to day1.priceDate due to _updateOffsetFactors call
      const day1OffsetVal = this.offsetFactors[0] ? this.offsetFactors[0].threshold : 0;
      this._buildChartEntriesForDay(day1.hourly, day1OffsetVal, newCombinedData, day1.priceDate, day1.daily);
      processedSomething = true;
    }

    if (day2.priceDate && day2.hourly.length > 0) {
      // offsetFactors[1] should now correspond to day2.priceDate
      const day2OffsetVal = this.offsetFactors[1] ? this.offsetFactors[1].threshold : 0;
      this._buildChartEntriesForDay(day2.hourly, day2OffsetVal, newCombinedData, day2.priceDate, day2.daily);
      processedSomething = true;
    }

    if (processedSomething) {
      this.chartData = newCombinedData.sort((a, b) => new Date(a.startTime) - new Date(b.startTime)).slice(-48);
      this.dataAvailable = this.chartData.length > 0;
      this._recalculateMaxPrice();
      if (this.config.debug) this.logger.debug(this.moduleName, `Chart data refreshed. Total entries: ${this.chartData.length}. Data available: ${this.dataAvailable}`);
    } else {
      // This path taken if neither day1 nor day2 had data
      const chartHadData = this.chartData.length > 0;
      this.chartData = [];
      this.dataAvailable = false;
      if (chartHadData) this._recalculateMaxPrice(); // Recalculate maxPrice (likely to 0) only if it changed
      if (this.config.debug && chartHadData) this.logger.info(this.moduleName, 'No valid price data processed from event; chart data cleared.');
    }

    const chartContentChanged = this._checkAndSendChartDataInternal();
    if (emitChartUpdate && chartContentChanged) {
      this.eventBus.emit('chart:dataUpdated', this.getChartDataForClient());
      if (this.config.debug) this.logger.debug(this.moduleName, 'Emitted chart:dataUpdated event.');
    }
    return chartContentChanged;
  }

  // Renamed from _updateInternalChartData, now uses passed dailySummary
  _buildChartEntriesForDay(hourlyPrices, adjustmentFactor, targetArray, priceDate, dailySummary) {
    if (!hourlyPrices || hourlyPrices.length === 0) return;

    const avgPrice = dailySummary.avgPrice;

    if (avgPrice === undefined || avgPrice === null) {
      if (this.config.debug) this.logger.warn(this.moduleName, `Average price is undefined for ${priceDate}. Cannot calculate thresholds accurately.`);
    }

    const fixed = (this.maxPrice / this.verticalStepCount) * this.fixedOffset;
    const adjustVal = (this.maxPrice / this.verticalStepCount) * adjustmentFactor;
    const thresholdLevel = avgPrice === undefined || avgPrice === null ? 0 : adjustmentFactor === 0 ? parseFloat((avgPrice + fixed).toFixed(4)) : parseFloat((avgPrice + fixed + adjustVal).toFixed(4));

    hourlyPrices.forEach((h) => {
      targetArray.push({
        startTime: h.startTime,
        spotPrice: h.spotPrice,
        avgPrice: avgPrice,
        thresholdLevel: thresholdLevel,
        isBelowThreshold: h.spotPrice < thresholdLevel ? 1 : 0,
      });
    });
  }

  // Renamed from recalculateMaxPrice
  _recalculateMaxPrice() {
    if (this.chartData.length > 0) {
      this.maxPrice = this.chartData.reduce((max, p) => (p.spotPrice > max ? p.spotPrice : max), 0);
    } else {
      // Use summaries from the latest price event if chartData is empty
      const currentDayMax = this.currentDaySummaryForChart.maxPrice || 0;
      const nextDayMax = this.nextDaySummaryForChart.maxPrice || 0;
      this.maxPrice = Math.max(currentDayMax, nextDayMax, 0);
    }
    if (this.config.debug) this.logger.debug(this.moduleName, `Recalculated maxPrice for chart thresholds: ${this.maxPrice}`);
  }

  async _updateOffsetFactors(psCurrentDate, psNextDate) {
    // Logic from previous version of ChartDataService.refreshChartDataFromPriceService to update offsetFactors
    // Ensure skewDays and getDateString use the module's logger or are pure
    let newFactor0 = {
      date: psCurrentDate || (await skewDays(0, null, this.logger)),
      threshold: 0,
    };
    let newFactor1 = {
      date: psNextDate || (await skewDays(1, newFactor0.date, this.logger)),
      threshold: 0,
    };

    const oldFactor0Date = this.offsetFactors[0] ? this.offsetFactors[0].date : null;
    const oldFactor0Threshold = this.offsetFactors[0] ? this.offsetFactors[0].threshold : 0;
    const oldFactor1Date = this.offsetFactors[1] ? this.offsetFactors[1].date : null;
    const oldFactor1Threshold = this.offsetFactors[1] ? this.offsetFactors[1].threshold : 0;

    if (oldFactor0Date === newFactor0.date) newFactor0.threshold = oldFactor0Threshold;
    else if (oldFactor1Date === newFactor0.date) newFactor0.threshold = oldFactor1Threshold;

    if (oldFactor1Date === newFactor1.date) newFactor1.threshold = oldFactor1Threshold;
    else if (oldFactor0Date === newFactor1.date) newFactor1.threshold = oldFactor0Threshold;

    if (newFactor0.date && newFactor0.date === newFactor1.date) {
      if (this.config.debug) this.logger.warn(this.moduleName, `newFactor0.date and newFactor1.date are identical (${newFactor0.date}). Adjusting newFactor1.date.`);
      newFactor1.date = await skewDays(1, new Date(newFactor0.date), this.logger);
      newFactor1.threshold = 0;
      if (oldFactor1Date === newFactor1.date) newFactor1.threshold = oldFactor1Threshold;
      else if (oldFactor0Date === newFactor1.date) newFactor1.threshold = oldFactor0Threshold;
    }

    const newOffsetFactors = [newFactor0, newFactor1];
    if (JSON.stringify(this.offsetFactors) !== JSON.stringify(newOffsetFactors)) {
      this.offsetFactors = newOffsetFactors;
      this._saveOffsets(); // Call internal save
    }

    this.leftAvgOffsetFactor = this.offsetFactors[0] ? this.offsetFactors[0].threshold : 0;
    this.rightAvgOffsetFactor = this.offsetFactors[1] ? this.offsetFactors[1].threshold : 0;

    const today = getDateString(new Date(), this.logger);
    this.isOnRightSide = this.chartData.length > 0 && this.chartData[0].startTime.slice(0, 10) !== today;
  }

  async _getOffsets() {
    // Uses module's skewDays and logger now
    let initialOffsets = [
      { date: await skewDays(0, null, this.logger), threshold: 0 }, // Default to today
      { date: await skewDays(1, null, this.logger), threshold: 0 }, // Default to tomorrow
    ];
    // Adjust initialOffsets to yesterday and today to match old behavior if desired,
    // but current day and next day might be more logical starting points.
    // For now, using today and tomorrow as default for a fresh setup.
    // The _updateOffsetFactors will align with actual price data dates from PriceService events.

    if (!fs.existsSync(this.savePath)) {
      try {
        fs.mkdirSync(this.savePath, { recursive: true });
      } catch (e) {
        this.logger.error(this.moduleName, `Error creating savePath ${this.savePath}`, e);
        return initialOffsets;
      }
    }
    if (!fs.existsSync(this.saveFile)) {
      try {
        fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
      } catch (e) {
        this.logger.error(this.moduleName, `Error writing initial offsets to ${this.saveFile}`, e);
      }
      return initialOffsets;
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.saveFile));
      if (Array.isArray(data) && data.length > 0 && data.every((item) => typeof item === 'object' && 'date' in item && 'threshold' in item)) {
        // Ensure it always returns an array of 2, even if file has 1 or more than 2
        if (data.length === 1) {
          const otherDate = data[0].date === (await skewDays(0, null, this.logger)) ? await skewDays(1, null, this.logger) : await skewDays(0, null, this.logger);
          return [data[0], { date: otherDate, threshold: 0 }];
        }
        return data.slice(0, 2); // Take the first two if more exist
      } else {
        this.logger.warn(this.moduleName, `Invalid data structure in ${this.saveFile}. Reinitializing.`);
        fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
        return initialOffsets;
      }
    } catch (error) {
      this.logger.error(this.moduleName, `Error reading ${this.saveFile}: ${error}. Reinitializing.`);
      fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
      return initialOffsets;
    }
  }

  _saveOffsets(where) {
    // `where` parameter removed for now, can be added if needed for logging
    try {
      fs.writeFileSync(this.saveFile, JSON.stringify(this.offsetFactors));
      if (this.config.debug) this.logger.debug(this.moduleName, `Offset factors saved: ${JSON.stringify(this.offsetFactors)}` + (where ? ` from ${where}` : ''));
    } catch (error) {
      this.logger.error(this.moduleName, `Error saving offset factors to ${this.saveFile}: ${error}`);
    }
  }

  // Direct MQTT chart adjustments processing
  async _processMqttChartAdjustment(topic, messagePayload) {
    const topicParts = topic.split('/');
    const adjustmentType = topicParts[topicParts.length - 1];
    let chartDataActuallyModified = false;

    // Get current dates from our stored price data
    const currentPriceDate = this.latestPriceData.currentPriceDate;
    const nextPriceDate = this.latestPriceData.nextPriceDate;

    let targetIndex = -1;

    if (adjustmentType === 'adjustLeftAvgOffset') {
      targetIndex = this.offsetFactors[0] && this.offsetFactors[0].date === currentPriceDate ? 0 : this.offsetFactors[1] && this.offsetFactors[1].date === currentPriceDate ? 1 : 0; // Default to 0 if no match
    } else if (adjustmentType === 'adjustRightAvgOffset') {
      targetIndex = this.offsetFactors[1] && this.offsetFactors[1].date === nextPriceDate ? 1 : this.offsetFactors[0] && this.offsetFactors[0].date === nextPriceDate ? 0 : 1; // Default to 1 if no match
    }

    if (targetIndex !== -1 && this.offsetFactors[targetIndex]) {
      const parsed = parseFloat(messagePayload.toString());
      this.offsetFactors[targetIndex].threshold = parsed === 0 ? 0 : (this.offsetFactors[targetIndex].threshold || 0) + parsed * this.stepFactor;

      if (targetIndex === 0) this.leftAvgOffsetFactor = this.offsetFactors[targetIndex].threshold;
      if (targetIndex === 1) this.rightAvgOffsetFactor = this.offsetFactors[targetIndex].threshold;

      this._saveOffsets(`_processMqttChartAdjustment for ${adjustmentType}`);

      // Re-process chart data with new offsets, but don't emit chart:dataUpdated from here directly.
      // Let the return value signal if a wider update is needed.
      // The data source (this.latestPriceData) hasn't changed, only the offsets.
      // We need to rebuild chartData with new threshold levels.
      chartDataActuallyModified = await this._updateChartDataFromPrices(this.latestPriceData, false); // Pass false to prevent double emission initially

      if (chartDataActuallyModified) {
        // If content truly changed
        this.eventBus.emit('chart:dataUpdated', this.getChartDataForClient());
        if (this.config.debug) this.logger.debug(this.moduleName, `Emitted chart:dataUpdated event after MQTT adjustment.`);
      }
      // Also publish current hour MQTT data as it might have changed
      this.publishData('_processMqttChartAdjustment');
    } else {
      this.logger.warn(this.moduleName, `Could not determine target index for MQTT adjustment: ${adjustmentType} (current: ${currentPriceDate}, next: ${nextPriceDate}, factors: ${JSON.stringify(this.offsetFactors)})`);
    }
  }

  publishData(from) {
    if (!this.mqttClient || !this.mqttClient.connected) {
      this.logger.warn(this.moduleName, 'MQTT client not connected, cannot publish data.');
      return;
    }

    const now = new Date();
    // Use this.currentHour if updated by performHourlyTasks, otherwise fallback to actual current hour
    const hourToPublish = from === 'performHourlyTasks' && typeof this.currentHour === 'number' ? this.currentHour : now.getHours();
    const dateToPublish = from === 'performHourlyTasks' && this.currentDate ? this.currentDate : getDateString(now, this.logger);

    // Find the data point in chartData that corresponds to the hourToPublish on dateToPublish
    // The startTime in chartData is ISO string like "YYYY-MM-DDTHH:MM:SSZ"
    const targetStartTimePrefix = `${dateToPublish}T${String(hourToPublish).padStart(2, '0')}`;

    const dataPointToPublish = this.chartData.find((dp) => dp.startTime.startsWith(targetStartTimePrefix));

    if (!dataPointToPublish) {
      if (this.config.debug) this.logger.debug(this.moduleName, `publishData (from ${from}): No dataPoint in chartData for ${targetStartTimePrefix}`);
      return;
    }

    if (this.config.debug) this.logger.debug(this.moduleName, `publishData (from ${from}): Publishing for ${dataPointToPublish.startTime}`);

    const payload = {
      spotPrice: dataPointToPublish.spotPrice,
      avgPrice: dataPointToPublish.avgPrice,
      thresholdLevel: dataPointToPublish.thresholdLevel,
      isBelowThreshold: dataPointToPublish.isBelowThreshold,
      startTime: dataPointToPublish.startTime,
      source: this.moduleName,
    };

    try {
      this.mqttClient.publish(`${this.statTopic}/spotPrice`, String(payload.spotPrice), this.pubOpts);
      this.mqttClient.publish(`${this.statTopic}/avgPrice`, String(payload.avgPrice), this.pubOpts);
      this.mqttClient.publish(`${this.statTopic}/thresholdLevel`, String(payload.thresholdLevel), this.pubOpts);
      this.mqttClient.publish(`${this.statTopic}/spotBelowThreshold`, String(payload.isBelowThreshold), this.pubOpts);

      // Emit event for other modules (e.g. publishing service)
      this.eventBus.emit('chart:currentHourInfo', payload);
      if (this.config.debug) this.logger.debug(this.moduleName, 'Emitted chart:currentHourInfo event.', payload);
    } catch (err) {
      this.logger.error(this.moduleName, `Publishing failed: ${err}`);
    }
  }

  // Internal checker, renamed to avoid conflict with the IIFE pattern if we copy that exactly
  _checkAndSendChartDataInternal() {
    if (!this.chartData || this.chartData.length === 0) {
      if (this.config.debug) this.logger.debug(this.moduleName, '_checkAndSendChartDataInternal: No chart data available.');
      // If chartData became empty, it's a change from its previous state if it had data.
      // This needs a more robust way to store "last known signature" even if empty.
      // For now, if it's empty, assume it might have changed from non-empty.
      const changed = this._lastChartDataSignature !== '[]';
      this._lastChartDataSignature = '[]';
      return changed;
    }

    const currentSignature = JSON.stringify(this.chartData.map((d) => ({ sT: d.startTime, sP: d.spotPrice, tL: d.thresholdLevel, iBT: d.isBelowThreshold })));

    if (currentSignature !== this._lastChartDataSignature) {
      this._lastChartDataSignature = currentSignature;
      if (this.config.debug) this.logger.debug(this.moduleName, 'Chart data has changed, update should be sent to clients.');
      return true;
    } else {
      if (this.config.debug) this.logger.debug(this.moduleName, 'No change in relevant chart data to send to clients.');
      return false;
    }
  }

  async performHourlyTasks() {
    if (this.config.debug) this.logger.debug(this.moduleName, 'Hourly tasks invoked...');

    this.timezoneOffset = -new Date().getTimezoneOffset() / 60;
    this.currentDate = getDateString(new Date(), this.logger);
    this.currentHour = new Date().getHours();
    this.logger.info(this.moduleName, `Hourly task: Current hour updated to ${this.currentHour} for date ${this.currentDate}`);

    // Refresh chart data using the latest stored price data.
    // Pass 'true' to allow event emission if chart data changes.
    const chartContentChanged = await this._updateChartDataFromPrices(this.latestPriceData, true);

    // Publish current hour's data via MQTT and event
    this.publishData('performHourlyTasks');

    if (this.config.debug) this.logger.debug(this.moduleName, `Hourly tasks completed. Chart content changed: ${chartContentChanged}`);
    // The return value for server.js's hourly task runner should indicate if websockets need to update.
    // This is now handled by chart:dataUpdated event.
    // However, if server.js still uses a return value, chartContentChanged is appropriate.
    return chartContentChanged;
  }

  getChartDataForClient() {
    return this.chartData;
  }

  getOffsetFactors() {
    return this.offsetFactors;
  }

  getTimezoneOffset() {
    return this.timezoneOffset;
  }
}

module.exports = ChartServiceModule;
