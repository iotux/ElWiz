const { event } = require('../misc/misc.js');
const { upTime, getMacAddress, loadYaml } = require('../misc/util.js');
const MQTTClient = require('../misc/mqtt');

const configFile = './config.yaml';
const config = loadYaml(configFile);

const mqttUrl = config.mqttUrl; // || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'notice');
mqttClient.waitForConnect();
/**
 * Formats status data.
 *
 * @param {Object} obj - The status object.
 * @returns {Object} - Formatted status data.
 */
function formatStatusData(data) {
  const obj = JSON.parse(data);
  return obj;
  return {
    tibberVersion: obj.status.Build || 'unknown',
    hardWare: obj.status.Hw || 'unknown',
    ID: obj.status.ID || 'unknown',
    MAC: getMacAddress(obj.status.ID) || 'unknown',
    upTime: upTime(obj.status.Uptime) || 'unknown',
    SSID: obj.status.ssid || 'unknown',
    rssi: obj.status.rssi || 'unknown',
    wifiFail: obj.status.wififail || 'unknown',
    meter: obj.status.meter || 'unknown',
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

  mqttClient.publish(config.pubStatus, JSON.stringify(statusData, !config.DEBUG, 2), { qos: 1, retain: true });
}

/**
 * Handles notice events.
 *
 * @param {Object} msg - The notice message.
 */
function onNotice(msg) {
  if (msg === typeof Object) {
    mqttClient.publish(config.pubNotice, JSON.stringify(msg), config.statOpts);
    if (config.DEBUG) {
      console.log('Notice: Event message: ' + config.pubNotice, JSON.stringify(msg, !config.DEBUG, 2));
    }
  } else {
    mqttClient.publish(config.pubNotice, msg, config.statOpts);
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
      event.on('status', onStatus);
      event.on('notice', onNotice);
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
