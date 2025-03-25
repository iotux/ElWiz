const MQTTClient = require("../mqtt/mqtt");
const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js');

const configFile = './config.yaml';
const config = loadYaml(configFile);

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'pulseControl');

const controlTopic = config.pulseControlTopic || 'rebbit';
const refreshMessage = config.pulseRefreshMessage || 'batching_disable';
const refreshInterval = config.pulseRefreshInterval || "-1";

mqttClient.waitForConnect();

function onContolEvent(obj) {
  mqttClient.publish(`${controlTopic}`, `${refreshMessage} ${refreshInterval}`, { retain: true, qos: 1 });
}

const pulseControl = {
  isVirgin: true,
  init: function() {
    if (this.isVirgin) {
      this.isVirgin = false;
      //event.on('publish1', onContolEvent);
      //event.on('publish2', onContolEvent);
      event.on('publish3', onContolEvent);
    }
  }
};

pulseControl.init();
module.exports = { pulseControl };
