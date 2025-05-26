// src/modules/hanReader/index.js
const MQTTClient = require('../../../mqtt/mqtt'); // Path relative to this file

class HanReaderModule {
  constructor(moduleConfig, mainLogger, eventBusInstance) {
    this.config = moduleConfig; // Expected: { enabled, debug, hanMqttTopic, mqtt: { url, options, clientName } }
    this.logger = mainLogger;
    this.eventBus = eventBusInstance;
    this.moduleName = 'HanReaderModule';

    this.hanMqttTopic = this.config.hanMqttTopic || 'elwiz-ng/han/data'; // Default topic, user MUST configure this
    this.debug = this.config.debug || false;

    // MQTT Client Setup
    const mqttUrl = this.config.mqtt?.url || 'mqtt://localhost:1883';
    const mqttOpts = this.config.mqtt?.options || {};
    const clientName = this.config.mqtt?.clientName || 'ElWiz_HanReaderModule_Client';

    const mqttLogger = {
      debug: (message, ...args) => this.logger.debug(clientName, message, ...args),
      info: (message, ...args) => this.logger.info(clientName, message, ...args),
      warn: (message, ...args) => this.logger.warn(clientName, message, ...args),
      error: (message, ...args) => this.logger.error(clientName, message, ...args),
    };
    this.mqttClient = new MQTTClient(mqttUrl, mqttOpts, clientName, mqttLogger);

    this.logger.info(this.moduleName, `Initialized. Will listen on MQTT topic: ${this.hanMqttTopic}`);
  }

  start() {
    this.logger.info(this.moduleName, 'Starting HanReaderModule...');
    this._connectMqttAndSubscribe();
  }

  _connectMqttAndSubscribe() {
    this.mqttClient.on('connect', () => {
      this.logger.info(this.moduleName, 'MQTT client connected. Subscribing to HAN data topic.');
      this._subscribeToHanTopic();
    });

    if (this.mqttClient.connected) {
      this.logger.info(this.moduleName, 'MQTT client was already connected. Subscribing to HAN data topic.');
      this._subscribeToHanTopic();
    }
    // MQTTClient wrapper should handle reconnections and re-subscriptions.
  }

  _subscribeToHanTopic() {
    this.mqttClient.subscribe(this.hanMqttTopic, (err) => {
      if (err) {
        this.logger.error(this.moduleName, `Subscription error for ${this.hanMqttTopic}: ${err.message}`);
      } else {
        if (this.debug) this.logger.debug(this.moduleName, `Subscribed to ${this.hanMqttTopic}`);
      }
    });

    this.mqttClient.on('message', (topic, message) => {
      // Check if the message is on the HAN topic (in case of wildcard subscriptions, though not used here)
      if (topic === this.hanMqttTopic) {
        const rawPayload = message.toString();
        if (this.debug) this.logger.debug(this.moduleName, `Received MQTT message on ${topic}: ${rawPayload}`);

        let parsedData = null;
        let parseError = null;

        // Placeholder for actual parsing logic based on user's Z-Wave to MQTT gateway output
        // For now, try a generic JSON.parse and log success/failure.
        // User will need to provide payload structure to make this useful.
        try {
          parsedData = JSON.parse(rawPayload);
          if (this.debug) this.logger.debug(this.moduleName, 'Successfully parsed HAN data as JSON.');
        } catch (e) {
          parseError = e.message;
          if (this.debug) this.logger.warn(this.moduleName, `Could not parse HAN data as JSON: ${parseError}. Will emit raw payload.`);
          // If not JSON, parsedData remains null, rawPayload will be emitted.
        }

        const eventPayload = {
          receivedAt: new Date().toISOString(),
          topic: topic,
          rawPayload: rawPayload,
          jsonData: parsedData, // Will be null if JSON.parse failed
          parseError: parseError, // Will be null if JSON.parse succeeded
        };

        this.eventBus.emit('han:data', eventPayload);
        if (this.debug) this.logger.debug(this.moduleName, "Emitted 'han:data' event.", eventPayload);
      }
    });
  }
}

module.exports = HanReaderModule;
