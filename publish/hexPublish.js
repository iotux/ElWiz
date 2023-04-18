
const yaml = require("yamljs");
const configFile = "./config.yaml";
const Mqtt = require('../mqtt/mqtt.js');
const { event } = require('../misc/misc.js');
const config = yaml.load(configFile);
const mqttClient = Mqtt.mqttClient();

const debugTopic = config.debugTopic || 'elwiz/debug';

/*
 *
*/
function onEvent1(hex) {
  if (debug)
    console.log('List1: hexPublish',hex);
  mqttClient.publish(debugTopic + "/list1", hex);
}

function onEvent2(hex) {
  if (debug)
    console.log('List2: hexPublish', hex);
  mqttClient.publish(debugTopic + "/list2", hex);
}

function onEvent3(hex) {
  if (debug)
    console.log('List3: hexPublish', hex);
  mqttClient.publish(debugTopic + "/list3", hex);
}

const hexPublish = {
  isVirgin: true,

  init: function () {
    // Run once
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('hex1', onEvent1);
      event.on('hex2', onEvent2);
      event.on('hex3', onEvent3);
    }
  }
}

module.exports = hexPublish;
