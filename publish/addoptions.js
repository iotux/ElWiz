
const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js');

//const MQTTClient = require("../mqtt/mqtt");
const configFile = './config.yaml';
const config = loadYaml(configFile);

const pubMqttUrl = config.publishMqttUrl || 'mqtt://localhost:1883';
const pubMqttOpts = config.publishMqttOptions;
//const pubClient = new MQTTClient(pubMqttUrl, pubMqttOpts, 'hassAnnounce');
//pubClient.waitForConnect();

function addOptions1(obj) {
  delete obj.timestamp;
  console.log('List1: addoptions', obj);
  // forward(obj);
}

function addOptions2(obj) {
  console.log('List2: addoptions', obj);
  // forward(obj);
}

function addOptions3(obj) {
  console.log('List3: addoptions', obj);
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
      event.on('list1', addOptions1);
      event.on('list2', addOptions2);
      event.on('list3', addOptions3);
    }
  },
  run: function (list, obj) {
    this.init();
  }
};

module.exports = publish;
