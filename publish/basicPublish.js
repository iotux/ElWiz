const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js');
const MQTTClient = require('../misc/mqtt');

const configFile = './config.yaml';
const config = loadYaml(configFile);

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'hassPublish');
mqttClient.waitForConnect();

/*
 * Publishes a plain basic object with only Pulse data
 * and possibly price and cost information
 */
function onPubEvent1(obj) {
  delete obj.timestamp;
  obj.publisher = 'basicPublish';
  console.log('List1: basicPublish', obj);
  // forward(obj);
  mqttClient.publish(config.pubTopic + '/list1', JSON.stringify(obj, !config.DEBUG, 2), config.list1Opts);
}

function onPubEvent2(obj) {
  console.log('List2: basicPublish', obj);
  // forward(obj);
  mqttClient.publish(config.pubTopic + '/list2', JSON.stringify(obj, !config.DEBUG, 2), config.list2Opts);
}

function onPubEvent3(obj) {
  console.log('List3: basicPublish', obj);
  mqttClient.publish(config.pubTopic + '/list3', JSON.stringify(obj, !config.DEBUG, 2), config.list3Opts);
  // forward(obj);
}

const publish = {
  // Plugin constants
  isVirgin: true,
  broker: undefined,
  mqttOptions: {},

  init: function () {
    // Run once
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('publish1', onPubEvent1);
      event.on('publish2', onPubEvent2);
      event.on('publish3', onPubEvent3);
      client = Mqtt.mqttClient();
    }
  },
};

publish.init();
module.exports = publish;
