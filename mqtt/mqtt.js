const mqtt = require('mqtt');

class MQTTClient {
  constructor(brokerUrl, mqttOptions = {}, caller = null) {
    this.brokerUrl = brokerUrl;
    this.mqttOptions = mqttOptions;
    this.caller = caller;
    this.connected = false;
    this.onConnectResolve = null;

    this.client = this.init();
  }

  init() {
    this.client = mqtt.connect(this.brokerUrl, this.mqttOptions);

    this.client.on('error', (err) => {
      if (err.errno === 'ENOTFOUND') {
        console.log('\nNot connected to broker');
        console.log('Check your configuration\n');
        process.exit(0);
      } else {
        console.log('Client error: ', err);
      }
    });

    this.client.on('close', () => {
      this.connected = false;
      console.log(`Disconnected from ${this.brokerUrl} Attempting to reconnect...`);
      this.client.reconnect();
    });

    this.client.on('connect', () => {
      this.connected = true;
      if (this.caller === null) {
        console.log(`Connected to ${this.brokerUrl}`);
      } else {
        console.log(`Connected to ${this.brokerUrl} from ${this.caller}`);
      }
      if (this.onConnectResolve) {
        this.onConnectResolve();
      }
    });

    return this.client;
  }

  async waitForConnect() {
    return new Promise((resolve) => {
      if (this.connected) {
        resolve();
      } else {
        this.onConnectResolve = resolve;
      }
    });
  }

  publish(topic, message, options) {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, options, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  subscribe(topic, options) {
    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, options, (err, granted) => {
        if (err) {
          reject(err);
        } else {
          resolve(granted);
        }
      });
    });
  }

  on(event, callback) {
    this.client.on(event, callback);
  }
}

module.exports = MQTTClient;
