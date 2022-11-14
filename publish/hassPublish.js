
const yaml = require("yamljs");
const configFile = "./config.yaml";
const Mqtt = require('../mqtt/mqtt.js');
const { event } = require('../misc/misc.js');
const { hassAnnounce } = require('./hassAnnounce.js')

const config = yaml.load(configFile);

const debug = false;
const haBaseTopic = config.haBaseTopic + '/';
const list1Opts = { retain: config.list1Retain, qos: config.list1Qos };
const list2Opts = { retain: config.list2Retain, qos: config.list2Qos };
const list3Opts = { retain: config.list3Retain, qos: config.list3Qos };
let client;

/*
 *
*/
function onPubEvent1(obj) {
  delete obj.timestamp;
  obj.publisher = 'hassPublish';
  if (debug)
    console.log('List1: hassPublish',obj);
  //client.publish(haBaseTopic + "/list1", JSON.stringify(obj, !config.DEBUG, 2), list1Opts);
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    client.publish(haBaseTopic + key + "/state", JSON.stringify(value, !config.DEBUG, 2), list1Opts);
  }
}

function onPubEvent2(obj) {
  delete obj.meterVersion
  delete obj.meterID
  delete obj.meterModel
  obj.publisher = 'hassPublish';
  if (debug)
    console.log('List2: hassPublish', obj);
  //client.publish(haBaseTopic + "/list2", JSON.stringify(obj, !config.DEBUG, 2), list2Opts);
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    client.publish(haBaseTopic + key + "/state", JSON.stringify(value, !config.DEBUG, 2), list2Opts);
  }
}

function onPubEvent3(obj) {
  delete obj.meterVersion
  delete obj.meterID
  delete obj.meterModel
  obj.publisher = 'hassPublish';
  if (debug)
    console.log('List3: hassPublish', obj);
  //client.publish(haBaseTopic + "/state", JSON.stringify(obj, !config.DEBUG, 2), list3Opts);
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    client.publish(haBaseTopic + key + "/state", JSON.stringify(value, !config.DEBUG, 2), list3Opts);
  }
}

const hasspublish = {
  // Plugin constants
  isVirgin: true,

  init: function () {
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('publish1', onPubEvent1);
      event.on('publish2', onPubEvent2);
      event.on('publish3', onPubEvent3);
      client = Mqtt.mqttClient();
      hassAnnounce()
    }
  }
}

module.exports = hasspublish;
