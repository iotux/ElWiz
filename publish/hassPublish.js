
const yaml = require('yamljs');
const configFile = './config.yaml';
const Mqtt = require('../mqtt/mqtt.js');
const { event } = require('../misc/misc.js');
const { hassAnnounce } = require('./hassAnnounce.js');

const config = yaml.load(configFile);

const hassDebug = config.hassDebug || false;
const debugTopic = config.debugTopic + '/';
const haBaseTopic = config.haBaseTopic + '/' || 'elwiz/';
const list1Opts = { retain: config.list1Retain, qos: config.list1Qos };
const list2Opts = { retain: config.list2Retain, qos: config.list2Qos };
const list3Opts = { retain: config.list3Retain, qos: config.list3Qos };
let mqttClient;

/*
 *
*/
function onPubEvent1(obj) {
  delete obj.timestamp;
  delete obj.isLastList2;
  delete obj.isNewHour;
  delete obj.isNewDay;
  delete obj.isNewMonth;
  obj.publisher = 'hassPublish';
  if (hassDebug) { console.log('List1: hassPublish', obj); }
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    //const pre = ['on', 'off', 'ON', 'OFF', true, false].includes(value) ? 'binary_' : '';
    //mqttClient.publish(haBaseTopic + pre + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list1Opts);
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list1Opts);
  }
}

function onPubEvent2(obj) {
  delete obj.meterVersion;
  delete obj.meterID;
  delete obj.meterModel;
  delete obj.isLastList2;
  delete obj.isNewHour;
  delete obj.isNewDay;
  delete obj.isNewMonth;
  obj.publisher = 'hassPublish';
  if (hassDebug) { console.log('List2: hassPublish', obj); }
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    //const pre = ['on', 'off', 'ON', 'OFF', true, false].includes(value) ? 'binary_' : '';
    //mqttClient.publish(haBaseTopic + pre + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list2Opts);
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list2Opts);
  }
}

function onPubEvent3(obj) {
  //delete obj.meterVersion;
  //delete obj.meterID;
  //delete obj.meterModel;
  delete obj.isLastList2;
  delete obj.isNewHour;
  delete obj.isNewDay;
  delete obj.isNewMonth;
  obj.publisher = 'hassPublish';
  if (hassDebug) { console.log('List3: hassPublish', obj); }
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    //const pre = ['on', 'off', 'ON', 'OFF', true, false].includes(value) ? 'binary_' : '';
    //mqttClient.publish(haBaseTopic + pre + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list3Opts);
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list3Opts);
  }
}

function onHexEvent1(hex) {
  if (hassDebug) { console.log('List1: hexPublish', hex); }
  mqttClient.publish(debugTopic + 'list1', hex);
}

function onHexEvent2(hex) {
  if (hassDebug) { console.log('List2: hexPublish', hex); }
  mqttClient.publish(debugTopic + 'list2', hex);
}

function onHexEvent3(hex) {
  if (hassDebug) { console.log('List3: hexPublish', hex); }
  mqttClient.publish(debugTopic + 'list3', hex);
}

const hasspublish = {
  isVirgin: true,

  init: function () {
    // Run once
    if (this.isVirgin) {
      this.isVirgin = false;
      mqttClient = Mqtt.mqttClient();
      event.on('publish1', onPubEvent1);
      event.on('publish2', onPubEvent2);
      event.on('publish3', onPubEvent3);
      event.on('hex1', onHexEvent1);
      event.on('hex2', onHexEvent2);
      event.on('hex3', onHexEvent3);

      hassAnnounce();
    }
  }
};

hasspublish.init();
module.exports = hasspublish;
