
const configFile = './config.yaml';
const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js')
const config = loadYaml(configFile);
const MQTTClient = require("../mqtt/mqtt");

const debug = config.DEBUG || false;
const debugTopic = config.debugTopic || 'elwiz/debug';

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'hassPublish');
mqttClient.waitForConnect();

function onEvent1(hex) {
  if (debug) { console.log('List1: hexPublish', hex); }
  mqttClient.publish(debugTopic + '/list1', hex);
}

function onEvent2(hex) {
  if (debug) { console.log('List2: hexPublish', hex); }
  mqttClient.publish(debugTopic + '/list2', hex);
}

function onEvent3(hex) {
  if (debug) { console.log('List3: hexPublish', hex); }
  mqttClient.publish(debugTopic + '/list3', hex);
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
};

hexPublish.init();
module.exports = hexPublish;
