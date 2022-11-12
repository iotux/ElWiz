
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
function status(obj) {
  // Do something
  let data = {
    tibberVersion: obj.Build,
    hardWare: obj.Hw,
    ID: json.ID,
    MAC: getMacAddress(obj.ID),
    upTime: upTime(obj.Uptime),
    SSID: obj.ssid,
    rssi: obj.rssi,
    wifiFail: obj.wififail
  }
  if (config.DEBUG)
    console.log("onStatus:", data);
}

function onStatus(obj) {
  //let m = obj.toString();
  let msg = JSON.parse(obj);
  let status = msg.status;
  //if (config.republish && pulse.pulseStatus !== undefined)
    client.publish(config.pubStatus, JSON.stringify(status, !config.DEBUG, 2), config.statOpts);
  if (config.DEBUG)
    console.log("Notice: Pulse status: " + config.pubStatus + " ", JSON.parse(obj));
}

function onHello(obj) {
  //if (config.republish)
  client.publish(config.pubNotice, config.greetMessage, config.statOpts);
  if (config.DEBUG)
    console.log("Notice: Pulse is starting: " + config.pubNotice + " ", msg);
}

function onNotice(obj) {
  //if (config.republish)
    //client.publish(config.pubNotice, msg, pulse.statOpts);
    client.publish(config.pubNotice, JSON.stringify(obj), config.statOpts);
  if (config.DEBUG)
    console.log("Notice: Event message: " + config.pubNotice + " ", JSON.stringify(obj, !config.DEBUG, 2));
}

const notice = {
  // Plugin constants
  isVirgin: true,
  broker: undefined,
  mqttOptions: {},

  init: function () {
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('hello', onHello);
      event.on('status', onStatus);
      event.on('notice', onNotice);
      client = Mqtt.mqttClient();
    }
  },    
  run: function (list, obj) {
    this.init()
  }
}

module.exports = notice;