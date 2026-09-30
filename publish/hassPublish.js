const MQTTClient = require('../misc/mqtt');
const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js');

const { hassAnnounce } = require('../publish/hassAnnounce.js');

const configFile = './config.yaml';
const config = loadYaml(configFile);

const debug = config.publish.debug || false;
const debugTopic = config.debugTopic + '/';
const haBaseTopic = config.haBaseTopic + '/' || 'elwiz/';
// All elwiz/sensor/* state topics are published with the same options no
// matter which list (1, 2 or 3) triggered the publish. The same topic can
// be fed by several lists (e.g. consumptionCurrentHour from the frequent
// list1 messages and from the hourly list3 message), so using the per-list
// retain flags would make the topic alternate between retained and
// non-retained - and a non-retained publish clears the broker's retained
// value, leaving late subscribers without a value until the next hour.
const sensorOpts = { retain: true, qos: 1 };

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
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), sensorOpts);
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
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), sensorOpts);
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
    mqttClient.publish(haBaseTopic + 'sensor/' + key, JSON.stringify(value, null, config.DEBUG ? 2 : 0), sensorOpts);
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
