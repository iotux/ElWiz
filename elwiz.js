#!/usr/bin/env node

const fs = require('fs');
const MQTTClient = require('./misc/mqtt');
const notice = require('./publish/notice.js');
const { event } = require('./misc/misc.js');
const { loadYaml } = require('./misc/util.js');
const PriceService = require('./lib/common/priceService.js');
const mergePricesPlugin = require('./plugin/mergeprices.js');

require('./misc/dbinit.js');
require('./ams/pulseControl.js');
// plugselector is used via event, its listeners are set up when it's required.
require('./plugin/plugselector.js');
require('./publish/hassAnnounce.js');

const programName = 'ElWiz';
const programPid = process.pid;
const configFile = './config.yaml';
let config;

try {
  config = loadYaml(configFile);
} catch (error) {
  console.error(`[Main] Fatal error loading config file ${configFile}: ${error.message}`);
  process.exit(1);
}

// Basic console logger for elwiz main
const logger = {
  info: (message) => console.log(`[ElWiz INFO] ${message}`),
  error: (message) => console.error(`[ElWiz ERROR] ${message}`),
  debug: (message) => {
    if (config.DEBUG) console.log(`[ElWiz DEBUG] ${message}`);
  },
};

const messageFormat = config.messageFormat || 'raw';
const meterModel = config.meterModel;
const meterPath = `./ams/${meterModel}.js`;
try {
  require(meterPath);
  logger.info(`Meter module ${meterPath} loaded.`);
} catch (error) {
  logger.error(`[Main] Fatal error loading meter module ${meterPath}: ${error.message}`);
  process.exit(1);
}

const watchValue = config.watchValue || 15;

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions || {};
const elwizMqttClient = new MQTTClient(mqttUrl, mqttOpts, 'ElWizMain', logger);

const priceCalcEnabled = !!(config.computePrices || config.calculateCost);

// Instantiate PriceService
const priceServiceInstance = new PriceService(
  elwizMqttClient,
  {
    priceTopic: config.priceTopic,
    debug: config.DEBUG, // Pass general debug flag to priceService config
    manualFeed: priceCalcEnabled,
  },
  logger,
  event,
);

// Optionally initialize price calculation module to enrich prices before they reach PriceService
if (priceCalcEnabled) {
  const PriceCalc = require('./lib/common/priceCalc.js');
  const priceCalc = new PriceCalc({
    mqttClient: elwizMqttClient,
    priceService: priceServiceInstance,
    config: {
      priceTopic: config.priceTopic,
      priceInterval: config.priceInterval,
      debug: config.mergeprices?.debug || config.DEBUG,
      supplierKwhPrice: config.supplierKwhPrice,
      supplierVatPercent: config.supplierVatPercent,
      supplierMonthPrice: config.supplierMonthPrice,
      gridKwhPrice: config.gridKwhPrice,
      gridVatPercent: config.gridVatPercent,
      gridMonthPrice: config.gridMonthPrice,
      energyTax: config.energyTax,
      energyDayPrice: config.energyDayPrice,
      energyNightPrice: config.energyNightPrice,
      dayHoursStart: config.dayHoursStart,
      dayHoursEnd: config.dayHoursEnd,
    },
    logger,
  });
  void priceCalc; // Retain instance for its MQTT side effects.
}

// Initialize mergeprices plugin with the PriceService instance
mergePricesPlugin.initialize(priceServiceInstance);

let pulseTopics = []; // Renamed from 'topic' to avoid conflict
if (config.topic) {
  // Ensure config.topic exists before pushing
  pulseTopics.push(config.topic);
} else {
  pulseTopics.push('tibber'); // Default if not specified
  logger.warn("MQTT topic for Tibber Pulse not specified in config, using default 'tibber'");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await elwizMqttClient.waitForConnect(); // Ensure MQTT client is connected before Pulse class tries to use it

  class Pulse {
    constructor() {
      this.debug = config.DEBUG || false;
      this.mqttClient = elwizMqttClient;
      this.timerValue = watchValue;
      this.timerExpired = false;
      this.init();
      if (notice && typeof notice.run === 'function') {
        notice.run();
      } else {
        logger.warn('Notice module or run method not available.');
      }
    }

    async init() {
      await delay(1500);
      setInterval(() => this.watch(), 1000);
      logger.info(`${programName} is performing, PID: ${programPid}`);

      pulseTopics.forEach((t) => {
        this.mqttClient.subscribe(t, (err) => {
          if (err) {
            logger.error(`MQTT subscription error for Pulse topic "${t}": ${err}`);
          } else {
            logger.info(`Listening on "${mqttUrl}" for Pulse messages with topic "${t}"`);
          }
        });
      });

      event.emit('notice', config.greetMessage || 'ElWiz is performing...');
      logger.info('ElWiz Pulse instance initialized.');
      this.run(); // Start the message listener
    }

    watch() {
      if (!this.timerExpired) {
        this.timerValue--;
      }
      if (this.timerValue <= 0 && !this.timerExpired) {
        event.emit('notice', config.offlineMessage || 'Pulse is offline!');
        this.timerExpired = true;
        this.timerValue = 0;
        logger.info('Pulse is offline!');
      }
    }

    async run() {
      this.mqttClient.on('message', (msgTopic, msgPayload) => {
        if (pulseTopics.includes(msgTopic)) {
          // Process only messages from configured Pulse topics
          this.timerValue = watchValue; // Reset watchdog on receiving relevant message
          this.timerExpired = false;

          if (messageFormat === 'json') {
            try {
              event.emit(meterModel, {
                topic: msgTopic,
                message: JSON.parse(msgPayload.toString()),
              });
            } catch (e) {
              logger.error(`Error parsing JSON message from Pulse: ${e.message}`);
            }
          } else {
            const buf = Buffer.from(msgPayload);
            this.processMessage(buf);
          }
        }
      });
      logger.info('ElWiz Pulse message processor is running.');
    }

    processMessage(buf) {
      if (buf[0] === 0x08) {
        const indexOf7e = buf.indexOf(0x7e);
        if (indexOf7e !== -1) {
          buf = buf.slice(indexOf7e);
        }
      }
      const messageType = buf[0];

      if (messageType === 0x2f) {
        // OBIS
        const msg = buf.toString();
        event.emit('obis', msg);
      } else if (messageType === 0x7b) {
        // JSON status from some Pulse versions
        const msg = buf.toString();
        event.emit('status', msg);
      } else if (messageType === 0x7e) {
        // HDLC frame (AMS data)
        this.processMeterData(buf);
      } else if (messageType === 'H' && buf.length === 1) {
        // Possible "Hello" or keep-alive from some Pulse fw
        const msg = buf.toString();
        event.emit('hello', msg); // Assuming 'hello' event is handled or just for debug
        if (this.debug) logger.debug(`Received 'hello' message from Pulse: ${msg}`);
      } else {
        const msg = buf.toString();
        // Avoid logging every unknown message if it's too noisy, or add specific checks
        if (this.debug) logger.debug(`Received unhandled message type or string from Pulse (first byte: ${buf[0]}): ${msg.slice(0, 50)}...`);
        event.emit('notice', msg); // Generic notice for unhandled
      }
    }

    processMeterData(buf) {
      // Simplified length check, actual HDLC parsing might be more complex
      if (buf.length > 2) {
        // Basic check for some payload
        // Assuming the full buffer is the meter data if it starts with 0x7e
        event.emit('pulse', buf);
      } else {
        if (this.debug) logger.debug(`Invalid meter data buffer received (too short): ${buf.toString('hex')}`);
      }
    }
  }

  const pulse = new Pulse();
  // run() is called from init() now
  // await pulse.run();
})();
