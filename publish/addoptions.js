
const yaml = require("yamljs");
const { event } = require('../misc/misc.js');
const Mqtt = require('../mqtt/mqtt.js');

const configFile = "./config.yaml";
const config = yaml.load(configFile);

let client;

/*
 *
 *
 *
*/
function addOptions1(obj) {
  delete obj.timestamp;
  console.log('List1: addoptions',obj);
  //forward(obj);
}

function addOptions2(obj) {
  console.log('List2: addoptions',obj);
  //forward(obj);
}

function addOptions3(obj) {
  console.log('List3: addoptions', obj);
  //forward(obj);
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
      client = Mqtt.mqttClient();
    }
  },    
  run: function (list, obj) {
    this.init()
  }
}

module.exports = publish;
