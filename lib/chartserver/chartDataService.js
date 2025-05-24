const fs = require('fs');
const path = require('path'); // For saveFile path construction

class ChartDataService {
    constructor(config, mqttClient, logger = console) {
        this.config = config; // Expects serverConfig properties
        this.mqttClient = mqttClient;
        this.logger = logger;

        // Chart-related global state variables
        this.chartData = [];
        this.twoDaysData = [];
        this.offsetFactors = []; // Will be initialized by getOffsets
        this.leftAvgOffsetFactor = 0;
        this.rightAvgOffsetFactor = 0;
        this.maxPrice = 0;
        this.isVirgin = true; // To track if it's the first run of handleMessages
        this.isOnRightSide = false; // To track which part of the 2-day data is current
        this.currentDate = this.getDateString(new Date());
        this.currentHour = new Date().getHours();
        this.dataAvailable = false; // To track if chartData has been initialized
        this.timerInit = true; // For initial MQTT message handling delay
        this.timezoneOffset = 0; // Will be set by performHourlyTasks

        this.savePath = this.config.savePath || './data';
        this.saveFile = path.join(this.savePath, 'thresholds.json');
        
        this.fixedOffset = this.config.fixedAverageOffset || 0;
        this.stepFactor = this.config.adjustmentStepFactor || 1;
        this.verticalStepCount = this.config.verticalStepCount || 50;
        this.pubOpts = { retain: true, qos: 0 }; // MQTT publish options

        this.statTopic = `${this.config.haBaseTopic || 'elwiz'}/chart`;


        // Initializing offsets
        this.initializeOffsets();
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

    getDateString(dateTime) {
        const now = new Date(dateTime);
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    async skewDays(days) {
        const oneDay = 86400000; // pre-calculate milliseconds in a day (24 * 60 * 60 * 1000)
        const date = new Date(Date.now() + oneDay * days);
        return this.getDateString(date);
    }

    async getOffsets() {
        let initialOffsets = [{ date: await this.skewDays(-1), threshold: 0 }, { date: await this.skewDays(0), threshold: 0 }];
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
                if (Array.isArray(data) && data.length === 2 && data.every(item => typeof item === 'object' && 'date' in item && 'threshold' in item)) {
                    return data;
                } else {
                    this.logger.warn(`[ChartDataService] Invalid data structure in ${this.saveFile}. Reinitializing with default values.`);
                    fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
                    return initialOffsets;
                }
            } catch (error) {
                this.logger.error(`[ChartDataService] Error reading or parsing ${this.saveFile}: ${error}. Reinitializing with default values.`);
                fs.writeFileSync(this.saveFile, JSON.stringify(initialOffsets));
                return initialOffsets;
            }
        }
    }

    saveThresholds(idx, threshold, where) {
        if (this.offsetFactors && this.offsetFactors[idx]) {
            this.offsetFactors[idx].threshold = threshold;
            if (this.config.debug) {
                this.logger.info(`[ChartDataService] saveThresholds ${where}: saved ${JSON.stringify(this.offsetFactors)}`);
            }
            fs.writeFileSync(this.saveFile, JSON.stringify(this.offsetFactors));
        } else {
            this.logger.error(`[ChartDataService] Attempted to save threshold for invalid index ${idx}`);
        }
    }
    
    parseJsonSafely(message) {
        let buffer;
        try {
            buffer = message.toString();
        } catch (err) {
            this.logger.error('[ChartDataService] Error converting buffer to string:', err);
            return { error: true, message: 'Message cannot be parsed as string', data: null };
        }
        const trimmedString = buffer.trim();
        if (trimmedString === '') {
            return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
        }
        try {
            const data = JSON.parse(trimmedString);
            return { error: false, message: 'Successfully parsed JSON.', data: data };
        } catch (error) {
            return { error: true, message: `Error parsing JSON: ${error.message}`, data: null };
        }
    }

    processMqttPriceData(topic, messagePayload) {
        const result = this.parseJsonSafely(messagePayload);
        let chartDataUpdated = false;

        if (!result.error) {
            if (this.twoDaysData.length < 2) {
                this.twoDaysData.push(result.data);
            } else if (result.data.priceDate > this.twoDaysData[1].priceDate) {
                this.twoDaysData.push(result.data);
                this.twoDaysData = this.twoDaysData.slice(-2);
            } else {
                if (this.config.debug) {
                    this.logger.info(`[ChartDataService] Pricedata skipped ${result.data.priceDate}`);
                }
            }

            if (this.timerInit) {
                this.timerInit = false;
                setTimeout(() => {
                    chartDataUpdated = this.handleMessages();
                    this.timerInit = true;
                    // If handleMessages indicates an update, the caller (server.js) will use this.
                    // This method itself doesn't directly return the status of this async operation.
                    // The caller (server.js) needs a way to know if wsSendAll should be called.
                    // For now, handleMessages will call checkAndSendChartData which returns a boolean.
                    // We need to propagate this boolean back.
                    if (chartDataUpdated) {
                         // This is tricky because of setTimeout.
                         // Consider an event emitter or callback for server.js to react.
                         // For now, let's assume server.js will poll or check after a delay.
                         // Or, the caller (server.js) has to manage this logic.
                         // Let's simplify: handleMessages will directly call a method on WebSocketServer instance
                         // if it's passed here, or server.js orchestrates.
                         // Given the current task, server.js will orchestrate.
                         // So, this method should indicate if an update that needs broadcasting happened.
                    }
                }, 500);
            }
        }
        return chartDataUpdated; // This will likely be false due to setTimeout
    }
    
    // This method needs to be called by server.js after processMqttPriceData's timeout completes.
    // This is a simplified approach. A better one would be event-driven.
    triggerHandleMessages() {
        return this.handleMessages();
    }


    processMqttChartAdjustment(topic, messagePayload) {
        const topicParts = topic.split('/');
        const adjustmentType = topicParts[topicParts.length -1]; // last part of topic
        let updated = false;

        if (adjustmentType === 'adjustLeftAvgOffset') {
            const parsed = parseFloat(messagePayload.toString());
            this.leftAvgOffsetFactor = parsed === 0 ? 0 : this.leftAvgOffsetFactor + parsed * this.stepFactor;
            this.saveThresholds(0, this.leftAvgOffsetFactor, 'adjustLeftDisp, mqtt');
            this.updateAvgData(0, this.leftAvgOffsetFactor, 'adjustLeftDisp, mqtt');
            updated = true;
        } else if (adjustmentType === 'adjustRightAvgOffset') {
            const parsed = parseFloat(messagePayload.toString());
            this.rightAvgOffsetFactor = parsed === 0 ? 0 : this.rightAvgOffsetFactor + parsed * this.stepFactor;
            this.saveThresholds(1, this.rightAvgOffsetFactor, 'adjustRightDisp, mqtt');
            this.updateAvgData(24, this.rightAvgOffsetFactor, 'adjustRightDisp, mqtt');
            updated = true;
        }
        return updated;
    }

    handleMessages() {
        const today = this.getDateString(new Date()); // Use current date for comparison
        this.isOnRightSide = false;
        let chartModified = false;

        if (this.config.debug) {
            this.logger.info(`[ChartDataService] handleMessages: twoDaysData length ${this.twoDaysData.length}`);
        }

        if (this.twoDaysData.length > 1) {
            this.isOnRightSide = this.twoDaysData[1].priceDate === today;

            if (this.offsetFactors && this.offsetFactors.length > 1 && this.twoDaysData[1].priceDate > this.offsetFactors[1].date) {
                this.offsetFactors.push({ date: this.twoDaysData[1].priceDate, threshold: 0 });
                this.offsetFactors = this.offsetFactors.slice(-2);
                this.saveThresholds(1, 0, 'handleMessages');
            }
        }
        
        if (this.twoDaysData.length > 0 && this.offsetFactors && this.offsetFactors.length > 0) {
             this.updateChartData(this.twoDaysData[0], this.offsetFactors[0].threshold);
             chartModified = true; // Data is processed, assume modified for now
        }
        if (this.twoDaysData.length > 1 && this.offsetFactors && this.offsetFactors.length > 1) {
            this.updateChartData(this.twoDaysData[1], this.offsetFactors[1].threshold);
            chartModified = true; // Data is processed
        }
        
        // checkAndSendChartData will determine if an actual update for clients is needed
        const sendUpdate = this.checkAndSendChartData(this.chartData);
        
        if (this.config.debug) {
            this.logger.info(`[ChartDataService] AvgOffsetFactors: ${JSON.stringify(this.offsetFactors)}`);
            this.twoDaysData.forEach((m, idx) => {
                this.logger.info(`[ChartDataService] priceDate ${idx}: ${m.priceDate}`);
            });
        }
        
        if (this.offsetFactors && this.offsetFactors.length > 0) {
            this.leftAvgOffsetFactor = this.offsetFactors[0].threshold;
            if (this.offsetFactors.length > 1) {
                 this.rightAvgOffsetFactor = this.offsetFactors[1].threshold;
            }
        }

        this.isVirgin = false;
        return sendUpdate; // Return true if data should be sent to clients
    }

    updateChartData(prices, adjustment) {
        let hourlyData;
        try {
            hourlyData = prices.hourly;
        } catch (err) {
            this.logger.warn('[ChartDataService] No data to update in updateChartData.');
            return;
        }

        const avgPrice = prices.daily.avgPrice;
        
        let currentMax = 0;
        if (this.chartData.length > 0) {
          currentMax = this.chartData.reduce((max, p) => p.spotPrice > max ? p.spotPrice : max, 0);
        }
        if (prices.daily.maxPrice > currentMax) {
          currentMax = prices.daily.maxPrice;
        }
        this.maxPrice = currentMax;

        const fixed = (this.maxPrice / this.verticalStepCount) * this.fixedOffset;
        const adjustVal = (this.maxPrice / this.verticalStepCount) * adjustment;

        if (this.config.debug) {
            this.logger.info(`[ChartDataService] updateChartData: maxPrice=${this.maxPrice}, avgPrice=${avgPrice}, fixed=${fixed}, adjustVal=${adjustVal}`);
        }

        const thresholdLevel = adjustment === 0 ? parseFloat((avgPrice + fixed).toFixed(4)) : parseFloat((avgPrice + fixed + adjustVal).toFixed(4));
        
        if (!hourlyData || hourlyData.length === 0) {
            if (this.config.debug) this.logger.info("[ChartDataService] No hourly data to update.");
            return;
        }

        const newData = hourlyData.map(h => ({
            startTime: h.startTime,
            spotPrice: h.spotPrice,
            avgPrice: avgPrice,
            thresholdLevel: thresholdLevel,
            isBelowThreshold: h.spotPrice < thresholdLevel ? 1 : 0,
        }));

        if (!this.dataAvailable) {
            this.dataAvailable = true;
            this.chartData = [...newData];
        } else {
            // This logic needs to be smarter about merging/replacing data for specific days
            // For now, it replaces data for the day represented by `prices.priceDate`
            const newPriceDate = prices.priceDate;
            this.chartData = this.chartData.filter(d => d.startTime.slice(0, 10) !== newPriceDate);
            this.chartData = [...this.chartData, ...newData];
            // Sort by startTime to ensure chronological order
            this.chartData.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        }

        if (this.chartData.length > 48) {
            this.chartData = this.chartData.slice(-48);
        }
        if (this.config.debug) {
            this.logger.info(`[ChartDataService] updateChartData processed. ChartData length: ${this.chartData.length}`);
        }
    }

    async updateAvgData(startOffset, adjustment, from) {
        if (this.config.debug) this.logger.info(`[ChartDataService] updateAvgData invoked from ${from}`);

        startOffset = startOffset === 24 ? 24 : 0;
        const dayIndex = startOffset === 0 ? 0 : 1;

        if (!this.twoDaysData[dayIndex] || !this.twoDaysData[dayIndex].daily) {
            this.logger.warn(`[ChartDataService] updateAvgData: twoDaysData for dayIndex ${dayIndex} is not available.`);
            return false;
        }
        const avgPrice = this.twoDaysData[dayIndex].daily.avgPrice;
        
        const fixed = (this.maxPrice / this.verticalStepCount) * this.fixedOffset;
        const adjustVal = (this.maxPrice / this.verticalStepCount) * adjustment;

        if (this.config.debug) {
            this.logger.info(`[ChartDataService] updateAvgData: maxPrice=${this.maxPrice}, avgPrice=${avgPrice}, fixed=${fixed}, adjustVal=${adjustVal}`);
        }
        
        let modified = false;
        this.chartData.forEach((h, idx) => {
            if (idx >= startOffset && idx < startOffset + 24) {
                const newThresholdLevel = avgPrice > 0 ? parseFloat((avgPrice + fixed + adjustVal).toFixed(3)) : 0;
                const newIsBelowThreshold = h.spotPrice < newThresholdLevel ? 1 : 0;
                if (h.thresholdLevel !== newThresholdLevel || h.isBelowThreshold !== newIsBelowThreshold) {
                    h.thresholdLevel = newThresholdLevel;
                    h.isBelowThreshold = newIsBelowThreshold;
                    modified = true;
                }
            }
        });
        
        // Check if current hour's data, for the relevant day, needs publishing
        if (this.chartData[startOffset] && this.chartData[startOffset].startTime.slice(0, 10) === this.currentDate) {
            this.publishData(startOffset, 'updateAvgData');
        }
        return modified; // Indicates if chartData was changed and might need broadcast
    }

    publishData(startOffset, from) {
        if (!this.mqttClient || !this.mqttClient.connected) {
            this.logger.warn('[ChartDataService] MQTT client not connected, cannot publish data.');
            return;
        }
        const dataPoint = this.chartData[this.currentHour + startOffset];
        if (!dataPoint) {
            if (this.config.debug) this.logger.warn(`[ChartDataService] publishData: No dataPoint for currentHour ${this.currentHour} + startOffset ${startOffset}`);
            return;
        }

        if (this.config.debug) {
            this.logger.info(`[ChartDataService] publishData invoked from ${from}, StartOffset: ${startOffset}\nchartDataPoint: ${JSON.stringify(dataPoint)}`);
        }
        try {
            this.mqttClient.publish(`${this.statTopic}/spotPrice`, String(dataPoint.spotPrice), this.pubOpts);
            this.mqttClient.publish(`${this.statTopic}/avgPrice`, String(dataPoint.avgPrice), this.pubOpts);
            this.mqttClient.publish(`${this.statTopic}/thresholdLevel`, String(dataPoint.thresholdLevel), this.pubOpts);
            this.mqttClient.publish(`${this.statTopic}/spotBelowThreshold`, String(dataPoint.isBelowThreshold), this.pubOpts);
        } catch (err) {
            this.logger.error(`[ChartDataService] Publishing failed: ${err}`);
        }
    }

    checkAndSendChartData = (() => {
        let recentUpdates = new Set();
        let lastUpdateSize = 0;

        return (currentChartData) => {
            if (!currentChartData || currentChartData.length === 0) {
                 if (this.config.debug) this.logger.info('[ChartDataService] checkAndSendChartData: No chart data available.');
                return false;
            }
            const currentStartTimes = currentChartData.map(data => data.startTime.slice(0, 10));
            const uniqueStartTimes = new Set(currentStartTimes);
            const isNewData = [...uniqueStartTimes].some(date => !recentUpdates.has(date));

            if (isNewData || currentChartData.length !== lastUpdateSize) {
                if (this.isOnRightSide && this.offsetFactors.length > 1) {
                    this.updateAvgData(24, this.offsetFactors[1].threshold, 'checkAndSendChartData, right');
                } else if (!this.isOnRightSide && this.offsetFactors.length > 0) {
                    this.updateAvgData(0, this.offsetFactors[0].threshold, 'checkAndSendChartData, left');
                }
                
                uniqueStartTimes.forEach(date => recentUpdates.add(date));
                lastUpdateSize = currentChartData.length;

                while (recentUpdates.size > 2) {
                    const oldestDate = [...recentUpdates].sort()[0];
                    recentUpdates.delete(oldestDate);
                }
                if (this.config.debug) {
                    this.logger.info('[ChartDataService] Data updated, should be sent to clients.');
                }
                return true; // Data should be sent
            } else {
                if (this.config.debug) this.logger.info('[ChartDataService] No new data to send to clients.');
                return false; // No new data to send
            }
        };
    })();

    async performHourlyTasks() {
        if (this.config.debug) {
            this.logger.info('[ChartDataService] Hourly tasks invoked...');
        }
        this.timezoneOffset = -new Date().getTimezoneOffset() / 60;
        const date = new Date(Date.now());
        this.currentHour = date.getHours();
        this.currentDate = this.getDateString(date);

        if (this.chartData && this.chartData.length > 0) {
            this.isOnRightSide = this.chartData[0].startTime.slice(0, 10) === this.currentDate ? false : true;
        } else {
            this.isOnRightSide = false; // Default if no chart data
        }
        
        let updated = false;
        if (!this.isVirgin && this.offsetFactors) {
            const startOffset = this.isOnRightSide ? 24 : 0;
            const currentFactor = this.isOnRightSide ? (this.offsetFactors[1] ? this.offsetFactors[1].threshold : 0) : (this.offsetFactors[0] ? this.offsetFactors[0].threshold : 0) ;
            updated = await this.updateAvgData(startOffset, currentFactor, 'hourlyTasks');
        }

        if (this.config.debug) {
            this.logger.info(`[ChartDataService] Hourly AvgOffsetFactors: ${JSON.stringify(this.offsetFactors)}`);
            this.logger.info(`[ChartDataService] Hourly isOnRightSide: ${this.isOnRightSide}`);
        }
        return updated; // Return if data needs to be sent
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

module.exports = ChartDataService;
