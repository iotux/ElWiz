const fs = require("fs");
const path = require("path"); // For saveFile path construction

class ChartDataService {
  constructor(config, mqttClient, priceService, logger = console) {
    // Added priceService
    this.config = config; // Expects serverConfig properties
    this.mqttClient = mqttClient;
    this.priceService = priceService; // Store PriceService instance
    this.logger = logger;

    // Chart-related global state variables
    this.chartData = []; // This will be the 48-hour combined array
    // twoDaysData and timerInit (for MQTT prices) are removed
    this.offsetFactors = [];
    this.leftAvgOffsetFactor = 0;
    this.rightAvgOffsetFactor = 0;
    this.maxPrice = 0;
    // isVirgin is less relevant now, data availability depends on PriceService
    this.isOnRightSide = false; // To track which part of the 2-day data is current
    this.currentDate = this.getDateString(new Date());
    this.currentHour = new Date().getHours();
    this.dataAvailable = false; // To track if chartData has been initialized
    this.timezoneOffset = 0;

    this.savePath = this.config.savePath || "./data";
    this.saveFile = path.join(this.savePath, "thresholds.json");

    this.fixedOffset = this.config.fixedAverageOffset || 0;
    this.stepFactor = this.config.adjustmentStepFactor || 1;
    this.verticalStepCount = this.config.verticalStepCount || 50;
    this.pubOpts = { retain: true, qos: 0 };

    this.statTopic = `${this.config.haBaseTopic || "elwiz"}/chart`;

    this.initializeOffsets();
    // Initial data load from PriceService
    this.refreshChartDataFromPriceService();
  }

  async initializeOffsets() {
    this.offsetFactors = await this.getOffsets();
    this.logger.info(
      "[ChartDataService] Thresholds initialized: " +
        JSON.stringify(this.offsetFactors),
    );
    if (this.offsetFactors && this.offsetFactors.length > 0) {
      this.leftAvgOffsetFactor = this.offsetFactors[0].threshold;
      if (this.offsetFactors.length > 1) {
        this.rightAvgOffsetFactor = this.offsetFactors[1].threshold;
      }
    }
  }

  // Method to update chartData based on data from PriceService
  async refreshChartDataFromPriceService() {
    if (!this.priceService) {
      this.logger.warn(
        "[ChartDataService] PriceService not available to refresh chart data.",
      );
      return false;
    }

    const todayHourly = this.priceService.getCurrentDayHourlyArray();
    const nextDayHourly = this.priceService.getNextDayHourlyArray();
    const currentPriceDate = this.priceService.getCurrentPriceDate();
    const nextPriceDate = this.priceService.getNextPriceDate();

    let newCombinedData = [];
    let processedSomething = false;

    if (currentPriceDate && todayHourly && todayHourly.length > 0) {
      const currentDayOffsetFactor =
        this.offsetFactors[0] && this.offsetFactors[0].date === currentPriceDate
          ? this.offsetFactors[0].threshold
          : this.offsetFactors[1] &&
              this.offsetFactors[1].date === currentPriceDate
            ? this.offsetFactors[1].threshold
            : this.leftAvgOffsetFactor; // Fallback or default
      this._updateInternalChartData(
        todayHourly,
        currentDayOffsetFactor,
        newCombinedData,
        currentPriceDate,
      );
      processedSomething = true;
    } else {
      if (this.config.debug)
        this.logger.info(
          `[ChartDataService] No current day hourly data from PriceService for date: ${currentPriceDate || "unknown"}`,
        );
    }

    if (
      this.priceService.isNextDayAvailable() &&
      nextPriceDate &&
      nextDayHourly &&
      nextDayHourly.length > 0
    ) {
      const nextDayOffsetFactor =
        this.offsetFactors[1] && this.offsetFactors[1].date === nextPriceDate
          ? this.offsetFactors[1].threshold
          : this.rightAvgOffsetFactor; // Fallback or default
      this._updateInternalChartData(
        nextDayHourly,
        nextDayOffsetFactor,
        newCombinedData,
        nextPriceDate,
      );
      processedSomething = true;
    } else {
      if (this.config.debug)
        this.logger.info(
          `[ChartDataService] No next day hourly data from PriceService for date: ${nextPriceDate || "unknown"}`,
        );
    }

    if (processedSomething) {
      this.chartData = newCombinedData
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
        .slice(-48);
      this.dataAvailable = this.chartData.length > 0;
      this.recalculateMaxPrice(); // Recalculate maxPrice based on the new 48h window
      if (this.config.debug)
        this.logger.info(
          `[ChartDataService] Chart data refreshed. Total entries: ${this.chartData.length}. Data available: ${this.dataAvailable}`,
        );
    }

    // Update offsetFactors based on new dates from priceService
    const today = this.getDateString(new Date());
    this.isOnRightSide =
      this.chartData.length > 0 &&
      this.chartData[0].startTime.slice(0, 10) !== today;

    if (
      currentPriceDate &&
      this.offsetFactors[0] &&
      this.offsetFactors[0].date !== currentPriceDate
    ) {
      // If current day from price service doesn't match first offset factor date,
      // it implies a shift. If next day was available and matches offsetFactors[1], shift offsets.
      if (
        this.offsetFactors[1] &&
        this.offsetFactors[1].date === currentPriceDate
      ) {
        this.offsetFactors = [
          {
            date: currentPriceDate,
            threshold: this.offsetFactors[1].threshold,
          },
          { date: nextPriceDate || (await this.skewDays(1)), threshold: 0 },
        ];
        this.saveThresholds(1, 0, "refreshChartDataFromPriceService_shift"); // Save new structure
      } else {
        // currentPriceDate is new, and not matching offsetFactors[1]
        this.offsetFactors = [
          { date: currentPriceDate, threshold: 0 },
          { date: nextPriceDate || (await this.skewDays(1)), threshold: 0 },
        ];
        this.saveThresholds(
          0,
          0,
          "refreshChartDataFromPriceService_newCurrent",
        );
        this.saveThresholds(
          1,
          0,
          "refreshChartDataFromPriceService_newNextForCurrent",
        );
      }
    }
    if (
      nextPriceDate &&
      this.offsetFactors[1] &&
      this.offsetFactors[1].date !== nextPriceDate
    ) {
      // If next day from price service doesn't match second offset factor, update it.
      // This assumes offsetFactors[0] is correctly set to currentPriceDate by now.
      this.offsetFactors[1] = {
        date: nextPriceDate,
        threshold: this.offsetFactors[1].threshold || 0,
      };
      this.saveThresholds(
        1,
        this.offsetFactors[1].threshold,
        "refreshChartDataFromPriceService_updateNext",
      );
    }

    // Update local threshold factors from potentially modified offsetFactors
    if (this.offsetFactors && this.offsetFactors.length > 0) {
      this.leftAvgOffsetFactor = this.offsetFactors[0].threshold;
      if (this.offsetFactors.length > 1) {
        this.rightAvgOffsetFactor = this.offsetFactors[1].threshold;
      }
    }

    // This function itself doesn't decide to broadcast; it just updates internal data.
    // The caller (e.g., hourly task, or after an MQTT adjustment) will use checkAndSend.
    return this.checkAndSendChartData(); // Return true if data should be sent
  }

  // Internal helper to process a single day's hourly data
  _updateInternalChartData(
    hourlyPrices,
    adjustmentFactor,
    targetArray,
    priceDate,
  ) {
    if (!hourlyPrices || hourlyPrices.length === 0) return;

    const dailySummary =
      priceDate === this.priceService.getCurrentPriceDate()
        ? this.priceService.getCurrentDaySummary()
        : priceDate === this.priceService.getNextPriceDate()
          ? this.priceService.getNextDaySummary()
          : {};

    const avgPrice = dailySummary.avgPrice;

    if (avgPrice === undefined || avgPrice === null) {
      if (this.config.debug)
        this.logger.warn(
          `[ChartDataService] Average price is undefined for ${priceDate}. Cannot calculate thresholds accurately.`,
        );
      // Potentially skip this day or use a fallback average if critical
    }

    // Max price for threshold calculation should be based on the combined 48h window,
    // so this.maxPrice (recalculated by recalculateMaxPrice) is used.
    const fixed = (this.maxPrice / this.verticalStepCount) * this.fixedOffset;
    const adjustVal =
      (this.maxPrice / this.verticalStepCount) * adjustmentFactor;
    const thresholdLevel =
      avgPrice === undefined || avgPrice === null
        ? 0 // Fallback if avgPrice missing
        : adjustmentFactor === 0
          ? parseFloat((avgPrice + fixed).toFixed(4))
          : parseFloat((avgPrice + fixed + adjustVal).toFixed(4));

    hourlyPrices.forEach((h) => {
      targetArray.push({
        startTime: h.startTime,
        spotPrice: h.spotPrice,
        avgPrice: avgPrice, // Use the specific day's average price
        thresholdLevel: thresholdLevel,
        isBelowThreshold: h.spotPrice < thresholdLevel ? 1 : 0,
      });
    });
  }

  recalculateMaxPrice() {
    if (this.chartData.length > 0) {
      this.maxPrice = this.chartData.reduce(
        (max, p) => (p.spotPrice > max ? p.spotPrice : max),
        0,
      );
    } else {
      // What should maxPrice be if there's no data? From config? Or default?
      // For now, let PriceService provide daily max prices if needed as fallback.
      // This maxPrice is specific to the current items in chartData for threshold calc.
      const currentDayMax =
        this.priceService.getCurrentDaySummary().maxPrice || 0;
      const nextDayMax = this.priceService.isNextDayAvailable()
        ? this.priceService.getNextDaySummary().maxPrice || 0
        : 0;
      this.maxPrice = Math.max(currentDayMax, nextDayMax, 0); // Ensure it's at least 0
    }
    if (this.config.debug)
      this.logger.info(
        `[ChartDataService] Recalculated maxPrice for chart thresholds: ${this.maxPrice}`,
      );
  }

  getDateString(dateTime) {
    const now = new Date(dateTime);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  async skewDays(days) {
    const oneDay = 86400000;
    const date = new Date(Date.now() + oneDay * days);
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
        if (
          Array.isArray(data) &&
          data.length === 2 &&
          data.every(
            (item) =>
              typeof item === "object" && "date" in item && "threshold" in item,
          )
        ) {
          return data;
        } else {
          this.logger.warn(
            `[ChartDataService] Invalid data structure in ${this.saveFile}. Reinitializing.`,
          );
          fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
          return initialOffsets;
        }
      } catch (error) {
        this.logger.error(
          `[ChartDataService] Error reading ${this.saveFile}: ${error}. Reinitializing.`,
        );
        fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
        return initialOffsets;
      }
    }
  }

  saveThresholds(idx, threshold, where) {
    if (this.offsetFactors && this.offsetFactors[idx]) {
      this.offsetFactors[idx].threshold = threshold;
      if (this.config.debug) {
        this.logger.info(
          `[ChartDataService] saveThresholds from ${where}: saved ${JSON.stringify(this.offsetFactors)}`,
        );
      }
      fs.writeFileSync(this.saveFile, JSON.stringify(this.offsetFactors));
    } else {
      this.logger.error(
        `[ChartDataService] Attempted to save threshold for invalid index ${idx}`,
      );
    }
  }

  // processMqttPriceData is removed as PriceService handles MQTT price messages.
  // processMqttChartAdjustment is still relevant for direct chart adjustments.
  processMqttChartAdjustment(topic, messagePayload) {
    const topicParts = topic.split("/");
    const adjustmentType = topicParts[topicParts.length - 1];
    let chartWasModified = false;

    const currentPriceDate = this.priceService.getCurrentPriceDate();
    const nextPriceDate = this.priceService.getNextPriceDate();

    if (adjustmentType === "adjustLeftAvgOffset") {
      const parsed = parseFloat(messagePayload.toString());
      // Determine which offsetFactor to adjust. 'left' usually means current day.
      // Find the offsetFactor that matches currentPriceDate or is the first one.
      let targetIndex = 0; // Default to first if no date match
      if (
        this.offsetFactors[0] &&
        this.offsetFactors[0].date === currentPriceDate
      ) {
        targetIndex = 0;
      } else if (
        this.offsetFactors[1] &&
        this.offsetFactors[1].date === currentPriceDate
      ) {
        targetIndex = 1; // Should ideally not happen if first is current
      }

      this.offsetFactors[targetIndex].threshold =
        parsed === 0
          ? 0
          : this.offsetFactors[targetIndex].threshold +
            parsed * this.stepFactor;
      this.leftAvgOffsetFactor = this.offsetFactors[targetIndex].threshold;
      this.saveThresholds(
        targetIndex,
        this.leftAvgOffsetFactor,
        "adjustLeftDisp, mqtt",
      );
      // This adjustment requires re-evaluating thresholds for the affected day in chartData
      chartWasModified = true;
    } else if (adjustmentType === "adjustRightAvgOffset") {
      const parsed = parseFloat(messagePayload.toString());
      // 'right' usually means next day. Find offsetFactor matching nextPriceDate or the second one.
      let targetIndex = 1; // Default to second
      if (
        this.offsetFactors[1] &&
        this.offsetFactors[1].date === nextPriceDate
      ) {
        targetIndex = 1;
      } else if (
        this.offsetFactors[0] &&
        this.offsetFactors[0].date === nextPriceDate
      ) {
        targetIndex = 0; // Should ideally not happen if second is next
      } else if (!this.offsetFactors[1] && this.offsetFactors[0]) {
        // Only one offset factor, assume it's for current, create one for next
        this.offsetFactors[1] = {
          date: nextPriceDate || "unknown",
          threshold: 0,
        };
      } else if (!this.offsetFactors[1]) {
        // No offset factors at all (edge case)
        this.logger.warn(
          "[ChartDataService] adjustRightAvgOffset: No offset factors available to adjust.",
        );
        return false;
      }

      this.offsetFactors[targetIndex].threshold =
        parsed === 0
          ? 0
          : this.offsetFactors[targetIndex].threshold +
            parsed * this.stepFactor;
      this.rightAvgOffsetFactor = this.offsetFactors[targetIndex].threshold;
      this.saveThresholds(
        targetIndex,
        this.rightAvgOffsetFactor,
        "adjustRightDisp, mqtt",
      );
      chartWasModified = true;
    }

    if (chartWasModified) {
      // After direct adjustment, refresh chartData to apply new thresholds
      // This will call _updateInternalChartData which uses the updated offsetFactors
      return this.refreshChartDataFromPriceService();
    }
    return false; // No relevant adjustment or no change made
  }

  // updateAvgData is effectively replaced by targeted refreshChartDataFromPriceService and applying offsets
  // during _updateInternalChartData. Direct manipulation via updateAvgData is less needed.
  // However, if specific hourly data points need re-evaluation based on new offsets *without*
  // full re-fetch from PriceService, this might be kept. For now, refresh is cleaner.
  // For simplicity, let's assume refreshChartDataFromPriceService handles application of new thresholds.

  publishData(startOffsetRelevantDay, from) {
    // startOffsetRelevantDay indicates if it's current (0) or next (24 logic)
    if (!this.mqttClient || !this.mqttClient.connected) {
      this.logger.warn(
        "[ChartDataService] MQTT client not connected, cannot publish data.",
      );
      return;
    }
    // Find the data point in chartData that corresponds to the current real-time hour.
    // This requires knowing if the current hour falls into the "current day" or "next day" part of chartData
    const now = new Date();
    const currentHourStartTimeISO = now.toISOString().slice(0, 13) + ":00:00";

    const dataPointToPublish = this.chartData.find((dp) =>
      dp.startTime.startsWith(currentHourStartTimeISO.slice(0, 13)),
    );

    if (!dataPointToPublish) {
      if (this.config.debug)
        this.logger.warn(
          `[ChartDataService] publishData (from ${from}): No dataPoint in chartData for current real hour ${currentHourStartTimeISO}`,
        );
      return;
    }

    if (this.config.debug) {
      this.logger.info(
        `[ChartDataService] publishData (from ${from}): Publishing for ${dataPointToPublish.startTime}`,
      );
    }
    try {
      this.mqttClient.publish(
        `${this.statTopic}/spotPrice`,
        String(dataPointToPublish.spotPrice),
        this.pubOpts,
      );
      this.mqttClient.publish(
        `${this.statTopic}/avgPrice`,
        String(dataPointToPublish.avgPrice),
        this.pubOpts,
      );
      this.mqttClient.publish(
        `${this.statTopic}/thresholdLevel`,
        String(dataPointToPublish.thresholdLevel),
        this.pubOpts,
      );
      this.mqttClient.publish(
        `${this.statTopic}/spotBelowThreshold`,
        String(dataPointToPublish.isBelowThreshold),
        this.pubOpts,
      );
    } catch (err) {
      this.logger.error(`[ChartDataService] Publishing failed: ${err}`);
    }
  }

  checkAndSendChartData = (() => {
    // This is now a simpler flag based on whether chartData changed
    let lastChartDataSignature = "";

    return () => {
      // Parameter currentChartData removed, uses this.chartData
      if (!this.chartData || this.chartData.length === 0) {
        if (this.config.debug)
          this.logger.info(
            "[ChartDataService] checkAndSendChartData: No chart data available.",
          );
        return false;
      }

      // Create a simple signature of the current chart data relevant for display
      // This might need to be more sophisticated if deep changes are missed
      const currentSignature = JSON.stringify(
        this.chartData.map((d) => ({
          sT: d.startTime,
          sP: d.spotPrice,
          tL: d.thresholdLevel,
          iBT: d.isBelowThreshold,
        })),
      );

      if (currentSignature !== lastChartDataSignature) {
        lastChartDataSignature = currentSignature;
        if (this.config.debug) {
          this.logger.info(
            "[ChartDataService] Chart data has changed, update should be sent to clients.",
          );
        }
        return true; // Data has changed, should be sent
      } else {
        if (this.config.debug)
          this.logger.info(
            "[ChartDataService] No change in relevant chart data to send to clients.",
          );
        return false; // No change
      }
    };
  })();

  async performHourlyTasks() {
    if (this.config.debug) {
      this.logger.info("[ChartDataService] Hourly tasks invoked...");
    }
    this.timezoneOffset = -new Date().getTimezoneOffset() / 60;
    this.currentDate = this.getDateString(new Date()); // Update current date/hour
    this.currentHour = new Date().getHours();

    // PriceService handles its own rollovers. We just refresh our view from it.
    const chartModified = await this.refreshChartDataFromPriceService();

    // After refreshing, publish current hour's data.
    // The 'startOffset' logic for publishData needs to determine which day the current real hour belongs to.
    // This is now implicitly handled by publishData finding the current hour in this.chartData.
    this.publishData(0, "hourlyTasks"); // Pass 0 as it's for current real-time hour

    if (this.config.debug) {
      this.logger.info(
        `[ChartDataService] Hourly tasks completed. Chart modified: ${chartModified}`,
      );
    }
    return chartModified;
  }

  getChartDataForClient() {
    // Ensure chartData is up-to-date before sending to client,
    // though frequent refreshes should be driven by PriceService updates or hourly tasks.
    // A direct call here might be redundant if refreshChartDataFromPriceService is called regularly.
    // However, it's safer for on-demand requests like a new client connecting.
    // await this.refreshChartDataFromPriceService(); // Consider if this is too much overhead for every client `init`
    return this.chartData;
  }

  getOffsetFactors() {
    return this.offsetFactors;
  }

  getTimezoneOffset() {
    return this.timezoneOffset;
  }
}

module.exports = ChartDataService;
