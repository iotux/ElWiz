const MQTTClient = require('../mqtt/mqtt');
const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js');

const { hassAnnounce } = require('../publish/hassAnnounce.js');

const configFile = './config.yaml';
const config = loadYaml(configFile);

const debug = config.publish.debug || false;
const debugTopic = config.debugTopic + '/';
const haBaseTopic = config.haBaseTopic + '/' || 'elwiz/';
const list1Opts = { retain: config.list1Retain, qos: config.list1Qos };
const list2Opts = { retain: config.list2Retain, qos: config.list2Qos };
const list3Opts = { retain: config.list3Retain, qos: config.list3Qos };

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'hassPublish');
mqttClient.waitForConnect();

function onPubEvent1(obj) {
  obj.publisher = 'hassPublish';
  if (debug) {
    console.log('List1: hassPublish', JSON.stringify(obj, null, 2));
  }
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list1Opts);
  }
}

function onPubEvent2(obj) {
  delete obj.meterVersion;
  delete obj.meterID;
  delete obj.meterModel;
  obj.publisher = 'hassPublish';
  if (debug) {
    console.log('List2: hassPublish', JSON.stringify(obj, null, 2));
  }
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list2Opts);
  }
  if (!Number.isNaN(obj.lastMeterConsumption)) {
    mqttClient.publish(`${haBaseTopic}sensor/status`, 'online', { retain: true, qos: 0 });
  }
}

function onPubEvent3(obj) {
  obj.publisher = 'hassPublish';
  if (debug) {
    console.log('List3: hassPublish', JSON.stringify(obj, null, 2));
  }
  // Unfold JSON object
  for (const [key, value] of Object.entries(obj)) {
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), list3Opts);
  }
}

function onHexEvent1(hex) {
  mqttClient.publish(debugTopic + 'list1', hex);
}
function onHexEvent2(hex) {
  mqttClient.publish(debugTopic + 'list2', hex);
}
function onHexEvent3(hex) {
  mqttClient.publish(debugTopic + 'list3', hex);
}

const hasspublish = {
  isVirgin: true,

  init: async function () {
    // Run once
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('publish1', onPubEvent1);
      event.on('publish2', onPubEvent2);
      event.on('publish3', onPubEvent3);
      event.on('hex1', onHexEvent1);
      event.on('hex2', onHexEvent2);
      event.on('hex3', onHexEvent3);
      //await hassAnnounce();
    }
  },
};

hasspublish.init();
module.exports = hasspublish;
