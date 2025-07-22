const fs = require('fs');
const path = require('path'); // For saveFile path construction

class ChartDataService {
  constructor(config, mqttClient, priceService, webSocketServer, logger = console) {
    this.config = config;
    this.mqttClient = mqttClient;
    this.priceService = priceService;
    this.webSocketServer = webSocketServer; // Add webSocketServer
    this.logger = logger;

    this.chartData = [];
    this.offsetFactors = [];
    this.leftAvgOffsetFactor = 0;
    this.rightAvgOffsetFactor = 0;
    this.maxPrice = 0;
    this.isOnRightSide = false;
    this.currentDate = this.getDateString(new Date());
    this.currentHour = new Date().getHours();
    this.dataAvailable = false;

    this.savePath = this.config.savePath || './data';
    this.saveFile = path.join(this.savePath, 'thresholds.json');

    this.fixedOffset = this.config.fixedAverageOffset || 0;
    this.stepFactor = this.config.adjustmentStepFactor || 1;
    this.verticalStepCount = this.config.verticalStepCount || 50;
    this.pubOpts = { retain: true, qos: 0 };

    this.statTopic = `${this.config.haBaseTopic || 'elwiz'}/chart`;

    this.initializeOffsets();
    this.refreshChartDataFromPriceService();

    // Publish initial chart data after a delay to ensure priceService has data
    setTimeout(() => {
      if (this.chartData && this.chartData.length > 0) {
        this.publishData(0, 'startup');
        this.logger.info('[ChartDataService] Initial chart data published on startup.');
      } else {
        this.logger.warn('[ChartDataService] No chart data available to publish on startup after delay.');
      }
    }, 5000); // 5 second delay
  }

  async initializeOffsets() {
    this.offsetFactors = await this.getOffsets();
    this.logger.info('[ChartDataService] Thresholds initialized: ' + JSON.stringify(this.offsetFactors));
    if (this.offsetFactors && this.offsetFactors.length > 0) {
      this.leftAvgOffsetFactor = this.offsetFactors[0].threshold;
      if (this.offsetFactors.length > 1) {
        this.rightAvgOffsetFactor = this.offsetFactors[1].threshold;
      }
    }
  }

  async refreshChartDataFromPriceService() {
    if (!this.priceService) {
      this.logger.warn('[ChartDataService] PriceService not available to refresh chart data.');
      return false;
    }

    let newCombinedData = [];
    let processedSomething = false;

    if (this.priceService.isNextDayAvailable()) {
      const todayHourly = this.priceService.getCurrentDayHourlyArray();
      const nextDayHourly = this.priceService.getNextDayHourlyArray();
      const currentPriceDate = this.priceService.getCurrentPriceDate();
      const nextPriceDate = this.priceService.getNextPriceDate();

      if (currentPriceDate && todayHourly && todayHourly.length > 0) {
        const currentDayOffsetFactor = this.offsetFactors[0] && this.offsetFactors[0].date === currentPriceDate ? this.offsetFactors[0].threshold : this.leftAvgOffsetFactor;
        this._updateInternalChartData(todayHourly, currentDayOffsetFactor, newCombinedData, currentPriceDate);
        processedSomething = true;
      }

      if (nextPriceDate && nextDayHourly && nextDayHourly.length > 0) {
        const nextDayOffsetFactor = this.offsetFactors[1] && this.offsetFactors[1].date === nextPriceDate ? this.offsetFactors[1].threshold : this.rightAvgOffsetFactor;
        this._updateInternalChartData(nextDayHourly, nextDayOffsetFactor, newCombinedData, nextPriceDate);
        processedSomething = true;
      }
    } else {
      const prevDayHourly = this.priceService.getPreviousDayHourlyArray();
      const todayHourly = this.priceService.getCurrentDayHourlyArray();
      const prevPriceDate = this.priceService.getPreviousPriceDate();
      const currentPriceDate = this.priceService.getCurrentPriceDate();

      if (prevPriceDate && prevDayHourly && prevDayHourly.length > 0) {
        const prevDayOffsetFactor = this.offsetFactors[0] && this.offsetFactors[0].date === prevPriceDate ? this.offsetFactors[0].threshold : this.leftAvgOffsetFactor;
        this._updateInternalChartData(prevDayHourly, prevDayOffsetFactor, newCombinedData, prevPriceDate);
        processedSomething = true;
      }

      if (currentPriceDate && todayHourly && todayHourly.length > 0) {
        const currentDayOffsetFactor = this.offsetFactors[1] && this.offsetFactors[1].date === currentPriceDate ? this.offsetFactors[1].threshold : this.rightAvgOffsetFactor;
        this._updateInternalChartData(todayHourly, currentDayOffsetFactor, newCombinedData, currentPriceDate);
        processedSomething = true;
      }
    }

    if (processedSomething) {
      this.chartData = newCombinedData.sort((a, b) => new Date(a.startTime) - new Date(b.startTime)).slice(-48);
      this.dataAvailable = this.chartData.length > 0;
      this.recalculateMaxPrice();
      if (this.config.debug) {
        this.logger.info(`[ChartDataService] Chart data refreshed. Total entries: ${this.chartData.length}. Data available: ${this.dataAvailable}`);
      }
    }

    const psCurrentDate = this.priceService.getCurrentPriceDate();
    const psNextDate = this.priceService.getNextPriceDate();

    let newFactor0 = {
      date: psCurrentDate || (await this.skewDays(0)),
      threshold: 0,
    };
    let newFactor1 = {
      date: psNextDate || (await this.skewDays(1, newFactor0.date)),
      threshold: 0,
    };

    const oldFactor0Date = this.offsetFactors[0] ? this.offsetFactors[0].date : null;
    const oldFactor0Threshold = this.offsetFactors[0] ? this.offsetFactors[0].threshold : 0;
    const oldFactor1Date = this.offsetFactors[1] ? this.offsetFactors[1].date : null;
    const oldFactor1Threshold = this.offsetFactors[1] ? this.offsetFactors[1].threshold : 0;

    if (oldFactor0Date === newFactor0.date) {
      newFactor0.threshold = oldFactor0Threshold;
    } else if (oldFactor1Date === newFactor0.date) {
      newFactor0.threshold = oldFactor1Threshold;
    }

    if (oldFactor1Date === newFactor1.date) {
      newFactor1.threshold = oldFactor1Threshold;
    } else if (oldFactor0Date === newFactor1.date) {
      newFactor1.threshold = oldFactor1Threshold;
    }

    if (newFactor0.date && newFactor0.date === newFactor1.date) {
      if (this.config.debug) {
        this.logger.warn(`[ChartDataService] newFactor0.date and newFactor1.date are identical (${newFactor0.date}). Adjusting newFactor1.date to be distinct.`);
      }
      newFactor1.date = await this.skewDays(1, new Date(newFactor0.date));
      newFactor1.threshold = 0;
      if (oldFactor1Date === newFactor1.date) {
        newFactor1.threshold = oldFactor1Threshold;
      } else if (oldFactor0Date === newFactor1.date) {
        newFactor1.threshold = oldFactor1Threshold;
      }
    }

    const newOffsetFactors = [newFactor0, newFactor1];

    if (JSON.stringify(this.offsetFactors) !== JSON.stringify(newOffsetFactors)) {
      this.offsetFactors = newOffsetFactors;
      try {
        if (!fs.existsSync(this.savePath)) {
          fs.mkdirSync(this.savePath, { recursive: true });
        }
        fs.writeFileSync(this.saveFile, JSON.stringify(this.offsetFactors));
        if (this.config.debug) {
          this.logger.info(`[ChartDataService] Offset factors updated and saved: ${JSON.stringify(this.offsetFactors)}`);
        }
      } catch (error) {
        this.logger.error(`[ChartDataService] Error saving offset factors to ${this.saveFile}: ${error}`);
      }
    }

    this.leftAvgOffsetFactor = this.offsetFactors[0] ? this.offsetFactors[0].threshold : 0;
    this.rightAvgOffsetFactor = this.offsetFactors[1] ? this.offsetFactors[1].threshold : 0;

    const today = this.getDateString(new Date());
    this.isOnRightSide = this.chartData.length > 0 && this.chartData[0].startTime.slice(0, 10) !== today;

    return processedSomething;
  }

  _updateInternalChartData(hourlyPrices, adjustmentFactor, targetArray, priceDate) {
    if (!hourlyPrices || hourlyPrices.length === 0) return;

    const dailySummary =
      priceDate === this.priceService.getCurrentPriceDate()
        ? this.priceService.getCurrentDaySummary()
        : priceDate === this.priceService.getNextPriceDate()
          ? this.priceService.getNextDaySummary()
          : priceDate === this.priceService.getPreviousPriceDate()
            ? this.priceService.getPreviousDaySummary()
            : {};

    const avgPrice = dailySummary.avgPrice;

    if (avgPrice === undefined || avgPrice === null) {
      if (this.config.debug) this.logger.warn(`[ChartDataService] Average price is undefined for ${priceDate}. Cannot calculate thresholds accurately.`);
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

  recalculateMaxPrice() {
    if (this.chartData.length > 0) {
      this.maxPrice = this.chartData.reduce((max, p) => (p.spotPrice > max ? p.spotPrice : max), 0);
    } else {
      const currentDayMax = this.priceService.getCurrentDaySummary().maxPrice || 0;
      const nextDayMax = this.priceService.isNextDayAvailable() ? this.priceService.getNextDaySummary().maxPrice || 0 : 0;
      this.maxPrice = Math.max(currentDayMax, nextDayMax, 0);
    }
    if (this.config.debug) this.logger.info(`[ChartDataService] Recalculated maxPrice for chart thresholds: ${this.maxPrice}`);
  }

  getDateString(dateTime) {
    const now = new Date(dateTime);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  async skewDays(days, baseDateInput = null) {
    const oneDay = 86400000;
    let baseTime;
    if (baseDateInput) {
      const parsedBaseDate = new Date(baseDateInput);
      if (!isNaN(parsedBaseDate.getTime())) {
        baseTime = parsedBaseDate.getTime();
      } else {
        this.logger.warn(`[ChartDataService] Invalid baseDateInput for skewDays: ${baseDateInput}. Falling back to Date.now().`);
        baseTime = Date.now();
      }
    } else {
      baseTime = Date.now();
    }
    const date = new Date(baseTime + oneDay * days);
    return this.getDateString(date);
  }

  async getOffsets() {
    let initialOffsets = [
      { date: await this.skewDays(-1), threshold: 0 },
      { date: await this.skewDays(0), threshold: 0 },
    ];
    if (!fs.existsSync(this.savePath)) {
      fs.mkdirSync(this.savePath, { recursive: true });
      fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
      return initialOffsets;
    } else {
      if (!fs.existsSync(this.saveFile)) {
        fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
        return initialOffsets;
      }
      try {
        const data = JSON.parse(fs.readFileSync(this.saveFile));
        if (Array.isArray(data) && data.length === 2 && data.every((item) => typeof item === 'object' && 'date' in item && 'threshold' in item)) {
          return data;
        } else {
          this.logger.warn(`[ChartDataService] Invalid data structure in ${this.saveFile}. Reinitializing.`);
          fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
          return initialOffsets;
        }
      } catch (error) {
        this.logger.error(`[ChartDataService] Error reading ${this.saveFile}: ${error}. Reinitializing.`);
        fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
        return initialOffsets;
      }
    }
  }

  saveThresholds(idx, threshold, where) {
    if (this.offsetFactors && this.offsetFactors[idx]) {
      this.offsetFactors[idx].threshold = threshold;
      if (this.config.debug) {
        this.logger.info(`[ChartDataService] saveThresholds from ${where}: saved ${JSON.stringify(this.offsetFactors)}`);
      }
      fs.writeFileSync(this.saveFile, JSON.stringify(this.offsetFactors));
    } else {
      this.logger.error(`[ChartDataService] Attempted to save threshold for invalid index ${idx}`);
    }
  }

  _notifyClients() {
    const { chartDataChanged, chartIndexChanged } = this.checkAndSendChartData();

    if (this.config.debug) {
      if (chartDataChanged || chartIndexChanged) {
        this.logger.info(`[ChartDataService] Notifying clients. Data changed: ${chartDataChanged}, Index changed: ${chartIndexChanged}.`);
      }
    }

    if (chartDataChanged) {
      this.webSocketServer.wsSendAll('chart', 'full', {
        chartData: this.chartData,
        currentChartIndex: this._getCurrentChartIndex(),
      });
    } else if (chartIndexChanged) {
      this.webSocketServer.wsSendAll('chart', 'index_update', {
        currentChartIndex: this._getCurrentChartIndex(),
      });
    }
    return { chartDataChanged, chartIndexChanged };
  }

  async handlePriceUpdate() {
    if (this.config.debug) {
      this.logger.info('[ChartDataService] Price update handled. Refreshing chart data and notifying clients.');
    }
    await this.refreshChartDataFromPriceService();
    this._notifyClients();
  }

  async processMqttChartAdjustment(topic, messagePayload) {
    const topicParts = topic.split('/');
    const adjustmentType = topicParts[topicParts.length - 1];
    let chartWasModified = false;

    const currentPriceDate = this.priceService.getCurrentPriceDate();
    const nextPriceDate = this.priceService.getNextPriceDate();

    if (adjustmentType === 'adjustLeftAvgOffset') {
      const parsed = parseFloat(messagePayload.toString());
      let targetIndex = 0;
      if (this.offsetFactors[0] && this.offsetFactors[0].date === currentPriceDate) {
        targetIndex = 0;
      } else if (this.offsetFactors[1] && this.offsetFactors[1].date === currentPriceDate) {
        targetIndex = 1;
      }

      this.offsetFactors[targetIndex].threshold = parsed === 0 ? 0 : this.offsetFactors[targetIndex].threshold + parsed * this.stepFactor;
      this.leftAvgOffsetFactor = this.offsetFactors[targetIndex].threshold;
      this.saveThresholds(targetIndex, this.leftAvgOffsetFactor, 'adjustLeftDisp, mqtt');
      chartWasModified = true;
    } else if (adjustmentType === 'adjustRightAvgOffset') {
      const parsed = parseFloat(messagePayload.toString());
      let targetIndex = 1;
      if (this.offsetFactors[1] && this.offsetFactors[1].date === nextPriceDate) {
        targetIndex = 1;
      } else if (this.offsetFactors[0] && this.offsetFactors[0].date === nextPriceDate) {
        targetIndex = 0;
      } else if (!this.offsetFactors[1] && this.offsetFactors[0]) {
        this.offsetFactors[1] = {
          date: nextPriceDate || 'unknown',
          threshold: 0,
        };
      } else if (!this.offsetFactors[1]) {
        this.logger.warn('[ChartDataService] adjustRightAvgOffset: No offset factors available to adjust.');
        return false;
      }

      this.offsetFactors[targetIndex].threshold = parsed === 0 ? 0 : this.offsetFactors[targetIndex].threshold + parsed * this.stepFactor;
      this.rightAvgOffsetFactor = this.offsetFactors[targetIndex].threshold;
      this.saveThresholds(targetIndex, this.rightAvgOffsetFactor, 'adjustRightDisp, mqtt');
      chartWasModified = true;
    }

    if (chartWasModified) {
      await this.refreshChartDataFromPriceService();
      this._notifyClients();
      return true;
    }
    return false;
  }

  publishData(startOffsetRelevantDay, from) {
    if (!this.mqttClient || !this.mqttClient.connected) {
      this.logger.warn('[ChartDataService] MQTT client not connected, cannot publish data.');
      return;
    }
    const now = new Date();
    const serverLocalTime = now; // 'now' is already in the server's local time. No further adjustment needed if chartData.startTime is also in local time.

    const year = serverLocalTime.getFullYear();
    const month = String(serverLocalTime.getMonth() + 1).padStart(2, '0');
    const day = String(serverLocalTime.getDate()).padStart(2, '0');
    const hour = String(serverLocalTime.getHours()).padStart(2, '0');
    const currentHourStart = `${year}-${month}-${day}T${hour}`;

    let currentChartIndex = -1;
    for (let i = 0; i < this.chartData.length; i++) {
      if (this.chartData[i].startTime.startsWith(currentHourStart)) {
        currentChartIndex = i;
        break;
      }
    }

    const dataPointToPublish = this.chartData[currentChartIndex];

    if (!dataPointToPublish) {
      if (this.config.debug) this.logger.warn(`[ChartDataService] publishData (from ${from}): No dataPoint in chartData for current real hour ${currentHourStart}. chartData length: ${this.chartData.length}`);
      return;
    }

    if (this.config.debug) {
      this.logger.info(`[ChartDataService] publishData (from ${from}): Publishing for ${dataPointToPublish.startTime}.`);
    }
    try {
      this.mqttClient.publish(`${this.statTopic}/spotPrice`, String(dataPointToPublish.spotPrice), this.pubOpts);
      this.mqttClient.publish(`${this.statTopic}/avgPrice`, String(dataPointToPublish.avgPrice), this.pubOpts);
      this.mqttClient.publish(`${this.statTopic}/thresholdLevel`, String(dataPointToPublish.thresholdLevel), this.pubOpts);
      this.mqttClient.publish(`${this.statTopic}/spotBelowThreshold`, String(dataPointToPublish.isBelowThreshold), this.pubOpts);
    } catch (err) {
      this.logger.error(`[ChartDataService] Publishing failed: ${err}`);
    }
  }

  checkAndSendChartData = (() => {
    let lastChartDataSignature = '';
    let lastChartIndex = -1;

    return () => {
      if (!this.chartData || this.chartData.length === 0) {
        if (this.config.debug) this.logger.info('[ChartDataService] checkAndSendChartData: No chart data available.');
        return { chartDataChanged: false, chartIndexChanged: false };
      }

      const currentChartIndex = this._getCurrentChartIndex();

      const currentDataSignature = JSON.stringify(
        this.chartData.map((d) => ({
          sT: d.startTime,
          sP: d.spotPrice,
          tL: d.thresholdLevel,
          iBT: d.isBelowThreshold,
        })),
      );

      const chartDataChanged = currentDataSignature !== lastChartDataSignature;
      const chartIndexChanged = currentChartIndex !== lastChartIndex;

      if (chartDataChanged) {
        lastChartDataSignature = currentDataSignature;
      }
      if (chartIndexChanged) {
        lastChartIndex = currentChartIndex;
      }

      if (this.config.debug) {
        if (chartDataChanged || chartIndexChanged) {
          this.logger.info(`[ChartDataService] Chart data changed: ${chartDataChanged}, Chart index changed: ${chartIndexChanged}.`);
        } else {
          this.logger.info('[ChartDataService] No change in relevant chart data or index to send to clients.');
        }
      }
      return { chartDataChanged, chartIndexChanged };
    };
  })();

  async performHourlyTasks() {
    if (this.config.debug) {
      this.logger.info('[ChartDataService] Hourly tasks invoked...');
    }
    const previousDate = this.currentDate; // Store previous date before updating
    this.currentDate = this.getDateString(new Date());
    this.currentHour = new Date().getHours();

    let dataRefreshed = false;
    const isMidnightRollover = this.chartData.length > 0 && this.currentDate !== previousDate;

    if (isMidnightRollover || this.priceService.hasNewData()) {
      dataRefreshed = await this.refreshChartDataFromPriceService();
      this.priceService.clearNewDataFlag(); // Clear the flag after refreshing chart data
    }

    this.publishData(0, 'hourlyTasks');

    const { chartIndexChanged } = this._notifyClients();

    if (this.config.debug) {
      this.logger.info(`[ChartDataService] Hourly tasks completed. Data refreshed: ${dataRefreshed}, Chart index changed: ${chartIndexChanged}`);
    }
    return dataRefreshed || chartIndexChanged;
  }

  _getCurrentChartIndex() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const currentHourStart = `${year}-${month}-${day}T${hour}`;

    for (let i = 0; i < this.chartData.length; i++) {
      if (this.chartData[i].startTime.startsWith(currentHourStart)) {
        return i;
      }
    }
    return -1;
  }

  getChartDataForClient() {
    const currentChartIndex = this._getCurrentChartIndex();
    
    return {
      chartData: this.chartData,
      currentChartIndex: currentChartIndex,
    };
  }

  getOffsetFactors() {
    return this.offsetFactors;
  }

  
}

module.exports = ChartDataService;