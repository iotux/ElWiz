
const yaml = require("yamljs");
const configFile = "./config.yaml";
const Mqtt = require('../mqtt/mqtt.js');
const { event } = require('../misc/misc.js');

const config = yaml.load(configFile);

const debug = false;
const debugTopic = config.debugTopic;
let client;

/*
 *
*/
function onHexEvent1(hex) {
  if (debug)
    console.log('List1: hexPublish',hex);
  client.publish(debugTopic + "/list1", hex);
}

function onHexEvent2(hex) {
  if (debug)
    console.log('List2: hexPublish', hex);
  client.publish(debugTopic + "/list2", hex);
}

function onHexEvent3(hex) {
  if (debug)
    console.log('List3: hexPublish', hex);
  client.publish(debugTopic + "/list3", hex);
}

const hexPublish = {
  isVirgin: true,

  init: function () {
    // Run once
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('hex1', onHexEvent1);
      event.on('hex2', onHexEvent2);
      event.on('hex3', onHexEvent3);
      client = Mqtt.mqttClient();
    }
  }
}

module.exports = hexPublish;
