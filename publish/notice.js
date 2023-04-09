const yaml = require('yamljs');
const { event } = require('../misc/misc.js');
const { upTime, getMacAddress } = require('../misc/util.js');
const Mqtt = require('../mqtt/mqtt.js');

const configFile = './config.yaml';
const config = yaml.load(configFile);

let client;

/**
 * Formats status data.
 *
 * @param {Object} obj - The status object.
 * @returns {Object} - Formatted status data.
 */
function formatStatusData(obj) {
  return {
    tibberVersion: obj.Build,
    hardWare: obj.Hw,
    ID: obj.ID,
    //MAC: getMacAddress(obj.ID),
    //upTime: upTime(obj.Uptime),
    SSID: obj.ssid,
    rssi: obj.rssi,
    wifiFail: obj.wififail,
  };
}

/**
 * Handles status events.
 *
 * @param {Object} obj - The status object.
 */
function onStatus(obj) {
  const statusData = formatStatusData(obj);

  if (config.DEBUG) {
    console.log('onStatus:', statusData);
  }

  client.publish(config.pubStatus, JSON.stringify(statusData, !config.DEBUG, 2), config.statOpts);
}

/**
 * Handles hello events.
 *
 * @param {Object} obj - The hello object.
 */
function onHello(obj) {
  client.publish(config.pubNotice, config.greetMessage, config.statOpts);

  if (config.DEBUG) {
    console.log('Notice: Pulse is starting: ' + config.pubNotice);
  }
}

/**
 * Handles notice events.
 *
 * @param {Object} obj - The notice object.
 */
function onNotice(obj) {
  client.publish(config.pubNotice, JSON.stringify(obj), config.statOpts);

  if (config.DEBUG) {
    console.log('Notice: Event message: ' + config.pubNotice, JSON.stringify(obj, !config.DEBUG, 2));
  }
}

const notice = {
  isVirgin: true,
  broker: undefined,
  mqttOptions: {},

  /**
   * Initializes the notice module.
   */
  init: function () {
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('hello', onHello);
      event.on('status', onStatus);
      event.on('notice', onNotice);
      client = Mqtt.mqttClient();
    }
  },

  /**
   * Runs the notice module with the given list and object.
   *
   * @param {Array} list - The list of items.
   * @param {Object} obj - The object containing data.
   */
  run: function (list, obj) {
    this.init();
  },
};

module.exports = notice;
