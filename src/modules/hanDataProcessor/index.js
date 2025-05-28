// src/modules/hanDataProcessor/index.js
'use strict';

// Assuming ams/kaifa.js is at the root ams/ directory, adjust path if ams is also under src/
// From src/modules/hanDataProcessor/index.js to root/ams/kaifa.js is ../../../ams/kaifa.js
// const kaifaDriver = require('../../../ams/kaifa.js'); // Loaded dynamically below

class HanDataProcessorModule {
  constructor(moduleConfig, mainLogger, eventBusInstance) {
    this.moduleName = 'HanDataProcessorModule';
    this.config = moduleConfig || {}; // Expected: { debug: boolean, meterModel: string }
    this.logger = mainLogger;
    this.eventBus = eventBusInstance;

    this.debug = this.config.debug || false;
    this.meterModel = this.config.meterModel || null; // e.g., 'kaifa', 'aidon', etc.

    if (!this.meterModel) {
      this.logger.warn(this.moduleName, 'meterModel is not configured. HAN data processing will be limited.');
    }
    if (!this.eventBus) {
      throw new Error('eventBusInstance is required for HanDataProcessorModule.');
    }
    if (!this.logger) {
      // Fallback logger if none provided
      this.logger = {
        debug: console.debug,
        info: console.info,
        warn: console.warn,
        error: console.error,
      };
      this.logger.warn(this.moduleName, 'mainLogger not provided, using console fallback.');
    }

    this.logger.info(this.moduleName, `Initialized. Configured meterModel: '${this.meterModel}'. Debug: ${this.debug}`);
  }

  start() {
    this.logger.info(this.moduleName, 'Starting...');
    if (!this.eventBus || typeof this.eventBus.on !== 'function') {
      this.logger.error(this.moduleName, 'Event bus is not available or does not have an "on" method. Cannot subscribe to han:data.');
      return;
    }

    this.eventBus.on('han:data', this.handleHanData.bind(this));
    this.logger.info(this.moduleName, "Subscribed to 'han:data' event.");
  }

  handleHanData(eventPayload) {
    if (this.debug) {
      this.logger.debug(this.moduleName, "Received 'han:data' event:", JSON.stringify(eventPayload, null, 2));
    }

    // If data was successfully parsed as JSON by HanReaderModule, it might not be for our binary decoders.
    // However, some systems might send binary data wrapped in a JSON string.
    // For this Kaifa DLMS decoder, we expect raw binary (hex string) data.
    // HanReaderModule sets jsonData if JSON.parse succeeds, and parseError if it fails.
    // We are interested in cases where jsonData is null and there's a rawPayload.

    if (eventPayload.jsonData) {
      if (this.debug) {
        this.logger.debug(this.moduleName, 'Event payload contains pre-parsed JSON data. Skipping binary DLMS decoding for this payload.');
        console.log(eventPayload.jsonData);
      }
      return;
    }

    if (!eventPayload.rawPayload) {
      this.logger.warn(this.moduleName, "Received 'han:data' without rawPayload. Cannot process.");
      return;
    }

    // Determine which driver to use
    if (this.meterModel === 'kaifa') {
      try {
        // Dynamically require the driver to ensure fresh state if ever needed,
        // though typically require caches. Path from src/modules/hanDataProcessor/ to ams/
        const kaifaDriver = require('../../../ams/kaifa.js');

        // We assume eventPayload.rawPayload is a hex string of the HAN frame.
        // HanReaderModule currently does `message.toString()`. If the MQTT message is pure binary,
        // this rawPayload might be a garbled UTF-8 string.
        // For robust operation, the data source feeding MQTT topic handled by HanReaderModule
        // should publish the binary data as a hex-encoded string.
        // If rawPayload is NOT a hex string, it needs conversion here.
        // For now, we proceed assuming rawPayload IS the hex string.
        const hexPayload = eventPayload.rawPayload;

        if (this.debug) {
          this.logger.debug(this.moduleName, `Attempting to decode Kaifa payload: ${hexPayload.substring(0, 100)}...`);
        }

        const decodedData = kaifaDriver.decodeKaifaPayload(hexPayload);

        if (this.debug) {
          this.logger.debug(this.moduleName, 'Kaifa data decoded successfully:', JSON.stringify(decodedData, null, 2));
        }

        // Emit a general event with the structured data
        this.eventBus.emit('han:decoded:kaifa', {
          sourceTimestamp: eventPayload.receivedAt,
          meterModel: 'kaifa',
          decoded: decodedData,
        });

        // Optionally, emit more specific events based on decodedData content
        // Example: if (decodedData.elements['1.0.1.7.0.255']) {
        //   this.eventBus.emit('ams:kaifa:activePower', decodedData.elements['1.0.1.7.0.255']);
        // }
      } catch (error) {
        this.logger.error(this.moduleName, `Error decoding Kaifa data: ${error.message}. Raw payload: ${eventPayload.rawPayload.substring(0, 100)}...`, error.stack);
        this.eventBus.emit('han:decodeError:kaifa', {
          sourceTimestamp: eventPayload.receivedAt,
          meterModel: 'kaifa',
          error: error.message,
          rawPayload: eventPayload.rawPayload,
          stack: error.stack,
        });
      }
    } else if (this.meterModel) {
      if (this.debug) {
        this.logger.debug(this.moduleName, `Meter model '${this.meterModel}' is configured, but no specific decoder implemented for it here yet.`);
      }
    } else {
      // No meterModel configured, or not 'kaifa'.
      // Do nothing, or log if necessary.
      if (this.debug && !this.meterModel) {
        this.logger.debug(this.moduleName, 'No meterModel configured, cannot attempt decoding.');
      }
    }
  }

  stop() {
    this.logger.info(this.moduleName, 'Stopping...');
    if (this.eventBus && typeof this.eventBus.off === 'function') {
      this.eventBus.off('han:data', this.handleHanData.bind(this)); // Important to bind 'this' correctly for off too
      this.logger.info(this.moduleName, "Unsubscribed from 'han:data' event.");
    }
  }
}

module.exports = HanDataProcessorModule;
