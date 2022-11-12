
const fs = require('fs');
const yaml = require("yamljs");
const mqtt = require("mqtt");

const configFile = "./config.yaml";
const config = yaml.load(configFile);

/*
 *
 *
 *
*/

const MQTT = {
  virgin: true,
  client: undefined,
  broker: undefined,
  mqttOptions: {},

  init: function () {
    if (this.virgin) {
      this.virgin = false;

      if (config.mqttBroker === null) {
        console.log("\nBroker IP address or hostname missing");
        console.log("Edit your \"config.yaml\" file\n");
        process.exit(0);
      }
      
      this.broker = config.mqttBroker + ":" + config.brokerPort;
      this.mqttOptions = {
        userName: config.userName, password: config.password,
        will: {
          topic: config.pubNotice, payload: config.willMessage,
        }
      };

      this.client = mqtt.connect("mqtt://" + this.broker, this.mqttOptions);
      this.client.on("error", function (err) {
      if (err.errno === "ENOTFOUND") {
        console.log("\nNot connectd to broker");
        console.log("Check your \"config.yaml\" file\n")
        process.exit(0);
      } else
        console.log("Client error: ", err);
      });
    }
  },

  mqttClient: function () {
    this.init();
    if (this.client !== undefined) {
      return this.client;
    } else {
      console.log("Check your \"config.yaml\" file\n")
    }
  }
}

module.exports = MQTT;