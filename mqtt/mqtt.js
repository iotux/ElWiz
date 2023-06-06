
const yaml = require('yamljs');
const mqtt = require('mqtt');

const configFile = './config.yaml';

/*
 *
 *
 *
*/

let config;
try {
  config = yaml.load(configFile);
} catch (err) {
  console.error('Error loading config.yaml:', err.message);
  process.exit(1);
}

// const requiredConfigKeys = ['mqttBroker', 'brokerPort', 'userName', 'password', 'pubNotice', 'willMessage'];
const requiredConfigKeys = ['mqttBroker', 'brokerPort', 'pubNotice', 'willMessage'];
for (const key of requiredConfigKeys) {
  if (!config.hasOwnProperty(key) || config[key] === null) {
    console.error(`Missing configuration value: ${key}`);
    console.error('Edit your "config.yaml" file');
    process.exit(1);
  }
}

const MQTT = {
  virgin: true,
  client: undefined,
  broker: undefined,
  connected: false,
  mqttOptions: {},

  isConnected: function () {
    return this.connected;
  },

  init: function () {
    if (this.virgin) {
      this.virgin = false;

      if (config.mqttBroker === null) {
        console.log('\nBroker IP address or hostname missing');
        console.log('Edit your "config.yaml" file\n');
        process.exit(0);
      }

      this.broker = config.mqttBroker + ':' + config.brokerPort;
      this.mqttOptions = {
        username: config.userName,
        password: config.password,
        will: {
          topic: config.pubNotice,
          payload: config.willMessage
        }
      };

      this.client = mqtt.connect('mqtt://' + this.broker, this.mqttOptions);

      this.client.on('error', function (err) {
        if (err.errno === 'ENOTFOUND') {
          console.log('\nNot connectd to broker');
          console.log('Check your "config.yaml" file\n');
          process.exit(0);
        } else { console.log('Client error: ', err); }
      });

      this.client.on('close', () => {
        console.log('Disconnected from the MQTT broker. Attempting to reconnect...');
        this.client.reconnect();
      });

      this.client.on('connect', () => {
        console.log('Connected to MQTT broker...');
        this.connected = true;
      });

    }
  },

  mqttClient: function () {
    this.init();
    if (this.client !== undefined) {
      return this.client;
    } else {
      console.log('Check your "config.yaml" file\n');
    }
  }
};

module.exports = MQTT;
